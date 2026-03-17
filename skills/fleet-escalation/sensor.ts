/**
 * fleet-escalation sensor
 *
 * Every 15 minutes, SSH into each fleet VM and query for blocked tasks.
 * For each new blocked task found:
 * 1. Create a FleetEscalationMachine workflow instance (dedup via instance_key)
 * 2. Track the escalation in memory/fleet-escalations.json
 * 3. Send email digest to whoabuddy if any new escalations
 *
 * The meta-sensor evaluates active workflows and creates the resolution task
 * automatically when the workflow reaches the "escalated" state.
 */

import { join } from "node:path";
import {
  claimSensorRun,
  createSensorLogger,
  pendingTaskExistsForSource,
} from "../../src/sensors.ts";
import {
  REMOTE_ARC_DIR,
  getAgentIp,
  getSshPassword,
  ssh,
  getActiveAgentNames,
  isFleetSuspended,
} from "../../src/ssh.ts";
import { getCredential } from "../../src/credentials.ts";
import {
  insertWorkflow,
  getWorkflowByInstanceKey,
} from "../../src/db.ts";
import { toHtmlEmail } from "../arc-report-email/html.ts";

const SENSOR_NAME = "fleet-escalation";
const INTERVAL_MINUTES = 15;

const log = createSensorLogger(SENSOR_NAME);

const MAINTENANCE_FILE = new URL("../../db/fleet-maintenance.json", import.meta.url).pathname;

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
  workflowId: number;
  subject: string;
  reason: string;
  escalatedAt: string;
}

interface ClearedRecord {
  agent: string;
  remoteTaskId: number;
  workflowId: number;
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
  const apiBaseUrl = await getCredential("arc-email-sync", "api_base_url");
  const adminKey = await getCredential("arc-email-sync", "admin_api_key");
  const recipient = await getCredential("arc-email-sync", "report_recipient");

  if (!apiBaseUrl || !adminKey || !recipient) {
    log("email credentials missing — skipping notification");
    return;
  }

  const lines = newEscalations.map(
    (e) =>
      `- [${e.agent}] Task #${e.remoteTaskId}: ${e.subject}\n  Reason: ${e.reason || "(no reason given)"}\n  Escalation workflow id=${e.workflowId} (meta-sensor will create resolution task)`,
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
  const htmlBody = toHtmlEmail(body, subject, "Fleet Escalation");

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
        html: htmlBody,
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
  if (isFleetSuspended()) return "skip";

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Skip entirely if fleet is in maintenance mode
  try {
    const mFile = Bun.file(MAINTENANCE_FILE);
    if (await mFile.exists()) {
      const config = await mFile.json() as { enabled?: boolean };
      if (config.enabled) {
        log("fleet in maintenance mode — skipping escalation scan");
        return "skip";
      }
    }
  } catch { /* proceed if file unreadable */ }

  let password: string;
  try {
    password = await getSshPassword();
  } catch {
    log("no SSH password configured — skipping");
    return "skip";
  }

  const state = await loadState();
  const newEscalations: EscalationRecord[] = [];

  // Check all agents in parallel (suspended agents excluded)
  const agentNames = getActiveAgentNames();
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
        const instanceKey = `fleet-escalation-${agent}-${task.id}`;

        // Dedup: if a workflow already exists for this agent+task, skip
        const existing = getWorkflowByInstanceKey(instanceKey);
        if (existing) {
          const hasPendingResolution = pendingTaskExistsForSource(`workflow:${existing.id}`);
          log(`${agent} task #${task.id} already has workflow id=${existing.id}${hasPendingResolution ? ", resolution task pending" : ""}, skipping`);
          continue;
        }

        const reason = task.result_summary || "(no block reason provided)";

        const workflowId = insertWorkflow({
          template: "fleet-escalation",
          instance_key: instanceKey,
          current_state: "escalated",
          context: JSON.stringify({
            agentName: agent,
            blockedTaskId: task.id,
            blockDescription: reason,
            alertDate: new Date().toISOString(),
          }),
        });

        const record: EscalationRecord = {
          agent,
          remoteTaskId: task.id,
          workflowId,
          subject: task.subject,
          reason,
          escalatedAt: new Date().toISOString(),
        };
        newEscalations.push(record);
        state.escalations.push(record);
        log(
          `created workflow id=${workflowId} for ${agent} task #${task.id} (meta-sensor will create resolution task)`,
        );
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
