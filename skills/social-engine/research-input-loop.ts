#!/usr/bin/env bun
// skills/social-engine/research-input-loop.ts
//
// P5 arc-demand-flywheel (2026-07-03) — Arc-owned X research-input loop.
//
// The operator asked for Arc's own high-signal target set derived from
// "read-history / consumption frequency" (accounts Arc's own research pipeline
// already cites) rather than hand-recalled lists (a dead end this quest's P0
// explicitly flagged: "Hand-recruited operator DM list from model recall — all
// 12 targets unreachable").
//
// GROUND TRUTH SOURCE: every research report under `research/**/*.md` carries a
// `source_url: [...]` frontmatter array of the tweets it distilled. An account
// that shows up repeatedly there is an account Arc's own dispatch loop keeps
// reading — the literal definition of "consumption frequency."
//
// A ONE-OFF version of this already ran once (task#19403, 2026-06-19 — see
// `social_accounts.research_seed_watermark`), seeding 68 rows. This script makes
// the refresh REPEATABLE and idempotent: re-running it only inserts accounts
// that (a) clear the frequency floor and (b) are not already present under any
// casing. It never auto-follows a newly-discovered handle (ramp conservatively —
// following/replying is a separate, rate-limited decision made elsewhere) and it
// never removes or reclassifies an existing row.
//
// Usage:
//   bun skills/social-engine/research-input-loop.ts [--dry-run] [--floor N]

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { OPERATOR_X_USERNAMES } from "../whop-sales/lib/lead-source.ts";

const DRY_RUN = process.argv.includes("--dry-run");
const floorArgIdx = process.argv.indexOf("--floor");
const FREQUENCY_FLOOR =
  floorArgIdx >= 0 && process.argv[floorArgIdx + 1] ? parseInt(process.argv[floorArgIdx + 1]!, 10) : 3;

const RESEARCH_DIR = resolve(import.meta.dir, "../../research");
const DB_PATH = process.env.ARC_DB_PATH ?? resolve(import.meta.dir, "../../db/arc.sqlite");

// X's generic redirect-URL segment when a handle can't be resolved at scrape
// time (`x.com/i/status/...`) — not a real handle, must be excluded.
const NON_HANDLE_PLACEHOLDERS = new Set(["i"]);
// Arc's own account must never become a "target."
const ARC_OWN_HANDLES = new Set(["arc0btc"]);

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [research-input-loop] ${msg}`);
}

/** Recursively list every .md file under a directory (research/ has subdirs
 * like research/openrouter/, research/arxiv/, research/cache/). */
function listMarkdownFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) out.push(...listMarkdownFilesRecursive(full));
    else if (entry.endsWith(".md")) out.push(full);
  }
  return out;
}

const HANDLE_URL_RE = /(?:x\.com|twitter\.com)\/([A-Za-z0-9_]+)\/status/g;

/** Scan every research report for source_url tweet links and return a
 * frequency map of lowercased-handle -> {count, displayHandle}. */
export function computeConsumptionFrequency(
  researchDir: string = RESEARCH_DIR,
): Map<string, { count: number; displayHandle: string }> {
  const freq = new Map<string, { count: number; displayHandle: string }>();
  const files = listMarkdownFilesRecursive(researchDir);
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    let m: RegExpExecArray | null;
    HANDLE_URL_RE.lastIndex = 0;
    while ((m = HANDLE_URL_RE.exec(content)) !== null) {
      const handle = m[1]!;
      const key = handle.toLowerCase();
      if (NON_HANDLE_PLACEHOLDERS.has(key)) continue;
      if (ARC_OWN_HANDLES.has(key)) continue;
      if (OPERATOR_X_USERNAMES.has(key)) continue;
      const existing = freq.get(key);
      if (existing) existing.count++;
      else freq.set(key, { count: 1, displayHandle: handle });
    }
  }
  return freq;
}

interface ExistingHandle {
  handle_lower: string;
}

function loadExistingHandles(db: Database): Set<string> {
  const rows = db.query("SELECT lower(handle) as handle_lower FROM social_accounts").all() as ExistingHandle[];
  return new Set(rows.map((r) => r.handle_lower));
}

async function main() {
  log(`Starting${DRY_RUN ? " (DRY-RUN)" : ""} — frequency floor=${FREQUENCY_FLOOR}`);

  const freq = computeConsumptionFrequency();
  const ranked = [...freq.entries()].sort((a, b) => b[1].count - a[1].count);

  log(`Scanned research corpus: ${ranked.length} distinct X handles cited.`);
  log("Top 10 by consumption frequency:");
  for (const [key, v] of ranked.slice(0, 10)) {
    log(`  ${v.displayHandle}: ${v.count}`);
  }

  const db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=5000");

  const existing = loadExistingHandles(db);
  const watermark = `p5-consumption-refresh:${new Date().toISOString().slice(0, 10)}`;

  const candidates = ranked.filter(([key, v]) => v.count >= FREQUENCY_FLOOR && !existing.has(key));

  log(
    `${candidates.length} new handle(s) clear the floor (>=${FREQUENCY_FLOOR}) and are not already in social_accounts.`,
  );

  let inserted = 0;
  for (const [, v] of candidates) {
    log(`${DRY_RUN ? "[DRY-RUN] would insert" : "inserting"}: ${v.displayHandle} (count=${v.count})`);
    if (!DRY_RUN) {
      db.query(
        `INSERT OR IGNORE INTO social_accounts
           (handle, platform, targeting_status, follow_state, is_agent,
            research_seed, research_seed_watermark, notes)
         VALUES (?, 'x', 'eligible', NULL, 0, 1, ?, ?)`,
      ).run(
        v.displayHandle,
        watermark,
        `research_seed count=${v.count}; agent-dev cohort (P5 auto-refresh)`,
      );
      inserted++;
    }
  }

  log(
    DRY_RUN
      ? `DRY-RUN complete: ${candidates.length} handle(s) would be inserted. No writes made.`
      : `Complete: ${inserted} new handle(s) inserted with watermark '${watermark}'.`,
  );

  db.close();
}

main().catch((e) => {
  console.error("[research-input-loop] Fatal:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
