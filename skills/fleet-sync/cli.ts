/**
 * fleet-sync CLI — sync CLAUDE.md, skills, and git commits to fleet agents via SSH.
 *
 * Usage:
 *   bun skills/fleet-sync/cli.ts claude-md [--agent <name|all>]
 *   bun skills/fleet-sync/cli.ts skills --agent <name|all> [--skill <name>]
 *   bun skills/fleet-sync/cli.ts status [--agent <name|all>]
 *   bun skills/fleet-sync/cli.ts full [--agent <name|all>]
 *   bun skills/fleet-sync/cli.ts git-status [--agent <name|all>]
 *   bun skills/fleet-sync/cli.ts git-sync [--agent <name|all>] [--force-push]
 *   bun skills/fleet-sync/cli.ts contacts [--agent <name|all>]
 */

import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AGENTS,
  REMOTE_ARC_DIR,
  getAgentIp,
  getSshPassword,
  ssh,
  sshLog,
  resolveAgents,
} from "../../src/ssh.ts";

const ROOT = join(import.meta.dir, "../..");

// ---- Agent → skill assignments ----
// Derived from templates/agent-specialization-matrix.md

const AGENT_SKILLS: Record<string, string[]> = {
  spark: [
    "aibtc-heartbeat",
    "aibtc-inbox-sync",
    "aibtc-news-classifieds",
    "aibtc-news-deal-flow",
    "aibtc-news-editorial",
    "arc-reputation",
    "bitcoin-quorumclaw",
    "bitcoin-taproot-multisig",
    "bitcoin-wallet",
    "dao-zero-authority",
    "defi-stacks-market",
    "erc8004-identity",
    "erc8004-reputation",
    "erc8004-trust",
    "erc8004-validation",
    "social-agent-engagement",
    "social-x-ecosystem",
    "social-x-posting",
    "stacks-payments",
    "stacks-stackspot",
    "styx",
  ],
  iris: [
    "aibtc-repo-maintenance",
    "arc-brand-voice",
    "arc-content-quality",
    "arc-email-sync",
    "arc-link-research",
    "arc-report-email",
    "arc-reporting",
    "arc-reputation",
    "arc-roundtable",
    "arxiv-research",
    "blog-publishing",
    "claude-code-releases",
    "erc8004-reputation",
    "github-mentions",
    "github-release-watch",
    "site-consistency",
  ],
  loom: [
    "aibtc-dev-ops",
    "arc-mcp-server",
    "arc-observatory",
    "arc-reputation",
    "defi-bitflow",
    "defi-zest",
    "erc8004-reputation",
    "github-worker-logs",
    "worker-deploy",
    "worker-logs-monitor",
  ],
  forge: [
    "arc0btc-ask-service",
    "arc0btc-monetization",
    "arc0btc-pr-review",
    "arc0btc-site-health",
    "arc-remote-setup",
    "arc-reputation",
    "blog-deploy",
    "dev-landing-page-review",
    "erc8004-reputation",
    "github-ci-status",
    "github-issue-monitor",
    "github-security-alerts",
  ],
};

// Skills every agent needs (shared infrastructure)
const SHARED_SKILLS: string[] = [
  "arc-credentials",
  "arc-skill-manager",
  "arc-service-health",
  "arc-alive-check",
];

// ---- Flag parsing ----

interface Flags {
  agent?: string;
  skill?: string;
  forcePush?: boolean;
}

function parseFlags(args: string[]): { command: string; flags: Flags } {
  const command = args[0] ?? "";
  const flags: Flags = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--agent" && args[i + 1]) {
      flags.agent = args[++i];
    } else if (args[i] === "--skill" && args[i + 1]) {
      flags.skill = args[++i];
    } else if (args[i] === "--force-push") {
      flags.forcePush = true;
    }
  }
  return { command, flags };
}

// ---- Helpers ----

function localMd5(filePath: string): string {
  const content = readFileSync(filePath, "utf-8");
  const hasher = new Bun.CryptoHasher("md5");
  hasher.update(content);
  return hasher.digest("hex");
}

async function remoteMd5(
  ip: string,
  password: string,
  remotePath: string
): Promise<string | null> {
  const result = await ssh(ip, password, `md5sum ${remotePath} 2>/dev/null`);
  if (!result.ok) return null;
  return result.stdout.trim().split(/\s+/)[0] ?? null;
}

function getSkillsForAgent(agent: string): string[] {
  const assigned = AGENT_SKILLS[agent] ?? [];
  // Merge shared + agent-specific, dedup
  const all = [...new Set([...SHARED_SKILLS, ...assigned])];
  // Filter to skills that actually exist locally
  return all.filter((s) => existsSync(join(ROOT, "skills", s, "SKILL.md")));
}

// ---- Commands ----

async function syncClaudeMd(agents: string[]): Promise<void> {
  const localPath = join(ROOT, "CLAUDE.md");
  if (!existsSync(localPath)) {
    process.stderr.write("CLAUDE.md not found at project root\n");
    process.exit(1);
  }

  const localHash = localMd5(localPath);
  const password = await getSshPassword();

  console.log(`\nSyncing CLAUDE.md (local hash: ${localHash.slice(0, 8)}...)`);

  for (const agent of agents) {
    const ip = await getAgentIp(agent);
    const remotePath = `${REMOTE_ARC_DIR}/CLAUDE.md`;
    const remoteHash = await remoteMd5(ip, password, remotePath);

    if (remoteHash === localHash) {
      console.log(`  [${agent}] CLAUDE.md already in sync ✓`);
      continue;
    }

    const content = readFileSync(localPath, "utf-8");
    const result = await sshLog(
      ip,
      password,
      agent,
      `cat > ${remotePath} << 'CLAUDEMDEOF'\n${content}\nCLAUDEMDEOF`
    );
    if (result.ok) {
      console.log(
        `  [${agent}] CLAUDE.md synced (was: ${remoteHash?.slice(0, 8) ?? "missing"})`
      );
    } else {
      process.stderr.write(`  [${agent}] CLAUDE.md sync FAILED\n`);
    }
  }
}

async function syncSkills(agents: string[], skillFilter?: string): Promise<void> {
  const password = await getSshPassword();

  for (const agent of agents) {
    const ip = await getAgentIp(agent);
    const skills = skillFilter
      ? [skillFilter]
      : getSkillsForAgent(agent);

    if (skills.length === 0) {
      console.log(`  [${agent}] No skills to sync`);
      continue;
    }

    console.log(`\n[${agent}] Syncing ${skills.length} skill(s)...`);

    // Ensure skills directory exists on remote
    await ssh(ip, password, `mkdir -p ${REMOTE_ARC_DIR}/skills`);

    for (const skill of skills) {
      const localSkillDir = join(ROOT, "skills", skill);
      if (!existsSync(localSkillDir)) {
        console.log(`  [${agent}] ${skill} — not found locally, skipping`);
        continue;
      }

      // Tar locally, pipe over SSH, extract on remote
      // This handles all files in the skill directory atomically
      const tarProc = Bun.spawn(["tar", "-cf", "-", "-C", join(ROOT, "skills"), skill], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const extractCmd = `tar -xf - -C ${REMOTE_ARC_DIR}/skills`;
      const sshProc = Bun.spawn(
        [
          "sshpass",
          "-e",
          "ssh",
          "-o", "StrictHostKeyChecking=no",
          "-o", "ConnectTimeout=10",
          "-o", "BatchMode=no",
          `dev@${ip}`,
          extractCmd,
        ],
        {
          stdin: tarProc.stdout,
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env, SSHPASS: password },
        }
      );

      const sshStderr = await new Response(sshProc.stderr).text();
      const sshExit = await sshProc.exited;
      await tarProc.exited;

      if (sshExit === 0) {
        console.log(`  [${agent}] ${skill} synced`);
      } else {
        process.stderr.write(
          `  [${agent}] ${skill} FAILED (exit ${sshExit}): ${sshStderr.trim()}\n`
        );
      }
    }
  }
}

async function showStatus(agents: string[]): Promise<void> {
  const localClaudeMdHash = localMd5(join(ROOT, "CLAUDE.md"));
  const password = await getSshPassword();

  console.log(`\nFleet sync status (CLAUDE.md local: ${localClaudeMdHash.slice(0, 8)}...)\n`);

  for (const agent of agents) {
    const ip = await getAgentIp(agent);
    console.log(`[${agent}] (${ip})`);

    // Check CLAUDE.md
    const remoteHash = await remoteMd5(ip, password, `${REMOTE_ARC_DIR}/CLAUDE.md`);
    if (remoteHash === null) {
      console.log("  CLAUDE.md: MISSING");
    } else if (remoteHash === localClaudeMdHash) {
      console.log("  CLAUDE.md: in sync");
    } else {
      console.log(`  CLAUDE.md: OUT OF SYNC (remote: ${remoteHash.slice(0, 8)}...)`);
    }

    // Check skills presence
    const assignedSkills = getSkillsForAgent(agent);
    const result = await ssh(
      ip,
      password,
      `ls ${REMOTE_ARC_DIR}/skills/ 2>/dev/null`
    );
    const remoteSkills = result.ok
      ? result.stdout
          .trim()
          .split("\n")
          .filter((s) => s.length > 0)
      : [];

    const missing = assignedSkills.filter((s) => !remoteSkills.includes(s));
    const present = assignedSkills.filter((s) => remoteSkills.includes(s));

    console.log(`  Skills: ${present.length}/${assignedSkills.length} present`);
    if (missing.length > 0) {
      console.log(`  Missing: ${missing.join(", ")}`);
    }
    console.log("");
  }
}

// ---- Contacts sync ----

async function syncContacts(agents: string[]): Promise<void> {
  const password = await getSshPassword();

  // Export all active agent contacts from Arc's contacts DB
  const exportProc = Bun.spawn(
    ["bash", "bin/arc", "skills", "run", "--name", "contacts", "--", "export", "--type", "agent"],
    { cwd: ROOT, stdout: "pipe", stderr: "pipe" }
  );
  const exportOut = await new Response(exportProc.stdout).text();
  const exportExit = await exportProc.exited;

  if (exportExit !== 0) {
    process.stderr.write("contacts export failed — skipping contacts sync\n");
    return;
  }

  let contactCount = 0;
  try {
    const parsed = JSON.parse(exportOut) as unknown[];
    contactCount = parsed.length;
  } catch {
    process.stderr.write("contacts export produced invalid JSON — skipping\n");
    return;
  }

  if (contactCount === 0) {
    console.log("No agent contacts to sync.");
    return;
  }

  console.log(`\nSyncing ${contactCount} agent contact(s) to fleet...`);

  const exportPath = join(tmpdir(), `arc-fleet-contacts-${Date.now()}.json`);
  await Bun.write(exportPath, exportOut);

  for (const agent of agents) {
    const ip = await getAgentIp(agent);
    const remotePath = `/tmp/arc-fleet-contacts.json`;

    // SCP contacts JSON to agent
    const scpProc = Bun.spawn(
      [
        "sshpass", "-e", "scp",
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=10",
        exportPath,
        `dev@${ip}:${remotePath}`,
      ],
      { env: { ...process.env, SSHPASS: password }, stdout: "pipe", stderr: "pipe" }
    );
    const scpExit = await scpProc.exited;

    if (scpExit !== 0) {
      const scpErr = (await new Response(scpProc.stderr).text()).trim();
      process.stderr.write(`  [${agent}] SCP failed: ${scpErr}\n`);
      continue;
    }

    // Import on agent (also re-activates archived fleet-peer contacts)
    const importCmd = `cd ${REMOTE_ARC_DIR} && bash bin/arc skills run --name contacts -- import --file ${remotePath} && rm -f ${remotePath}`;
    const result = await ssh(ip, password, importCmd);

    if (result.ok) {
      const summary = result.stdout
        .split("\n")
        .filter((l) => l.includes("[contacts]"))
        .join(" ")
        .trim();
      console.log(`  [${agent}] ${summary || "contacts synced"}`);
    } else {
      process.stderr.write(`  [${agent}] import FAILED: ${result.stderr.trim()}\n`);
    }
  }

  try {
    unlinkSync(exportPath);
  } catch {
    // ignore cleanup errors
  }
}

// ---- Git helpers ----

interface GitInfo {
  commit: string;
  branch: string;
  dirty: boolean;
}

async function getLocalGitInfo(): Promise<GitInfo> {
  const commitProc = Bun.spawn(["git", "rev-parse", "HEAD"], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const commit = (await new Response(commitProc.stdout).text()).trim();
  await commitProc.exited;

  const branchProc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const branch = (await new Response(branchProc.stdout).text()).trim();
  await branchProc.exited;

  const dirtyProc = Bun.spawn(["git", "status", "--porcelain"], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const dirtyOut = (await new Response(dirtyProc.stdout).text()).trim();
  await dirtyProc.exited;

  return { commit, branch, dirty: dirtyOut.length > 0 };
}

async function getRemoteGitInfo(
  ip: string,
  password: string
): Promise<GitInfo | null> {
  const result = await ssh(
    ip,
    password,
    `cd ${REMOTE_ARC_DIR} && git rev-parse HEAD && git rev-parse --abbrev-ref HEAD && git status --porcelain`
  );
  if (!result.ok) return null;
  const lines = result.stdout.trim().split("\n");
  return {
    commit: lines[0] ?? "",
    branch: lines[1] ?? "",
    dirty: lines.slice(2).some((l) => l.trim().length > 0),
  };
}

async function gitStatus(agents: string[]): Promise<void> {
  const local = await getLocalGitInfo();
  const password = await getSshPassword();

  console.log(
    `\nArc (local): ${local.branch} @ ${local.commit.slice(0, 10)}${local.dirty ? " [dirty]" : ""}\n`
  );

  const results = await Promise.allSettled(
    agents.map(async (agent) => {
      const ip = await getAgentIp(agent);
      const remote = await getRemoteGitInfo(ip, password);
      return { agent, remote };
    })
  );

  let allSynced = true;
  for (const r of results) {
    if (r.status === "rejected") {
      console.log(`  [???] error: ${r.reason}`);
      allSynced = false;
      continue;
    }
    const { agent, remote } = r.value;
    if (!remote) {
      console.log(`  [${agent}] UNREACHABLE`);
      allSynced = false;
      continue;
    }
    const synced = remote.commit === local.commit;
    const dirty = remote.dirty ? " [dirty]" : "";
    const mark = synced ? "IN SYNC" : "BEHIND";
    console.log(
      `  [${agent}] ${remote.branch} @ ${remote.commit.slice(0, 10)}${dirty} — ${mark}`
    );
    if (!synced) allSynced = false;
  }

  console.log(
    allSynced
      ? "\nAll agents on same commit."
      : "\nSome agents out of sync. Run: arc skills run --name fleet-sync -- git-sync"
  );
}

/** Shared: find drifted agents and create bundle. Returns null if all in sync. */
async function prepareSyncBundle(
  agents: string[]
): Promise<{
  local: GitInfo;
  password: string;
  needsSync: Array<{ agent: string; ip: string; remoteCommit: string }>;
  bundlePath: string;
} | null> {
  const local = await getLocalGitInfo();
  const password = await getSshPassword();

  if (local.dirty) {
    console.log(
      "WARNING: Local working tree has uncommitted changes. Only committed code will be synced.\n"
    );
  }

  console.log(
    `Syncing fleet to ${local.branch} @ ${local.commit.slice(0, 10)}\n`
  );

  const needsSync: Array<{ agent: string; ip: string; remoteCommit: string }> =
    [];
  for (const agent of agents) {
    const ip = await getAgentIp(agent);
    const remote = await getRemoteGitInfo(ip, password);
    if (!remote) {
      console.log(`  [${agent}] UNREACHABLE — skipping`);
      continue;
    }
    if (remote.commit === local.commit) {
      console.log(`  [${agent}] already on ${local.commit.slice(0, 10)}`);
      continue;
    }
    needsSync.push({ agent, ip, remoteCommit: remote.commit });
  }

  if (needsSync.length === 0) {
    console.log("\nAll reachable agents already in sync.");
    return null;
  }

  const bundlePath = join(tmpdir(), `arc-fleet-sync-${Date.now()}.bundle`);
  console.log(`\nCreating git bundle...`);
  const bundleProc = Bun.spawn(
    ["git", "bundle", "create", bundlePath, "--all"],
    {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  const bundleStderr = (await new Response(bundleProc.stderr).text()).trim();
  const bundleExit = await bundleProc.exited;
  if (bundleExit !== 0) {
    process.stderr.write(`Failed to create bundle: ${bundleStderr}\n`);
    process.exit(1);
  }

  const bundleSize = Bun.file(bundlePath).size;
  console.log(`Bundle created: ${(bundleSize / 1024 / 1024).toFixed(1)} MB`);

  return { local, password, needsSync, bundlePath };
}

/** SCP a bundle to an agent. Returns true on success. */
async function scpBundle(
  ip: string,
  password: string,
  localBundlePath: string,
  agent: string
): Promise<boolean> {
  const remoteBundlePath = `/tmp/arc-fleet-sync.bundle`;
  const scpProc = Bun.spawn(
    [
      "sshpass",
      "-e",
      "scp",
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "ConnectTimeout=10",
      localBundlePath,
      `dev@${ip}:${remoteBundlePath}`,
    ],
    {
      env: { ...process.env, SSHPASS: password },
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  const scpExit = await scpProc.exited;
  if (scpExit !== 0) {
    const scpErr = (await new Response(scpProc.stderr).text()).trim();
    process.stderr.write(`  [${agent}] SCP failed: ${scpErr}\n`);
    return false;
  }
  return true;
}

/** Cleanup a local bundle file. */
function cleanupBundle(bundlePath: string): void {
  try {
    unlinkSync(bundlePath);
  } catch {
    // ignore cleanup errors
  }
}

/**
 * Notify-only git sync (default).
 * Sends bundle to drifted agents and creates a task on their local queue
 * so the worker applies the update itself with full local context.
 */
async function gitSync(agents: string[]): Promise<void> {
  const prep = await prepareSyncBundle(agents);
  if (!prep) return;
  const { local, password, needsSync, bundlePath } = prep;

  for (const { agent, ip, remoteCommit } of needsSync) {
    console.log(
      `\n  [${agent}] notifying ${remoteCommit.slice(0, 10)} -> ${local.commit.slice(0, 10)}...`
    );

    // Step 1: SCP bundle to agent
    const ok = await scpBundle(ip, password, bundlePath, agent);
    if (!ok) continue;
    console.log(`  [${agent}] bundle transferred`);

    // Step 2: Create task on agent's local queue via SSH
    const subject = `Apply git bundle: update to ${local.branch} @ ${local.commit.slice(0, 10)}`;
    const taskCmd = [
      `cd ${REMOTE_ARC_DIR} &&`,
      `bash bin/arc tasks add`,
      `--subject "${subject}"`,
      `--priority 3`,
      `--description "Bundle at /tmp/arc-fleet-sync.bundle. Target: ${local.branch} @ ${local.commit}. Steps: git fetch /tmp/arc-fleet-sync.bundle && git checkout ${local.branch} && git reset --hard ${local.commit} && ~/.bun/bin/bun install && rm -f /tmp/arc-fleet-sync.bundle. Restart services if src/ changed."`,
    ].join(" ");

    const result = await ssh(ip, password, taskCmd);
    if (result.ok) {
      console.log(`  [${agent}] task created on local queue`);
    } else {
      process.stderr.write(
        `  [${agent}] task creation FAILED: ${result.stderr.trim()}\n`
      );
      // Fallback: clean up the bundle on the remote since no task will consume it
      await ssh(ip, password, `rm -f /tmp/arc-fleet-sync.bundle`);
    }
  }

  cleanupBundle(bundlePath);
  console.log("\nGit sync notifications sent. Workers will apply updates.");
}

/**
 * Force-push git sync (emergency fallback).
 * Arc directly applies the bundle on each agent — full reset + bun install.
 * Use --force-push flag to invoke.
 */
async function gitSyncForcePush(agents: string[]): Promise<void> {
  const prep = await prepareSyncBundle(agents);
  if (!prep) return;
  const { local, password, needsSync, bundlePath } = prep;

  for (const { agent, ip, remoteCommit } of needsSync) {
    console.log(
      `\n  [${agent}] force-syncing ${remoteCommit.slice(0, 10)} -> ${local.commit.slice(0, 10)}...`
    );

    const ok = await scpBundle(ip, password, bundlePath, agent);
    if (!ok) continue;

    const remoteBundlePath = `/tmp/arc-fleet-sync.bundle`;
    const fetchCmd = [
      `cd ${REMOTE_ARC_DIR}`,
      `git stash --include-untracked 2>/dev/null || true`,
      `git fetch ${remoteBundlePath}`,
      `git checkout ${local.branch} 2>/dev/null || git checkout -b ${local.branch} ${local.commit}`,
      `git reset --hard ${local.commit}`,
      `~/.bun/bin/bun install`,
      `rm -f ${remoteBundlePath}`,
      `echo "OK"`,
    ].join(" && ");

    const result = await ssh(ip, password, fetchCmd);
    if (result.ok && result.stdout.includes("OK")) {
      const verify = await ssh(
        ip,
        password,
        `cd ${REMOTE_ARC_DIR} && git rev-parse HEAD`
      );
      const newCommit = verify.stdout.trim();
      if (newCommit === local.commit) {
        console.log(`  [${agent}] synced to ${local.commit.slice(0, 10)}`);
      } else {
        process.stderr.write(
          `  [${agent}] sync completed but commit mismatch: ${newCommit.slice(0, 10)}\n`
        );
      }
    } else {
      process.stderr.write(
        `  [${agent}] sync FAILED: ${result.stderr.trim()}\n`
      );
    }
  }

  cleanupBundle(bundlePath);
  console.log("\nGit force-push sync complete.");
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { command, flags } = parseFlags(args);

  if (!command) {
    console.log("Usage: fleet-sync <command> [--agent <name|all>] [--skill <name>] [--force-push]");
    console.log("Commands: claude-md, skills, status, full, git-status, git-sync, contacts");
    console.log("  git-sync: notify-only (bundle + task). Add --force-push for direct reset.");
    console.log("  contacts: export Arc's agent contacts and seed/re-activate them on each worker");
    process.exit(0);
  }

  const agents = resolveAgents(flags.agent ?? "all");

  switch (command) {
    case "claude-md":
      await syncClaudeMd(agents);
      break;

    case "skills":
      await syncSkills(agents, flags.skill);
      break;

    case "status":
      await showStatus(agents);
      break;

    case "full":
      await syncClaudeMd(agents);
      await syncSkills(agents);
      await syncContacts(agents);
      break;

    case "contacts":
      await syncContacts(agents);
      break;

    case "git-status":
      await gitStatus(agents);
      break;

    case "git-sync":
      if (flags.forcePush) {
        await gitSyncForcePush(agents);
      } else {
        await gitSync(agents);
      }
      break;

    default:
      process.stderr.write(`Unknown command: ${command}\n`);
      process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`fleet-sync error: ${error.message}\n`);
    process.exit(1);
  });
}
