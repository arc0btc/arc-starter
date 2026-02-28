#!/usr/bin/env bun
import { parseFlags } from "../../src/utils.ts";
import {
  initDatabase,
  getDatabase,
  insertTask,
  pendingTaskExistsForSource,
} from "../../src/db.ts";
import type { Task } from "../../src/db.ts";

// ---- Error classification (shared with sensor.ts) ----

const ERROR_PATTERNS: Array<{ signature: string; patterns: RegExp[] }> = [
  {
    signature: "payment-error",
    patterns: [/402/i, /payment/i],
  },
  {
    signature: "sqlite-lock",
    patterns: [/database is locked/i, /SQLITE_BUSY/i],
  },
  {
    signature: "wallet-error",
    patterns: [/wallet.*unlock/i, /wallet.*fail/i, /signing.*fail/i],
  },
  {
    signature: "timeout",
    patterns: [/timeout/i, /ETIMEDOUT/i, /\bhung\b/i, /timed?\s*out/i],
  },
  {
    signature: "auth-error",
    patterns: [/\b403\b/, /\b401\b/, /permission denied/i, /unauthorized/i, /forbidden/i],
  },
  {
    signature: "network-error",
    patterns: [/ECONNREFUSED/i, /ENOTFOUND/i, /fetch failed/i, /network/i],
  },
];

function classifyError(text: string): string {
  for (const { signature, patterns } of ERROR_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(text)) return signature;
    }
  }
  return "unknown";
}

function shortHash(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

// ---- Commands ----

function cmdScan(args: string[]): void {
  const { flags } = parseFlags(args);
  const hours = parseInt(flags.hours ?? "24", 10);
  const threshold = parseInt(flags.threshold ?? "3", 10);

  initDatabase();
  const db = getDatabase();

  const failedTasks = db
    .query(
      `SELECT * FROM tasks
       WHERE status IN ('failed', 'blocked')
         AND completed_at IS NOT NULL
         AND datetime(completed_at) >= datetime('now', ?)
       ORDER BY completed_at DESC`,
    )
    .all(`-${hours} hours`) as Task[];

  if (failedTasks.length === 0) {
    console.log(`No failed/blocked tasks in the last ${hours} hours.`);
    return;
  }

  // Group by signature
  const groups = new Map<string, Task[]>();
  for (const task of failedTasks) {
    const text = task.result_summary ?? task.subject;
    const sig = classifyError(text);
    const existing = groups.get(sig) ?? [];
    existing.push(task);
    groups.set(sig, existing);
  }

  console.log(`\n=== Failure Scan: ${failedTasks.length} failures in last ${hours}h ===\n`);

  // Sort by count descending
  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);

  for (const [signature, tasks] of sorted) {
    const exceeds = tasks.length >= threshold;
    const marker = exceeds ? " [RECURRING]" : "";
    console.log(`${signature} (${tasks.length})${marker}`);
    for (const task of tasks.slice(0, 5)) {
      const summary = task.result_summary ?? task.subject;
      const truncated = summary.length > 80 ? summary.slice(0, 79) + "~" : summary;
      console.log(`  #${task.id} ${truncated}`);
    }
    if (tasks.length > 5) {
      console.log(`  ... and ${tasks.length - 5} more`);
    }
    console.log();
  }

  // Summary
  const recurring = sorted.filter(([, tasks]) => tasks.length >= threshold);
  if (recurring.length > 0) {
    console.log(`${recurring.length} pattern(s) exceed threshold (${threshold}+).`);
    console.log("Use --create-tasks to generate investigation tasks.");
  } else {
    console.log("No recurring patterns found.");
  }

  // Create investigation tasks if requested
  if (flags["create-tasks"] === "true") {
    let created = 0;
    for (const [signature, tasks] of recurring) {
      const source = `sensor:failure-triage:pattern:${shortHash(signature)}`;
      if (pendingTaskExistsForSource(source)) {
        console.log(`  Skipping ${signature} — investigation task already exists`);
        continue;
      }

      const taskIds = tasks.map((t) => t.id).join(", ");
      const samples = tasks
        .slice(0, 3)
        .map((t) => `  - task #${t.id}: ${t.result_summary ?? t.subject}`)
        .join("\n");

      const id = insertTask({
        subject: `Investigate recurring failure: ${signature} (${tasks.length} occurrences)`,
        description: [
          `## Recurring Failure Pattern: ${signature}`,
          "",
          `**Occurrences:** ${tasks.length} in the last ${hours} hours`,
          `**Task IDs:** ${taskIds}`,
          "",
          "### Samples",
          samples,
          "",
          "### Instructions",
          "1. Read AGENT.md for this skill before starting",
          "2. Check our own code first before blaming external services",
          "3. Find the root cause, not just the symptom",
          "4. Fix if it's our bug, file ONE issue if external, document if transient",
        ].join("\n"),
        skills: '["failure-triage", "manage-skills"]',
        priority: 3,
        source,
      });

      console.log(`  Created task #${id} for ${signature}`);
      created++;
    }
    console.log(`\nCreated ${created} investigation task(s).`);
  }
}

function cmdInvestigate(args: string[]): void {
  const { flags } = parseFlags(args);
  const pattern = flags.pattern;

  if (!pattern) {
    process.stderr.write(
      "Usage: arc skills run --name failure-triage -- investigate --pattern <text>\n"
    );
    process.exit(1);
  }

  initDatabase();
  const db = getDatabase();

  // Search for tasks matching this pattern in result_summary
  const matchingTasks = db
    .query(
      `SELECT * FROM tasks
       WHERE status IN ('failed', 'blocked')
         AND (result_summary LIKE ? OR subject LIKE ?)
       ORDER BY completed_at DESC
       LIMIT 20`,
    )
    .all(`%${pattern}%`, `%${pattern}%`) as Task[];

  if (matchingTasks.length === 0) {
    console.log(`No failed/blocked tasks matching "${pattern}".`);
    return;
  }

  console.log(`\n=== Investigation: "${pattern}" — ${matchingTasks.length} matching task(s) ===\n`);

  for (const task of matchingTasks) {
    console.log(`--- Task #${task.id} ---`);
    console.log(`  Subject:   ${task.subject}`);
    console.log(`  Status:    ${task.status}`);
    console.log(`  Priority:  ${task.priority}`);
    console.log(`  Source:    ${task.source ?? "none"}`);
    console.log(`  Skills:    ${task.skills ?? "none"}`);
    console.log(`  Attempts:  ${task.attempt_count}`);
    console.log(`  Created:   ${task.created_at}`);
    console.log(`  Completed: ${task.completed_at ?? "n/a"}`);
    console.log(`  Summary:   ${task.result_summary ?? "none"}`);
    if (task.result_detail) {
      const detail = task.result_detail;
      const truncated = detail.length > 500 ? detail.slice(0, 497) + "..." : detail;
      console.log(`  Detail:    ${truncated}`);
    }
    console.log();
  }

  // Classify the signature
  const sampleText = matchingTasks[0].result_summary ?? matchingTasks[0].subject;
  const signature = classifyError(sampleText);
  console.log(`Error signature: ${signature}`);
  console.log(`Unique sources: ${new Set(matchingTasks.map((t) => t.source)).size}`);
  console.log(`Date range: ${matchingTasks[matchingTasks.length - 1].created_at} → ${matchingTasks[0].created_at}`);
}

function printUsage(): void {
  console.log(`failure-triage — detect recurring failure patterns

Usage:
  arc skills run --name failure-triage -- scan [--hours 24] [--threshold 3] [--create-tasks]
  arc skills run --name failure-triage -- investigate --pattern <text>

Commands:
  scan           Review recent failed/blocked tasks, group by error signature
    --hours N       Lookback period in hours (default: 24)
    --threshold N   Min occurrences to flag as recurring (default: 3)
    --create-tasks  Create investigation tasks for recurring patterns

  investigate    Deep-dive a specific recurring error pattern
    --pattern TEXT  Error text to search for in failed tasks
`);
}

// ---- Main ----

function main(): void {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "scan":
      cmdScan(args.slice(1));
      break;
    case "investigate":
      cmdInvestigate(args.slice(1));
      break;
    case "help":
    case undefined:
      printUsage();
      break;
    default:
      process.stderr.write(`Error: unknown subcommand '${sub}'\n`);
      printUsage();
      process.exit(1);
  }
}

main();
