#!/usr/bin/env bun

/**
 * fleet-handoff CLI
 *
 * Hand off tasks to another fleet agent via SSH.
 * Records handoffs in memory/fleet-handoffs.json.
 */

import { parseFlags } from "../../src/utils.ts";
import { initDatabase, getTaskById } from "../../src/db.ts";
import {
  AGENTS,
  REMOTE_ARC_DIR,
  getAgentIp,
  getSshPassword,
  ssh,
} from "../../src/ssh.ts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MEMORY_DIR = new URL("../../memory", import.meta.url).pathname;
const HANDOFFS_PATH = join(MEMORY_DIR, "fleet-handoffs.json");

interface HandoffRecord {
  id: number;
  source_agent: string;
  target_agent: string;
  local_task_id: number;
  remote_task_id: number | null;
  subject: string;
  reason: string;
  handed_off_at: string;
  status: string;
}

function loadHandoffs(): HandoffRecord[] {
  try {
    if (!existsSync(HANDOFFS_PATH)) return [];
    const raw = readFileSync(HANDOFFS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHandoffs(records: HandoffRecord[]): void {
  writeFileSync(HANDOFFS_PATH, JSON.stringify(records, null, 2) + "\n");
}

function getSourceAgent(): string {
  try {
    const { AGENT_NAME } = require("../../src/identity.ts");
    return AGENT_NAME ?? "arc0";
  } catch {
    return "arc0";
  }
}

// ---- initiate ----

async function cmdInitiate(flags: Record<string, string>): Promise<void> {
  const agent = flags["agent"];
  const taskIdStr = flags["task-id"];
  const progress = flags["progress"] ?? "";
  const remaining = flags["remaining"] ?? "";
  const reason = flags["reason"] ?? "";
  const artifacts = flags["artifacts"] ?? "";
  const priorityOverride = flags["priority"];
  const skillsOverride = flags["skills"];

  if (!agent) {
    process.stderr.write("Error: --agent is required\n");
    process.exit(1);
  }
  if (!taskIdStr) {
    process.stderr.write("Error: --task-id is required\n");
    process.exit(1);
  }

  const taskId = parseInt(taskIdStr, 10);
  if (isNaN(taskId)) {
    process.stderr.write(`Error: invalid task ID '${taskIdStr}'\n`);
    process.exit(1);
  }

  // Validate target agent
  const validAgents = new Set([...Object.keys(AGENTS), "arc"]);
  if (!validAgents.has(agent)) {
    process.stderr.write(`Error: unknown agent '${agent}'. Valid: ${[...validAgents].join(", ")}\n`);
    process.exit(1);
  }

  // Load local task for context
  initDatabase();
  const task = getTaskById(taskId);
  const subject = task?.subject ?? remaining;
  const priority = priorityOverride ? parseInt(priorityOverride, 10) : (task?.priority ?? 5);

  let skills: string[] = [];
  if (skillsOverride) {
    skills = skillsOverride.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (task?.skills) {
    try {
      const parsed = JSON.parse(task.skills);
      if (Array.isArray(parsed)) skills = parsed;
    } catch { /* ignore */ }
  }

  const sourceAgent = getSourceAgent();

  // Build structured description for the remote task
  const descParts: string[] = [`[HANDOFF from ${sourceAgent} task #${taskId}]`];
  if (progress) {
    descParts.push("", "## Progress (completed)", progress);
  }
  if (remaining) {
    descParts.push("", "## Remaining (TODO)", remaining);
  }
  if (artifacts) {
    descParts.push("", "## Artifacts", artifacts);
  }
  if (reason) {
    descParts.push("", "## Reason", reason);
  }
  descParts.push("", "## Original task", `Subject: ${subject}`, `Priority: ${priority}`);
  if (skills.length > 0) {
    descParts.push(`Skills: ${skills.join(", ")}`);
  }

  const description = descParts.join("\n");

  // If target is "arc" and we ARE arc, just create a local task
  if (agent === "arc") {
    const remoteTaskId = await createLocalTask(subject, priority, skills, description, sourceAgent, taskId);
    recordHandoff(sourceAgent, agent, taskId, remoteTaskId, subject, reason);
    process.stdout.write(`Handoff recorded (local). Task #${remoteTaskId} created.\n`);
    return;
  }

  // Send to remote agent via SSH
  let password: string;
  try {
    password = await getSshPassword();
  } catch (err) {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
    return;
  }

  let ip: string;
  try {
    ip = await getAgentIp(agent);
  } catch {
    process.stderr.write(`Error: cannot resolve IP for agent '${agent}'\n`);
    process.exit(1);
    return;
  }

  const escSubject = subject.replace(/'/g, "'\\''");
  const escDesc = description.replace(/'/g, "'\\''").slice(0, 2000);

  let cmd = `cd ${REMOTE_ARC_DIR} && bash bin/arc tasks add --subject '${escSubject}' --priority ${priority}`;
  if (skills.length > 0) {
    cmd += ` --skills ${skills.join(",")}`;
  }
  cmd += ` --description '${escDesc}'`;
  cmd += ` --source 'fleet:${sourceAgent}:handoff'`;

  const result = await ssh(ip, password, cmd);

  if (!result.ok) {
    process.stderr.write(`Error: SSH to ${agent} (${ip}) failed.\n${result.stderr}\n`);
    process.exit(1);
    return;
  }

  // Try to extract remote task ID from output (e.g., "Task #123 created")
  const match = result.stdout.match(/(?:Task\s+)?#?(\d+)/);
  const remoteTaskId = match ? parseInt(match[1], 10) : null;

  recordHandoff(sourceAgent, agent, taskId, remoteTaskId, subject, reason);
  process.stdout.write(`Handoff to ${agent} successful.${remoteTaskId ? ` Remote task #${remoteTaskId}.` : ""}\n`);
}

function createLocalTask(
  subject: string,
  priority: number,
  skills: string[],
  description: string,
  source: string,
  parentTaskId: number,
): Promise<number> {
  // Use arc CLI to create the task locally
  const escSubject = subject.replace(/'/g, "'\\''");
  const escDesc = description.replace(/'/g, "'\\''").slice(0, 2000);

  let cmd = `bash bin/arc tasks add --subject '${escSubject}' --priority ${priority}`;
  if (skills.length > 0) {
    cmd += ` --skills ${skills.join(",")}`;
  }
  cmd += ` --description '${escDesc}'`;
  cmd += ` --source 'fleet:${source}:handoff'`;

  const ROOT = new URL("../../", import.meta.url).pathname;
  const proc = Bun.spawnSync({
    cmd: ["bash", "-c", cmd],
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = proc.stdout.toString();
  const match = stdout.match(/(?:Task\s+)?#?(\d+)/);
  const taskId = match ? parseInt(match[1], 10) : 0;
  return Promise.resolve(taskId);
}

function recordHandoff(
  sourceAgent: string,
  targetAgent: string,
  localTaskId: number,
  remoteTaskId: number | null,
  subject: string,
  reason: string,
): void {
  const records = loadHandoffs();
  const nextId = records.length > 0 ? Math.max(...records.map((r) => r.id)) + 1 : 1;
  records.push({
    id: nextId,
    source_agent: sourceAgent,
    target_agent: targetAgent,
    local_task_id: localTaskId,
    remote_task_id: remoteTaskId,
    subject,
    reason,
    handed_off_at: new Date().toISOString(),
    status: "handed-off",
  });
  saveHandoffs(records);
}

// ---- status ----

function cmdStatus(flags: Record<string, string>): void {
  const idStr = flags["id"];
  if (!idStr) {
    process.stderr.write("Error: --id is required\n");
    process.exit(1);
  }

  const id = parseInt(idStr, 10);
  const records = loadHandoffs();
  const record = records.find((r) => r.id === id);

  if (!record) {
    process.stderr.write(`No handoff found with ID ${id}\n`);
    process.exit(1);
    return;
  }

  process.stdout.write(`Handoff #${record.id}\n`);
  process.stdout.write(`  From: ${record.source_agent} task #${record.local_task_id}\n`);
  process.stdout.write(`  To:   ${record.target_agent}${record.remote_task_id ? ` task #${record.remote_task_id}` : ""}\n`);
  process.stdout.write(`  Subject: ${record.subject.slice(0, 80)}\n`);
  process.stdout.write(`  Reason:  ${record.reason.slice(0, 80)}\n`);
  process.stdout.write(`  Status:  ${record.status}\n`);
  process.stdout.write(`  Time:    ${record.handed_off_at}\n`);
}

// ---- list ----

function cmdList(flags: Record<string, string>): void {
  const limit = parseInt(flags["limit"] ?? "20", 10);
  const records = loadHandoffs();
  const slice = records.slice(-limit);

  if (slice.length === 0) {
    process.stdout.write("No handoffs recorded.\n");
    return;
  }

  process.stdout.write(`Last ${slice.length} handoffs (of ${records.length} total):\n`);
  process.stdout.write("─".repeat(80) + "\n");

  for (const r of slice) {
    const subj = r.subject.slice(0, 50);
    const remote = r.remote_task_id ? `#${r.remote_task_id}` : "?";
    process.stdout.write(
      `  #${String(r.id).padStart(3)} ${r.source_agent}→${r.target_agent.padEnd(6)} local=#${r.local_task_id} remote=${remote} │ ${subj}\n`
    );
  }
}

// ---- usage ----

function printUsage(): void {
  process.stdout.write(`fleet-handoff — Hand off tasks to another fleet agent

Usage:
  arc skills run --name fleet-handoff -- <command> [options]

Commands:
  initiate    Hand off a task to another agent
              --agent <target>       Target agent (arc, spark, iris, loom, forge)
              --task-id <id>         Local task ID being handed off
              --progress <text>      What has been completed
              --remaining <text>     What still needs to be done
              [--reason <text>]      Why handing off
              [--artifacts <text>]   Files, branches, or external state
              [--priority <n>]       Override priority (default: from task)
              [--skills s1,s2]       Override skills (default: from task)

  status      Show a specific handoff record
              --id <handoff-id>

  list        Show recent handoffs
              [--limit <n>]          Max records to show (default: 20)
`);
}

// ---- main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];
  const { flags } = parseFlags(args.slice(1));

  switch (sub) {
    case "initiate":
      await cmdInitiate(flags);
      break;
    case "status":
      cmdStatus(flags);
      break;
    case "list":
      cmdList(flags);
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
