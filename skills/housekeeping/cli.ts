#!/usr/bin/env bun

import { existsSync, statSync, readdirSync, mkdirSync, renameSync, readFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";
import { initDatabase } from "../../src/db.ts";

const ROOT = join(import.meta.dir, "../..");
const LOCK_PATH = join(ROOT, "db/dispatch-lock.json");
const WAL_PATH = join(ROOT, "db/arc.sqlite-wal");
const DB_PATH = join(ROOT, "db/arc.sqlite");
const MEMORY_PATH = join(ROOT, "memory/MEMORY.md");
const LOCK_STALE_MINUTES = 60;
const WAL_MAX_MB = 10;
const MEMORY_MAX_LINES = 80;
const WATCHED_DIRS = ["src/", "skills/", "templates/", "memory/"];
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T/;
const ARCHIVAL_DIRS = ["reports", "research"];
const ARCHIVAL_KEEP = 5;

// ---- Types ----

interface CheckReport {
  uncommitted: string[];
  untracked: string[];
  staleLock: boolean;
  staleLockAgeMinutes: number | null;
  walSizeMb: number | null;
  memoryLines: number | null;
  archivalNeeded: string[];
  issueCount: number;
}

// ---- Checks ----

function runChecks(): CheckReport {
  const report: CheckReport = {
    uncommitted: [],
    untracked: [],
    staleLock: false,
    staleLockAgeMinutes: null,
    walSizeMb: null,
    memoryLines: null,
    archivalNeeded: [],
    issueCount: 0,
  };

  // 1. Git status
  const statusResult = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT });
  const statusOutput = statusResult.stdout?.toString().trim() ?? "";
  if (statusOutput) {
    const lines = statusOutput.split("\n");

    // Modified tracked files (status column M in position 1 = unstaged, position 0 = staged)
    report.uncommitted = lines
      .filter((l) => /^.M|^M.|^A.|^D.|^R./.test(l))
      .map((l) => l.slice(3).trim());

    // Untracked files in watched directories
    report.untracked = lines
      .filter((l) => l.startsWith("??"))
      .map((l) => l.slice(3).trim())
      .filter((f) => WATCHED_DIRS.some((d) => f.startsWith(d)));
  }

  // 2. Stale dispatch lock
  if (existsSync(LOCK_PATH)) {
    try {
      const stat = statSync(LOCK_PATH);
      const ageMinutes = (Date.now() - stat.mtimeMs) / 60_000;
      report.staleLockAgeMinutes = Math.round(ageMinutes);
      if (ageMinutes > LOCK_STALE_MINUTES) {
        report.staleLock = true;
      }
    } catch {
      // ignore
    }
  }

  // 3. WAL size
  if (existsSync(WAL_PATH)) {
    try {
      const stat = statSync(WAL_PATH);
      report.walSizeMb = Math.round((stat.size / (1024 * 1024)) * 10) / 10;
    } catch {
      // ignore
    }
  }

  // 4. Memory line count
  if (existsSync(MEMORY_PATH)) {
    try {
      const content = readFileSync(MEMORY_PATH, "utf-8");
      report.memoryLines = content.split("\n").length;
    } catch {
      // ignore
    }
  }

  // 5. ISO 8601 archival
  for (const dir of ARCHIVAL_DIRS) {
    const dirPath = join(ROOT, dir);
    if (!existsSync(dirPath)) continue;
    try {
      const entries = readdirSync(dirPath);
      const isoFiles = entries.filter((e) => ISO_PATTERN.test(e) && !e.startsWith("."));
      if (isoFiles.length > ARCHIVAL_KEEP) {
        report.archivalNeeded.push(dir);
      }
    } catch {
      // ignore
    }
  }

  // Count issues
  if (report.uncommitted.length > 0) report.issueCount++;
  if (report.untracked.length > 0) report.issueCount++;
  if (report.staleLock) report.issueCount++;
  if (report.walSizeMb !== null && report.walSizeMb > WAL_MAX_MB) report.issueCount++;
  if (report.memoryLines !== null && report.memoryLines > MEMORY_MAX_LINES) report.issueCount++;
  if (report.archivalNeeded.length > 0) report.issueCount++;

  return report;
}

// ---- Fix ----

function runFix(): void {
  const report = runChecks();

  if (report.issueCount === 0) {
    process.stdout.write("housekeeping: all clean, nothing to fix\n");
    return;
  }

  let fixed = 0;

  // 1. Commit uncommitted tracked changes
  if (report.uncommitted.length > 0) {
    process.stdout.write(`fixing: ${report.uncommitted.length} uncommitted file(s)\n`);
    const addResult = spawnSync("git", ["add", ...report.uncommitted], { cwd: ROOT });
    if (addResult.status === 0) {
      const commitResult = spawnSync(
        "git",
        ["commit", "-m", `chore(housekeeping): auto-commit tracked changes [${report.uncommitted.length} file(s)]`],
        { cwd: ROOT }
      );
      if (commitResult.status === 0) {
        process.stdout.write("  committed tracked changes\n");
        fixed++;
      } else {
        process.stderr.write(`  commit failed: ${commitResult.stderr?.toString().trim()}\n`);
      }
    }
  }

  // 2. Stage and commit untracked files in watched dirs
  if (report.untracked.length > 0) {
    process.stdout.write(`fixing: ${report.untracked.length} untracked file(s) in watched dirs\n`);
    const addResult = spawnSync("git", ["add", ...report.untracked], { cwd: ROOT });
    if (addResult.status === 0) {
      const commitResult = spawnSync(
        "git",
        ["commit", "-m", `chore(housekeeping): auto-commit new files [${report.untracked.length} file(s)]`],
        { cwd: ROOT }
      );
      if (commitResult.status === 0) {
        process.stdout.write("  committed untracked files\n");
        fixed++;
      } else {
        process.stderr.write(`  commit failed: ${commitResult.stderr?.toString().trim()}\n`);
      }
    }
  }

  // 3. Remove stale dispatch lock
  if (report.staleLock) {
    process.stdout.write(`fixing: stale dispatch lock (${report.staleLockAgeMinutes} min old)\n`);
    try {
      unlinkSync(LOCK_PATH);
      process.stdout.write("  removed stale lock\n");
      fixed++;
    } catch (err) {
      process.stderr.write(`  failed to remove lock: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  // 4. WAL checkpoint
  if (report.walSizeMb !== null && report.walSizeMb > WAL_MAX_MB) {
    process.stdout.write(`fixing: WAL checkpoint (${report.walSizeMb} MB)\n`);
    try {
      const db = initDatabase();
      db.run("PRAGMA wal_checkpoint(TRUNCATE)");
      process.stdout.write("  WAL checkpointed\n");
      fixed++;
    } catch (err) {
      process.stderr.write(`  checkpoint failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  // 5. ISO 8601 file archival
  if (report.archivalNeeded.length > 0) {
    for (const dir of report.archivalNeeded) {
      process.stdout.write(`fixing: archiving old files in ${dir}/\n`);
      const moved = archiveOldFiles(join(ROOT, dir));
      process.stdout.write(`  moved ${moved} file(s) to ${dir}/archive/\n`);
      if (moved > 0) fixed++;
    }
  }

  // 6. Memory bloat — can't auto-fix, just report
  if (report.memoryLines !== null && report.memoryLines > MEMORY_MAX_LINES) {
    process.stdout.write(
      `skipping: MEMORY.md is ${report.memoryLines} lines — needs manual consolidation via manage-skills\n`
    );
  }

  process.stdout.write(`\nhousekeeping: fixed ${fixed} issue(s)\n`);
}

/** Move ISO 8601-named files older than the 5 most recent to archive/ subdirectory. */
function archiveOldFiles(dirPath: string): number {
  const entries = readdirSync(dirPath);
  const isoFiles = entries
    .filter((e) => ISO_PATTERN.test(e) && !e.startsWith("."))
    .sort()
    .reverse(); // newest first

  if (isoFiles.length <= ARCHIVAL_KEEP) return 0;

  const toArchive = isoFiles.slice(ARCHIVAL_KEEP);
  const archivePath = join(dirPath, "archive");
  mkdirSync(archivePath, { recursive: true });

  let moved = 0;
  for (const file of toArchive) {
    try {
      renameSync(join(dirPath, file), join(archivePath, file));
      moved++;
    } catch (err) {
      const rel = relative(ROOT, join(dirPath, file));
      process.stderr.write(`  failed to archive ${rel}: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  return moved;
}

// ---- Usage ----

function printUsage(): void {
  process.stdout.write(
    `housekeeping CLI

USAGE
  arc skills run --name housekeeping -- <subcommand>

SUBCOMMANDS
  check    Run all hygiene checks, output JSON report
  fix      Auto-fix safe issues (commit, checkpoint, archive)
`
  );
}

// ---- Entry point ----

function main(): void {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "check": {
      const report = runChecks();
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      break;
    }
    case "fix":
      runFix();
      break;
    default:
      if (sub) {
        process.stderr.write(`Error: unknown subcommand '${sub}'\n\n`);
      }
      printUsage();
      if (sub) process.exit(1);
      break;
  }
}

main();
