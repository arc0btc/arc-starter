#!/usr/bin/env bun

/**
 * fleet-deploy CLI
 *
 * Canary deployment pipeline: code change → test on one agent → roll out to all.
 * Composes fleet-sync (git bundles) + fleet-exec (restart) + health checks.
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

const DEFAULT_CANARY = "forge";
const HEALTH_CHECK_WAIT_MS = 15_000; // wait before health check
const HEALTH_CHECK_RETRIES = 3;
const HEALTH_CHECK_INTERVAL_MS = 10_000;

// ---- Types ----

interface DeployResult {
  agent: string;
  synced: boolean;
  restarted: boolean;
  healthy: boolean;
  commit: string;
  error?: string;
}

// ---- Git helpers ----

async function getLocalHead(): Promise<{ commit: string; branch: string; dirty: boolean }> {
  const commitProc = Bun.spawn(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
  const commit = (await new Response(commitProc.stdout).text()).trim();
  await commitProc.exited;

  const branchProc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], { stdout: "pipe", stderr: "pipe" });
  const branch = (await new Response(branchProc.stdout).text()).trim();
  await branchProc.exited;

  const dirtyProc = Bun.spawn(["git", "status", "--porcelain"], { stdout: "pipe", stderr: "pipe" });
  const dirtyOut = (await new Response(dirtyProc.stdout).text()).trim();
  await dirtyProc.exited;

  return { commit, branch, dirty: dirtyOut.length > 0 };
}

async function getRemoteCommit(ip: string, password: string): Promise<string | null> {
  const result = await ssh(ip, password, `cd ${REMOTE_ARC_DIR} && git rev-parse HEAD`);
  return result.ok ? result.stdout.trim() : null;
}

// ---- Git bundle sync ----

async function createBundle(branch: string): Promise<string> {
  const bundlePath = `/tmp/fleet-deploy-${Date.now()}.bundle`;
  const proc = Bun.spawn(["git", "bundle", "create", bundlePath, "--all"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = (await new Response(proc.stderr).text()).trim();
  const exit = await proc.exited;
  if (exit !== 0) throw new Error(`Bundle creation failed: ${stderr}`);
  return bundlePath;
}

async function syncAgent(
  agent: string,
  ip: string,
  password: string,
  bundlePath: string,
  targetCommit: string,
  targetBranch: string
): Promise<boolean> {
  // SCP bundle to agent
  const scpProc = Bun.spawn(
    ["sshpass", "-e", "scp", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10",
     bundlePath, `dev@${ip}:/tmp/fleet-deploy.bundle`],
    { env: { ...process.env, SSHPASS: password }, stdout: "pipe", stderr: "pipe" }
  );
  if ((await scpProc.exited) !== 0) {
    const err = (await new Response(scpProc.stderr).text()).trim();
    process.stderr.write(`  [${agent}] SCP failed: ${err}\n`);
    return false;
  }

  // Fetch from bundle, reset to target commit
  const fetchCmd = [
    `cd ${REMOTE_ARC_DIR}`,
    `git stash --include-untracked 2>/dev/null || true`,
    `git fetch /tmp/fleet-deploy.bundle`,
    `git checkout ${targetBranch} 2>/dev/null || git checkout -b ${targetBranch} ${targetCommit}`,
    `git reset --hard ${targetCommit}`,
    `~/.bun/bin/bun install`,
    `rm -f /tmp/fleet-deploy.bundle`,
    `echo "SYNC_OK"`,
  ].join(" && ");

  const result = await ssh(ip, password, fetchCmd);
  if (!result.ok || !result.stdout.includes("SYNC_OK")) {
    process.stderr.write(`  [${agent}] Sync failed: ${result.stderr.trim()}\n`);
    return false;
  }

  // Verify commit landed
  const verify = await getRemoteCommit(ip, password);
  if (verify !== targetCommit) {
    process.stderr.write(`  [${agent}] Commit mismatch after sync: ${verify?.slice(0, 10)}\n`);
    return false;
  }

  return true;
}

// ---- Service restart ----

async function restartServices(agent: string, ip: string, password: string): Promise<boolean> {
  const cmd = [
    "systemctl --user daemon-reload",
    "systemctl --user restart arc-sensors.timer",
    "systemctl --user restart arc-dispatch.timer",
    "systemctl --user is-active arc-sensors.timer",
    "systemctl --user is-active arc-dispatch.timer",
  ].join(" && ");

  const result = await ssh(ip, password, cmd);
  if (!result.ok) {
    process.stderr.write(`  [${agent}] Service restart failed: ${result.stderr.trim()}\n`);
    return false;
  }
  return true;
}

// ---- Health check ----

async function healthCheck(agent: string, ip: string, password: string): Promise<boolean> {
  const cmd = [
    `systemctl --user is-active arc-sensors.timer`,
    `systemctl --user is-active arc-dispatch.timer`,
    `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun src/cli.ts status`,
  ].join(" && ");

  const result = await ssh(ip, password, cmd);
  if (!result.ok) {
    process.stderr.write(`  [${agent}] Health check failed: ${result.stderr.trim()}\n`);
    return false;
  }
  return true;
}

async function healthCheckWithRetry(agent: string, ip: string, password: string): Promise<boolean> {
  for (let attempt = 1; attempt <= HEALTH_CHECK_RETRIES; attempt++) {
    if (attempt > 1) {
      process.stdout.write(`  [${agent}] Health check retry ${attempt}/${HEALTH_CHECK_RETRIES}...\n`);
      await Bun.sleep(HEALTH_CHECK_INTERVAL_MS);
    }
    const ok = await healthCheck(agent, ip, password);
    if (ok) return true;
  }
  return false;
}

// ---- Deploy one agent ----

async function deployAgent(
  agent: string,
  password: string,
  bundlePath: string,
  targetCommit: string,
  targetBranch: string,
  noRestart: boolean
): Promise<DeployResult> {
  const result: DeployResult = {
    agent,
    synced: false,
    restarted: false,
    healthy: false,
    commit: "",
  };

  try {
    const ip = await getAgentIp(agent);

    // Check if already on target
    const current = await getRemoteCommit(ip, password);
    if (current === targetCommit) {
      process.stdout.write(`  [${agent}] Already on ${targetCommit.slice(0, 10)}\n`);
      result.synced = true;
      result.commit = targetCommit;
      result.restarted = true;
      result.healthy = true;
      return result;
    }

    // Sync
    process.stdout.write(`  [${agent}] Syncing ${current?.slice(0, 10) ?? "?"} → ${targetCommit.slice(0, 10)}...\n`);
    result.synced = await syncAgent(agent, ip, password, bundlePath, targetCommit, targetBranch);
    if (!result.synced) return result;
    result.commit = targetCommit;

    // Restart
    if (!noRestart) {
      process.stdout.write(`  [${agent}] Restarting services...\n`);
      result.restarted = await restartServices(agent, ip, password);
      if (!result.restarted) return result;

      // Health check after a brief wait
      process.stdout.write(`  [${agent}] Waiting ${HEALTH_CHECK_WAIT_MS / 1000}s before health check...\n`);
      await Bun.sleep(HEALTH_CHECK_WAIT_MS);
      result.healthy = await healthCheckWithRetry(agent, ip, password);
    } else {
      result.restarted = true;
      result.healthy = true;
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}

// ---- Subcommands ----

async function cmdCanary(flags: Record<string, string>): Promise<void> {
  const canaryAgent = flags["agent"] ?? DEFAULT_CANARY;
  if (!AGENTS[canaryAgent]) {
    process.stderr.write(`Unknown agent: ${canaryAgent}. Known: ${Object.keys(AGENTS).join(", ")}\n`);
    process.exit(1);
  }

  const local = await getLocalHead();
  if (local.dirty) {
    process.stdout.write("WARNING: Local tree has uncommitted changes. Only committed code will deploy.\n\n");
  }

  process.stdout.write(`Canary deploy to ${canaryAgent} — ${local.branch} @ ${local.commit.slice(0, 10)}\n\n`);

  const password = await getSshPassword();
  const bundlePath = await createBundle(local.branch);
  process.stdout.write(`Bundle created: ${bundlePath}\n\n`);

  const noRestart = flags["no-restart"] === "true";
  const result = await deployAgent(canaryAgent, password, bundlePath, local.commit, local.branch, noRestart);

  // Cleanup bundle
  try { (await import("node:fs")).unlinkSync(bundlePath); } catch { /* ignore */ }

  printDeployResults([result]);

  if (!result.healthy) {
    process.stderr.write(`\nCanary FAILED. Do NOT proceed with rollout.\n`);
    process.exit(1);
  }

  process.stdout.write(`\nCanary PASSED. Safe to rollout:\n`);
  process.stdout.write(`  arc skills run --name fleet-deploy -- rollout --skip-agents ${canaryAgent}\n`);
}

async function cmdRollout(flags: Record<string, string>): Promise<void> {
  const skipList = (flags["skip-agents"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const agents = Object.keys(AGENTS).filter((a) => !skipList.includes(a));

  if (agents.length === 0) {
    process.stdout.write("No agents to deploy to (all skipped).\n");
    return;
  }

  const local = await getLocalHead();
  if (local.dirty) {
    process.stdout.write("WARNING: Local tree has uncommitted changes. Only committed code will deploy.\n\n");
  }

  process.stdout.write(`Rolling out to ${agents.length} agent(s): ${agents.join(", ")}\n`);
  process.stdout.write(`Target: ${local.branch} @ ${local.commit.slice(0, 10)}\n\n`);

  const password = await getSshPassword();
  const bundlePath = await createBundle(local.branch);
  process.stdout.write(`Bundle created: ${bundlePath}\n\n`);

  const noRestart = flags["no-restart"] === "true";

  // Deploy in parallel
  const results = await Promise.allSettled(
    agents.map((agent) => deployAgent(agent, password, bundlePath, local.commit, local.branch, noRestart))
  );

  // Cleanup bundle
  try { (await import("node:fs")).unlinkSync(bundlePath); } catch { /* ignore */ }

  const deployResults = results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      agent: agents[i],
      synced: false,
      restarted: false,
      healthy: false,
      commit: "",
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });

  printDeployResults(deployResults);

  const failed = deployResults.filter((r) => !r.healthy);
  if (failed.length > 0) {
    process.stderr.write(`\n${failed.length} agent(s) failed. Review above.\n`);
    process.exit(1);
  }

  process.stdout.write(`\nAll ${agents.length} agent(s) deployed successfully.\n`);
}

async function cmdPipeline(flags: Record<string, string>): Promise<void> {
  const canaryAgent = flags["canary"] ?? DEFAULT_CANARY;
  if (!AGENTS[canaryAgent]) {
    process.stderr.write(`Unknown canary agent: ${canaryAgent}. Known: ${Object.keys(AGENTS).join(", ")}\n`);
    process.exit(1);
  }

  const skipList = (flags["skip-agents"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const rolloutAgents = Object.keys(AGENTS).filter((a) => a !== canaryAgent && !skipList.includes(a));

  const local = await getLocalHead();
  if (local.dirty) {
    process.stdout.write("WARNING: Local tree has uncommitted changes. Only committed code will deploy.\n\n");
  }

  process.stdout.write(`=== Fleet Deploy Pipeline ===\n`);
  process.stdout.write(`Target: ${local.branch} @ ${local.commit.slice(0, 10)}\n`);
  process.stdout.write(`Canary: ${canaryAgent}\n`);
  process.stdout.write(`Rollout: ${rolloutAgents.length > 0 ? rolloutAgents.join(", ") : "(none)"}\n\n`);

  const password = await getSshPassword();
  const bundlePath = await createBundle(local.branch);
  const noRestart = flags["no-restart"] === "true";

  // Stage 1: Canary
  process.stdout.write(`--- Stage 1: Canary (${canaryAgent}) ---\n\n`);
  const canaryResult = await deployAgent(canaryAgent, password, bundlePath, local.commit, local.branch, noRestart);
  printDeployResults([canaryResult]);

  if (!canaryResult.healthy) {
    // Cleanup
    try { (await import("node:fs")).unlinkSync(bundlePath); } catch { /* ignore */ }
    process.stderr.write(`\nCanary FAILED on ${canaryAgent}. Pipeline aborted — no agents were rolled out.\n`);
    process.exit(1);
  }

  process.stdout.write(`\nCanary passed. Proceeding to rollout.\n\n`);

  if (rolloutAgents.length === 0) {
    process.stdout.write(`No remaining agents to rollout.\n`);
    try { (await import("node:fs")).unlinkSync(bundlePath); } catch { /* ignore */ }
    return;
  }

  // Stage 2: Rollout remaining
  process.stdout.write(`--- Stage 2: Rollout (${rolloutAgents.join(", ")}) ---\n\n`);

  const rolloutResults = await Promise.allSettled(
    rolloutAgents.map((agent) => deployAgent(agent, password, bundlePath, local.commit, local.branch, noRestart))
  );

  // Cleanup
  try { (await import("node:fs")).unlinkSync(bundlePath); } catch { /* ignore */ }

  const allRollout = rolloutResults.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      agent: rolloutAgents[i],
      synced: false,
      restarted: false,
      healthy: false,
      commit: "",
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });

  printDeployResults(allRollout);

  // Final summary
  const allResults = [canaryResult, ...allRollout];
  const passed = allResults.filter((r) => r.healthy).length;
  const failed = allResults.length - passed;

  process.stdout.write(`\n=== Pipeline Complete ===\n`);
  process.stdout.write(`${passed}/${allResults.length} agents healthy`);
  if (failed > 0) {
    process.stdout.write(` (${failed} failed)`);
  }
  process.stdout.write(`\n`);

  if (failed > 0) process.exit(1);
}

async function cmdStatus(): Promise<void> {
  const local = await getLocalHead();
  const password = await getSshPassword();

  process.stdout.write(`Fleet deployment status\n`);
  process.stdout.write(`Local: ${local.branch} @ ${local.commit.slice(0, 10)}${local.dirty ? " [dirty]" : ""}\n\n`);

  const agents = Object.keys(AGENTS);
  const results = await Promise.allSettled(
    agents.map(async (agent) => {
      const ip = await getAgentIp(agent);
      const commit = await getRemoteCommit(ip, password);
      const healthy = commit ? await healthCheck(agent, ip, password) : false;
      return { agent, commit, healthy };
    })
  );

  let allSynced = true;
  for (const r of results) {
    if (r.status === "rejected") {
      process.stdout.write(`  [???] error\n`);
      allSynced = false;
      continue;
    }
    const { agent, commit, healthy } = r.value;
    if (!commit) {
      process.stdout.write(`  [${agent}] UNREACHABLE\n`);
      allSynced = false;
      continue;
    }
    const synced = commit === local.commit;
    const health = healthy ? "healthy" : "UNHEALTHY";
    const sync = synced ? "IN SYNC" : `BEHIND (${commit.slice(0, 10)})`;
    process.stdout.write(`  [${agent}] ${sync} — ${health}\n`);
    if (!synced) allSynced = false;
  }

  process.stdout.write(allSynced ? "\nAll agents on same commit.\n" : "\nSome agents out of sync.\n");
}

// ---- Output ----

function printDeployResults(results: DeployResult[]): void {
  process.stdout.write(`\n`);
  for (const r of results) {
    const sync = r.synced ? "synced" : "SYNC FAIL";
    const restart = r.restarted ? "restarted" : "RESTART FAIL";
    const health = r.healthy ? "healthy" : "UNHEALTHY";
    const status = r.healthy ? "OK" : "FAIL";
    process.stdout.write(`  [${r.agent}] ${status} — ${sync}, ${restart}, ${health}`);
    if (r.commit) process.stdout.write(` @ ${r.commit.slice(0, 10)}`);
    if (r.error) process.stdout.write(` (${r.error})`);
    process.stdout.write(`\n`);
  }
}

// ---- Usage ----

function printUsage(): void {
  process.stdout.write(`fleet-deploy — Canary deployment pipeline for agent fleet

Usage:
  arc skills run --name fleet-deploy -- <command> [options]

Commands:
  pipeline              Full pipeline: canary → validate → rollout
  canary --agent NAME   Deploy + validate on single agent (default: ${DEFAULT_CANARY})
  rollout               Deploy to all agents (or remaining after canary)
  status                Show deployment state across fleet

Options:
  --canary <agent>        Canary agent for pipeline (default: ${DEFAULT_CANARY})
  --skip-agents <a,b>     Skip these agents during rollout
  --no-restart true       Sync code without restarting services

Agents: ${Object.keys(AGENTS).join(", ")}
`);
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];
  const { flags } = parseFlags(args.slice(1));

  switch (sub) {
    case "pipeline":
      await cmdPipeline(flags);
      break;
    case "canary":
      await cmdCanary(flags);
      break;
    case "rollout":
      await cmdRollout(flags);
      break;
    case "status":
      await cmdStatus();
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      break;
    default:
      process.stderr.write(`Unknown command: ${sub}\n\n`);
      printUsage();
      process.exit(1);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
