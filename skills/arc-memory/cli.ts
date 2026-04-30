/**
 * arc-memory CLI
 *
 * Commands:
 *   add-pattern   --section "SECTION" --pattern "TEXT"   Add a pattern to patterns.md
 *   list-sections                                        List section headers in patterns.md
 *   retrospective [--days 7] [--dry-run]                 Print retrospective briefing
 *   framework     --name "NAME"                          Show a decision framework by name
 *   write-entry   --category A|F|S|T|P|L --slug SLUG --title TITLE --body TEXT
 *                 [--skills s1,s2] [--expires YYYY-MM-DD] [--follows EVENT_ID]
 *                 Write a structured entry to MEMORY.md; auto-supersedes entry with same slug
 *   list-entries  [--category A|F|S|T|P|L]              List all entries in MEMORY.md
 *   supersede     --slug OLD_SLUG --new-slug NEW_SLUG    Mark an entry as superseded
 */

import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Database } from "bun:sqlite";

const ROOT = join(import.meta.dir, "..", "..");
const PATTERNS_PATH = join(ROOT, "memory", "patterns.md");
const FRAMEWORKS_PATH = join(ROOT, "memory", "frameworks.md");
const MEMORY_PATH = join(ROOT, "memory", "MEMORY.md");
const DB_PATH = join(ROOT, "db", "arc.sqlite");

// Category headers as they appear in MEMORY.md
const CATEGORY_HEADERS: Record<string, string> = {
  A: "## [A] Operational State",
  F: "## [F] Fleet",
  S: "## [S] Services",
  T: "## [T] Temporal Events",
  P: "## [P] Patterns",
  L: "## [L] Learnings",
};

const CATEGORY_NAMES: Record<string, string> = {
  A: "Operational State",
  F: "Fleet",
  S: "Services",
  T: "Temporal Events",
  P: "Patterns",
  L: "Learnings",
};

// ---- Helpers ----

function readFile(path: string): string {
  if (!existsSync(path)) {
    console.error(`File not found: ${path}`);
    process.exit(1);
  }
  return readFileSync(path, "utf8");
}

// Build the primary temporal tag for a category
function buildPrimaryTag(category: string, timestamp?: string): string {
  const dateStamp = timestamp ?? new Date().toISOString().split("T")[0];
  const tagsByCategory: Record<string, string> = {
    A: `[STATE: ${dateStamp}]`,
    F: `[UPDATED: ${dateStamp}]`,
    S: `[UPDATED: ${dateStamp}]`,
    T: `[EVENT: ${dateStamp}]`,
    P: `[PATTERN: validated]`,
    L: `[LEARNING: ${dateStamp}]`,
  };
  return tagsByCategory[category] ?? `[UPDATED: ${dateStamp}]`;
}

// ---- MEMORY.md entry parsing ----

interface MemoryEntry {
  slug: string;
  category: string;
  headerLine: string;
  bodyLines: string[];
  lineIndex: number; // line index of the header
}

function parseMemoryEntries(content: string): MemoryEntry[] {
  const lines = content.split("\n");
  const entries: MemoryEntry[] = [];
  let currentCategory = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track current category section
    for (const [cat, header] of Object.entries(CATEGORY_HEADERS)) {
      if (line.startsWith(header)) {
        currentCategory = cat;
        break;
      }
    }

    // Match entry header: **slug** [optional tags]
    // Slugs: lowercase, digits, hyphens only
    const match = line.match(/^\*\*([a-z0-9-]+)\*\*/);
    if (match && currentCategory) {
      const slug = match[1];
      const bodyLines: string[] = [];
      let j = i + 1;
      // Collect body until next entry header, section header, or --- separator
      while (
        j < lines.length &&
        !lines[j].match(/^\*\*[a-z0-9-]+\*\*/) &&
        !lines[j].startsWith("## ") &&
        lines[j] !== "---"
      ) {
        bodyLines.push(lines[j]);
        j++;
      }
      entries.push({
        slug,
        category: currentCategory,
        headerLine: line,
        bodyLines,
        lineIndex: i,
      });
    }
  }

  return entries;
}

// Find a category section's insertion point (just before the "---" that ends the section)
function findCategoryInsertPoint(lines: string[], category: string): number {
  const header = CATEGORY_HEADERS[category];
  const sectionStart = lines.findIndex((l) => l.startsWith(header));
  if (sectionStart === -1) return lines.length;

  // Find the next "---" separator that is followed by a "## [" ASMR section header
  // (within a few lines, to handle blank lines between --- and the header)
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        if (lines[j].match(/^## \[/)) {
          return i; // Insert before the "---"
        }
      }
    }
  }
  return lines.length;
}

// Update the schema timestamp in MEMORY.md header
function updateSchemaTimestamp(content: string): string {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return content.replace(
    /\*Schema: ASMR v1 — Last consolidated: [^\*]+\*/,
    `*Schema: ASMR v1 — Last consolidated: ${now}*`
  );
}

// ---- write-entry ----

function cmdWriteEntry(args: string[]): void {
  let category: string | undefined;
  let slug: string | undefined;
  let title: string | undefined;
  let body: string | undefined;
  let skills: string | undefined;
  let expires: string | undefined;
  let follows: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--category" && args[i + 1]) category = args[++i].toUpperCase();
    else if (args[i] === "--slug" && args[i + 1]) slug = args[++i];
    else if (args[i] === "--title" && args[i + 1]) title = args[++i];
    else if (args[i] === "--body" && args[i + 1]) body = args[++i];
    else if (args[i] === "--skills" && args[i + 1]) skills = args[++i];
    else if (args[i] === "--expires" && args[i + 1]) expires = args[++i];
    else if (args[i] === "--follows" && args[i + 1]) follows = args[++i];
  }

  if (!category || !slug || !body) {
    console.error("Usage: write-entry --category A|F|S|T|P|L --slug SLUG --body TEXT [--title TITLE] [--skills s1,s2] [--expires YYYY-MM-DD] [--follows EVENT_ID]");
    console.error("Categories: A=Operational State, F=Fleet, S=Services, T=Temporal Events, P=Patterns, L=Learnings");
    process.exit(1);
  }

  if (!CATEGORY_HEADERS[category]) {
    console.error(`Unknown category: "${category}". Valid: A, F, S, T, P, L`);
    process.exit(1);
  }

  // Validate slug format
  if (!/^[a-z0-9-]+$/.test(slug)) {
    console.error(`Invalid slug "${slug}": use lowercase letters, digits, and hyphens only`);
    process.exit(1);
  }

  const content = readFile(MEMORY_PATH);
  const lines = content.split("\n");
  const entries = parseMemoryEntries(content);

  // Check for existing entry with same slug
  const existing = entries.find((e) => e.slug === slug);
  let supersededNote = "";

  if (existing) {
    // Tag the existing entry as superseded
    const today = new Date().toISOString().split("T")[0];
    const supersededTag = `[SUPERSEDED BY: ${slug} ${today}]`;

    // Insert superseded tag into existing entry's header line if not already there
    if (!lines[existing.lineIndex].includes("[SUPERSEDED BY:")) {
      lines[existing.lineIndex] = lines[existing.lineIndex] + ` ${supersededTag}`;
      console.log(`Marked existing entry as superseded: ${existing.slug} (was in [${existing.category}])`);
      supersededNote = ` [SUPERSEDES: ${slug}]`;
    }
  }

  // Build the new entry header
  const primaryTag = buildPrimaryTag(category);
  let headerTags = primaryTag;
  if (expires) headerTags += ` [EXPIRES: ${expires}]`;
  if (skills) headerTags += ` [SKILLS: ${skills}]`;
  if (follows) headerTags += ` [FOLLOWS: ${follows}]`;
  if (supersededNote) headerTags += supersededNote;

  const entryTitle = title ?? slug;
  const newHeader = `**${slug}** ${headerTags}`;

  // Build new entry block
  const newEntryLines = ["", newHeader, body, ""];

  // Find insertion point (end of category section)
  const insertPoint = findCategoryInsertPoint(lines, category);

  // Insert the new entry
  lines.splice(insertPoint, 0, ...newEntryLines);

  // Update schema timestamp
  const updatedContent = updateSchemaTimestamp(lines.join("\n"));
  writeFileSync(MEMORY_PATH, updatedContent, "utf8");

  console.log(`Written to [${category}] ${CATEGORY_NAMES[category]}:`);
  console.log(`  ${newHeader}`);
  console.log(`  ${body.slice(0, 80)}${body.length > 80 ? "..." : ""}`);
  if (existing) {
    console.log(`  (superseded entry '${slug}' in [${existing.category}])`);
  }
}

// ---- list-entries ----

function cmdListEntries(args: string[]): void {
  let filterCategory: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--category" && args[i + 1]) filterCategory = args[++i].toUpperCase();
  }

  const content = readFile(MEMORY_PATH);
  const entries = parseMemoryEntries(content);

  const filtered = filterCategory
    ? entries.filter((e) => e.category === filterCategory)
    : entries;

  if (filtered.length === 0) {
    console.log(filterCategory ? `No entries in category [${filterCategory}]` : "No entries found");
    return;
  }

  // Group by category for display
  const byCategory = new Map<string, MemoryEntry[]>();
  for (const entry of filtered) {
    const list = byCategory.get(entry.category) ?? [];
    list.push(entry);
    byCategory.set(entry.category, list);
  }

  const categoryOrder = ["A", "F", "S", "T", "P", "L"];
  for (const cat of categoryOrder) {
    const catEntries = byCategory.get(cat);
    if (!catEntries) continue;

    console.log(`\n[${cat}] ${CATEGORY_NAMES[cat]} (${catEntries.length}):`);
    for (const entry of catEntries) {
      const isSuperseded = entry.headerLine.includes("[SUPERSEDED BY:");
      const tag = isSuperseded ? " [SUPERSEDED]" : "";
      // Extract key tags for display
      const tags = (entry.headerLine.match(/\[(?:STATE|UPDATED|EVENT|PATTERN|LEARNING|EXPIRES|SKILLS): [^\]]+\]/g) ?? []).join(" ");
      console.log(`  ${entry.slug}${tag}  ${tags}`);
    }
  }
  console.log();
}

// ---- supersede ----

function cmdSupersede(args: string[]): void {
  let oldSlug: string | undefined;
  let newSlug: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--slug" && args[i + 1]) oldSlug = args[++i];
    else if (args[i] === "--new-slug" && args[i + 1]) newSlug = args[++i];
  }

  if (!oldSlug || !newSlug) {
    console.error("Usage: supersede --slug OLD_SLUG --new-slug NEW_SLUG");
    process.exit(1);
  }

  const content = readFile(MEMORY_PATH);
  const lines = content.split("\n");
  const entries = parseMemoryEntries(content);

  const target = entries.find((e) => e.slug === oldSlug);
  if (!target) {
    console.error(`Entry not found: "${oldSlug}"`);
    console.log("Use 'list-entries' to see available slugs.");
    process.exit(1);
  }

  if (lines[target.lineIndex].includes("[SUPERSEDED BY:")) {
    console.log(`Entry "${oldSlug}" is already marked superseded.`);
    return;
  }

  const today = new Date().toISOString().split("T")[0];
  lines[target.lineIndex] = lines[target.lineIndex] + ` [SUPERSEDED BY: ${newSlug} ${today}]`;

  const updatedContent = updateSchemaTimestamp(lines.join("\n"));
  writeFileSync(MEMORY_PATH, updatedContent, "utf8");

  console.log(`Marked "${oldSlug}" as [SUPERSEDED BY: ${newSlug} ${today}]`);
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
  case "write-entry":
    cmdWriteEntry(rest);
    break;
  case "list-entries":
    cmdListEntries(rest);
    break;
  case "supersede":
    cmdSupersede(rest);
    break;
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
    console.log("  write-entry   --category A|F|S|T|P|L --slug SLUG --body TEXT [--title TITLE] [--skills s1,s2] [--expires DATE] [--follows EVENT_ID]");
    console.log("  list-entries  [--category A|F|S|T|P|L]");
    console.log("  supersede     --slug OLD_SLUG --new-slug NEW_SLUG");
    console.log("  add-pattern   --section SECTION --pattern TEXT");
    console.log("  list-sections");
    console.log("  retrospective [--days 7] [--dry-run]");
    console.log('  framework     [--name "NAME"]');
    if (command && command !== "--help" && command !== "-h") {
      console.error(`\nUnknown command: ${command}`);
      process.exit(1);
    }
}
