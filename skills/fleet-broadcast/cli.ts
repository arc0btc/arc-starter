#!/usr/bin/env bun

/**
 * fleet-broadcast CLI
 *
 * Send a task to all fleet agents simultaneously via SSH.
 * Pattern: Promise.allSettled() — one failure never blocks others.
 */

import { parseFlags } from "../../src/utils.ts";
import {
  AGENTS,
  REMOTE_ARC_DIR,
  getAgentIp,
  getSshPassword,
  ssh,
  resolveAgents,
} from "../../src/ssh.ts";

// ---- Types ----

interface BroadcastResult {
  agent: string;
  ok: boolean;
  output: string;
  error?: string;
}

// ---- Core: send task to one agent ----

async function sendToAgent(
  agent: string,
  password: string,
  subject: string,
  priority: string,
  skills: string,
  description: string,
  source: string
): Promise<BroadcastResult> {
  try {
    const ip = await getAgentIp(agent);

    // Escape single quotes for shell safety
    const escSubject = subject.replace(/'/g, "'\\''");
    let remoteCmd = `cd ${REMOTE_ARC_DIR} && bash bin/arc tasks add --subject '${escSubject}' --priority ${priority}`;

    if (skills) {
      remoteCmd += ` --skills ${skills}`;
    }
    if (description) {
      const escDesc = description.replace(/'/g, "'\\''");
      remoteCmd += ` --description '${escDesc}'`;
    }
    remoteCmd += ` --source '${source}'`;

    const result = await ssh(ip, password, remoteCmd);
    return {
      agent,
      ok: result.ok,
      output: result.ok ? result.stdout.trim() : result.stderr.trim() || result.stdout.trim(),
    };
  } catch (error) {
    return {
      agent,
      ok: false,
      output: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---- Core: check task status on one agent ----

async function checkOnAgent(
  agent: string,
  password: string,
  subject: string
): Promise<BroadcastResult> {
  try {
    const ip = await getAgentIp(agent);
    const escSubject = subject.replace(/'/g, "'\\''");

    const remoteCmd = `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun -e "
      import { Database } from 'bun:sqlite';
      const db = new Database('db/arc.sqlite', { readonly: true });
      const rows = db.query(\"SELECT id, subject, status, priority, result_summary FROM tasks WHERE subject LIKE '%' || ?1 || '%' ORDER BY id DESC LIMIT 3\").all('${escSubject}');
      if (rows.length === 0) { console.log('No matching tasks'); process.exit(0); }
      for (const r of rows) {
        console.log('#' + r.id + ' [' + r.status + '] P' + r.priority + ': ' + r.subject + (r.result_summary ? ' — ' + r.result_summary : ''));
      }
    "`;

    const result = await ssh(ip, password, remoteCmd);
    return {
      agent,
      ok: result.ok,
      output: result.ok ? result.stdout.trim() : result.stderr.trim() || result.stdout.trim(),
    };
  } catch (error) {
    return {
      agent,
      ok: false,
      output: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---- Output ----

function printResults(results: BroadcastResult[]): void {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;

  for (const r of results) {
    const status = r.ok ? "OK" : "FAIL";
    process.stdout.write(`\n  ${r.agent} [${status}]: ${r.error ?? r.output}\n`);
  }

  process.stdout.write(
    `\n${passed}/${results.length} succeeded${failed > 0 ? `, ${failed} failed` : ""}\n`
  );
}

// ---- Subcommands ----

async function cmdSend(agents: string[], flags: Record<string, string>): Promise<void> {
  const subject = flags["subject"];
  if (!subject) {
    process.stderr.write("Error: --subject <text> required\n");
    process.exit(1);
  }

  const priority = flags["priority"] ?? "5";
  const skills = flags["skills"] ?? "";
  const description = flags["description"] ?? "";
  const source = flags["source"] ?? "fleet:arc:broadcast";

  const password = await getSshPassword();

  process.stdout.write(`Broadcasting task to ${agents.length} agent(s): ${agents.join(", ")}\n`);
  process.stdout.write(`  Subject: ${subject}\n`);
  process.stdout.write(`  Priority: ${priority}\n`);
  if (skills) process.stdout.write(`  Skills: ${skills}\n`);

  const results = await Promise.allSettled(
    agents.map((agent) =>
      sendToAgent(agent, password, subject, priority, skills, description, source)
    )
  );

  const resolved: BroadcastResult[] = results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      agent: agents[i],
      ok: false,
      output: "",
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });

  printResults(resolved);

  if (resolved.some((r) => !r.ok)) process.exit(1);
}

async function cmdStatus(agents: string[], flags: Record<string, string>): Promise<void> {
  const subject = flags["subject"];
  if (!subject) {
    process.stderr.write("Error: --subject <text> required\n");
    process.exit(1);
  }

  const password = await getSshPassword();

  process.stdout.write(`Checking broadcast status on ${agents.length} agent(s)\n`);
  process.stdout.write(`  Subject match: ${subject}\n`);

  const results = await Promise.allSettled(
    agents.map((agent) => checkOnAgent(agent, password, subject))
  );

  const resolved: BroadcastResult[] = results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      agent: agents[i],
      ok: false,
      output: "",
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });

  printResults(resolved);
}

// ---- Usage ----

function printUsage(): void {
  process.stdout.write(`fleet-broadcast — Send a task to all fleet agents simultaneously

Usage:
  arc skills run --name fleet-broadcast -- <command> [options]

Commands:
  send     Broadcast a task to all agents in parallel
           --subject <text>       Task subject (required)
           --priority <n>         Priority 1-10 (default: 5)
           --skills <s1,s2>       Skills to load on remote agent
           --description <text>   Task description
           --source <tag>         Source tag (default: fleet:arc:broadcast)

  status   Check broadcast task status across agents
           --subject <text>       Subject substring to match (required)

Options:
  --agents spark,iris   Comma-separated agent list (default: all)

Agents: ${Object.keys(AGENTS).join(", ")}
`);
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];
  const { flags } = parseFlags(args.slice(1));

  let agents: string[];
  try {
    agents = resolveAgents(flags["agents"]);
  } catch (error) {
    process.stderr.write(
      `Error: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(1);
  }

  switch (sub) {
    case "send":
      await cmdSend(agents, flags);
      break;
    case "status":
      await cmdStatus(agents, flags);
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
