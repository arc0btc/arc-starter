#!/usr/bin/env bun

/**
 * fleet-escalation CLI
 *
 * View escalation status, check agents for blocked tasks, and manually escalate.
 */

import { join } from "node:path";
import { parseFlags } from "../../src/utils.ts";
import { getCredential } from "../../src/credentials.ts";
import {
  AGENTS,
  REMOTE_ARC_DIR,
  getAgentIp,
  getSshPassword,
  ssh,
} from "../../src/ssh.ts";
import { insertTaskIfNew } from "../../src/sensors.ts";
import { toHtmlEmail } from "../arc-report-email/html.ts";
import { sendEmail } from "../arc-email-sync/sync.ts";

const MEMORY_DIR = new URL("../../memory", import.meta.url).pathname;
const ESCALATIONS_FILE = join(MEMORY_DIR, "fleet-escalations.json");

// ---- Types ----

interface EscalationRecord {
  agent: string;
  remoteTaskId: number;
  localTaskId: number;
  subject: string;
  reason: string;
  escalatedAt: string;
}

interface EscalationState {
  escalations: EscalationRecord[];
  lastChecked: string;
}

// ---- Helpers ----

async function loadState(): Promise<EscalationState> {
  try {
    const file = Bun.file(ESCALATIONS_FILE);
    if (await file.exists()) {
      return (await file.json()) as EscalationState;
    }
  } catch {
    // Corrupt — start fresh
  }
  return { escalations: [], lastChecked: "" };
}

async function saveState(state: EscalationState): Promise<void> {
  await Bun.write(ESCALATIONS_FILE, JSON.stringify(state, null, 2));
}

// ---- Subcommands ----

async function cmdStatus(): Promise<void> {
  const state = await loadState();

  process.stdout.write(`Fleet Escalations\n`);
  process.stdout.write(`Last checked: ${state.lastChecked || "never"}\n`);
  process.stdout.write(`Total tracked: ${state.escalations.length}\n\n`);

  if (state.escalations.length === 0) {
    process.stdout.write("No escalations recorded.\n");
    return;
  }

  // Show last 10
  const recent = state.escalations.slice(-10);
  process.stdout.write("Recent escalations:\n\n");

  for (const e of recent) {
    process.stdout.write(`  [${e.agent}] Remote #${e.remoteTaskId} → Arc #${e.localTaskId}\n`);
    process.stdout.write(`    ${e.subject}\n`);
    process.stdout.write(`    Reason: ${e.reason}\n`);
    process.stdout.write(`    Escalated: ${e.escalatedAt}\n\n`);
  }
}

async function cmdCheck(flags: Record<string, string>): Promise<void> {
  const agent = flags["agent"];
  if (!agent || !AGENTS[agent]) {
    process.stderr.write(`Error: --agent <name> required (${Object.keys(AGENTS).join(", ")})\n`);
    process.exit(1);
  }

  const ip = await getAgentIp(agent);
  const password = await getSshPassword();

  const remoteCmd = `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun -e "
    const { Database } = require('bun:sqlite');
    const db = new Database('db/arc.sqlite', { readonly: true });
    const rows = db.query('SELECT id, subject, result_summary, created_at, priority FROM tasks WHERE status = \\\\'blocked\\\\' ORDER BY priority ASC, created_at ASC LIMIT 20').all();
    console.log(JSON.stringify(rows));
    db.close();
  " 2>/dev/null`;

  process.stdout.write(`Checking ${agent} (${ip}) for blocked tasks...\n\n`);
  const result = await ssh(ip, password, remoteCmd);

  if (!result.ok) {
    process.stderr.write(`SSH failed (exit ${result.exitCode})\n`);
    if (result.stderr.trim()) process.stderr.write(`${result.stderr}\n`);
    process.exit(1);
  }

  try {
    const tasks = JSON.parse(result.stdout.trim()) as Array<{
      id: number;
      subject: string;
      result_summary: string | null;
      created_at: string;
      priority: number;
    }>;

    if (tasks.length === 0) {
      process.stdout.write(`No blocked tasks on ${agent}.\n`);
      return;
    }

    process.stdout.write(`${tasks.length} blocked task(s) on ${agent}:\n\n`);
    for (const t of tasks) {
      process.stdout.write(`  #${t.id} [P${t.priority}] ${t.subject}\n`);
      process.stdout.write(`    Reason: ${t.result_summary || "(none)"}\n`);
      process.stdout.write(`    Created: ${t.created_at}\n\n`);
    }
  } catch {
    process.stdout.write(`Raw response: ${result.stdout}\n`);
  }
}

async function cmdEscalate(flags: Record<string, string>): Promise<void> {
  const agent = flags["agent"];
  if (!agent || !AGENTS[agent]) {
    process.stderr.write(`Error: --agent <name> required (${Object.keys(AGENTS).join(", ")})\n`);
    process.exit(1);
  }

  const id = flags["id"];
  if (!id) {
    process.stderr.write("Error: --id <n> required (remote task ID)\n");
    process.exit(1);
  }

  const reason = flags["reason"] || "(manual escalation)";
  const taskId = parseInt(id, 10);

  // Check if already escalated
  const state = await loadState();
  const existing = state.escalations.find(
    (e) => e.agent === agent && e.remoteTaskId === taskId,
  );
  if (existing) {
    process.stdout.write(`Already escalated as Arc task #${existing.localTaskId}\n`);
    return;
  }

  // Get remote task subject
  const ip = await getAgentIp(agent);
  const password = await getSshPassword();

  const remoteCmd = `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun -e "
    const { Database } = require('bun:sqlite');
    const db = new Database('db/arc.sqlite', { readonly: true });
    const row = db.query('SELECT id, subject, status FROM tasks WHERE id = ${taskId}').get();
    console.log(JSON.stringify(row));
    db.close();
  " 2>/dev/null`;

  const result = await ssh(ip, password, remoteCmd);
  let subject = `Task #${taskId} on ${agent}`;

  if (result.ok) {
    try {
      const task = JSON.parse(result.stdout.trim()) as { id: number; subject: string; status: string } | null;
      if (task) subject = task.subject;
    } catch {
      // Use fallback subject
    }
  }

  // Create escalation task on Arc
  const source = `sensor:fleet-escalation:${agent}:${taskId}`;
  const localTaskId = insertTaskIfNew(source, {
    subject: `Fleet escalation: ${agent} blocked on task #${taskId} — ${subject}`,
    description: [
      `**Manual escalation** from CLI.`,
      "",
      `Agent **${agent}**, remote task #${taskId}: ${subject}`,
      `Reason: ${reason}`,
      "",
      "Investigate and resolve or escalate to whoabuddy.",
    ].join("\n"),
    priority: 2,
    skills: '["fleet-escalation", "fleet-task-sync"]',
  });

  if (localTaskId === null) {
    process.stdout.write("Escalation task already exists for this source.\n");
    return;
  }

  // Record
  const record: EscalationRecord = {
    agent,
    remoteTaskId: taskId,
    localTaskId,
    subject,
    reason,
    escalatedAt: new Date().toISOString(),
  };
  state.escalations.push(record);
  await saveState(state);

  process.stdout.write(`Escalated: ${agent} task #${taskId} → Arc task #${localTaskId}\n`);

  // Send email
  const recipient = await getCredential("arc-email-sync", "report_recipient");

  if (recipient) {
    const emailBody = `Manual escalation from Arc CLI.\n\nAgent: ${agent}\nRemote task #${taskId}: ${subject}\nReason: ${reason}\nArc task #${localTaskId}\n\n— Arc`;
    const emailSubject = `Fleet escalation: ${agent} blocked on task #${taskId}`;
    try {
      await sendEmail({
        to: recipient,
        subject: emailSubject,
        body: emailBody,
        html: toHtmlEmail(emailBody, emailSubject, "Fleet Escalation"),
        from: "arc@arc0.me",
      });
      process.stdout.write("Email notification sent to whoabuddy.\n");
    } catch (error) {
      process.stderr.write(`Email failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  } else {
    process.stdout.write("Email credentials not configured — skipping notification.\n");
  }
}

// ---- Usage ----

function printUsage(): void {
  process.stdout.write(`fleet-escalation — Detect and escalate blocked fleet agent tasks

Usage:
  arc skills run --name fleet-escalation -- <command> [options]

Commands:
  status              Show recent escalations
  check               Query agent for blocked tasks (read-only)
        --agent <name>   Agent name (${Object.keys(AGENTS).join(", ")})
  escalate            Manually escalate a blocked task to Arc + email whoabuddy
        --agent <name>   Agent name
        --id <n>         Remote task ID
        --reason <text>  Block reason (optional)
`);
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];
  const { flags } = parseFlags(args.slice(1));

  switch (sub) {
    case "status":
      await cmdStatus();
      break;
    case "check":
      await cmdCheck(flags);
      break;
    case "escalate":
      await cmdEscalate(flags);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      break;
    default:
      process.stderr.write(`Error: unknown subcommand '${sub}'\n\n`);
      printUsage();
      process.exit(1);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
