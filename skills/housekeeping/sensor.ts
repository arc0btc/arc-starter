import { claimSensorRun } from "../../src/sensors.ts";
import { initDatabase, insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import { existsSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const SENSOR_NAME = "housekeeping";
const INTERVAL_MINUTES = 30;
const TASK_SOURCE = "sensor:housekeeping";

const ROOT = join(import.meta.dir, "../..");
const LOCK_PATH = join(ROOT, "db/dispatch-lock.json");
const WAL_PATH = join(ROOT, "db/arc.sqlite-wal");
const MEMORY_PATH = join(ROOT, "memory/MEMORY.md");
const LOCK_STALE_MINUTES = 60;
const WAL_MAX_MB = 10;
const MEMORY_MAX_LINES = 80;
const WATCHED_DIRS = ["src/", "skills/", "templates/", "memory/"];

export default async function housekeepingSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  if (pendingTaskExistsForSource(TASK_SOURCE)) return "skip";

  const issues: string[] = [];

  // 1. Uncommitted changes in tracked files
  const statusResult = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT });
  const statusOutput = statusResult.stdout?.toString().trim() ?? "";
  if (statusOutput) {
    const lines = statusOutput.split("\n");
    const modified = lines.filter((l) => /^.M/.test(l));
    if (modified.length > 0) {
      issues.push(`${modified.length} uncommitted tracked change(s)`);
    }

    // 2. Untracked files in watched directories
    const untracked = lines
      .filter((l) => l.startsWith("??"))
      .map((l) => l.slice(3).trim())
      .filter((f) => WATCHED_DIRS.some((d) => f.startsWith(d)));
    if (untracked.length > 0) {
      issues.push(`${untracked.length} untracked file(s) in watched dirs`);
    }
  }

  // 3. Stale dispatch lock
  if (existsSync(LOCK_PATH)) {
    try {
      const stat = statSync(LOCK_PATH);
      const ageMinutes = (Date.now() - stat.mtimeMs) / 60_000;
      if (ageMinutes > LOCK_STALE_MINUTES) {
        issues.push(`stale dispatch lock (${Math.round(ageMinutes)} min old)`);
      }
    } catch {
      // ignore stat errors
    }
  }

  // 4. WAL file size
  if (existsSync(WAL_PATH)) {
    try {
      const stat = statSync(WAL_PATH);
      const sizeMb = stat.size / (1024 * 1024);
      if (sizeMb > WAL_MAX_MB) {
        issues.push(`WAL file ${sizeMb.toFixed(1)} MB (threshold: ${WAL_MAX_MB} MB)`);
      }
    } catch {
      // ignore
    }
  }

  // 5. Memory file size
  if (existsSync(MEMORY_PATH)) {
    try {
      const content = await Bun.file(MEMORY_PATH).text();
      const lineCount = content.split("\n").length;
      if (lineCount > MEMORY_MAX_LINES) {
        issues.push(`MEMORY.md is ${lineCount} lines (threshold: ${MEMORY_MAX_LINES})`);
      }
    } catch {
      // ignore
    }
  }

  // 6. ISO 8601 file accumulation
  const archivalDirs = findDirsNeedingArchival(ROOT);
  if (archivalDirs.length > 0) {
    issues.push(`${archivalDirs.length} dir(s) need ISO 8601 file archival`);
  }

  if (issues.length === 0) return "ok";

  insertTask({
    subject: `housekeeping: ${issues.length} issue(s) detected`,
    description: issues.map((i) => `- ${i}`).join("\n"),
    skills: '["housekeeping", "manage-skills"]',
    source: TASK_SOURCE,
    priority: 7,
  });

  return "ok";
}

/** Scan for directories with >5 ISO 8601-named files. */
function findDirsNeedingArchival(root: string): string[] {
  const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T/;
  const candidates = ["reports", "research"];
  const result: string[] = [];

  for (const dir of candidates) {
    const dirPath = join(root, dir);
    if (!existsSync(dirPath)) continue;
    try {
      const entries = readdirSync(dirPath);
      const isoFiles = entries.filter(
        (e) => ISO_PATTERN.test(e) && !e.startsWith(".")
      );
      if (isoFiles.length > 5) {
        result.push(dir);
      }
    } catch {
      // ignore
    }
  }

  return result;
}
