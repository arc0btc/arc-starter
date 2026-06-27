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
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { Database } from "bun:sqlite";

const ROOT = join(import.meta.dir, "..", "..");
const PATTERNS_PATH = join(ROOT, "memory", "patterns.md");
const FRAMEWORKS_PATH = join(ROOT, "memory", "frameworks.md");
const MEMORY_PATH = join(ROOT, "memory", "MEMORY.md");
const RECENT_LOG_PATH = join(ROOT, "memory", "recent.log");
const SHARED_ENTRIES_DIR = join(ROOT, "memory", "shared", "entries");
const ARCHIVE_DIR = join(ROOT, "memory", "archive");
const DB_PATH = join(ROOT, "db", "arc.sqlite");

const MEMORY_WARN_LINES = 180;
const MEMORY_HARD_LINES = 200;
const RECENT_LOG_MAX_LINES = 500;
const STALE_TAG_DAYS = 14;

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

// ---- health ----

interface HealthIssue {
  level: "warn" | "fail";
  check: string;
  detail: string;
}

function cmdHealth(_args: string[]): void {
  const issues: HealthIssue[] = [];

  // 1. MEMORY.md line count
  const memoryContent = existsSync(MEMORY_PATH) ? readFileSync(MEMORY_PATH, "utf8") : "";
  const memoryLines = memoryContent ? memoryContent.split("\n").length : 0;
  if (memoryLines >= MEMORY_HARD_LINES) {
    issues.push({ level: "fail", check: "memory-lines", detail: `MEMORY.md ${memoryLines} lines — AT Claude Code truncation cliff (hard: ${MEMORY_HARD_LINES})` });
  } else if (memoryLines >= MEMORY_WARN_LINES) {
    issues.push({ level: "warn", check: "memory-lines", detail: `MEMORY.md ${memoryLines} lines — approaching truncation cliff (warn: ${MEMORY_WARN_LINES}, hard: ${MEMORY_HARD_LINES})` });
  }

  // 2. recent.log line count
  const recentLogContent = existsSync(RECENT_LOG_PATH) ? readFileSync(RECENT_LOG_PATH, "utf8") : "";
  const recentLogLines = recentLogContent ? recentLogContent.split("\n").filter((l) => l.trim()).length : 0;
  if (recentLogLines > RECENT_LOG_MAX_LINES) {
    issues.push({ level: "fail", check: "recent-log", detail: `recent.log ${recentLogLines} lines — over threshold (max: ${RECENT_LOG_MAX_LINES})` });
  }

  // 3. Orphaned shared/entries/*.md (no [[slug]] AND no index line in MEMORY.md)
  const orphaned: string[] = [];
  if (existsSync(SHARED_ENTRIES_DIR)) {
    const entryFiles = readdirSync(SHARED_ENTRIES_DIR).filter((f) => f.endsWith(".md"));
    for (const file of entryFiles) {
      const slug = file.replace(/\.md$/, "");
      const hasLink = memoryContent.includes(`[[${slug}]]`);
      // index lines look like: - [Title](memory/shared/entries/slug.md)
      const hasIndex = memoryContent.includes(`(memory/shared/entries/${file})`);
      if (!hasLink && !hasIndex) orphaned.push(slug);
    }
  }
  if (orphaned.length > 0) {
    issues.push({
      level: "warn",
      check: "orphaned-entries",
      detail: `${orphaned.length} orphaned shared/entries (no inbound link): ${orphaned.slice(0, 5).join(", ")}${orphaned.length > 5 ? ` +${orphaned.length - 5} more` : ""}`,
    });
  }

  // 4. Broken [[slug]] links (slug referenced in MEMORY.md but no file exists)
  const linkMatches = [...memoryContent.matchAll(/\[\[([a-z0-9-]+)\]\]/g)];
  const brokenLinks: string[] = [];
  if (linkMatches.length > 0) {
    for (const m of linkMatches) {
      const slug = m[1];
      if (!existsSync(join(SHARED_ENTRIES_DIR, `${slug}.md`))) {
        brokenLinks.push(slug);
      }
    }
  }
  const uniqueBroken = [...new Set(brokenLinks)];
  if (uniqueBroken.length > 0) {
    issues.push({ level: "warn", check: "broken-links", detail: `${uniqueBroken.length} broken [[slug]] link(s): ${uniqueBroken.join(", ")}` });
  }

  // 5. Stale [STATE: YYYY-MM-DD] tags in [A] section (> 14 days)
  const staleTagPattern = /\[STATE: (\d{4}-\d{2}-\d{2})\]/g;
  const nowMs = new Date().getTime();
  const staleTags: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = staleTagPattern.exec(memoryContent)) !== null) {
    const ageDays = (nowMs - new Date(m[1]).getTime()) / 86_400_000;
    if (ageDays > STALE_TAG_DAYS) staleTags.push(`${m[1]} (${Math.round(ageDays)}d)`);
  }
  if (staleTags.length > 0) {
    issues.push({ level: "warn", check: "stale-tags", detail: `${staleTags.length} stale [STATE:] tag(s): ${staleTags.join(", ")}` });
  }

  // Report
  const now = new Date().toISOString();
  console.log(`MEMORY HEALTH AUDIT — ${now}`);
  console.log("=".repeat(60));
  console.log(`MEMORY.md   ${memoryLines} lines  (warn: ${MEMORY_WARN_LINES}, hard: ${MEMORY_HARD_LINES})`);
  console.log(`recent.log  ${recentLogLines} lines  (max: ${RECENT_LOG_MAX_LINES})`);

  if (issues.length === 0) {
    console.log("\nSTATUS: OK — no issues found");
    return;
  }

  console.log(`\nISSUES (${issues.length}):`);
  for (const issue of issues) {
    const prefix = issue.level === "fail" ? "[FAIL]" : "[WARN]";
    console.log(`  ${prefix} ${issue.detail}`);
  }

  const failures = issues.filter((i) => i.level === "fail").length;
  const status = failures > 0 ? "FAIL" : "WARN";
  console.log(`\nSTATUS: ${status} — ${issues.length} issue(s) found`);
  if (failures > 0) process.exit(1);
}

// ---- archive ----

function cmdArchive(_args: string[]): void {
  if (!existsSync(MEMORY_PATH)) {
    console.error("MEMORY.md not found");
    process.exit(1);
  }

  mkdirSync(ARCHIVE_DIR, { recursive: true });

  // Timestamp: YYYY-MM-DDTHH-MM-SSZ
  const ts = new Date().toISOString().replace(/:/g, "-").replace(/\.\d{3}Z$/, "Z");
  const archivePath = join(ARCHIVE_DIR, `${ts}-memory.md`);

  const content = readFileSync(MEMORY_PATH, "utf8");
  writeFileSync(archivePath, content, "utf8");

  const lineCount = content.split("\n").length;
  console.log(`Archived MEMORY.md (${lineCount} lines) → memory/archive/${ts}-memory.md`);
  console.log("Now safe to consolidate MEMORY.md.");
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
  case "health":
    cmdHealth(rest);
    break;
  case "archive":
    cmdArchive(rest);
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
    console.log("  health        read-only audit: line counts, orphaned entries, broken links, stale tags");
    console.log("  archive       snapshot current MEMORY.md to memory/archive/ before consolidation");
    if (command && command !== "--help" && command !== "-h") {
      console.error(`\nUnknown command: ${command}`);
      process.exit(1);
    }
}
