#!/usr/bin/env bun

/**
 * fleet-task-sync CLI
 *
 * Send tasks to remote agents, check status, and recall results via SSH.
 */

import { parseFlags } from "../../src/utils.ts";
import { getCredential } from "../../src/credentials.ts";

// ---- Agent fleet config (shared with arc-remote-setup) ----

const AGENTS: Record<string, string> = {
  spark: "192.168.1.12",
  iris: "192.168.1.13",
  loom: "192.168.1.14",
  forge: "192.168.1.15",
};

const SSH_USER = "dev";
const REMOTE_ARC_DIR = "/home/dev/arc-starter";

// ---- SSH helpers ----

async function getAgentIp(agent: string): Promise<string> {
  const override = await getCredential("vm-fleet", `${agent}-ip`);
  if (override) return override;
  const ip = AGENTS[agent];
  if (!ip) throw new Error(`Unknown agent: ${agent}. Known: ${Object.keys(AGENTS).join(", ")}`);
  return ip;
}

async function getSshPassword(): Promise<string> {
  const password = await getCredential("vm-fleet", "ssh-password");
  if (!password) throw new Error("SSH password not set. Run: arc creds set --service vm-fleet --key ssh-password --value <pw>");
  return password;
}

interface SshResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function ssh(ip: string, password: string, command: string): Promise<SshResult> {
  const proc = Bun.spawn(
    ["sshpass", "-e", "ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10", `${SSH_USER}@${ip}`, command],
    {
      env: { ...process.env, SSHPASS: password },
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { ok: exitCode === 0, stdout, stderr, exitCode };
}

function requireAgent(flags: Record<string, string>): string {
  const agent = flags["agent"];
  if (!agent) {
    process.stderr.write("Error: --agent <name> required (spark, iris, loom, forge)\n");
    process.exit(1);
  }
  if (!AGENTS[agent]) {
    process.stderr.write(`Error: unknown agent '${agent}'. Known: ${Object.keys(AGENTS).join(", ")}\n`);
    process.exit(1);
  }
  return agent;
}

// ---- Subcommands ----

async function cmdSend(flags: Record<string, string>): Promise<void> {
  const agent = requireAgent(flags);
  const subject = flags["subject"];
  if (!subject) {
    process.stderr.write("Error: --subject <text> required\n");
    process.exit(1);
  }

  const priority = flags["priority"] ?? "5";
  const skills = flags["skills"] ?? "";
  const description = flags["description"] ?? "";

  const ip = await getAgentIp(agent);
  const password = await getSshPassword();

  // Build the remote arc tasks add command
  // Escape single quotes in subject and description for shell safety
  const escSubject = subject.replace(/'/g, "'\\''");
  let remoteCmd = `cd ${REMOTE_ARC_DIR} && bash bin/arc tasks add --subject '${escSubject}' --priority ${priority}`;

  if (skills) {
    remoteCmd += ` --skills ${skills}`;
  }
  if (description) {
    const escDesc = description.replace(/'/g, "'\\''");
    remoteCmd += ` --description '${escDesc}'`;
  }

  // Add source indicating this came from Arc
  remoteCmd += ` --source 'fleet:arc'`;

  process.stdout.write(`Sending task to ${agent} (${ip})...\n`);
  process.stdout.write(`  Subject: ${subject}\n`);
  process.stdout.write(`  Priority: ${priority}\n`);
  if (skills) process.stdout.write(`  Skills: ${skills}\n`);

  const result = await ssh(ip, password, remoteCmd);
  if (result.ok) {
    process.stdout.write(`${result.stdout}`);
  } else {
    process.stderr.write(`Failed to send task (exit ${result.exitCode})\n`);
    if (result.stderr.trim()) process.stderr.write(`${result.stderr}\n`);
    if (result.stdout.trim()) process.stderr.write(`${result.stdout}\n`);
    process.exit(1);
  }
}

async function cmdCheck(flags: Record<string, string>): Promise<void> {
  const agent = requireAgent(flags);
  const id = flags["id"];
  if (!id) {
    process.stderr.write("Error: --id <n> required\n");
    process.exit(1);
  }

  const ip = await getAgentIp(agent);
  const password = await getSshPassword();

  // Query the task directly via sqlite
  const query = `SELECT id, subject, status, priority, created_at, started_at, completed_at, result_summary FROM tasks WHERE id = ${parseInt(id, 10)}`;
  const remoteCmd = `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun -e "
    import { Database } from 'bun:sqlite';
    const db = new Database('db/arc.sqlite', { readonly: true });
    const row = db.query(\\\"${query}\\\").get();
    if (!row) { console.log('Task not found'); process.exit(1); }
    console.log(JSON.stringify(row, null, 2));
  "`;

  process.stdout.write(`Checking task #${id} on ${agent} (${ip})...\n`);
  const result = await ssh(ip, password, remoteCmd);
  if (result.ok) {
    try {
      const task = JSON.parse(result.stdout.trim());
      process.stdout.write(`\n  Task #${task.id}: ${task.subject}\n`);
      process.stdout.write(`  Status: ${task.status}\n`);
      process.stdout.write(`  Priority: ${task.priority}\n`);
      process.stdout.write(`  Created: ${task.created_at}\n`);
      if (task.started_at) process.stdout.write(`  Started: ${task.started_at}\n`);
      if (task.completed_at) process.stdout.write(`  Completed: ${task.completed_at}\n`);
      if (task.result_summary) process.stdout.write(`  Summary: ${task.result_summary}\n`);
    } catch {
      // Not JSON, print raw output
      process.stdout.write(result.stdout);
    }
  } else {
    process.stderr.write(`Failed to check task (exit ${result.exitCode})\n`);
    if (result.stderr.trim()) process.stderr.write(`${result.stderr}\n`);
    if (result.stdout.trim()) process.stdout.write(`${result.stdout}\n`);
    process.exit(1);
  }
}

async function cmdRecall(flags: Record<string, string>): Promise<void> {
  const agent = requireAgent(flags);
  const id = flags["id"];
  if (!id) {
    process.stderr.write("Error: --id <n> required\n");
    process.exit(1);
  }

  const ip = await getAgentIp(agent);
  const password = await getSshPassword();

  // Query full task results via sqlite
  const taskId = parseInt(id, 10);
  const remoteCmd = `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun -e "
    import { Database } from 'bun:sqlite';
    const db = new Database('db/arc.sqlite', { readonly: true });
    const row = db.query('SELECT id, subject, status, priority, result_summary, result_detail, cost_usd, completed_at FROM tasks WHERE id = ${taskId}').get();
    if (!row) { console.log('Task not found'); process.exit(1); }
    console.log(JSON.stringify(row, null, 2));
  "`;

  process.stdout.write(`Recalling task #${id} from ${agent} (${ip})...\n`);
  const result = await ssh(ip, password, remoteCmd);
  if (result.ok) {
    try {
      const task = JSON.parse(result.stdout.trim());
      process.stdout.write(`\n  Task #${task.id}: ${task.subject}\n`);
      process.stdout.write(`  Status: ${task.status}\n`);
      if (task.completed_at) process.stdout.write(`  Completed: ${task.completed_at}\n`);
      if (task.cost_usd) process.stdout.write(`  Cost: $${task.cost_usd}\n`);
      process.stdout.write(`\n  --- Summary ---\n`);
      process.stdout.write(`  ${task.result_summary ?? "(none)"}\n`);
      process.stdout.write(`\n  --- Detail ---\n`);
      process.stdout.write(`  ${task.result_detail ?? "(none)"}\n`);
    } catch {
      process.stdout.write(result.stdout);
    }
  } else {
    process.stderr.write(`Failed to recall task (exit ${result.exitCode})\n`);
    if (result.stderr.trim()) process.stderr.write(`${result.stderr}\n`);
    if (result.stdout.trim()) process.stdout.write(`${result.stdout}\n`);
    process.exit(1);
  }
}

// ---- Usage ----

function printUsage(): void {
  process.stdout.write(`fleet-task-sync — Send tasks to remote agents and retrieve results

Usage:
  arc skills run --name fleet-task-sync -- <command> [options]

Commands:
  send    Send a task to a remote agent
          --agent <name>        Agent name (spark, iris, loom, forge)
          --subject <text>      Task subject (required)
          --priority <n>        Priority 1-10 (default: 5)
          --skills <s1,s2>      Skills to load
          --description <text>  Task description

  check   Check status of a task on a remote agent
          --agent <name>        Agent name
          --id <n>              Task ID on remote agent

  recall  Pull results from a completed task
          --agent <name>        Agent name
          --id <n>              Task ID on remote agent

Agents: ${Object.keys(AGENTS).join(", ")}
`);
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];
  const { flags } = parseFlags(args.slice(1));

  switch (sub) {
    case "send":
      await cmdSend(flags);
      break;
    case "check":
      await cmdCheck(flags);
      break;
    case "recall":
      await cmdRecall(flags);
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
