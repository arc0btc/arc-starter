/**
 * fleet-escalation sensor
 *
 * Every 15 minutes, SSH into each fleet VM and query for blocked tasks.
 * For each new blocked task found:
 * 1. Create an escalation task on Arc's queue (P2)
 * 2. Track the escalation in memory/fleet-escalations.json
 * 3. Send email digest to whoabuddy if any new escalations
 */

import { join } from "node:path";
import {
  claimSensorRun,
  createSensorLogger,
  insertTaskIfNew,
} from "../../src/sensors.ts";
import {
  AGENTS,
  REMOTE_ARC_DIR,
  getAgentIp,
  getSshPassword,
  ssh,
} from "../../src/ssh.ts";
import { getCredential } from "../../src/credentials.ts";

const SENSOR_NAME = "fleet-escalation";
const INTERVAL_MINUTES = 15;

const log = createSensorLogger(SENSOR_NAME);

const MEMORY_DIR = new URL("../../memory", import.meta.url).pathname;
const ESCALATIONS_FILE = join(MEMORY_DIR, "fleet-escalations.json");

// ---- Types ----

interface BlockedTask {
  id: number;
  subject: string;
  result_summary: string | null;
  created_at: string;
  priority: number;
  skills: string | null;
}

interface EscalationRecord {
  agent: string;
  remoteTaskId: number;
  localTaskId: number;
  subject: string;
  reason: string;
  escalatedAt: string;
}

interface ClearedRecord {
  agent: string;
  remoteTaskId: number;
  localTaskId: number;
  clearedAt: string;
  resolution: string;
}

interface EscalationState {
  escalations: EscalationRecord[];
  lastChecked: string;
  cleared?: ClearedRecord[];
}

// ---- State management ----

async function loadState(): Promise<EscalationState> {
  try {
    const file = Bun.file(ESCALATIONS_FILE);
    if (await file.exists()) {
      return (await file.json()) as EscalationState;
    }
  } catch {
    // Corrupt file — start fresh
  }
  return { escalations: [], lastChecked: "" };
}

async function saveState(state: EscalationState): Promise<void> {
  await Bun.write(ESCALATIONS_FILE, JSON.stringify(state, null, 2));
}

function isAlreadyEscalated(
  state: EscalationState,
  agent: string,
  taskId: number,
): boolean {
  // Check both active escalations AND cleared ones — don't re-escalate what was already handled
  const inActive = state.escalations.some(
    (e) => e.agent === agent && e.remoteTaskId === taskId,
  );
  const inCleared = (state.cleared ?? []).some(
    (e) => e.agent === agent && e.remoteTaskId === taskId,
  );
  return inActive || inCleared;
}

// ---- Query remote blocked tasks ----

async function getBlockedTasks(
  agent: string,
  ip: string,
  password: string,
): Promise<BlockedTask[]> {
  const remoteCmd = `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun -e "
    const { Database } = require('bun:sqlite');
    const db = new Database('db/arc.sqlite', { readonly: true });
    const rows = db.query('SELECT id, subject, result_summary, created_at, priority, skills FROM tasks WHERE status = \\\\'blocked\\\\' ORDER BY priority ASC, created_at ASC LIMIT 20').all();
    console.log(JSON.stringify(rows));
    db.close();
  " 2>/dev/null`;

  const result = await ssh(ip, password, remoteCmd);
  if (!result.ok) {
    log(`${agent}: SSH query failed (exit ${result.exitCode})`);
    return [];
  }

  try {
    return JSON.parse(result.stdout.trim()) as BlockedTask[];
  } catch {
    log(`${agent}: failed to parse blocked tasks response`);
    return [];
  }
}

// ---- Email notification ----

async function emailWhoabuddy(
  newEscalations: EscalationRecord[],
): Promise<void> {
  const apiBaseUrl = await getCredential("email", "api_base_url");
  const adminKey = await getCredential("email", "admin_api_key");
  const recipient = await getCredential("email", "report_recipient");

  if (!apiBaseUrl || !adminKey || !recipient) {
    log("email credentials missing — skipping notification");
    return;
  }

  const lines = newEscalations.map(
    (e) =>
      `- [${e.agent}] Task #${e.remoteTaskId}: ${e.subject}\n  Reason: ${e.reason || "(no reason given)"}\n  Escalated as Arc task #${e.localTaskId}`,
  );

  const body = [
    `${newEscalations.length} fleet agent task(s) blocked and escalated to Arc:`,
    "",
    ...lines,
    "",
    "Review these on Arc's task queue or reply to this email with instructions.",
    "",
    "— Arc",
  ].join("\n");

  const subject = `Fleet escalation: ${newEscalations.length} blocked task(s) need attention`;

  try {
    const response = await fetch(`${apiBaseUrl}/api/send`, {
      method: "POST",
      headers: {
        "X-Admin-Key": adminKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: recipient,
        subject,
        body,
        from: "arc@arc0.me",
      }),
    });

    if (response.ok) {
      log(`email sent to whoabuddy: ${newEscalations.length} escalation(s)`);
    } else {
      const text = await response.text();
      log(`email send failed: HTTP ${response.status} — ${text}`);
    }
  } catch (error) {
    log(
      `email send error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ---- Sensor entry point ----

export default async function fleetEscalationSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  let password: string;
  try {
    password = await getSshPassword();
  } catch {
    log("no SSH password configured — skipping");
    return "skip";
  }

  const state = await loadState();
  const newEscalations: EscalationRecord[] = [];

  // Check all agents in parallel
  const agentNames = Object.keys(AGENTS);
  const results = await Promise.allSettled(
    agentNames.map(async (agent) => {
      let ip: string;
      try {
        ip = await getAgentIp(agent);
      } catch {
        return;
      }

      const blocked = await getBlockedTasks(agent, ip, password);
      if (blocked.length === 0) return;

      for (const task of blocked) {
        if (isAlreadyEscalated(state, agent, task.id)) continue;

        const source = `sensor:fleet-escalation:${agent}:${task.id}`;
        const reason = task.result_summary || "(no block reason provided)";

        const localTaskId = insertTaskIfNew(source, {
          subject: `Fleet escalation: ${agent} blocked on task #${task.id} — ${task.subject}`,
          description: [
            `Agent **${agent}** has a blocked task that needs attention.`,
            "",
            `**Remote task #${task.id}:** ${task.subject}`,
            `**Priority:** ${task.priority}`,
            `**Block reason:** ${reason}`,
            `**Created:** ${task.created_at}`,
            task.skills ? `**Skills:** ${task.skills}` : "",
            "",
            "**Actions:**",
            "1. Investigate the block reason",
            "2. If resolvable by Arc: fix and unblock the remote task",
            `3. To unblock: \`arc skills run --name fleet-task-sync -- send --agent ${agent} --subject \"Unblock task #${task.id}\" --priority 3\``,
            "4. If needs whoabuddy: leave this task open for human review",
          ]
            .filter(Boolean)
            .join("\n"),
          priority: 2,
          skills: '["fleet-escalation", "fleet-task-sync"]',
        });

        if (localTaskId !== null) {
          const record: EscalationRecord = {
            agent,
            remoteTaskId: task.id,
            localTaskId,
            subject: task.subject,
            reason,
            escalatedAt: new Date().toISOString(),
          };
          newEscalations.push(record);
          state.escalations.push(record);
          log(
            `escalated: ${agent} task #${task.id} → Arc task #${localTaskId}`,
          );
        }
      }
    }),
  );

  // Log any agent check failures
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "rejected") {
      log(
        `${agentNames[i]}: check failed — ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
      );
    }
  }

  // Trim escalation history to last 100 entries
  if (state.escalations.length > 100) {
    state.escalations = state.escalations.slice(-100);
  }

  state.lastChecked = new Date().toISOString();
  await saveState(state);

  // Send email digest if new escalations found
  if (newEscalations.length > 0) {
    await emailWhoabuddy(newEscalations);
  }

  log(
    `check complete: ${newEscalations.length} new escalation(s) across ${agentNames.length} agents`,
  );
  return "ok";
}
