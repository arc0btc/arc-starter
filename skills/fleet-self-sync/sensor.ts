/**
 * fleet-self-sync sensor — detect and apply pending git bundles on worker agents.
 *
 * Every 5 minutes, checks for bundles in /tmp/ deposited by Arc's fleet-push/fleet-sync.
 * When found, applies the newest bundle: git fetch + reset, bun install if needed,
 * restart affected services, validate health, clean up.
 */

import {
  claimSensorRun,
  createSensorLogger,
} from "../../src/sensors.ts";
import { join } from "node:path";
import { hostname } from "node:os";

const SENSOR_NAME = "fleet-self-sync";
const INTERVAL_MINUTES = 5;
const ROOT = new URL("../..", import.meta.url).pathname;
const BUN = `${process.env.HOME}/.bun/bin/bun`;
const SOUL_BACKUP = "/tmp/arc-soul-backup.md";
const MEMORY_BACKUP = "/tmp/arc-memory-backup.md";
// Persistent fallbacks written by configure-identity — survive git reset --hard
const SOUL_PERSISTENT = `${process.env.HOME}/.aibtc/SOUL.md`;
const MEMORY_PERSISTENT = `${process.env.HOME}/.aibtc/MEMORY.md`;

// Definitive Arc identity markers — narrow enough to avoid false positives.
// Worker SOUL.md files legitimately reference "arc0btc" (org, coordinator, X handle)
// so we check for claims that ONLY Arc's own SOUL.md would contain.
const ARC_IDENTITY_MARKERS = [
  "# Arc\n",                                           // H1 heading unique to Arc's SOUL.md
  "I'm Arc.",                                          // Self-identification sentence
  "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B",      // Arc's Stacks address
  "bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933",      // Arc's Bitcoin address
] as const;

function hasArcIdentityClaims(content: string): boolean {
  return ARC_IDENTITY_MARKERS.some((marker) => content.includes(marker));
}

/**
 * Resolve the best clean SOUL.md content BEFORE git reset.
 * Priority: (1) persistent ~/.aibtc/SOUL.md, (2) current working copy, (3) temp backup.
 * Returns the content string or null if no clean source exists.
 * All reads happen before reset — no file-system race conditions.
 */
async function resolveCleanSoul(
  soulPath: string,
  logger: (msg: string) => void,
): Promise<string | null> {
  // 1. Persistent copy — most reliable, set by configure-identity
  const persistentFile = Bun.file(SOUL_PERSISTENT);
  if (await persistentFile.exists()) {
    const content = await persistentFile.text();
    if (!hasArcIdentityClaims(content)) return content;
    logger(`WARNING: persistent SOUL.md has Arc identity — checking other sources`);
  }

  // 2. Current working copy (pre-reset)
  const soulFile = Bun.file(soulPath);
  if (await soulFile.exists()) {
    const content = await soulFile.text();
    if (!hasArcIdentityClaims(content)) return content;
  }

  // 3. Temp backup from a previous sync
  const backupFile = Bun.file(SOUL_BACKUP);
  if (await backupFile.exists()) {
    const content = await backupFile.text();
    if (!hasArcIdentityClaims(content)) return content;
  }

  return null;
}

/**
 * Resolve the best clean MEMORY.md content BEFORE git reset.
 * Priority: (1) persistent ~/.aibtc/MEMORY.md, (2) current working copy, (3) temp backup.
 */
async function resolveCleanMemory(
  memoryPath: string,
): Promise<string | null> {
  const persistentFile = Bun.file(MEMORY_PERSISTENT);
  if (await persistentFile.exists()) {
    return await persistentFile.text();
  }

  const memoryFile = Bun.file(memoryPath);
  if (await memoryFile.exists()) {
    const content = await memoryFile.text();
    if (!hasArcIdentityClaims(content)) return content;
  }

  const backupFile = Bun.file(MEMORY_BACKUP);
  if (await backupFile.exists()) {
    return await backupFile.text();
  }

  return null;
}

/**
 * Write identity files after git reset and keep all backup layers fresh.
 * Called with content resolved BEFORE the reset — no file reads needed.
 */
async function writeIdentityFiles(
  soulPath: string,
  memoryPath: string,
  soulContent: string | null,
  memoryContent: string | null,
  host: string,
  logger: (msg: string) => void,
): Promise<boolean> {
  let soulRestored = false;

  if (soulContent) {
    await Bun.write(soulPath, soulContent);
    // Always keep persistent and temp backups fresh from known-good content
    await Bun.write(SOUL_PERSISTENT, soulContent);
    await Bun.write(SOUL_BACKUP, soulContent);
    logger(`restored SOUL.md for ${host} (persistent + temp backups updated)`);
    soulRestored = true;
  } else {
    logger(`ERROR: no clean SOUL.md available for ${host} — run configure-identity to fix`);
  }

  if (memoryContent) {
    await Bun.write(memoryPath, memoryContent);
    await Bun.write(MEMORY_PERSISTENT, memoryContent);
    await Bun.write(MEMORY_BACKUP, memoryContent);
    logger(`restored MEMORY.md for ${host} (persistent + temp backups updated)`);
  } else {
    logger(`WARNING: no MEMORY.md backup available for ${host}`);
  }

  return soulRestored;
}

const ALL_SERVICES = [
  "arc-sensors.timer",
  "arc-dispatch.timer",
  "arc-web.service",
] as const;
type Service = (typeof ALL_SERVICES)[number];

const log = createSensorLogger(SENSOR_NAME);

// ---- Helpers ----

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

async function findBundles(): Promise<string[]> {
  const bundles: string[] = [];

  for (const pattern of ["arc-fleet-sync*.bundle", "arc-fleet-push*.bundle"]) {
    const glob = new Bun.Glob(pattern);
    for await (const entry of glob.scan({ cwd: "/tmp", absolute: true })) {
      bundles.push(entry);
    }
  }

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

async function restartAndValidate(
  services: Service[]
): Promise<{ ok: boolean; failed: string[] }> {
  if (services.length === 0) return { ok: true, failed: [] };

  await run(["systemctl", "--user", "daemon-reload"]);

  const failed: string[] = [];
  for (const s of services) {
    const restarted = await run(["systemctl", "--user", "restart", s]);
    if (!restarted.ok) {
      failed.push(s);
      continue;
    }
    await Bun.sleep(1000);
    const check = await run(["systemctl", "--user", "is-active", s]);
    if (!check.ok || check.stdout !== "active") failed.push(s);
  }

  return { ok: failed.length === 0, failed };
}

// ---- Main sensor ----

export default async function sensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const bundles = await findBundles();
  if (bundles.length === 0) {
    return "skip";
  }

  const bundlePath = bundles[0];
  log(`found ${bundles.length} bundle(s), applying newest: ${bundlePath}`);

  // Record pre-sync state
  const preHead = await run(["git", "rev-parse", "HEAD"]);
  if (!preHead.ok) {
    log("failed to get current HEAD");
    return "skip";
  }
  const preSha = preHead.stdout;

  // Fetch from bundle
  const fetchResult = await run(["git", "fetch", bundlePath]);
  if (!fetchResult.ok) {
    log(`git fetch failed: ${fetchResult.stderr.slice(0, 100)}`);
    // Clean up bad bundle
    for (const b of bundles) await run(["rm", "-f", b]);
    return `error — git fetch failed`;
  }

  // Resolve target
  const fetchHead = await run(["git", "rev-parse", "FETCH_HEAD"]);
  if (!fetchHead.ok) {
    log("could not resolve FETCH_HEAD");
    for (const b of bundles) await run(["rm", "-f", b]);
    return "error — no FETCH_HEAD";
  }
  const targetSha = fetchHead.stdout;

  if (targetSha === preSha) {
    log("already at target commit");
    for (const b of bundles) await run(["rm", "-f", b]);
    return "ok — already synced";
  }

  // Compute changeset
  const diffResult = await run([
    "git",
    "diff",
    "--name-only",
    `${preSha}..${targetSha}`,
  ]);
  const files = diffResult.stdout.split("\n").filter(Boolean);
  const services = Array.from(detectAffectedServices(files)) as Service[];
  const installDeps = needsBunInstall(files);

  log(
    `${preSha.slice(0, 10)} → ${targetSha.slice(0, 10)}: ${files.length} files, ${services.length} services`
  );

  // Pre-read identity files BEFORE reset — all reads happen here, writes happen after.
  // This eliminates the death spiral where contaminated files have no clean fallback.
  const soulPath = join(ROOT, "SOUL.md");
  const memoryPath = join(ROOT, "memory", "MEMORY.md");
  const host = hostname().toLowerCase();
  const isWorker = host !== "arc" && host !== "arc0btc";

  // Resolve clean content from all sources while they're still readable
  let cleanSoul: string | null = null;
  let cleanMemory: string | null = null;
  if (isWorker) {
    cleanSoul = await resolveCleanSoul(soulPath, log);
    cleanMemory = await resolveCleanMemory(memoryPath);
    if (!cleanSoul) {
      log(`WARNING: no clean SOUL.md source found before sync on ${host}`);
    }
  }

  // Apply
  const resetResult = await run(["git", "reset", "--hard", targetSha]);
  if (!resetResult.ok) {
    log(`git reset failed: ${resetResult.stderr.slice(0, 100)}`);
    for (const b of bundles) await run(["rm", "-f", b]);
    return "error — git reset failed";
  }

  // Write identity files from pre-read content — instant, no file-system dependencies
  if (isWorker) {
    const soulRestored = await writeIdentityFiles(
      soulPath, memoryPath, cleanSoul, cleanMemory, host, log,
    );

    // Post-restore verification
    if (!soulRestored) {
      log(`CRITICAL: no clean SOUL.md for ${host} — creating fix task`);
      await run([
        BUN, "run", "bin/arc", "tasks", "add",
        "--subject", `Identity drift on ${host}: SOUL.md has Arc identity — run configure-identity`,
        "--priority", "2",
        "--skills", "arc-remote-setup",
        "--source", "sensor:fleet-self-sync",
      ]);
    }
  }

  // bun install
  if (installDeps) {
    log("running bun install");
    const installResult = await run([BUN, "install", "--frozen-lockfile"]);
    if (!installResult.ok) {
      await run([BUN, "install"]);
    }
  }

  // Restart affected services
  if (services.length > 0) {
    log(`restarting: ${services.join(", ")}`);
    const health = await restartAndValidate(services);

    if (!health.ok) {
      log(`health check failed: ${health.failed.join(", ")} — rolling back`);

      await run(["git", "reset", "--hard", preSha]);

      // Restore identity files after rollback too (cleanSoul/cleanMemory still in memory)
      if (isWorker) {
        await writeIdentityFiles(soulPath, memoryPath, cleanSoul, cleanMemory, host, log);
      }

      if (installDeps) await run([BUN, "install"]);
      await restartAndValidate(ALL_SERVICES as unknown as Service[]);

      // Clean up bundles
      for (const b of bundles) await run(["rm", "-f", b]);

      return `error — health check failed (${health.failed.join(", ")}), rolled back to ${preSha.slice(0, 10)}`;
    }
  }

  // Clean up all bundles
  for (const b of bundles) await run(["rm", "-f", b]);

  log(`sync complete: ${targetSha.slice(0, 10)}`);
  return `ok — synced ${preSha.slice(0, 10)} → ${targetSha.slice(0, 10)}, ${services.length} service(s) restarted`;
}
