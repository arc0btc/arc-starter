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
// Persistent fallback written by configure-identity — survives git reset --hard
const SOUL_PERSISTENT = `${process.env.HOME}/.aibtc/SOUL.md`;

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
  // These files are per-agent and must not be overwritten by Arc's repo
  const soulPath = join(ROOT, "SOUL.md");
  const memoryPath = join(ROOT, "memory", "MEMORY.md");
  const soulFile = Bun.file(soulPath);
  const memoryFile = Bun.file(memoryPath);
  const hasSoul = await soulFile.exists();
  const hasMemory = await memoryFile.exists();
  if (hasSoul) await Bun.write(SOUL_BACKUP, soulFile);
  if (hasMemory) await Bun.write(MEMORY_BACKUP, memoryFile);

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
    if (hasSoul) {
      // Validate backup contains correct identity before restoring
      const backupContent = await Bun.file(SOUL_BACKUP).text();
      const hasArcIdentity = backupContent.includes("I'm Arc") || backupContent.includes("arc0btc");
      if (hasArcIdentity) {
        log(`WARNING: SOUL.md backup contains Arc identity on ${host} — trying persistent fallback`);
        // Runtime backup is Arc's version (death spiral). Try ~/.aibtc/SOUL.md written by configure-identity.
        const persistentFile = Bun.file(SOUL_PERSISTENT);
        if (await persistentFile.exists()) {
          const persistentContent = await persistentFile.text();
          const persistentHasArc = persistentContent.includes("I'm Arc") || persistentContent.includes("arc0btc");
          if (!persistentHasArc) {
            await Bun.write(soulPath, persistentContent);
            log(`restored SOUL.md from persistent fallback (~/.aibtc/SOUL.md) for ${host}`);
          } else {
            log(`ERROR: persistent SOUL.md also has Arc identity on ${host} — identity fix required`);
          }
        } else {
          log(`WARNING: no persistent SOUL.md fallback at ${SOUL_PERSISTENT} — run configure-identity to fix`);
        }
      } else {
        await Bun.write(soulPath, backupContent);
        log(`restored SOUL.md for ${host}`);
      }
    }
    if (hasMemory) {
      await Bun.write(memoryPath, Bun.file(MEMORY_BACKUP));
      log(`restored MEMORY.md for ${host}`);
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
        if (hasSoul) {
          await Bun.write(soulPath, Bun.file(SOUL_BACKUP));
          log(`restored SOUL.md after rollback for ${host}`);
        }
        if (hasMemory) {
          await Bun.write(memoryPath, Bun.file(MEMORY_BACKUP));
          log(`restored MEMORY.md after rollback for ${host}`);
        }
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
