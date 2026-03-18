/**
 * arc-memory CLI
 *
 * Commands:
 *   add-pattern   --section "SECTION" --pattern "TEXT"   Add a pattern to patterns.md
 *   list-sections                                        List section headers in patterns.md
 *   retrospective [--days 7] [--dry-run]                 Print retrospective briefing
 *   framework     --name "NAME"                          Show a decision framework by name
 */

import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Database } from "bun:sqlite";

const ROOT = join(import.meta.dir, "..", "..");
const PATTERNS_PATH = join(ROOT, "memory", "patterns.md");
const FRAMEWORKS_PATH = join(ROOT, "memory", "frameworks.md");
const DB_PATH = join(ROOT, "db", "arc.sqlite");

// ---- Helpers ----

function readFile(path: string): string {
  if (!existsSync(path)) {
    console.error(`File not found: ${path}`);
    process.exit(1);
  }
  return readFileSync(path, "utf8");
}

// ---- add-pattern ----

function cmdAddPattern(args: string[]): void {
  let section: string | undefined;
  let pattern: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--section" && args[i + 1]) section = args[++i];
    else if (args[i] === "--pattern" && args[i + 1]) pattern = args[++i];
  }

  if (!section || !pattern) {
    console.error("Usage: add-pattern --section SECTION --pattern TEXT");
    process.exit(1);
  }

  const content = readFile(PATTERNS_PATH);
  const lines = content.split("\n");

  // Find the section header
  const sectionIdx = lines.findIndex(
    (l) => l.startsWith("## ") && l.toLowerCase().includes(section!.toLowerCase())
  );

  if (sectionIdx === -1) {
    console.error(`Section not found: "${section}"`);
    console.log("Available sections:");
    lines
      .filter((l) => l.startsWith("## "))
      .forEach((l) => console.log(`  ${l}`));
    process.exit(1);
  }

  // Find end of section (next ## or end of file)
  let insertIdx = lines.length;
  for (let i = sectionIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      insertIdx = i;
      break;
    }
  }

  // Remove trailing blank lines before insert point
  while (insertIdx > 0 && lines[insertIdx - 1].trim() === "") {
    insertIdx--;
  }

  const formattedPattern = pattern.startsWith("- ") ? pattern : `- ${pattern}`;
  lines.splice(insertIdx, 0, formattedPattern);

  // Update timestamp at top if present
  const updatedContent = lines
    .join("\n")
    .replace(
      /\*Operational patterns.*?\*\n/,
      `*Operational patterns discovered and validated across cycles. Link: [MEMORY.md](MEMORY.md)*\n`
    );

  writeFileSync(PATTERNS_PATH, updatedContent, "utf8");
  console.log(`Added to section "${section}":`);
  console.log(`  ${formattedPattern}`);
}

// ---- list-sections ----

function cmdListSections(): void {
  const content = readFile(PATTERNS_PATH);
  const sections = content
    .split("\n")
    .filter((l) => l.startsWith("## "))
    .map((l) => l.replace(/^## /, ""));

  console.log(`\nSections in memory/patterns.md:\n`);
  for (const s of sections) {
    console.log(`  ${s}`);
  }
  console.log();
}

// ---- retrospective ----

interface TaskRow {
  id: number;
  subject: string;
  status: string;
  cost_usd: number;
  model: string | null;
  priority: number;
  attempt_count: number;
  result_summary: string | null;
}

function cmdRetrospective(args: string[]): void {
  let days = 7;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--days" && args[i + 1]) days = parseInt(args[++i], 10);
    else if (args[i] === "--dry-run") dryRun = true;
  }

  if (!existsSync(DB_PATH)) {
    console.error(`DB not found: ${DB_PATH}`);
    process.exit(1);
  }

  const db = new Database(DB_PATH, { readonly: true });
  const window = `-${days} days`;

  const tasks = db
    .query(
      `SELECT id, subject, status, priority, model, attempt_count, result_summary,
              COALESCE(cost_usd, 0) as cost_usd
       FROM tasks
       WHERE status IN ('completed', 'failed')
         AND completed_at > datetime('now', ?)
       ORDER BY cost_usd DESC`
    )
    .all(window) as TaskRow[];

  const completed = tasks.filter((t) => t.status === "completed");
  const failed = tasks.filter((t) => t.status === "failed");
  const highCost = tasks.filter((t) => t.cost_usd > 1.0);
  const multiAttempt = tasks.filter((t) => t.attempt_count > 1);
  const totalCost = tasks.reduce((s, t) => s + t.cost_usd, 0);

  console.log(`\n${days}-DAY RETROSPECTIVE (${dryRun ? "dry-run" : "live"})\n`);
  console.log(
    `Total: ${tasks.length} tasks  |  Completed: ${completed.length}  |  Failed: ${failed.length}  |  Cost: $${totalCost.toFixed(2)}\n`
  );

  if (failed.length > 0) {
    console.log("FAILED TASKS:");
    for (const t of failed.slice(0, 15)) {
      const summary = t.result_summary ? ` — ${t.result_summary.slice(0, 60)}` : "";
      const attempts = t.attempt_count > 1 ? ` [${t.attempt_count}x]` : "";
      console.log(`  [#${t.id}] P${t.priority} ${t.subject.slice(0, 60)}${attempts}${summary}`);
    }
    console.log();
  }

  if (highCost.length > 0) {
    console.log("HIGH-COST (>$1.00):");
    for (const t of highCost) {
      console.log(
        `  $${t.cost_usd.toFixed(3)}  P${t.priority} ${t.model ?? "?"}  [#${t.id}] ${t.subject.slice(0, 60)}`
      );
    }
    console.log();
  }

  if (multiAttempt.length > 0) {
    console.log("RETRIED:");
    for (const t of multiAttempt.slice(0, 10)) {
      console.log(`  ${t.attempt_count}x [#${t.id}] ${t.subject.slice(0, 60)} (${t.status})`);
    }
    console.log();
  }

  // Recurring subject patterns
  const prefixMap = new Map<string, number>();
  for (const t of tasks) {
    const prefix = t.subject.split(/\s+/).slice(0, 3).join(" ").toLowerCase();
    prefixMap.set(prefix, (prefixMap.get(prefix) ?? 0) + 1);
  }
  const patterns = [...prefixMap.entries()]
    .filter(([, c]) => c >= 3)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);

  if (patterns.length > 0) {
    console.log("RECURRING SUBJECT PATTERNS (≥3):");
    for (const [prefix, count] of patterns) {
      console.log(`  ${count}x  "${prefix}..."`);
    }
    console.log();
  }

  if (dryRun) {
    console.log("(dry-run — no task created)");
  }
}

// ---- framework ----

function cmdFramework(args: string[]): void {
  let name: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--name" && args[i + 1]) name = args[++i];
  }

  const content = readFile(FRAMEWORKS_PATH);
  const lines = content.split("\n");

  if (!name) {
    // List available frameworks
    console.log("\nAvailable frameworks in memory/frameworks.md:\n");
    lines
      .filter((l) => l.startsWith("## Framework"))
      .forEach((l) => console.log(`  ${l}`));
    console.log('\nUse --name "Framework Name" to view a specific framework.\n');
    return;
  }

  // Find the framework section
  const startIdx = lines.findIndex(
    (l) =>
      l.startsWith("## Framework") &&
      l.toLowerCase().includes(name!.toLowerCase())
  );

  if (startIdx === -1) {
    console.error(`Framework not found: "${name}"`);
    console.log("Available frameworks:");
    lines
      .filter((l) => l.startsWith("## Framework"))
      .forEach((l) => console.log(`  ${l}`));
    process.exit(1);
  }

  // Print until next ## or end
  const output: string[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    if (i > startIdx && lines[i].startsWith("## ")) break;
    output.push(lines[i]);
  }

  console.log("\n" + output.join("\n") + "\n");
}

// ---- Main ----

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case "add-pattern":
    cmdAddPattern(rest);
    break;
  case "list-sections":
    cmdListSections();
    break;
  case "retrospective":
    cmdRetrospective(rest);
    break;
  case "framework":
    cmdFramework(rest);
    break;
  default:
    console.log("Usage: arc skills run --name arc-memory -- <command> [options]");
    console.log("Commands:");
    console.log("  add-pattern   --section SECTION --pattern TEXT");
    console.log("  list-sections");
    console.log("  retrospective [--days 7] [--dry-run]");
    console.log('  framework     [--name "NAME"]');
    if (command && command !== "--help" && command !== "-h") {
      console.error(`\nUnknown command: ${command}`);
      process.exit(1);
    }
}
