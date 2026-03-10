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
 * Restore a worker's SOUL.md after git reset --hard overwrites it with Arc's version.
 * Priority order: (1) ~/.aibtc/SOUL.md persistent copy (most reliable, set by configure-identity),
 *                 (2) /tmp backup if clean, (3) fail loudly.
 * If restore succeeds from temp backup, also updates the persistent copy so it stays fresh.
 */
async function restoreIdentityFile(
  soulPath: string,
  host: string,
  logger: (msg: string) => void,
): Promise<boolean> {
  const persistentFile = Bun.file(SOUL_PERSISTENT);
  const backupFile = Bun.file(SOUL_BACKUP);

  // Try persistent copy first — most reliable, set by configure-identity
  if (await persistentFile.exists()) {
    const persistentContent = await persistentFile.text();
    if (!hasArcIdentityClaims(persistentContent)) {
      await Bun.write(soulPath, persistentContent);
      logger(`restored SOUL.md from persistent backup (~/.aibtc/SOUL.md) for ${host}`);
      return true;
    }
    logger(`WARNING: persistent SOUL.md has Arc identity on ${host} — trying temp backup`);
  }

  // Persistent missing or contaminated — try /tmp backup (captured before this sync)
  if (await backupFile.exists()) {
    const backupContent = await backupFile.text();
    if (!hasArcIdentityClaims(backupContent)) {
      await Bun.write(soulPath, backupContent);
      // Update persistent copy if it doesn't exist or is contaminated
      const persistentExists = await persistentFile.exists();
      if (!persistentExists) {
        await Bun.write(SOUL_PERSISTENT, backupContent);
        logger(`restored SOUL.md for ${host} from temp backup (created persistent copy)`);
      } else {
        logger(`restored SOUL.md for ${host} from temp backup`);
      }
      return true;
    }
    logger(`WARNING: temp SOUL.md backup also contains Arc identity on ${host}`);
  }

  logger(`ERROR: no clean SOUL.md available for ${host} — run configure-identity to fix`);
  return false;
}

/**
 * Restore a worker's MEMORY.md after git reset --hard.
 * Priority: (1) ~/.aibtc/MEMORY.md persistent, (2) /tmp backup, (3) fail.
 */
async function restoreMemoryFile(
  memoryPath: string,
  host: string,
  logger: (msg: string) => void,
): Promise<boolean> {
  const persistentFile = Bun.file(MEMORY_PERSISTENT);
  const backupFile = Bun.file(MEMORY_BACKUP);

  // Try persistent copy first
  if (await persistentFile.exists()) {
    await Bun.write(memoryPath, persistentFile);
    logger(`restored MEMORY.md from persistent backup for ${host}`);
    return true;
  }

  // Fall back to /tmp backup
  if (await backupFile.exists()) {
    const content = await backupFile.text();
    await Bun.write(memoryPath, content);
    // Update persistent copy only if it doesn't exist
    if (!(await persistentFile.exists())) {
      await Bun.write(MEMORY_PERSISTENT, content);
      logger(`restored MEMORY.md from temp backup for ${host} (created persistent copy)`);
    } else {
      logger(`restored MEMORY.md from temp backup for ${host}`);
    }
    return true;
  }

  logger(`WARNING: no MEMORY.md backup available for ${host}`);
  return false;
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

  // Backup agent-specific identity files before reset
  // Only backup if the current files are CLEAN (not already contaminated with Arc's identity)
  const soulPath = join(ROOT, "SOUL.md");
  const memoryPath = join(ROOT, "memory", "MEMORY.md");
  const soulFile = Bun.file(soulPath);
  const memoryFile = Bun.file(memoryPath);
  const hasSoul = await soulFile.exists();
  const hasMemory = await memoryFile.exists();
  if (hasSoul) {
    const currentSoulContent = await soulFile.text();
    if (!hasArcIdentityClaims(currentSoulContent)) {
      // Current SOUL.md is clean — safe to backup (temp only, persistent is set by configure-identity)
      await Bun.write(SOUL_BACKUP, currentSoulContent);
    } else {
      log(`WARNING: SOUL.md already has Arc identity before sync — skipping temp backup, will restore from persistent`);
    }
  }
  if (hasMemory) {
    const currentMemoryContent = await memoryFile.text();
    // Only backup if not contaminated with Arc's identity (prevents death spiral
    // where corrupted memory overwrites the persistent backup)
    if (!hasArcIdentityClaims(currentMemoryContent)) {
      await Bun.write(MEMORY_BACKUP, currentMemoryContent);
    } else {
      log(`WARNING: MEMORY.md has Arc identity markers before sync — skipping temp backup`);
    }
  }

  // Apply
  const resetResult = await run(["git", "reset", "--hard", targetSha]);
  if (!resetResult.ok) {
    log(`git reset failed: ${resetResult.stderr.slice(0, 100)}`);
    for (const b of bundles) await run(["rm", "-f", b]);
    return "error — git reset failed";
  }

  // Restore agent-specific identity files after reset
  // Only restore if this is a worker agent (not Arc itself)
  const host = hostname().toLowerCase();
  if (host !== "arc" && host !== "arc0btc") {
    // Always attempt restore — persistent backup is the authoritative source.
    // Restore is unconditional: even if files didn't exist before reset,
    // the persistent backup from configure-identity should be used.
    const soulRestored = await restoreIdentityFile(soulPath, host, log);
    await restoreMemoryFile(memoryPath, host, log);

    // Post-restore verification: confirm SOUL.md doesn't contain Arc identity
    const finalSoul = Bun.file(soulPath);
    if (await finalSoul.exists()) {
      const finalContent = await finalSoul.text();
      if (hasArcIdentityClaims(finalContent)) {
        log(`CRITICAL: SOUL.md still contains Arc identity after restore on ${host} — creating fix task`);
        await run([
          BUN, "run", "bin/arc", "tasks", "add",
          "--subject", `Identity drift on ${host}: SOUL.md has Arc identity — run configure-identity`,
          "--priority", "2",
          "--skills", "arc-remote-setup",
          "--source", "sensor:fleet-self-sync",
        ]);
      }
    } else if (!soulRestored) {
      // SOUL.md doesn't exist at all — need configure-identity
      log(`CRITICAL: no SOUL.md exists on ${host} after sync — creating fix task`);
      await run([
        BUN, "run", "bin/arc", "tasks", "add",
        "--subject", `Missing SOUL.md on ${host} — run configure-identity`,
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

      // Restore identity files after rollback too
      if (host !== "arc" && host !== "arc0btc") {
        await restoreIdentityFile(soulPath, host, log);
        await restoreMemoryFile(memoryPath, host, log);
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
