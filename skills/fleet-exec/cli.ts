#!/usr/bin/env bun

/**
 * fleet-exec CLI
 *
 * Parallel SSH command execution across agent fleet VMs.
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

interface AgentResult {
  agent: string;
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

// ---- Core: run command on one agent ----

async function execOnAgent(
  agent: string,
  password: string,
  command: string
): Promise<AgentResult> {
  try {
    const ip = await getAgentIp(agent);
    const result = await ssh(ip, password, command);
    return {
      agent,
      ok: result.ok,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    };
  } catch (error) {
    return {
      agent,
      ok: false,
      stdout: "",
      stderr: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---- Core: parallel execution ----

async function execFleet(
  agents: string[],
  password: string,
  command: string
): Promise<AgentResult[]> {
  const results = await Promise.allSettled(
    agents.map((agent) => execOnAgent(agent, password, command))
  );

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      agent: agents[i],
      ok: false,
      stdout: "",
      stderr: "",
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });
}

// ---- Output formatting ----

function printResults(results: AgentResult[]): void {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;

  for (const r of results) {
    const status = r.ok ? "OK" : "FAIL";
    process.stdout.write(`\n--- ${r.agent} [${status}] ---\n`);
    if (r.error) {
      process.stderr.write(`  Error: ${r.error}\n`);
    } else {
      if (r.stdout) process.stdout.write(`${r.stdout}\n`);
      if (r.stderr && !r.ok) process.stderr.write(`  stderr: ${r.stderr}\n`);
    }
  }

  process.stdout.write(
    `\n${passed}/${results.length} succeeded${failed > 0 ? `, ${failed} failed` : ""}\n`
  );
}

// ---- Subcommands ----

async function cmdRun(agents: string[], flags: Record<string, string>): Promise<void> {
  const command = flags["command"];
  if (!command) {
    process.stderr.write("Error: --command required for 'run'\n");
    process.exit(1);
  }

  const password = await getSshPassword();
  process.stdout.write(`Running on ${agents.length} agent(s): ${agents.join(", ")}\n`);
  process.stdout.write(`Command: ${command}\n`);

  const results = await execFleet(agents, password, command);
  printResults(results);

  if (results.some((r) => !r.ok)) process.exit(1);
}

async function cmdPull(agents: string[]): Promise<void> {
  const password = await getSshPassword();
  process.stdout.write(`Pulling latest on ${agents.length} agent(s): ${agents.join(", ")}\n`);

  const command = `cd ${REMOTE_ARC_DIR} && git pull --ff-only && ~/.bun/bin/bun install`;
  const results = await execFleet(agents, password, command);
  printResults(results);

  if (results.some((r) => !r.ok)) process.exit(1);
}

async function cmdRestart(agents: string[]): Promise<void> {
  const password = await getSshPassword();
  process.stdout.write(`Restarting services on ${agents.length} agent(s): ${agents.join(", ")}\n`);

  const command = [
    "systemctl --user restart arc-sensors.timer",
    "systemctl --user restart arc-dispatch.timer",
    "systemctl --user daemon-reload",
    "echo 'Services restarted'",
    "systemctl --user is-active arc-sensors.timer",
    "systemctl --user is-active arc-dispatch.timer",
  ].join(" && ");

  const results = await execFleet(agents, password, command);
  printResults(results);

  if (results.some((r) => !r.ok)) process.exit(1);
}

async function cmdStatus(agents: string[]): Promise<void> {
  const password = await getSshPassword();
  process.stdout.write(`Checking status on ${agents.length} agent(s): ${agents.join(", ")}\n`);

  const command = `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun src/cli.ts status`;
  const results = await execFleet(agents, password, command);
  printResults(results);

  if (results.some((r) => !r.ok)) process.exit(1);
}

// ---- Usage ----

function printUsage(): void {
  process.stdout.write(`fleet-exec — Parallel SSH command execution across agent fleet

Usage:
  arc skills run --name fleet-exec -- <command> [options]

Commands:
  run --command "CMD"   Execute arbitrary command on fleet VMs
  pull                  git pull + bun install on each agent
  restart               Restart sensor + dispatch systemd timers
  status                Run arc status on each agent

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
    case "run":
      await cmdRun(agents, flags);
      break;
    case "pull":
      await cmdPull(agents);
      break;
    case "restart":
      await cmdRestart(agents);
      break;
    case "status":
      await cmdStatus(agents);
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
