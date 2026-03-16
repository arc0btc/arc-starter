/**
 * Skill rename migration script.
 * Renames skill directories, updates frontmatter, sensor names,
 * cross-references, and DB task.skills columns.
 *
 * Usage: bun scripts/migrate-skill-names.ts [--dry-run] [--db-only]
 */

import { readdirSync, renameSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import Database from "bun:sqlite";

const ROOT = resolve(import.meta.dir, "..");
const SKILLS_DIR = join(ROOT, "skills");
const DB_PATH = join(ROOT, "db", "arc.sqlite");

const DRY_RUN = process.argv.includes("--dry-run");
const DB_ONLY = process.argv.includes("--db-only");

// Complete rename mapping: old → new
const RENAME_MAP: Record<string, string> = {
  "agent-engagement": "social-agent-engagement",
  "aibtc-dev": "aibtc-dev-ops",
  "aibtc-heartbeat": "aibtc-heartbeat",
  "aibtc-inbox": "aibtc-inbox-sync",
  "aibtc-maintenance": "aibtc-repo-maintenance",
  "aibtc-news": "aibtc-news-editorial",
  "aibtc-news-deal-flow": "aibtc-news-deal-flow",
  "aibtc-services": "aibtc-services-reference",
  "arc-brand": "arc-brand-voice",
  "architect": "arc-architecture-review",
  "bitflow": "bitflow-positions",
  "blog-deploy": "blog-deploy",
  "blog-publishing": "blog-publishing",
  "ceo": "arc-ceo-strategy",
  "ceo-review": "arc-ceo-review",
  "ci-status": "github-ci-status",
  "composition-patterns": "dev-react-composition",
  "content-quality": "arc-content-quality",
  "cost-alerting": "arc-cost-alerting",
  "credentials": "arc-credentials",
  "dashboard": "arc-web-dashboard",
  "email": "arc-email-sync",
  "evals": "arc-dispatch-evals",
  "failure-triage": "arc-failure-triage",
  "github-mentions": "github-mentions",
  "health": "arc-service-health",
  "housekeeping": "arc-housekeeping",
  "identity": "erc8004-identity",
  "manage-skills": "arc-skill-manager",
  "mcp-server": "arc-mcp-server",
  "performance-analytics": "arc-performance-analytics",
  "quorumclaw": "bitcoin-quorumclaw",
  "react-reviewer": "dev-react-review",
  "release-watcher": "github-release-watcher",
  "report-email": "arc-report-email",
  "reporting": "arc-reporting",
  "reputation": "erc8004-reputation",
  "research": "arc-link-research",
  "scheduler": "arc-scheduler",
  "security-alerts": "github-security-alerts",
  "self-audit": "arc-self-audit",
  "stacks-market": "defi-stacks-market",
  "stackspot": "stacks-stackspot",
  "styx": "styx-btc-bridge",
  "system-alive-check": "arc-alive-check",
  "taproot-multisig": "bitcoin-taproot-multisig",
  "validation": "erc8004-validation",
  "wallet": "bitcoin-wallet",
  "web-design": "dev-web-design",
  "worker-logs": "github-worker-logs",
  "workflow-review": "arc-workflow-review",
  "workflows": "arc-workflows",
  "worktrees": "arc-worktrees",
  "x-posting": "social-x-posting",
  "zero-authority": "dao-zero-authority",
};

// Filter to only skills that actually change
const CHANGES = Object.entries(RENAME_MAP).filter(([old, nw]) => old !== nw);

function log(msg: string): void {
  console.log(DRY_RUN ? `[DRY RUN] ${msg}` : msg);
}

// ── Step 1: Rename directories ──────────────────────────────────────
function renameDirs(): void {
  console.log("\n=== Step 1: Rename skill directories ===");
  for (const [oldName, newName] of CHANGES) {
    const oldPath = join(SKILLS_DIR, oldName);
    const newPath = join(SKILLS_DIR, newName);
    if (!existsSync(oldPath)) {
      console.log(`  SKIP (not found): ${oldName}`);
      continue;
    }
    if (existsSync(newPath)) {
      console.log(`  SKIP (target exists): ${newName}`);
      continue;
    }
    log(`  ${oldName} → ${newName}`);
    if (!DRY_RUN) {
      renameSync(oldPath, newPath);
    }
  }
}

// ── Step 2: Update file contents ────────────────────────────────────
function collectFiles(dir: string, exts: string[]): string[] {
  const results: string[] = [];
  function walk(d: string): void {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        walk(full);
      } else if (exts.some(ext => entry.name.endsWith(ext))) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

function updateFileContents(): void {
  console.log("\n=== Step 2: Update file contents ===");

  // Collect all .ts, .md files under skills/, src/, tests/, templates/
  const dirs = [
    join(ROOT, "skills"),
    join(ROOT, "src"),
    join(ROOT, "tests"),
    join(ROOT, "templates"),
  ].filter(existsSync);

  const files = dirs.flatMap(d => collectFiles(d, [".ts", ".md"]));
  console.log(`  Scanning ${files.length} files...`);

  // Sort changes by old name length descending to avoid substring issues
  // e.g., "ceo-review" before "ceo", "aibtc-news-deal-flow" before "aibtc-news"
  const sortedChanges = [...CHANGES].sort((a, b) => b[0].length - a[0].length);

  let totalReplacements = 0;

  for (const filePath of files) {
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    let modified = content;

    for (const [oldName, newName] of sortedChanges) {
      // Replace skill name references in various contexts:
      // 1. Quoted strings: "old-name" → "new-name"
      // 2. Directory paths: skills/old-name/ → skills/new-name/
      // 3. SENSOR_NAME: "old-name" → "new-name"
      // 4. Frontmatter name: name: old-name → name: new-name

      // Use word-boundary-like matching to avoid partial replacements
      // Match the skill name when surrounded by quotes, slashes, spaces, colons, or line boundaries
      const patterns = [
        // Quoted: "old-name" or 'old-name'
        { re: new RegExp(`"${escapeRegex(oldName)}"`, "g"), rep: `"${newName}"` },
        { re: new RegExp(`'${escapeRegex(oldName)}'`, "g"), rep: `'${newName}'` },
        // Directory path: skills/old-name/  or  skills/old-name\n
        { re: new RegExp(`skills/${escapeRegex(oldName)}(/|\\b)`, "g"), rep: `skills/${newName}$1` },
        // Frontmatter: name: old-name (at start of line)
        { re: new RegExp(`^(name:\\s*)${escapeRegex(oldName)}\\s*$`, "gm"), rep: `$1${newName}` },
        // SENSOR_NAME = "old-name"  (already covered by quoted pattern above)
        // sensor:old-name references
        { re: new RegExp(`sensor:${escapeRegex(oldName)}\\b`, "g"), rep: `sensor:${newName}` },
      ];

      for (const { re, rep } of patterns) {
        modified = modified.replace(re, rep);
      }
    }

    if (modified !== content) {
      const relPath = filePath.replace(ROOT + "/", "");
      const count = countDiffs(content, modified);
      totalReplacements += count;
      log(`  Updated: ${relPath} (${count} changes)`);
      if (!DRY_RUN) {
        writeFileSync(filePath, modified);
      }
    }
  }

  console.log(`  Total replacements: ${totalReplacements}`);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countDiffs(a: string, b: string): number {
  // Rough count of differences
  let count = 0;
  const linesA = a.split("\n");
  const linesB = b.split("\n");
  for (let i = 0; i < Math.max(linesA.length, linesB.length); i++) {
    if (linesA[i] !== linesB[i]) count++;
  }
  return count;
}

// ── Step 3: Update database ─────────────────────────────────────────
function updateDatabase(): void {
  console.log("\n=== Step 3: Update database tasks.skills ===");

  const db = new Database(DB_PATH);

  // Get all tasks with skills set
  const rows = db.query<{ id: number; skills: string }, []>(
    "SELECT id, skills FROM tasks WHERE skills IS NOT NULL AND skills != '' AND skills != '[]'"
  ).all();

  console.log(`  Found ${rows.length} tasks with skills references`);

  const sortedChanges = [...CHANGES].sort((a, b) => b[0].length - a[0].length);
  let updatedCount = 0;

  const updateStmt = db.prepare("UPDATE tasks SET skills = ? WHERE id = ?");

  db.transaction(() => {
    for (const row of rows) {
      let skills = row.skills;
      let modified = skills;

      for (const [oldName, newName] of sortedChanges) {
        // Replace in JSON string: "old-name" → "new-name"
        modified = modified.replace(
          new RegExp(`"${escapeRegex(oldName)}"`, "g"),
          `"${newName}"`
        );
      }

      if (modified !== skills) {
        updatedCount++;
        if (!DRY_RUN) {
          updateStmt.run(modified, row.id);
        }
      }
    }
  })();

  console.log(`  Updated ${updatedCount} tasks`);

  // Also update cycle_log.skills_loaded
  const cycleRows = db.query<{ id: number; skills_loaded: string }, []>(
    "SELECT id, skills_loaded FROM cycle_log WHERE skills_loaded IS NOT NULL AND skills_loaded != ''"
  ).all();

  let cycleUpdated = 0;
  const cycleStmt = db.prepare("UPDATE cycle_log SET skills_loaded = ? WHERE id = ?");

  db.transaction(() => {
    for (const row of cycleRows) {
      let skills = row.skills_loaded;
      let modified = skills;

      for (const [oldName, newName] of sortedChanges) {
        modified = modified.replace(
          new RegExp(`"${escapeRegex(oldName)}"`, "g"),
          `"${newName}"`
        );
      }

      if (modified !== skills) {
        cycleUpdated++;
        if (!DRY_RUN) {
          cycleStmt.run(modified, row.id);
        }
      }
    }
  })();

  console.log(`  Updated ${cycleUpdated} cycle_log entries`);
  db.close();
}

// ── Main ────────────────────────────────────────────────────────────
function main(): void {
  console.log(`Skill rename migration${DRY_RUN ? " (DRY RUN)" : ""}`);
  console.log(`Skills dir: ${SKILLS_DIR}`);
  console.log(`DB: ${DB_PATH}`);
  console.log(`Changes: ${CHANGES.length} skills to rename\n`);

  if (!DB_ONLY) {
    renameDirs();
    updateFileContents();
  }
  updateDatabase();

  console.log("\n=== Done ===");
}

main();
