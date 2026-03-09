#!/usr/bin/env bun

/**
 * fleet-handoff CLI
 *
 * Transfer partially complete tasks between fleet agents with structured context.
 * Packages progress, remaining work, and artifact references into a continuation task.
 */

import { parseFlags } from "../../src/utils.ts";
import {
  AGENTS,
  SSH_USER,
  REMOTE_ARC_DIR,
  getAgentIp,
  getSshPassword,
  ssh,
} from "../../src/ssh.ts";

const HANDOFF_STATE_PATH = "memory/fleet-handoffs.json";

// ---- Types ----

interface HandoffRecord {
  id: number;
  source_agent: string;
  target_agent: string;
  local_task_id: number;
  remote_task_id: number | null;
  subject: string;
  reason: string;
  handed_off_at: string;
  status: "handed-off" | "completed" | "failed";
}

// ---- State helpers ----

async function loadHandoffs(): Promise<HandoffRecord[]> {
  const file = Bun.file(HANDOFF_STATE_PATH);
  if (await file.exists()) {
    try {
      return JSON.parse(await file.text()) as HandoffRecord[];
    } catch {
      return [];
    }
  }
  return [];
}

async function saveHandoffs(records: HandoffRecord[]): Promise<void> {
  await Bun.write(HANDOFF_STATE_PATH, JSON.stringify(records, null, 2) + "\n");
}

function nextId(records: HandoffRecord[]): number {
  if (records.length === 0) return 1;
  return Math.max(...records.map((r) => r.id)) + 1;
}

// ---- Local task lookup ----

async function getLocalTask(
  taskId: number
): Promise<{
  id: number;
  subject: string;
  priority: number;
  skills: string | null;
  description: string | null;
  status: string;
} | null> {
  const { Database } = await import("bun:sqlite");
  const db = new Database("db/arc.sqlite", { readonly: true });
  try {
    const row = db
      .query(
        "SELECT id, subject, priority, skills, description, status FROM tasks WHERE id = ?"
      )
      .get(taskId) as {
      id: number;
      subject: string;
      priority: number;
      skills: string | null;
      description: string | null;
      status: string;
    } | null;
    return row;
  } finally {
    db.close();
  }
}

// ---- Build handoff description ----

function buildHandoffDescription(opts: {
  sourceAgent: string;
  localTaskId: number;
  originalSubject: string;
  originalPriority: number;
  originalSkills: string | null;
  progress: string;
  remaining: string;
  artifacts: string;
  reason: string;
}): string {
  const lines: string[] = [
    `[HANDOFF from ${opts.sourceAgent} task #${opts.localTaskId}]`,
    "",
    "## Progress (completed)",
    opts.progress,
    "",
    "## Remaining (TODO)",
    opts.remaining,
    "",
  ];

  if (opts.artifacts) {
    lines.push("## Artifacts", opts.artifacts, "");
  }

  if (opts.reason) {
    lines.push("## Reason", opts.reason, "");
  }

  lines.push(
    "## Original task",
    `Subject: ${opts.originalSubject}`,
    `Priority: ${opts.originalPriority}`,
    `Skills: ${opts.originalSkills ?? "none"}`
  );

  return lines.join("\n");
}

// ---- Parse remote task ID from arc tasks add output ----

function parseRemoteTaskId(output: string): number | null {
  // arc tasks add outputs something like "Created task #123"
  const match = output.match(/(?:Created task|Task created|#)(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

// ---- Commands ----

async function cmdInitiate(flags: Record<string, string>): Promise<void> {
  const agent = flags["agent"];
  if (!agent || !AGENTS[agent]) {
    process.stderr.write(
      `Error: --agent required. Known: ${Object.keys(AGENTS).join(", ")}\n`
    );
    process.exit(1);
  }

  const taskIdStr = flags["task-id"];
  if (!taskIdStr) {
    process.stderr.write("Error: --task-id <n> required\n");
    process.exit(1);
  }
  const taskId = parseInt(taskIdStr, 10);

  const progress = flags["progress"];
  if (!progress) {
    process.stderr.write("Error: --progress <text> required\n");
    process.exit(1);
  }

  const remaining = flags["remaining"];
  if (!remaining) {
    process.stderr.write("Error: --remaining <text> required\n");
    process.exit(1);
  }

  const artifacts = flags["artifacts"] ?? "";
  const reason = flags["reason"] ?? "manual handoff";
  const priorityOverride = flags["priority"];
  const skillsOverride = flags["skills"];

  // Look up local task
  const localTask = await getLocalTask(taskId);
  if (!localTask) {
    process.stderr.write(`Error: local task #${taskId} not found\n`);
    process.exit(1);
  }

  const priority = priorityOverride
    ? parseInt(priorityOverride, 10)
    : localTask.priority;
  const skills = skillsOverride ?? localTask.skills ?? "";

  // Build the handoff description
  const description = buildHandoffDescription({
    sourceAgent: "arc",
    localTaskId: taskId,
    originalSubject: localTask.subject,
    originalPriority: localTask.priority,
    originalSkills: localTask.skills,
    progress,
    remaining,
    artifacts,
    reason,
  });

  // Build remote subject
  const remoteSubject = `[handoff] ${localTask.subject}`;

  // Send to remote agent
  const ip = await getAgentIp(agent);
  const password = await getSshPassword();

  // Escape for shell
  const escSubject = remoteSubject.replace(/'/g, "'\\''");
  const escDescription = description.replace(/'/g, "'\\''");
  const escSkills = (typeof skills === "string" ? skills : "")
    .replace(/[\[\]"]/g, "")
    .trim();

  let remoteCmd = `cd ${REMOTE_ARC_DIR} && bash bin/arc tasks add --subject '${escSubject}' --priority ${priority}`;
  if (escSkills) {
    remoteCmd += ` --skills ${escSkills}`;
  }
  remoteCmd += ` --description '${escDescription}'`;
  remoteCmd += ` --source 'handoff:arc:${taskId}'`;

  process.stdout.write(`Handing off task #${taskId} to ${agent}...\n`);
  process.stdout.write(`  Subject: ${remoteSubject}\n`);
  process.stdout.write(`  Priority: ${priority}\n`);
  process.stdout.write(`  Progress: ${progress.slice(0, 80)}...\n`);
  process.stdout.write(`  Remaining: ${remaining.slice(0, 80)}...\n`);

  const result = await ssh(ip, password, remoteCmd);
  if (!result.ok) {
    process.stderr.write(
      `Failed to send handoff task (exit ${result.exitCode})\n`
    );
    if (result.stderr.trim()) process.stderr.write(`${result.stderr}\n`);
    if (result.stdout.trim()) process.stdout.write(`${result.stdout}\n`);
    process.exit(1);
  }

  const remoteTaskId = parseRemoteTaskId(result.stdout);
  process.stdout.write(`${result.stdout}`);

  // Record handoff state
  const records = await loadHandoffs();
  const record: HandoffRecord = {
    id: nextId(records),
    source_agent: "arc",
    target_agent: agent,
    local_task_id: taskId,
    remote_task_id: remoteTaskId,
    subject: localTask.subject,
    reason,
    handed_off_at: new Date().toISOString(),
    status: "handed-off",
  };
  records.push(record);
  await saveHandoffs(records);

  process.stdout.write(
    `\nHandoff #${record.id} recorded. Remote task: ${remoteTaskId ? `#${remoteTaskId}` : "(unknown)"}\n`
  );
  process.stdout.write(
    `\nTo close local task:\n  arc tasks close --id ${taskId} --status completed --summary "Handed off to ${agent} (handoff #${record.id})"\n`
  );
}

async function cmdStatus(flags: Record<string, string>): Promise<void> {
  const idStr = flags["id"];
  if (!idStr) {
    process.stderr.write("Error: --id <n> required\n");
    process.exit(1);
  }
  const id = parseInt(idStr, 10);

  const records = await loadHandoffs();
  const record = records.find((r) => r.id === id);
  if (!record) {
    process.stderr.write(`Handoff #${id} not found\n`);
    process.exit(1);
  }

  process.stdout.write(`Handoff #${record.id}\n`);
  process.stdout.write(`  Subject: ${record.subject}\n`);
  process.stdout.write(
    `  ${record.source_agent} task #${record.local_task_id} → ${record.target_agent}`
  );
  if (record.remote_task_id) {
    process.stdout.write(` task #${record.remote_task_id}`);
  }
  process.stdout.write(`\n`);
  process.stdout.write(`  Status: ${record.status}\n`);
  process.stdout.write(`  Reason: ${record.reason}\n`);
  process.stdout.write(`  Handed off: ${record.handed_off_at}\n`);

  // If we have a remote task ID, check its status
  if (record.remote_task_id && record.status === "handed-off") {
    process.stdout.write(
      `\nChecking remote status on ${record.target_agent}...\n`
    );
    try {
      const ip = await getAgentIp(record.target_agent);
      const password = await getSshPassword();
      const query = `SELECT id, status, result_summary FROM tasks WHERE id = ${record.remote_task_id}`;
      const remoteCmd = `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun -e "
        import { Database } from 'bun:sqlite';
        const db = new Database('db/arc.sqlite', { readonly: true });
        const row = db.query(\\"${query}\\").get();
        if (!row) { console.log('not-found'); process.exit(0); }
        console.log(JSON.stringify(row));
      "`;

      const result = await ssh(ip, password, remoteCmd);
      if (result.ok && result.stdout.trim() !== "not-found") {
        const remote = JSON.parse(result.stdout.trim()) as {
          id: number;
          status: string;
          result_summary: string | null;
        };
        process.stdout.write(`  Remote status: ${remote.status}\n`);
        if (remote.result_summary) {
          process.stdout.write(`  Remote summary: ${remote.result_summary}\n`);
        }

        // Update local record if remote is done
        if (
          remote.status === "completed" ||
          remote.status === "failed"
        ) {
          record.status = remote.status as "completed" | "failed";
          await saveHandoffs(records);
          process.stdout.write(
            `  (Updated local handoff status to ${record.status})\n`
          );
        }
      } else {
        process.stdout.write(`  Remote task not found or unreachable\n`);
      }
    } catch (err: unknown) {
      process.stdout.write(
        `  Could not check remote: ${err instanceof Error ? err.message : String(err)}\n`
      );
    }
  }
}

async function cmdList(flags: Record<string, string>): Promise<void> {
  const limit = parseInt(flags["limit"] ?? "20", 10);
  const records = await loadHandoffs();

  if (records.length === 0) {
    process.stdout.write("No handoffs recorded.\n");
    return;
  }

  const shown = records.slice(-limit);
  process.stdout.write(
    `Showing ${shown.length} of ${records.length} handoffs:\n\n`
  );

  for (const r of shown) {
    const remote = r.remote_task_id ? `→ #${r.remote_task_id}` : "→ ?";
    process.stdout.write(
      `  #${r.id} [${r.status}] ${r.source_agent}:#${r.local_task_id} ${remote} on ${r.target_agent} — ${r.subject.slice(0, 60)}\n`
    );
  }
}

// ---- Usage ----

function printUsage(): void {
  process.stdout.write(`fleet-handoff — Transfer partially complete tasks between agents

Usage:
  arc skills run --name fleet-handoff -- <command> [options]

Commands:
  initiate  Hand off a task to another agent with progress context
            --agent <name>        Target agent (spark, iris, loom, forge)
            --task-id <n>         Local task ID to hand off
            --progress <text>     What has been completed (required)
            --remaining <text>    What still needs to be done (required)
            --artifacts <text>    Files, branches, or state references
            --reason <text>       Why handing off (default: "manual handoff")
            --priority <n>        Override priority (default: same as original)
            --skills <s1,s2>      Override skills (default: same as original)

  status    Check handoff status (queries remote agent)
            --id <n>              Handoff ID

  list      List recorded handoffs
            --limit <n>           Max records to show (default: 20)

Agents: ${Object.keys(AGENTS).join(", ")}
`);
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];
  const { flags } = parseFlags(args.slice(1));

  switch (sub) {
    case "initiate":
      await cmdInitiate(flags);
      break;
    case "status":
      await cmdStatus(flags);
      break;
    case "list":
      await cmdList(flags);
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
  process.stderr.write(
    `Error: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
