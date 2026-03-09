/**
 * fleet-sync CLI — sync CLAUDE.md, skills, and git commits to fleet agents via SSH.
 *
 * Usage:
 *   bun skills/fleet-sync/cli.ts claude-md [--agent <name|all>]
 *   bun skills/fleet-sync/cli.ts skills --agent <name|all> [--skill <name>]
 *   bun skills/fleet-sync/cli.ts status [--agent <name|all>]
 *   bun skills/fleet-sync/cli.ts full [--agent <name|all>]
 *   bun skills/fleet-sync/cli.ts git-status [--agent <name|all>]
 *   bun skills/fleet-sync/cli.ts git-sync [--agent <name|all>]
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
    "github-mentions",
    "github-release-watch",
    "site-consistency",
  ],
  loom: [
    "aibtc-dev-ops",
    "arc-mcp-server",
    "arc-observatory",
    "defi-bitflow",
    "defi-zest",
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
    "blog-deploy",
    "dev-landing-page-review",
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
}

function parseFlags(args: string[]): { command: string; flags: Flags } {
  const command = args[0] ?? "";
  const flags: Flags = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--agent" && args[i + 1]) {
      flags.agent = args[++i];
    } else if (args[i] === "--skill" && args[i + 1]) {
      flags.skill = args[++i];
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

async function gitSync(agents: string[]): Promise<void> {
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

  // Check which agents actually need syncing
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
    return;
  }

  // Create git bundle from local repo
  // Bundle contains everything needed to reach local HEAD
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

  // Transfer and apply to each agent that needs it
  for (const { agent, ip, remoteCommit } of needsSync) {
    console.log(
      `\n  [${agent}] syncing ${remoteCommit.slice(0, 10)} -> ${local.commit.slice(0, 10)}...`
    );

    // SCP bundle to agent
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
        bundlePath,
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
      continue;
    }

    // On agent: fetch from bundle, checkout the target branch at the target commit
    const fetchCmd = [
      `cd ${REMOTE_ARC_DIR}`,
      // Stash any local changes to avoid conflicts
      `git stash --include-untracked 2>/dev/null || true`,
      // Fetch all refs from the bundle
      `git fetch ${remoteBundlePath}`,
      // Checkout the correct branch at the correct commit
      `git checkout ${local.branch} 2>/dev/null || git checkout -b ${local.branch} ${local.commit}`,
      // Reset to the exact commit (handles both fast-forward and diverged cases)
      `git reset --hard ${local.commit}`,
      // Reinstall dependencies in case package.json changed
      `~/.bun/bin/bun install`,
      // Clean up
      `rm -f ${remoteBundlePath}`,
      `echo "OK"`,
    ].join(" && ");

    const result = await ssh(ip, password, fetchCmd);
    if (result.ok && result.stdout.includes("OK")) {
      // Verify the commit landed
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

  // Clean up local bundle
  try {
    unlinkSync(bundlePath);
  } catch {
    // ignore cleanup errors
  }

  console.log("\nGit sync complete.");
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { command, flags } = parseFlags(args);

  if (!command) {
    console.log("Usage: fleet-sync <command> [--agent <name|all>] [--skill <name>]");
    console.log("Commands: claude-md, skills, status, full, git-status, git-sync");
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
      break;

    case "git-status":
      await gitStatus(agents);
      break;

    case "git-sync":
      await gitSync(agents);
      break;

    default:
      process.stderr.write(`Unknown command: ${command}\n`);
      process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    process.stderr.write(`fleet-sync error: ${err.message}\n`);
    process.exit(1);
  });
}
