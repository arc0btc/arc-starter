#!/usr/bin/env bun

/**
 * fleet-push CLI
 *
 * Change-aware code deployment across fleet agents.
 * Maps changed files → affected systemd units → targeted restart.
 * Rolls back per-agent on health check failure.
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

// ---- Constants ----

const STATE_FILE = new URL("../../db/hook-state/fleet-push.json", import.meta.url).pathname;

const ALL_SERVICES = ["arc-sensors.timer", "arc-dispatch.timer", "arc-web.service"] as const;
type Service = (typeof ALL_SERVICES)[number];

// ---- File → service mapping ----

function detectAffectedServices(changedFiles: string[]): Set<Service> {
  const services = new Set<Service>();
  let needsInstall = false;

  for (const f of changedFiles) {
    if (f === "package.json" || f === "bun.lockb") {
      needsInstall = true;
      ALL_SERVICES.forEach((s) => services.add(s));
      break; // all services affected
    }
    if (f === "src/sensors.ts" || f.match(/^skills\/[^/]+\/sensor\.ts$/)) {
      services.add("arc-sensors.timer");
    }
    if (
      f === "src/web.ts"
    ) {
      services.add("arc-web.service");
    }
    if (
      f.startsWith("src/") &&
      f !== "src/sensors.ts" &&
      f !== "src/web.ts"
    ) {
      // dispatch, db, cli, utils, credentials, ssh — core runtime
      services.add("arc-dispatch.timer");
    }
  }

  return services;
}

function needsBunInstall(changedFiles: string[]): boolean {
  return changedFiles.some((f) => f === "package.json" || f === "bun.lockb");
}

// ---- State management ----

interface PushState {
  last_pushed_sha: string;
  pushed_at: string;
  agents: Record<string, { sha: string; services: string[]; ok: boolean }>;
}

async function readState(): Promise<PushState | null> {
  try {
    const f = Bun.file(STATE_FILE);
    if (!(await f.exists())) return null;
    return (await f.json()) as PushState;
  } catch {
    return null;
  }
}

async function writeState(state: PushState): Promise<void> {
  const dir = STATE_FILE.replace(/\/[^/]+$/, "");
  await Bun.spawn(["mkdir", "-p", dir]).exited;
  await Bun.write(STATE_FILE, JSON.stringify(state, null, 2));
}

// ---- Git helpers ----

async function localSha(ref = "HEAD"): Promise<string> {
  const proc = Bun.spawn(["git", "rev-parse", ref], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`git rev-parse ${ref} failed`);
  return out.trim();
}

async function changedFiles(fromSha: string, toSha: string): Promise<string[]> {
  const proc = Bun.spawn(
    ["git", "diff", "--name-only", `${fromSha}..${toSha}`],
    { stdout: "pipe", stderr: "pipe" }
  );
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim().split("\n").filter(Boolean);
}

async function createBundle(toSha: string): Promise<string> {
  const bundlePath = `/tmp/arc-fleet-push-${toSha.slice(0, 8)}.bundle`;
  const proc = Bun.spawn(["git", "bundle", "create", bundlePath, "--all"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error("Failed to create git bundle");
  return bundlePath;
}

// ---- SSH helpers ----

async function scpBundle(ip: string, password: string, localPath: string): Promise<boolean> {
  const remotePath = `/tmp/${localPath.split("/").pop()}`;
  const proc = Bun.spawn(
    [
      "sshpass",
      "-e",
      "scp",
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "ConnectTimeout=15",
      localPath,
      `dev@${ip}:${remotePath}`,
    ],
    { env: { ...process.env, SSHPASS: password }, stdout: "pipe", stderr: "pipe" }
  );
  return (await proc.exited) === 0;
}

async function syncAgentToSha(
  agent: string,
  ip: string,
  password: string,
  bundlePath: string,
  toSha: string,
  installDeps: boolean
): Promise<boolean> {
  const remotePath = `/tmp/${bundlePath.split("/").pop()}`;

  const scpOk = await scpBundle(ip, password, bundlePath);
  if (!scpOk) return false;

  const cmds = [
    `cd ${REMOTE_ARC_DIR}`,
    `git fetch ${remotePath}`,
    `git reset --hard ${toSha}`,
    ...(installDeps ? [`~/.bun/bin/bun install --frozen-lockfile 2>/dev/null || ~/.bun/bin/bun install`] : []),
    `rm -f ${remotePath}`,
  ];

  const r = await ssh(ip, password, cmds.join(" && "));
  if (!r.ok) {
    process.stderr.write(`  [${agent}] sync failed: ${r.stderr.slice(0, 200)}\n`);
  }
  return r.ok;
}

async function restartServices(
  agent: string,
  ip: string,
  password: string,
  services: Service[]
): Promise<boolean> {
  if (services.length === 0) return true;

  const restartCmds = services.map((s) => `systemctl --user restart ${s}`);
  const verifyCmds = services.map((s) => `systemctl --user is-active ${s}`);
  const cmd = [
    "systemctl --user daemon-reload",
    ...restartCmds,
    ...verifyCmds,
  ].join(" && ");

  const r = await ssh(ip, password, cmd);
  if (!r.ok) {
    process.stderr.write(`  [${agent}] restart failed: ${r.stderr.slice(0, 200)}\n`);
  }
  return r.ok;
}

async function remoteHeadSha(
  agent: string,
  ip: string,
  password: string
): Promise<string | null> {
  const r = await ssh(ip, password, `cd ${REMOTE_ARC_DIR} && git rev-parse HEAD`);
  return r.ok ? r.stdout.trim() : null;
}

// ---- Subcommands ----

async function cmdDiff(flags: Record<string, string>): Promise<void> {
  const toSha = await localSha("HEAD");
  const state = await readState();
  const fromSha = flags["from"] ?? state?.last_pushed_sha;

  if (!fromSha) {
    process.stderr.write("No previous push recorded. Provide --from <sha>.\n");
    process.exit(1);
  }

  const files = await changedFiles(fromSha, toSha);
  const services = detectAffectedServices(files);
  const installDeps = needsBunInstall(files);

  process.stdout.write(`From: ${fromSha.slice(0, 12)}\n`);
  process.stdout.write(`To:   ${toSha.slice(0, 12)}\n\n`);

  if (files.length === 0) {
    process.stdout.write("No changes detected.\n");
    return;
  }

  process.stdout.write(`Changed files (${files.length}):\n`);
  for (const f of files) process.stdout.write(`  ${f}\n`);

  process.stdout.write(`\nAffected services:\n`);
  if (services.size === 0) {
    process.stdout.write("  (none — no restart required)\n");
  } else {
    for (const s of services) process.stdout.write(`  ${s}\n`);
  }
  if (installDeps) process.stdout.write(`  + bun install\n`);
}

async function cmdPush(flags: Record<string, string>): Promise<void> {
  const isDryRun = "dry-run" in flags;
  const agentNames = resolveAgents(flags["agents"]);
  const toSha = await localSha("HEAD");
  const state = await readState();
  const fromSha = flags["from"] ?? state?.last_pushed_sha;

  if (!fromSha) {
    process.stderr.write(
      "No previous push recorded. Provide --from <sha> for first deploy.\n"
    );
    process.exit(1);
  }

  const files = await changedFiles(fromSha, toSha);
  if (files.length === 0) {
    process.stdout.write(`Already up to date at ${toSha.slice(0, 12)}. Nothing to push.\n`);
    return;
  }

  const services = Array.from(detectAffectedServices(files)) as Service[];
  const installDeps = needsBunInstall(files);

  process.stdout.write(`Pushing ${fromSha.slice(0, 8)}..${toSha.slice(0, 8)} to ${agentNames.join(", ")}\n`);
  process.stdout.write(`Changed: ${files.length} file(s)\n`);
  process.stdout.write(
    `Services: ${services.length > 0 ? services.join(", ") : "(none)"}\n`
  );
  if (installDeps) process.stdout.write(`+ bun install required\n`);
  process.stdout.write("\n");

  if (isDryRun) {
    process.stdout.write("Dry run — no changes applied.\n");
    return;
  }

  const password = await getSshPassword();
  const bundlePath = await createBundle(toSha);

  const newState: PushState = {
    last_pushed_sha: toSha,
    pushed_at: new Date().toISOString(),
    agents: { ...(state?.agents ?? {}) },
  };

  const results = await Promise.allSettled(
    agentNames.map(async (agent) => {
      const ip = await getAgentIp(agent);

      process.stdout.write(`[${agent}] Syncing...\n`);
      const synced = await syncAgentToSha(agent, ip, password, bundlePath, toSha, installDeps);
      if (!synced) {
        newState.agents[agent] = { sha: fromSha, services, ok: false };
        return { agent, ok: false, reason: "sync failed" };
      }

      process.stdout.write(`[${agent}] Restarting services...\n`);
      const restarted = await restartServices(agent, ip, password, services);
      if (!restarted) {
        // Rollback this agent
        process.stderr.write(`[${agent}] Restart failed — rolling back to ${fromSha.slice(0, 8)}\n`);
        await syncAgentToSha(agent, ip, password, bundlePath, fromSha, installDeps);
        await restartServices(agent, ip, password, ALL_SERVICES as unknown as Service[]);
        newState.agents[agent] = { sha: fromSha, services, ok: false };
        return { agent, ok: false, reason: "restart failed, rolled back" };
      }

      // Verify commit landed
      const remoteSha = await remoteHeadSha(agent, ip, password);
      if (remoteSha !== toSha) {
        process.stderr.write(`[${agent}] SHA mismatch after push — rolling back\n`);
        await syncAgentToSha(agent, ip, password, bundlePath, fromSha, installDeps);
        await restartServices(agent, ip, password, ALL_SERVICES as unknown as Service[]);
        newState.agents[agent] = { sha: fromSha, services, ok: false };
        return { agent, ok: false, reason: "sha mismatch, rolled back" };
      }

      process.stdout.write(`[${agent}] OK — ${toSha.slice(0, 8)}\n`);
      newState.agents[agent] = { sha: toSha, services, ok: true };
      return { agent, ok: true };
    })
  );

  await writeState(newState);

  // Clean up bundle
  await Bun.spawn(["rm", "-f", bundlePath]).exited;

  const outcomes = results.map((r) =>
    r.status === "fulfilled" ? r.value : { agent: "?", ok: false, reason: String(r.reason) }
  );

  const passed = outcomes.filter((r) => r.ok).length;
  const failed = outcomes.length - passed;

  process.stdout.write(`\n${passed}/${outcomes.length} agents updated`);
  if (failed > 0) {
    process.stdout.write(`, ${failed} rolled back`);
    for (const r of outcomes.filter((o) => !o.ok)) {
      process.stdout.write(`\n  [${r.agent}] ${r.reason ?? "unknown failure"}`);
    }
    process.stdout.write("\n");
    process.exit(1);
  } else {
    process.stdout.write(" successfully.\n");
  }
}

async function cmdRollback(flags: Record<string, string>): Promise<void> {
  const toSha = flags["to"];
  if (!toSha) {
    process.stderr.write("--to <sha> is required\n");
    process.exit(1);
  }

  const agentNames = resolveAgents(flags["agents"]);
  const password = await getSshPassword();
  const bundlePath = await createBundle(toSha);

  process.stdout.write(`Rolling back ${agentNames.join(", ")} to ${toSha.slice(0, 8)}\n\n`);

  await Promise.allSettled(
    agentNames.map(async (agent) => {
      const ip = await getAgentIp(agent);
      const synced = await syncAgentToSha(agent, ip, password, bundlePath, toSha, false);
      if (!synced) {
        process.stderr.write(`[${agent}] rollback sync failed\n`);
        return;
      }
      await restartServices(agent, ip, password, ALL_SERVICES as unknown as Service[]);
      process.stdout.write(`[${agent}] rolled back to ${toSha.slice(0, 8)}\n`);
    })
  );

  await Bun.spawn(["rm", "-f", bundlePath]).exited;

  const state = await readState();
  if (state) {
    await writeState({ ...state, last_pushed_sha: toSha, pushed_at: new Date().toISOString() });
  }
}

// ---- Usage ----

function printUsage(): void {
  process.stdout.write(`fleet-push — Change-aware code deployment across fleet agents

Usage:
  arc skills run --name fleet-push -- <command> [options]

Commands:
  push                 Sync HEAD to agents, restart affected services, rollback on failure
  diff                 Show deployment plan without applying (dry-run analysis)
  rollback --to <sha>  Force-reset agents to a specific commit and restart all services

Options:
  --agents spark,iris  Comma-separated agent list (default: all)
  --from <sha>         Compute changeset from this SHA (default: last pushed SHA from state)
  --dry-run            Print plan without executing (push only)

Agents: ${Object.keys(AGENTS).join(", ")}
`);
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];
  const { flags } = parseFlags(args.slice(1));

  switch (sub) {
    case "push":
      await cmdPush(flags);
      break;
    case "diff":
      await cmdDiff(flags);
      break;
    case "rollback":
      await cmdRollback(flags);
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
