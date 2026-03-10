#!/usr/bin/env bun

/**
 * fleet-self-sync CLI
 *
 * Worker-local bundle detection, apply, service restart, and health validation.
 * Runs on worker agents to self-apply bundles deposited by Arc.
 */

import { parseFlags } from "../../src/utils.ts";
import { join } from "node:path";
import { hostname } from "node:os";

const ROOT = new URL("../..", import.meta.url).pathname;
const BUN = `${process.env.HOME}/.bun/bin/bun`;
const BUNDLE_GLOB = "/tmp/arc-fleet-sync*.bundle";
const BUNDLE_PUSH_GLOB = "/tmp/arc-fleet-push*.bundle";
const SOUL_BACKUP = "/tmp/arc-soul-backup.md";
const MEMORY_BACKUP = "/tmp/arc-memory-backup.md";
const SOUL_PERSISTENT = `${process.env.HOME}/.aibtc/SOUL.md`;
const MEMORY_PERSISTENT = `${process.env.HOME}/.aibtc/MEMORY.md`;

// Definitive Arc identity markers — same as sensor.ts
const ARC_IDENTITY_MARKERS = [
  "# Arc\n",
  "I'm Arc.",
  "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B",
  "bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933",
] as const;

function hasArcIdentityClaims(content: string): boolean {
  return ARC_IDENTITY_MARKERS.some((marker) => content.includes(marker));
}

// ---- File → service mapping (reused from fleet-push) ----

const ALL_SERVICES = [
  "arc-sensors.timer",
  "arc-dispatch.timer",
  "arc-web.service",
] as const;
type Service = (typeof ALL_SERVICES)[number];

function detectAffectedServices(changedFiles: string[]): Set<Service> {
  const services = new Set<Service>();

  for (const f of changedFiles) {
    if (f === "package.json" || f === "bun.lockb") {
      ALL_SERVICES.forEach((s) => services.add(s));
      break;
    }
    if (f === "src/sensors.ts" || f.match(/^skills\/[^/]+\/sensor\.ts$/)) {
      services.add("arc-sensors.timer");
    }
    if (f === "src/web.ts") {
      services.add("arc-web.service");
    }
    if (
      f.startsWith("src/") &&
      f !== "src/sensors.ts" &&
      f !== "src/web.ts"
    ) {
      services.add("arc-dispatch.timer");
    }
  }

  return services;
}

function needsBunInstall(changedFiles: string[]): boolean {
  return changedFiles.some((f) => f === "package.json" || f === "bun.lockb");
}

// ---- Git helpers ----

async function run(
  command: string[],
  opts?: { cwd?: string }
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const proc = Bun.spawn(command, {
    cwd: opts?.cwd ?? ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim() };
}

async function currentHead(): Promise<string> {
  const r = await run(["git", "rev-parse", "HEAD"]);
  if (!r.ok) throw new Error("git rev-parse HEAD failed");
  return r.stdout;
}

async function changedFilesBetween(
  fromSha: string,
  toSha: string
): Promise<string[]> {
  const r = await run(["git", "diff", "--name-only", `${fromSha}..${toSha}`]);
  return r.stdout.split("\n").filter(Boolean);
}

/**
 * Restore worker SOUL.md — persistent first (most reliable), then temp backup.
 */
async function restoreWorkerIdentity(
  soulPath: string,
  host: string,
): Promise<boolean> {
  const persistentFile = Bun.file(SOUL_PERSISTENT);
  const backupFile = Bun.file(SOUL_BACKUP);

  // Persistent copy first — set by configure-identity, most reliable
  if (await persistentFile.exists()) {
    const content = await persistentFile.text();
    if (!hasArcIdentityClaims(content)) {
      await Bun.write(soulPath, content);
      process.stdout.write(`Restored SOUL.md from persistent backup for ${host}\n`);
      return true;
    }
    process.stderr.write(`WARNING: persistent SOUL.md has Arc identity on ${host}\n`);
  }

  // Fall back to temp backup
  if (await backupFile.exists()) {
    const content = await backupFile.text();
    if (!hasArcIdentityClaims(content)) {
      await Bun.write(soulPath, content);
      await Bun.write(SOUL_PERSISTENT, content);
      process.stdout.write(`Restored SOUL.md for ${host} from temp backup (updated persistent copy)\n`);
      return true;
    }
    process.stderr.write(`WARNING: temp SOUL.md backup also has Arc identity on ${host}\n`);
  }

  process.stderr.write(`ERROR: no clean SOUL.md available for ${host}\n`);
  return false;
}

/**
 * Restore worker MEMORY.md — persistent first, then temp backup.
 */
async function restoreWorkerMemory(
  memoryPath: string,
  host: string,
): Promise<boolean> {
  const persistentFile = Bun.file(MEMORY_PERSISTENT);
  const backupFile = Bun.file(MEMORY_BACKUP);

  if (await persistentFile.exists()) {
    await Bun.write(memoryPath, persistentFile);
    process.stdout.write(`Restored MEMORY.md from persistent backup for ${host}\n`);
    return true;
  }

  if (await backupFile.exists()) {
    const content = await backupFile.text();
    await Bun.write(memoryPath, content);
    await Bun.write(MEMORY_PERSISTENT, content);
    process.stdout.write(`Restored MEMORY.md from temp backup for ${host}\n`);
    return true;
  }

  return false;
}

// ---- Bundle discovery ----

async function findBundles(): Promise<string[]> {
  const bundles: string[] = [];

  for (const pattern of [BUNDLE_GLOB, BUNDLE_PUSH_GLOB]) {
    const glob = new Bun.Glob(pattern.replace("/tmp/", ""));
    for await (const entry of glob.scan({ cwd: "/tmp", absolute: true })) {
      bundles.push(entry);
    }
  }

  // Sort by mtime descending (newest first)
  const stats = await Promise.all(
    bundles.map(async (b) => {
      const file = Bun.file(b);
      const exists = await file.exists();
      return { path: b, mtime: exists ? file.lastModified : 0 };
    })
  );
  stats.sort((a, b) => b.mtime - a.mtime);
  return stats.map((s) => s.path);
}

// ---- Service management ----

async function restartService(service: string): Promise<boolean> {
  const r = await run(["systemctl", "--user", "restart", service]);
  return r.ok;
}

async function isServiceActive(service: string): Promise<boolean> {
  const r = await run(["systemctl", "--user", "is-active", service]);
  return r.ok && r.stdout === "active";
}

async function restartAndValidate(
  services: Service[]
): Promise<{ ok: boolean; failed: string[] }> {
  if (services.length === 0) return { ok: true, failed: [] };

  // Daemon-reload first
  await run(["systemctl", "--user", "daemon-reload"]);

  const failed: string[] = [];
  for (const s of services) {
    const restarted = await restartService(s);
    if (!restarted) {
      failed.push(s);
      continue;
    }
    // Brief pause for service to settle
    await Bun.sleep(1000);
    const active = await isServiceActive(s);
    if (!active) failed.push(s);
  }

  return { ok: failed.length === 0, failed };
}

// ---- Apply bundle ----

async function applyBundle(bundlePath: string): Promise<{
  ok: boolean;
  preSha: string;
  postSha: string;
  files: string[];
  services: Service[];
  error?: string;
}> {
  const preSha = await currentHead();
  process.stdout.write(`Pre-sync commit: ${preSha.slice(0, 10)}\n`);

  // Fetch from bundle
  const fetchResult = await run(["git", "fetch", bundlePath]);
  if (!fetchResult.ok) {
    return {
      ok: false,
      preSha,
      postSha: preSha,
      files: [],
      services: [],
      error: `git fetch failed: ${fetchResult.stderr.slice(0, 200)}`,
    };
  }

  // Find the target commit from FETCH_HEAD
  const fetchHead = await run(["git", "rev-parse", "FETCH_HEAD"]);
  if (!fetchHead.ok) {
    return {
      ok: false,
      preSha,
      postSha: preSha,
      files: [],
      services: [],
      error: "Could not resolve FETCH_HEAD",
    };
  }
  const targetSha = fetchHead.stdout;

  if (targetSha === preSha) {
    process.stdout.write("Already at target commit. Nothing to apply.\n");
    return { ok: true, preSha, postSha: preSha, files: [], services: [] };
  }

  // Compute changeset before resetting
  const files = await changedFilesBetween(preSha, targetSha);
  const services = Array.from(detectAffectedServices(files)) as Service[];
  const installDeps = needsBunInstall(files);

  process.stdout.write(`Target commit: ${targetSha.slice(0, 10)}\n`);
  process.stdout.write(`Changed files: ${files.length}\n`);
  process.stdout.write(
    `Affected services: ${services.length > 0 ? services.join(", ") : "(none)"}\n`
  );
  if (installDeps) process.stdout.write("+ bun install required\n");

  // Backup agent-specific identity files before reset
  const host = hostname().toLowerCase();
  const isWorker = host !== "arc" && host !== "arc0btc";
  const soulPath = join(ROOT, "SOUL.md");
  const memoryPath = join(ROOT, "memory", "MEMORY.md");
  const soulFile = Bun.file(soulPath);
  const memoryFile = Bun.file(memoryPath);
  const hasSoul = await soulFile.exists();
  const hasMemory = await memoryFile.exists();

  if (isWorker) {
    if (hasSoul) {
      const currentSoulContent = await soulFile.text();
      if (!hasArcIdentityClaims(currentSoulContent)) {
        // Only backup clean identity files — never back up contaminated ones
        await Bun.write(SOUL_BACKUP, currentSoulContent);
        await Bun.write(SOUL_PERSISTENT, currentSoulContent);
        process.stdout.write("Backed up SOUL.md (clean)\n");
      } else {
        process.stderr.write("WARNING: SOUL.md already has Arc identity — skipping temp backup\n");
      }
    }
    if (hasMemory) {
      const currentMemoryContent = await memoryFile.text();
      await Bun.write(MEMORY_BACKUP, currentMemoryContent);
      await Bun.write(MEMORY_PERSISTENT, currentMemoryContent);
      process.stdout.write("Backed up MEMORY.md\n");
    }
  }

  // Apply: reset to target
  const resetResult = await run(["git", "reset", "--hard", targetSha]);
  if (!resetResult.ok) {
    return {
      ok: false,
      preSha,
      postSha: preSha,
      files,
      services,
      error: `git reset failed: ${resetResult.stderr.slice(0, 200)}`,
    };
  }

  // Restore agent-specific identity files after reset
  if (isWorker) {
    await restoreWorkerIdentity(soulPath, host);
    if (hasMemory) {
      await restoreWorkerMemory(memoryPath, host);
    }
  }

  // bun install if needed
  if (installDeps) {
    process.stdout.write("Running bun install...\n");
    const installResult = await run([
      BUN,
      "install",
      "--frozen-lockfile",
    ]);
    if (!installResult.ok) {
      // Retry without --frozen-lockfile
      const retry = await run([BUN, "install"]);
      if (!retry.ok) {
        process.stderr.write(`bun install failed: ${retry.stderr.slice(0, 200)}\n`);
      }
    }
  }

  // Restart affected services
  if (services.length > 0) {
    process.stdout.write(`Restarting ${services.length} service(s)...\n`);
    const health = await restartAndValidate(services);

    if (!health.ok) {
      process.stderr.write(
        `Service health check failed: ${health.failed.join(", ")}\n`
      );
      process.stderr.write(`Rolling back to ${preSha.slice(0, 10)}...\n`);

      // Rollback
      await run(["git", "reset", "--hard", preSha]);
      // Restore identity after rollback too
      if (isWorker) {
        await restoreWorkerIdentity(soulPath, host);
        if (hasMemory) await restoreWorkerMemory(memoryPath, host);
      }
      if (installDeps) {
        await run([BUN, "install"]);
      }
      await restartAndValidate(ALL_SERVICES as unknown as Service[]);

      return {
        ok: false,
        preSha,
        postSha: preSha,
        files,
        services,
        error: `Health check failed for: ${health.failed.join(", ")}. Rolled back.`,
      };
    }
  }

  const postSha = await currentHead();
  process.stdout.write(`Sync complete: ${postSha.slice(0, 10)}\n`);

  return { ok: true, preSha, postSha, files, services };
}

// ---- Subcommands ----

async function cmdApply(flags: Record<string, string>): Promise<void> {
  let bundlePath = flags["bundle"];

  if (!bundlePath) {
    const bundles = await findBundles();
    if (bundles.length === 0) {
      process.stdout.write("No pending bundles found.\n");
      return;
    }
    bundlePath = bundles[0];
    process.stdout.write(`Found bundle: ${bundlePath}\n`);
  }

  const file = Bun.file(bundlePath);
  if (!(await file.exists())) {
    process.stderr.write(`Bundle not found: ${bundlePath}\n`);
    process.exit(1);
  }

  const result = await applyBundle(bundlePath);

  // Clean up all bundles after apply (successful or not)
  const allBundles = await findBundles();
  for (const b of allBundles) {
    await run(["rm", "-f", b]);
  }

  if (!result.ok) {
    process.stderr.write(`Apply failed: ${result.error}\n`);
    process.exit(1);
  }

  process.stdout.write("OK\n");
}

async function cmdStatus(): Promise<void> {
  const head = await currentHead();
  const branch = (await run(["git", "rev-parse", "--abbrev-ref", "HEAD"])).stdout;

  process.stdout.write(`Branch: ${branch}\n`);
  process.stdout.write(`Commit: ${head.slice(0, 10)}\n\n`);

  // Pending bundles
  const bundles = await findBundles();
  process.stdout.write(`Pending bundles: ${bundles.length}\n`);
  for (const b of bundles) {
    const file = Bun.file(b);
    const size = file.size;
    process.stdout.write(
      `  ${b} (${Math.round(size / 1024)}KB)\n`
    );
  }

  // Service health
  process.stdout.write("\nService health:\n");
  for (const s of ALL_SERVICES) {
    const active = await isServiceActive(s);
    process.stdout.write(`  ${s}: ${active ? "active" : "INACTIVE"}\n`);
  }
}

// ---- Usage ----

function printUsage(): void {
  process.stdout.write(`fleet-self-sync — Worker-local bundle apply + service restart

Usage:
  arc skills run --name fleet-self-sync -- <command> [options]

Commands:
  apply [--bundle <path>]  Apply pending bundle (auto-detects newest if no path given)
  status                   Show current commit, pending bundles, and service health

The sensor (5min) auto-detects and applies bundles deposited by Arc.
`);
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];
  const { flags } = parseFlags(args.slice(1));

  switch (sub) {
    case "apply":
      await cmdApply(flags);
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
