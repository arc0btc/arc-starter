/**
 * skill-effectiveness CLI
 *
 * Correlates SKILL.md content hashes (recorded in cycle_log.skill_hashes)
 * with task outcomes to identify which skill phrasings perform best.
 *
 * Commands:
 *   report  [--skill NAME] [--period today|week|month|all] [--min-samples N]
 *   versions --skill NAME
 *   show-version --hash HASH
 */

import { Database } from "bun:sqlite";
import { join } from "node:path";
import { existsSync } from "node:fs";

// ---- DB setup ----

const ROOT = join(import.meta.dir, "..", "..");
const DB_PATH = join(ROOT, "db", "arc.sqlite");

if (!existsSync(DB_PATH)) {
  console.error(`DB not found at ${DB_PATH}`);
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });

// ---- Types ----

interface CycleRow {
  cycle_id: number;
  task_id: number | null;
  started_at: string;
  duration_ms: number | null;
  cost_usd: number;
  skill_hashes: string | null;
  task_status: string | null;
}

interface SkillVersionRow {
  hash: string;
  skill_name: string;
  content: string;
  first_seen: string;
  last_seen: string;
}

interface VersionStats {
  hash: string;
  skill_name: string;
  first_seen: string;
  last_seen: string;
  total: number;
  successes: number;
  failures: number;
  success_rate: number;
  avg_cost_usd: number;
  avg_duration_ms: number;
  total_cost_usd: number;
}

// ---- Helpers ----

function periodClause(period: string): string {
  switch (period) {
    case "today": return "AND date(cl.started_at) = date('now')";
    case "week":  return "AND cl.started_at >= datetime('now', '-7 days')";
    case "month": return "AND cl.started_at >= datetime('now', '-30 days')";
    default:      return "";
  }
}

function loadCycles(period: string): CycleRow[] {
  const where = periodClause(period);
  return db.query(`
    SELECT
      cl.id AS cycle_id,
      cl.task_id,
      cl.started_at,
      cl.duration_ms,
      cl.cost_usd,
      cl.skill_hashes,
      t.status AS task_status
    FROM cycle_log cl
    LEFT JOIN tasks t ON cl.task_id = t.id
    WHERE cl.skill_hashes IS NOT NULL
      AND t.status IN ('completed', 'failed')
      ${where}
  `).all() as CycleRow[];
}

function buildVersionStats(cycles: CycleRow[], filterSkill?: string): Map<string, VersionStats> {
  // key: "skill_name:hash"
  const map = new Map<string, VersionStats>();

  for (const row of cycles) {
    let hashes: Record<string, string>;
    try {
      hashes = JSON.parse(row.skill_hashes!) as Record<string, string>;
    } catch {
      continue;
    }

    for (const [skill, hash] of Object.entries(hashes)) {
      if (filterSkill && skill !== filterSkill) continue;

      const key = `${skill}:${hash}`;
      if (!map.has(key)) {
        // Look up first/last seen from skill_versions
        const sv = db.query(
          "SELECT first_seen, last_seen FROM skill_versions WHERE hash = ?"
        ).get(hash) as { first_seen: string; last_seen: string } | null;

        map.set(key, {
          hash,
          skill_name: skill,
          first_seen: sv?.first_seen ?? row.started_at,
          last_seen: sv?.last_seen ?? row.started_at,
          total: 0,
          successes: 0,
          failures: 0,
          success_rate: 0,
          avg_cost_usd: 0,
          avg_duration_ms: 0,
          total_cost_usd: 0,
        });
      }

      const s = map.get(key)!;
      s.total++;
      if (row.task_status === "completed") s.successes++;
      else s.failures++;
      s.total_cost_usd += row.cost_usd ?? 0;
      s.avg_duration_ms += row.duration_ms ?? 0; // accumulate, divide later
    }
  }

  // Finalize averages
  for (const s of map.values()) {
    s.success_rate = s.total > 0 ? s.successes / s.total : 0;
    s.avg_cost_usd = s.total > 0 ? s.total_cost_usd / s.total : 0;
    s.avg_duration_ms = s.total > 0 ? s.avg_duration_ms / s.total : 0;
  }

  return map;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function ms(n: number): string {
  if (n < 1000) return `${n.toFixed(0)}ms`;
  return `${(n / 1000).toFixed(1)}s`;
}

function usd(n: number): string {
  return `$${n.toFixed(4)}`;
}

// ---- Commands ----

function cmdReport(args: string[]): void {
  let skillFilter: string | undefined;
  let period = "all";
  let minSamples = 5;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--skill" && args[i + 1]) skillFilter = args[++i];
    else if (args[i] === "--period" && args[i + 1]) period = args[++i];
    else if (args[i] === "--min-samples" && args[i + 1]) minSamples = parseInt(args[++i], 10);
  }

  const cycles = loadCycles(period);
  if (cycles.length === 0) {
    console.log("No cycles with skill_hashes found for the selected period.");
    return;
  }

  const stats = buildVersionStats(cycles, skillFilter);

  // Group by skill_name, sort by skill then by success_rate desc
  const grouped = new Map<string, VersionStats[]>();
  for (const s of stats.values()) {
    if (s.total < minSamples) continue;
    const versionsList = grouped.get(s.skill_name) ?? [];
    versionsList.push(s);
    grouped.set(s.skill_name, versionsList);
  }

  if (grouped.size === 0) {
    console.log(`No skill versions with >= ${minSamples} samples found.`);
    return;
  }

  const periodLabel = period === "all" ? "all time" : period;
  console.log(`\nSKILL EFFECTIVENESS REPORT (${periodLabel}, min ${minSamples} samples)\n`);
  console.log(`Cycles analyzed: ${cycles.length}\n`);

  const skillNames = [...grouped.keys()].sort();
  for (const skillName of skillNames) {
    const versions = grouped.get(skillName)!.sort((a, b) => b.success_rate - a.success_rate);
    console.log(`── ${skillName}`);
    for (const v of versions) {
      const badge = versions.length > 1 && v === versions[0] ? " ★" : "";
      console.log(
        `   ${v.hash}${badge}  success=${pct(v.success_rate)}  n=${v.total}` +
        `  avg_cost=${usd(v.avg_cost_usd)}  avg_dur=${ms(v.avg_duration_ms)}` +
        `  active=${v.first_seen.slice(0, 10)}→${v.last_seen.slice(0, 10)}`
      );
    }
    console.log();
  }
}

function cmdVersions(args: string[]): void {
  let skillName: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--skill" && args[i + 1]) skillName = args[++i];
  }

  if (!skillName) {
    console.error("--skill NAME is required");
    process.exit(1);
  }

  const versions = db.query(
    "SELECT * FROM skill_versions WHERE skill_name = ? ORDER BY first_seen DESC"
  ).all(skillName) as SkillVersionRow[];

  if (versions.length === 0) {
    console.log(`No versions recorded for skill: ${skillName}`);
    return;
  }

  console.log(`\nKNOWN VERSIONS: ${skillName}\n`);

  // Get sample counts per hash from cycle_log
  const sampleMap = new Map<string, number>();
  const rows = db.query(`
    SELECT skill_hashes FROM cycle_log
    WHERE skill_hashes IS NOT NULL
      AND skill_hashes LIKE ?
  `).all(`%${skillName}%`) as { skill_hashes: string }[];

  for (const row of rows) {
    try {
      const hashes = JSON.parse(row.skill_hashes) as Record<string, string>;
      const h = hashes[skillName];
      if (h) sampleMap.set(h, (sampleMap.get(h) ?? 0) + 1);
    } catch {
      // skip malformed
    }
  }

  for (const v of versions) {
    const n = sampleMap.get(v.hash) ?? 0;
    const chars = v.content.length;
    const lines = v.content.split("\n").length;
    console.log(`  ${v.hash}  cycles=${n}  ${lines}L/${chars}ch  first=${v.first_seen.slice(0, 16)}  last=${v.last_seen.slice(0, 16)}`);
  }
  console.log();
  console.log(`Use 'show-version --hash HASH' to see full content of any version.`);
}

function cmdShowVersion(args: string[]): void {
  let hash: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--hash" && args[i + 1]) hash = args[++i];
  }

  if (!hash) {
    console.error("--hash HASH is required");
    process.exit(1);
  }

  const row = db.query(
    "SELECT * FROM skill_versions WHERE hash LIKE ?"
  ).get(`${hash}%`) as SkillVersionRow | null;

  if (!row) {
    console.error(`No version found for hash: ${hash}`);
    process.exit(1);
  }

  console.log(`\n── ${row.skill_name} @ ${row.hash}`);
  console.log(`   first_seen: ${row.first_seen}  last_seen: ${row.last_seen}\n`);
  console.log(row.content);
}

// ---- Main ----

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case "report":       cmdReport(rest); break;
  case "versions":     cmdVersions(rest); break;
  case "show-version": cmdShowVersion(rest); break;
  default:
    console.log("Usage: bun skills/skill-effectiveness/cli.ts <command> [options]");
    console.log("Commands:");
    console.log("  report        [--skill NAME] [--period today|week|month|all] [--min-samples N]");
    console.log("  versions      --skill NAME");
    console.log("  show-version  --hash HASH");
    if (command && command !== "--help" && command !== "-h") {
      console.error(`\nUnknown command: ${command}`);
      process.exit(1);
    }
}
