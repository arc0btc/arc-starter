#!/usr/bin/env bun
// skills/arc-daily-read/cli.ts
// Arc's Daily Read — P3 of arc-demand-distribution quest.
// Real-data chart + daily named first-person beat + amplification email hook.
// NO decorative AI art. Chart = SQL query on distilled_artifacts. Zero image generation.

import { Database } from "bun:sqlite";
import { join } from "path";
// dev-council/Lamport (P3 fix, CONFIRMED CRITICAL — F1): reserveDailyReadGroup() commits
// its reservation in a SEPARATE subprocess/transaction from claimEdition(). If claimEdition
// fails or throws AFTER a successful reservation, nothing released it — see cmdPost's use
// below for the full scenario (orphaned rows, permanent same-edition starvation).
import { releaseGroupRemainder, type Lane } from "../social-engine/admission.ts";
// arc-day-n-publishing P1 (design spec §3.6): the blog-publish task descriptor is shared
// with ContentCalendarMachine (extract-and-reuse, not a reimplementation — see the module's
// own doc comment for why).
import { buildBlogPublishTask } from "../arc-workflows/blog-render.ts";

const ARC_STARTER_ROOT = join(import.meta.dir, "../../");
// P1 (arc-demand-flywheel): env override lets verification/testing point at a scratch copy
// of the DB without ever touching the live daily_read_log. Defaults to the real path — zero
// behavior change in production.
const DB_PATH = process.env.DAILY_READ_DB_PATH ?? join(ARC_STARTER_ROOT, "db/arc.sqlite");
const RESEARCH_DIR = join(ARC_STARTER_ROOT, "research");
const INDEX_PATH = join(RESEARCH_DIR, "INDEX.md");
const MATERIALS_DIR = join(ARC_STARTER_ROOT, "db/daily-read-materials");
// arc-day-n-publishing P0/P1: the design spec's CTA menu is "$9 report or /subscribe, NEVER
// $49" — this used to be misworded as "Free room" while linking a $9 checkout URL under an
// `x-human` affiliate tag unrelated to Arc's canonical attribution. Retired; see ctaLine().
const SUBSCRIBE_URL = "https://arc0.me/subscribe?src=day-n-x";
const X_HANDLE = "@arc0btc";
// arc-day-n-publishing P1 (dev-council/Fowler, design spec §2 finding #8, CONFIRMED-applied):
// named constant for the lane the merged Day-N unit enqueues under, instead of hardcoding
// the string literal "daily-read" at every call site. Does NOT touch admission.ts's closed
// `Lane` union (off-limits) — centralizes the ONE place that changes if the lane is ever
// renamed (rename trigger: edition_n's live-shipped-streak reaching 30, tracked in
// CHECKPOINTS.md, same milestone that lifts the "don't say daily" copy embargo below).
const PRIMARY_THREAD_LANE: Lane = "daily-read";

/** Build a `${PRIMARY_THREAD_LANE}:<edition>:<suffix>` source key — the one place this
 *  shape is assembled, so the lane-rename follow-up (see constant above) is a one-line edit. */
function sourceKey(editionN: number, suffix: string): string {
  return `${PRIMARY_THREAD_LANE}:${editionN}:${suffix}`;
}

/** Streak length required before public copy may say "daily" (QUEST.md mandate: the word
 *  "daily" is not marketed until 30 consecutive editions ship) — see canUseDailyWord(). */
const DAILY_WORD_STREAK_THRESHOLD = 30;

// Crown jewels named explicitly in QUEST.md — drafted first, before falling through to the
// rest of the relevance-4/5 backlog.
const CROWN_JEWEL_SLUGS = [
  "cost-routing-defaults",
  "agent-memory-hygiene",
  "code-mode-mcp-code-execution",
  "agentic-engineering-discipline",
  "kimi-k2-300-agent-swarm",
];

// SOUL.md-aligned intro-style rotation (P1) — six framings pulled directly from SOUL.md's own
// "What works" bullets, so consecutive editions never open the same way. Rotated by edition
// number; the drafting LLM is instructed which one to use for a given edition.
const INTRO_STYLES = [
  "structural-observation — state the mechanism plainly, no throat-clearing",
  "build-on-the-finding — extend or complicate the source's own claim, don't just restate it",
  "genuine-question — open with what Arc is actually unsure about, not a rhetorical hook",
  "dry-specific-humor — a concrete, earned aside, never a generic joke",
  "concise-landed-take — one direct sentence, no runway",
  "direct-claim — name the actor/mechanism, no passive 'the data shows'",
];

// ---------- DB bootstrap ----------

function getDb(): Database {
  const db = new Database(DB_PATH);
  db.run("PRAGMA journal_mode=WAL");
  // P1 dev-council fix (kleppmann): the VM's dispatch loop is a continuous writer against this
  // same DB file — without a busy timeout, a concurrent writer yields SQLITE_BUSY here instead
  // of waiting, and this file's migration catch only swallows "duplicate column" errors.
  db.run("PRAGMA busy_timeout=5000");

  // Idempotent schema migration — daily_read_log
  // arc-day-n-publishing P1 (dev-council/Lamport+Kleppmann, design spec §3.3, CONFIRMED-applied):
  // AUTOINCREMENT (not bare INTEGER PRIMARY KEY, which is max(rowid)+1 and CAN be reused if the
  // top row is ever deleted) — this only affects a FRESH table; the live table predates this fix
  // and is upgraded in place by migrateEditionNAutoincrement() below.
  db.run(`
    CREATE TABLE IF NOT EXISTS daily_read_log (
      edition_n INTEGER PRIMARY KEY AUTOINCREMENT,
      beat_source TEXT NOT NULL,
      tweet_id TEXT,
      root_tweet_url TEXT,
      thesis_carried TEXT,
      what_got_wrong TEXT,
      chart_data TEXT,
      amplification_email_sent INTEGER NOT NULL DEFAULT 0,
      amplification_email_sent_at TEXT,
      organic_reach_snapshot TEXT,
      posted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )
  `);

  // P1 (arc-demand-flywheel): additive columns for findings-first tracking.
  // arc-day-n-publishing P1 (design spec §3.1, §3.6, CONFIRMED-applied): additive outbox-status
  // columns (status/void_reason) and the blog-slug cross-reference syncContentCalendar() checks
  // to avoid double-owning a Day-N-sourced blog post (arc-workflows/sensor.ts).
  // SQLite has no "ADD COLUMN IF NOT EXISTS" — catch-and-ignore duplicate-column errors,
  // matching this file's existing CREATE TABLE IF NOT EXISTS idempotency style.
  for (const migration of [
    "ALTER TABLE daily_read_log ADD COLUMN finding_slug TEXT",
    "ALTER TABLE daily_read_log ADD COLUMN opening_line TEXT",
    // Outbox-pattern status (§3.1): 'reserving' (claimed, not yet drained) → 'shipped' (every
    // planned tweet posted) / 'partial' (root posted, a continuation didn't) / 'void' (root
    // itself never posted — nothing went live). Existing rows (all 4 pre-P1 editions, confirmed
    // fully shipped in the P0 live-state re-read) backfill to 'shipped' via this DEFAULT.
    "ALTER TABLE daily_read_log ADD COLUMN status TEXT NOT NULL DEFAULT 'shipped'",
    "ALTER TABLE daily_read_log ADD COLUMN void_reason TEXT",
    // Set by cmdPost after queuing the Day-N blog-publish task (§3.6); read by
    // arc-workflows/sensor.ts's syncContentCalendar() to skip Day-N-owned slugs when
    // DAYN_MERGED=true, so they never get a second, redundant ContentCalendarMachine instance.
    "ALTER TABLE daily_read_log ADD COLUMN blog_slug TEXT",
  ]) {
    try {
      db.run(migration);
    } catch (error) {
      const errorMessage = String(error);
      if (!errorMessage.includes("duplicate column")) throw error;
    }
  }

  migrateEditionNAutoincrement(db);

  return db;
}

/**
 * arc-day-n-publishing P1 (dev-council/Lamport+Kleppmann, design spec §3.3, CONFIRMED-applied):
 * one-time, idempotent upgrade of a pre-existing `daily_read_log` table (created before this
 * phase, hence WITHOUT `AUTOINCREMENT`) to the AUTOINCREMENT-backed shape. SQLite cannot ALTER a
 * column to add AUTOINCREMENT — it requires rebuilding the table. Guarded by checking
 * `sqlite_sequence` for an existing row (present only once a table WAS created with
 * AUTOINCREMENT), so this is a no-op after the first successful run — matching this file's own
 * catch-and-ignore migration idiom elsewhere. Runs inside a single transaction: create the new
 * table, copy every row verbatim (explicit `edition_n` values are honored and backfill
 * `sqlite_sequence` to their max — see SQLite docs on AUTOINCREMENT + explicit rowids), drop the
 * old table, rename. Never touches row VALUES — this is a structural migration only.
 */
function migrateEditionNAutoincrement(db: Database): void {
  const seqRow = db.query("SELECT 1 FROM sqlite_sequence WHERE name = 'daily_read_log'").get();
  if (seqRow) return; // already AUTOINCREMENT-backed

  const tableExists = db
    .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='daily_read_log'")
    .get();
  if (!tableExists) return; // fresh DB — the CREATE TABLE above already used AUTOINCREMENT

  db.run("BEGIN IMMEDIATE");
  try {
    db.run(`
      CREATE TABLE daily_read_log_p1migration (
        edition_n INTEGER PRIMARY KEY AUTOINCREMENT,
        beat_source TEXT NOT NULL,
        tweet_id TEXT,
        root_tweet_url TEXT,
        thesis_carried TEXT,
        what_got_wrong TEXT,
        chart_data TEXT,
        amplification_email_sent INTEGER NOT NULL DEFAULT 0,
        amplification_email_sent_at TEXT,
        organic_reach_snapshot TEXT,
        posted_at TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        finding_slug TEXT,
        opening_line TEXT,
        status TEXT NOT NULL DEFAULT 'shipped',
        void_reason TEXT,
        blog_slug TEXT
      )
    `);
    db.run(`
      INSERT INTO daily_read_log_p1migration
        (edition_n, beat_source, tweet_id, root_tweet_url, thesis_carried, what_got_wrong,
         chart_data, amplification_email_sent, amplification_email_sent_at,
         organic_reach_snapshot, posted_at, created_at, finding_slug, opening_line,
         status, void_reason, blog_slug)
      SELECT
        edition_n, beat_source, tweet_id, root_tweet_url, thesis_carried, what_got_wrong,
        chart_data, amplification_email_sent, amplification_email_sent_at,
        organic_reach_snapshot, posted_at, created_at, finding_slug, opening_line,
        status, void_reason, blog_slug
      FROM daily_read_log
    `);
    db.run("DROP TABLE daily_read_log");
    db.run("ALTER TABLE daily_read_log_p1migration RENAME TO daily_read_log");
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
}

// ---------- Chart generation (NO AI art — pure SQL on distilled_artifacts) ----------

interface WeeklyCount {
  week: string;
  count: number;
}

interface ChartData {
  weeks: WeeklyCount[];
  totalArtifacts: number;
  thisWeekCount: number;
  lastWeekCount: number;
  dominantType: string;
  generatedAt: string;
}

function toSparkline(values: number[]): string {
  if (values.length === 0) return "";
  const chars = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  const max = Math.max(...values, 1);
  return values.map((v) => chars[Math.min(Math.floor((v / max) * (chars.length - 1)), chars.length - 1)]).join("");
}

function generateChart(): ChartData {
  const db = getDb();

  // Total artifact count — the "211 research passes" claim
  const totalRow = db.query("SELECT COUNT(*) as n FROM distilled_artifacts WHERE deleted_at IS NULL").get() as { n: number };
  const totalArtifacts = totalRow.n;

  // Weekly counts (last 8 weeks)
  const weeklyRows = db.query(`
    SELECT
      strftime('%Y-W%W', produced_at) as week,
      COUNT(*) as count
    FROM distilled_artifacts
    WHERE deleted_at IS NULL
      AND produced_at >= datetime('now', '-56 days')
    GROUP BY week
    ORDER BY week ASC
  `).all() as WeeklyCount[];

  // This week vs last week
  const thisWeekRow = db.query(`
    SELECT COUNT(*) as n FROM distilled_artifacts
    WHERE deleted_at IS NULL
      AND produced_at >= datetime('now', 'start of day', '-6 days')
  `).get() as { n: number };

  const lastWeekRow = db.query(`
    SELECT COUNT(*) as n FROM distilled_artifacts
    WHERE deleted_at IS NULL
      AND produced_at >= datetime('now', 'start of day', '-13 days')
      AND produced_at < datetime('now', 'start of day', '-6 days')
  `).get() as { n: number };

  // Dominant type this week
  const typeRow = db.query(`
    SELECT type, COUNT(*) as n FROM distilled_artifacts
    WHERE deleted_at IS NULL
      AND produced_at >= datetime('now', 'start of day', '-6 days')
    GROUP BY type ORDER BY n DESC LIMIT 1
  `).get() as { type: string; n: number } | null;

  // Humanize the internal type name for tweet copy
  const TYPE_LABELS: Record<string, string> = {
    snippet: "research",
    council: "council",
    arxiv: "arXiv",
    research: "research",
    report: "report",
  };
  const rawType = typeRow?.type ?? "research";
  const humanizedType = TYPE_LABELS[rawType] ?? rawType;

  db.close();

  return {
    weeks: weeklyRows,
    totalArtifacts,
    thisWeekCount: thisWeekRow.n,
    lastWeekCount: lastWeekRow.n,
    dominantType: humanizedType,
    generatedAt: new Date().toISOString(),
  };
}

function renderChartText(data: ChartData): string {
  const sparkline = toSparkline(data.weeks.map((w) => w.count));
  const trend = data.thisWeekCount > data.lastWeekCount ? "up" : data.thisWeekCount < data.lastWeekCount ? "down" : "flat";
  const delta = data.thisWeekCount - data.lastWeekCount;
  const deltaStr = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "flat";
  return `${sparkline} (${deltaStr} vs last week, ${data.dominantType} dominant)`;
}

// ---------- Edition tracking ----------

interface PriorBeat {
  edition_n: number;
  thesis_carried: string | null;
  what_got_wrong: string | null;
}

function getEditionN(): number {
  const db = getDb();
  const row = db.query("SELECT MAX(edition_n) as max_n FROM daily_read_log").get() as { max_n: number | null };
  db.close();
  return (row.max_n ?? 0) + 1;
}

function getPriorBeat(): PriorBeat | null {
  const db = getDb();
  const row = db.query(
    "SELECT edition_n, thesis_carried, what_got_wrong FROM daily_read_log ORDER BY edition_n DESC LIMIT 1"
  ).get() as PriorBeat | null;
  db.close();
  return row;
}

function alreadyPostedToday(): boolean {
  const db = getDb();
  const row = db.query(
    "SELECT COUNT(*) as n FROM daily_read_log WHERE date(posted_at) = date('now')"
  ).get() as { n: number };
  db.close();
  return row.n > 0;
}

interface ResumableEdition {
  edition_n: number;
  status: string;
}

/**
 * arc-day-n-publishing P1 (dev-council/Kleppmann+Lamport, design spec §3.2, CONFIRMED-applied):
 * "crash-resume must NOT redraft." Without this check, a producer run that finds edition N
 * already claimed (a prior run's INSERT succeeded, but the process crashed/was killed before
 * `logBeat`/`finalizeEditionStatus` ran) would call `getEditionN()` — a bare `MAX(edition_n)+1`
 * — and allocate N+1, orphaning N's reservation forever and posting divergent tweet text under
 * a NEW public number for what the reader may have already partially seen. This function finds
 * that not-yet-finalized row so the caller resumes the SAME edition_n with the SAME stored
 * materials/draft files, rather than drafting fresh content under a new number. Producer-side
 * (not `admission.ts`-side) by design — see CHECKPOINTS.md's disclosed `admitGroup`
 * idempotent-resume follow-up for why this isn't an engine-level fix.
 */
function findResumableEdition(db: Database): ResumableEdition | null {
  return db
    .query(
      `SELECT edition_n, status FROM daily_read_log
       WHERE status IN ('reserving', 'partial') AND date(created_at) = date('now')
       ORDER BY edition_n DESC LIMIT 1`
    )
    .get() as ResumableEdition | null;
}

/**
 * arc-day-n-publishing P1 (dev-council/Lamport+Kleppmann, design spec §3.3, CONFIRMED-applied):
 * the PUBLIC streak is NOT the raw edition_n (never-skip keeps that contiguous by
 * construction, so a bare PK-gap check can never detect a void — it always trivially equals
 * the row count). This folds over `(edition_n, status)` from the most recent edition
 * backwards, stopping at the first `void` — a voided edition is a real break the public saw,
 * and it must render as one even though the underlying counter stays contiguous.
 */
function computeStreak(db: Database): number {
  const rows = db
    .query("SELECT status FROM daily_read_log ORDER BY edition_n DESC")
    .all() as { status: string }[];
  let streak = 0;
  for (const row of rows) {
    if (row.status === "shipped" || row.status === "partial") {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

/**
 * QUEST.md mandate: the word "daily" is not marketed in public copy until 30 consecutive
 * editions ship. Encoded as a gate function (not a manual reminder) — see ctaLine() below,
 * the one place in this file's deterministic copy where "daily"/"Day N" branding is chosen.
 */
function canUseDailyWord(streak: number): boolean {
  return streak >= DAILY_WORD_STREAK_THRESHOLD;
}

/**
 * arc-day-n-publishing P1 (design spec §3.6/§4): read the merged-unit rollout toggle. Mirrors
 * arc-workflows/sensor.ts's isDaynMergedEnabled() — same `agent_config` row, same convention
 * (DB toggle, not env var, for an instant single-value rollback). Defaults OFF.
 */
function isDaynMergedEnabled(db: Database): boolean {
  const row = db.query("SELECT value FROM agent_config WHERE key = 'DAYN_MERGED'").get() as { value: string } | null;
  return row?.value === "true";
}

// ---------- Finding selection (P1 — findings-first, replaces pipeline-stats lede) ----------

interface IndexRow {
  relevance: number;
  reportFile: string; // e.g. "2026-06-27T15:00:00Z_agent-memory-hygiene.md"
  slug: string; // reportFile minus timestamp prefix + .md suffix
}

interface Finding {
  slug: string;
  reportFile: string;
  title: string;
  hook: string;
  fileLine: string;
}

/**
 * Parse research/INDEX.md's "All catalogued reports" table for relevance 4-5 rows.
 * Coupling note (P1 simplify pass): this format is generated by `arc skills run --name
 * arc-link-research -- reindex` (see INDEX.md's own header). No shared row-parser was found to
 * import (checked skills/arc-link-research/cli.ts, skills/arc-memory/cli.ts) — this is a
 * second, independent definition of "valid row." If INDEX.md's column layout changes, this
 * parser needs updating in lockstep; not extracted into a shared module since this is currently
 * the only consumer (rule of three).
 */
function parseIndexCandidates(): IndexRow[] {
  const text = require("fs").readFileSync(INDEX_PATH, "utf-8") as string;
  const lines = text.split("\n");
  const startIdx = lines.findIndex((l) => l.trim() === "## All catalogued reports");
  if (startIdx === -1) return [];

  const rows: IndexRow[] = [];
  // Row shape: | relevance | topics | repos | sku? | packaged? | fetched | [title](path) |
  const rowRe = /^\|\s*(\d+)\s*\|.*\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*$/;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## ")) break; // next section
    const m = line.match(rowRe);
    if (!m) continue;
    const relevance = parseInt(m[1], 10);
    if (relevance < 4) continue;
    const reportFile = m[3];
    if (!reportFile.endsWith(".md")) continue;
    const slug = reportFile.replace(/^\d{4}-\d{2}-\d{2}T[\d:-]+Z_/, "").replace(/\.md$/, "");
    rows.push({ relevance, reportFile, slug });
  }
  return rows;
}

/** Extract a measured-claim hook + a real file:line citation from a report body. */
function extractFindingMaterials(reportFile: string): { title: string; hook: string; fileLine: string } | null {
  const fs = require("fs");
  const path = join(RESEARCH_DIR, reportFile);
  if (!fs.existsSync(path)) return null;
  const text = fs.readFileSync(path, "utf-8") as string;

  const titleMatch = text.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : reportFile;

  // Hook: first bolded measured-claim bullet inside "## TL;DR". Report bullets are commonly
  // soft-wrapped across multiple source lines (continuation lines indented, no new marker) —
  // split on bullet boundaries (lookahead), then flatten each bullet's lines to one string
  // so the hook isn't truncated mid-sentence at the first physical line break.
  let hook = "";
  const tldrIdx = text.indexOf("## TL;DR");
  if (tldrIdx !== -1) {
    const sectionEnd = text.indexOf("\n## ", tldrIdx + 1);
    const section = text.slice(tldrIdx, sectionEnd === -1 ? undefined : sectionEnd);
    const bulletMarkerRe = /^(?:-|\d+\.)\s+/;
    const blocks = section.split(/\n(?=(?:-|\d+\.)\s)/);

    for (const block of blocks) {
      if (!bulletMarkerRe.test(block)) continue;
      const fullBullet = block.replace(bulletMarkerRe, "").replace(/\s+/g, " ").trim();
      if (/\*\*[^*]+\*\*/.test(fullBullet)) {
        hook = fullBullet;
        break;
      }
    }
  }
  if (!hook) {
    // Fallback: sku_why front-matter field
    const skuWhyMatch = text.match(/^sku_why:\s*(.+)$/m);
    if (skuWhyMatch) hook = skuWhyMatch[1].trim();
  }
  if (!hook) return null;

  // Real file:line citation, e.g. `src/dispatch.ts:216` or `escalation.ts:82-90`
  const fileLineMatch = text.match(/`([\w./-]+\.(?:ts|tsx|js|md|json)):(\d+(?:-\d+)?)`/);
  if (!fileLineMatch) return null;
  const fileLine = `${fileLineMatch[1]}:${fileLineMatch[2]}`;

  return { title, hook, fileLine };
}

/**
 * Round-robin select the next unused relevance-4/5 finding, crown jewels first.
 *
 * P1 dev-council fix (lamport): using an "ever used" set instead of a rotation WINDOW collapses
 * to a fixed point once every candidate has appeared once — the pool.filter would then always
 * return the full ordered list, and the loop always returns ordered[0] (the same finding, every
 * day, forever), silently breaking the "editions are distinct" property. Using a window sized to
 * the candidate count keeps genuine rotation going indefinitely.
 */
function selectFinding(db: Database): Finding | null {
  const candidates = parseIndexCandidates();
  if (candidates.length === 0) {
    console.error("selectFinding: research/INDEX.md parse yielded 0 relevance-4/5 candidates — check for a format change (this is NOT the normal 'all candidates already used' case).");
    return null;
  }

  const rank = (row: IndexRow): number => {
    const crownIdx = CROWN_JEWEL_SLUGS.indexOf(row.slug);
    if (crownIdx !== -1) return crownIdx; // 0-4, highest priority
    return 100 - row.relevance; // relevance 5 -> 95, relevance 4 -> 96 (lower = higher priority)
  };
  const ordered = [...candidates].sort((a, b) => rank(a) - rank(b));

  // Rotation window = one full cycle (candidate count), not "ever used" — see doc comment above.
  const recentRows = db.query(
    "SELECT finding_slug FROM daily_read_log WHERE finding_slug IS NOT NULL ORDER BY edition_n DESC LIMIT ?"
  ).all(ordered.length) as { finding_slug: string }[];
  const recentlyUsed = new Set(recentRows.map((r) => r.finding_slug));

  let pool = ordered.filter((r) => !recentlyUsed.has(r.slug));
  if (pool.length === 0) {
    // Every candidate appeared within the last full cycle. Exclude only the single most recent
    // finding (guarantees no immediate back-to-back repeat) so rotation continues rather than
    // collapsing to always-the-first-candidate.
    const mostRecent = recentRows[0]?.finding_slug;
    pool = ordered.filter((r) => r.slug !== mostRecent);
    if (pool.length === 0) pool = ordered; // only one candidate exists at all
  }

  for (const row of pool) {
    const materials = extractFindingMaterials(row.reportFile);
    if (!materials) continue; // no real citation available — skip, never ship a placeholder
    return { slug: row.slug, reportFile: row.reportFile, ...materials };
  }
  return null;
}

function chooseIntroStyle(editionN: number): string {
  return INTRO_STYLES[editionN % INTRO_STYLES.length];
}

function getRecentOpenings(db: Database, n: number = 3): string[] {
  const rows = db.query(
    "SELECT opening_line FROM daily_read_log WHERE opening_line IS NOT NULL ORDER BY edition_n DESC LIMIT ?"
  ).all(n) as { opening_line: string }[];
  return rows.map((r) => r.opening_line);
}

// ---------- Beat composition ----------

interface Beat {
  tweets: string[];
  editionN: number;
  thesis: string;
  chartData: ChartData | null;
  findingSlug: string | null;
  openingLine: string | null;
  /** arc-day-n-publishing P1 (design spec §3.4): true for the 1-tweet never-skip fallback —
   *  the streak still advances, but no blog-publish task is queued (nothing to mirror). */
  isMinimal: boolean;
}

interface VoiceDraft {
  // Only tweets 1-3 (the findings-first lede + so-what + continuity) are LLM-authored. Tweet 4
  // (stats footer + CTA) is always assembled deterministically by composeBeat() from the
  // materials brief — never accepted from the draft — so a 3-tuple is the honest contract.
  tweets: [string, string, string];
}

interface MaterialsBrief {
  editionN: number;
  finding: { slug: string; title: string; hook: string; fileLine: string } | null;
  introStyle: string;
  avoidOpenings: string[];
  statsFooter: {
    totalArtifacts: number;
    thisWeekCount: number;
    lastWeekCount: number;
    dominantType: string;
    sparklineText: string;
  };
  /** Empty string on editions with no CTA (see hasCta doc below) — never omit the field. */
  ctaLine: string;
  /** arc-day-n-publishing P1 (design spec §3.5): "no ROUTINE CTA tweet... when a CTA is used
   *  (not every edition)". Deterministic, not a coin flip — every 3rd edition carries a CTA so
   *  the rule is auditable from edition_n alone, not a hidden random draw. */
  hasCta: boolean;
  chartData: ChartData;
}

/**
 * arc-day-n-publishing P1 (design spec §3.5, §3.3): deterministic footer/CTA copy for a given
 * edition. "No routine CTA tweet" (§3.5) → hasCta is false on 2 of every 3 editions; when
 * present, it points at $9-report-or-/subscribe, NEVER $49 (fixes the pre-P1 template, which
 * linked a $9 checkout URL under a "Free room" label — misleading either way). The "daily" word
 * is gated on canUseDailyWord(streak) (QUEST.md: not marketed before a 30-edition streak).
 */
function buildCtaLine(editionN: number, streak: number): { ctaLine: string; hasCta: boolean } {
  const hasCta = editionN % 3 === 0;
  if (!hasCta) return { ctaLine: "", hasCta: false };

  const followLine = canUseDailyWord(streak)
    ? `Follow ${X_HANDLE} for the daily read.`
    : `Follow ${X_HANDLE} for Day ${editionN} · Read #${editionN}.`;
  const ctaLine = [
    followLine,
    ``,
    `Get the full write-up + findings the day they land: ${SUBSCRIBE_URL}`,
  ].join("\n");
  return { ctaLine, hasCta };
}

/**
 * P1 (arc-demand-flywheel): deterministic materials brief for the dispatch-cycle LLM to draft
 * from. No LLM call happens in this function — it only selects facts (finding, citation, stats,
 * intro-style rotation, anti-repeat guard) for a human/LLM drafter to turn into prose.
 * Returns the full ChartData (not just the derived statsFooter fields) so composeBeat() can
 * reuse it directly instead of re-querying the DB for the same numbers a second time.
 */
function composeMaterials(editionOverride?: number): MaterialsBrief {
  const db = getDb();
  const editionN = editionOverride ?? getEditionN();
  const chartData = generateChart();
  const sparklineText = renderChartText(chartData);
  const finding = selectFinding(db);
  const introStyle = chooseIntroStyle(editionN);
  const avoidOpenings = getRecentOpenings(db, 3);
  const streak = computeStreak(db);
  db.close();

  // P1 arc-strategy-panel fix (washington/quinn): "Stacks builders" narrowed the CTA against
  // the quest's locked audience (agent operators broadly, not just Stacks). Findings here are
  // general agent-infra topics as often as Stacks-specific — the CTA must not turn away the
  // reader the hook just earned.
  //
  // P1 verification-pass fix: this line + the stats footer both live in ONE 240-char tweet
  // (thread stays at 4 tweets total, matching the existing cap-check math in checkCap()/
  // sensor.ts rather than growing to 5). The original combination overflowed to ~340 chars and
  // silently truncated the CTA link out of the tweet entirely (caught only because the
  // arc-strategy-panel wording fix above made the overflow worse and this re-verification pass
  // measured the real length instead of assuming it fit). Kept intentionally terse.
  const { ctaLine, hasCta } = buildCtaLine(editionN, streak);

  return {
    editionN,
    finding,
    introStyle,
    avoidOpenings,
    statsFooter: {
      totalArtifacts: chartData.totalArtifacts,
      thisWeekCount: chartData.thisWeekCount,
      lastWeekCount: chartData.lastWeekCount,
      dominantType: chartData.dominantType,
      sparklineText,
    },
    ctaLine,
    hasCta,
    chartData,
  };
}

class VoiceDraftValidationError extends Error {}

/**
 * Load the FROZEN materials brief that `materials` wrote to disk, rather than recomputing it.
 *
 * P1 dev-council fix (kleppmann/newman/hohpe): the original design called composeMaterials()
 * again inside composeBeat(), re-selecting the finding and re-running the chart queries — a
 * TOCTOU gap where the draft could be validated against different facts than the drafter saw
 * (e.g. if a new daily_read_log row landed between `materials` and `post`, finding-selection
 * could shift and a truthful draft would spuriously fail citation validation). Reading back the
 * frozen file also doubles as the "did materials actually run for this edition" check Hohpe
 * asked for: a missing file fails loudly instead of silently recomputing.
 */
function loadMaterialsBrief(path: string): MaterialsBrief {
  const fs = require("fs");
  if (!fs.existsSync(path)) {
    throw new VoiceDraftValidationError(`no materials brief at ${path} — run 'materials' (not --dry-run) before drafting/posting`);
  }
  return JSON.parse(fs.readFileSync(path, "utf-8")) as MaterialsBrief;
}

/**
 * P1: composeBeat now REQUIRES an LLM-authored voice draft for tweets 1-3 (the findings-first
 * lede + so-what + continuity), validated against the FROZEN materials brief `materials` wrote
 * (see loadMaterialsBrief doc comment — not recomputed here). Tweet 4 (footer/CTA) is always
 * assembled deterministically here in code from the brief — never LLM-authored — so the stats +
 * free-room link can never drift or be hallucinated. This function does not call an LLM; it
 * validates a draft that was authored elsewhere (the dispatch-cycle LLM turn, gated by SOUL.md).
 */
function composeBeat(brief: MaterialsBrief, voiceDraft: VoiceDraft): Beat {
  if (!brief.finding) {
    throw new VoiceDraftValidationError("no eligible finding available (research/INDEX.md parse returned nothing usable)");
  }

  const [tweet1, tweet2, tweet3] = voiceDraft.tweets;
  for (const [i, t] of [tweet1, tweet2, tweet3].entries()) {
    if (t.length > 240) {
      throw new VoiceDraftValidationError(`voice draft tweet ${i + 1} exceeds 240 chars (${t.length})`);
    }
  }
  if (!tweet1.includes(brief.finding.fileLine)) {
    throw new VoiceDraftValidationError(
      `tweet 1 must cite the selected finding's file:line ("${brief.finding.fileLine}") literally — proof it was tested against a live agent, not asserted`
    );
  }
  const openingLine = tweet1.split("\n")[0].trim();
  if (brief.avoidOpenings.includes(openingLine)) {
    throw new VoiceDraftValidationError(
      `tweet 1's opening line repeats a prior edition's opening ("${openingLine}") — intros must be distinct`
    );
  }

  // Tweet 4: deterministic footer/appendix — stats + (sometimes) CTA, moved OFF the lede per P1
  // phase goal. Kept terse deliberately: on CTA editions this tweet must also carry the CTA
  // link in the same 240 chars, and the full annotated sparkline text (renderChartText) doesn't
  // fit alongside it — see buildCtaLine's comment for the overflow this was fixed from.
  // arc-day-n-publishing P1 (design spec §3.5): "no ROUTINE CTA tweet" — brief.hasCta is false
  // on 2 of every 3 editions (buildCtaLine), so ctaLine is "" and this tweet is stats-only.
  const tweet4 = [
    `${brief.statsFooter.totalArtifacts} research passes in my pipeline, ${brief.statsFooter.thisWeekCount} this week. Day ${brief.editionN} · Read #${brief.editionN}.`,
    ...(brief.hasCta ? ["", brief.ctaLine] : []),
  ].join("\n");
  if (tweet4.length > 240) {
    // Should be unreachable given the fixed-length fields above, but fail loudly rather than
    // silently truncate the CTA link out of the tweet again.
    throw new VoiceDraftValidationError(`deterministic tweet 4 (footer${brief.hasCta ? "+CTA" : ""}) exceeds 240 chars (${tweet4.length}) — shorten the footer/CTA template, do not let this silently truncate`);
  }

  return {
    tweets: [tweet1, tweet2, tweet3, tweet4],
    editionN: brief.editionN,
    thesis: brief.finding.hook,
    chartData: brief.chartData, // reuse — avoid a second identical generateChart() DB round-trip
    findingSlug: brief.finding.slug,
    openingLine,
    isMinimal: false,
  };
}

/**
 * arc-day-n-publishing P1 (design spec §3.4, dev-council/Lamport F5, CONFIRMED-applied):
 * NEVER-SKIP degradation. When the full read→post→thread pipeline cannot complete (no voice
 * draft, a validation failure, a missing/thin finding), the producer emits a 1-tweet minimal
 * edition rather than skipping the day — the streak counter advances instead of resetting.
 * Fully deterministic (no LLM call, by design — this is the exact fallback for when the LLM
 * turn is what failed). Uses the finding's hook + file:line citation when available (still
 * receipts-first); falls back to a bare, honest placeholder when even that isn't available
 * (research/INDEX.md parse returned nothing) so the streak survives the worst case too.
 *
 * Scope, disclosed (§3.4): this covers "thin content" / "drafting failed" — it does NOT cover
 * "the producer never ran at all" (VM down, expired token, timer miss). That gap is handed to
 * P5's monitor extension + the operator-loop dead-man's-switch (an in-producer fallback cannot
 * fire if the producer itself never executes).
 */
function composeMinimalBeat(brief: MaterialsBrief): Beat {
  const tweet = brief.finding
    ? `Day ${brief.editionN} · Read #${brief.editionN} (minimal edition — full read deferred). ${brief.finding.hook} ${brief.finding.fileLine}`
    : `Day ${brief.editionN} · Read #${brief.editionN} (minimal edition — full read deferred; no eligible finding available this cycle). The streak carries forward; the full read lands next cycle.`;

  if (tweet.length > 240) {
    // Truncate the finding hook, never the file:line citation (the receipt is the point).
    const overflow = tweet.length - 240;
    const truncatedHook = brief.finding
      ? `${brief.finding.hook.slice(0, Math.max(0, brief.finding.hook.length - overflow - 1))}…`
      : "";
    const rebuilt = brief.finding
      ? `Day ${brief.editionN} · Read #${brief.editionN} (minimal edition). ${truncatedHook} ${brief.finding.fileLine}`
      : tweet.slice(0, 240);
    return {
      tweets: [rebuilt],
      editionN: brief.editionN,
      thesis: brief.finding?.hook ?? "(no finding available)",
      chartData: brief.chartData ?? null,
      findingSlug: brief.finding?.slug ?? null,
      openingLine: rebuilt,
      isMinimal: true,
    };
  }

  return {
    tweets: [tweet],
    editionN: brief.editionN,
    thesis: brief.finding?.hook ?? "(no finding available)",
    chartData: brief.chartData ?? null,
    findingSlug: brief.finding?.slug ?? null,
    openingLine: tweet,
    isMinimal: true,
  };
}

// ---------- Cap check ----------

interface CapStatus {
  allowed: boolean;
  todayCount: number;
  cap: number;
  slotsRemaining: number;
  killSwitch: boolean;
}

// P3 arc-posting-scheduler (2026-07-05): daily-read now has its OWN `lane='daily-read'`
// budget_ledger row (reserved atomically via reserve-group in cmdPost, below) instead of
// sharing the 'post' lane's cap with content-calendar/the cadence beat — the whole point
// of this migration. `checkCap()`'s old `slotsRemaining >= 4` gate read the SHARED
// x_post_log/`post`-lane count, which is no longer the right arbiter for whether
// daily-read itself has room — reserve-group (against its own lane + the cross-lane
// DAILY_TWEET_CAP global backstop) is now authoritative for that. `allowed` below is
// narrowed to kill-switch-only; `todayCount`/`slotsRemaining` are kept on the returned
// shape (still logged/displayed by `cmdCompose`/`cmdStatus`) purely as an early
// visibility signal — NOT used to block posting anymore.
function checkCap(): CapStatus {
  const db = new Database(DB_PATH, { readonly: true });

  // Kill switch check
  const ksRow = db.query("SELECT value FROM agent_config WHERE key = 'outbound_enabled'").get() as { value: string } | null;
  const killSwitch = ksRow?.value === "false";

  // Daily tweet count (legacy shared-cap visibility only, see comment above — not a gate)
  const countRow = db.query(
    "SELECT COUNT(*) as n FROM x_post_log WHERE date(posted_at) = date('now')"
  ).get() as { n: number };

  db.close();

  const DAILY_TWEET_CAP = 6;
  const todayCount = countRow.n;
  const slotsRemaining = DAILY_TWEET_CAP - todayCount;

  return {
    allowed: !killSwitch, // P3: cap/window gating now happens via reserve-group in cmdPost
    todayCount,
    cap: DAILY_TWEET_CAP,
    slotsRemaining,
    killSwitch,
  };
}

// ---------- X posting via existing CLI ----------

async function postTweet(
  text: string,
  source: string,
  replyToId?: string,
  isRoot: boolean = false,
  dryRun: boolean = false
): Promise<string | null> {
  if (dryRun) {
    console.log(`  [DRY-RUN] Would post (source: ${source}, is_root: ${isRoot}):`);
    console.log(`  ${text.replace(/\n/g, " ").slice(0, 80)}...`);
    return `dry-run-tweet-id-${source}`;
  }

  const args = [
    join(ARC_STARTER_ROOT, "skills/social-x-posting/cli.ts"),
    "post",
    "--text", text,
    "--source", source,
  ];
  if (replyToId) {
    args.push("--reply-to", replyToId);
  }
  if (isRoot) {
    args.push("--root");
  }

  const proc = Bun.spawn(["bun", ...args], {
    cwd: ARC_STARTER_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    // dev-council/Hohpe (P3 fix, CONFIRMED HIGH — C2): this used to flatten EVERY non-zero
    // exit into a generic console.error with NO hook-state write — so the single WORST
    // outcome this quest can produce (a mid-drain `window_closed_no_post`, which can leave
    // an orphaned, partially-published thread live on X — see cli.ts's fast-path fix) was
    // exactly the one that never rang the alert `ops/monitor/arc-flywheel-health.ts`
    // watches. The reservation-stage failure (reserveDailyReadGroup, above) already writes
    // loud hook-state; the DRAIN-stage failure must too, using the SAME contract, so a
    // human sees "daily-read broke mid-post" and not just a stale "last reservation was
    // fine" state.
    let parsedReason = "post_failed_non_zero_exit";
    let parsedDetail = stderr.slice(0, 300) || `exit ${exitCode}`;
    try {
      const parsed = JSON.parse(stdout) as Record<string, unknown>;
      if (typeof parsed["reason"] === "string") parsedReason = parsed["reason"];
      parsedDetail = JSON.stringify(parsed).slice(0, 300);
    } catch { /* stdout wasn't JSON — keep the stderr-derived defaults */ }
    console.error(`X post failed (source: ${source}, reason=${parsedReason}): ${stderr}`);
    await writeDailyReadDeferState(parsedReason, `mid-drain failure on source=${source}: ${parsedDetail}`);
    return null;
  }

  // arc-day-n-publishing P1 (design spec §3.2 resume path): social-x-posting/cli.ts's
  // pre-admitted-group fast path is idempotent by source_key — a resumed run that re-issues
  // `post --source ${source}` for a tweet ALREADY sent in a prior (crashed) run gets back
  // `{skipped:true, reason:"already_handled_by_engine"}` with NO tweet_id in that JSON (it never
  // re-posts, which is correct — it must not double-publish). Without this branch, the resume
  // path would misread that as a FAILED send (tweetId=null) and wrongly void an edition whose
  // root actually already shipped. Recover the real id from x_post_log (same source_key), the
  // engine's own record of what actually posted.
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    if (parsed["skipped"] === true && parsed["reason"] === "already_handled_by_engine") {
      const db = getDb();
      const priorRow = db.query("SELECT tweet_id FROM x_post_log WHERE source = ?").get(source) as { tweet_id: string | null } | null;
      db.close();
      if (priorRow?.tweet_id) {
        console.log(`  RESUMED ${source}: already sent in a prior run — recovered tweet_id=${priorRow.tweet_id} from x_post_log (not re-posted)`);
        return priorRow.tweet_id;
      }
      console.log(`  RESUMED ${source}: engine reports already-handled (status=${parsed["existingStatus"]}) but x_post_log has no tweet_id for it — treating as unrecoverable, not re-posting`);
      return null;
    }
  } catch { /* stdout wasn't JSON — fall through to the normal tweet_id parse below */ }

  // Parse tweet ID from output
  const match = stdout.match(/tweet_id[:\s]+(\d+)/i) || stdout.match(/"id":\s*"(\d+)"/);
  const tweetId = match?.[1] ?? null;
  console.log(`  Posted ${source}: tweet_id=${tweetId ?? "unknown"}`);
  return tweetId;
}

// ---------- P3 arc-posting-scheduler: atomic whole-beat reservation ----------
//
// Reserves the WHOLE beat (normally root + reply-2 + reply-3 + cta; ONE root tweet for the
// arc-day-n-publishing P1 never-skip minimal edition — see composeMinimalBeat) as ONE atomic
// group, in daily-read's OWN `lane=${PRIMARY_THREAD_LANE}`, inside its 13:00-14:00 UTC window,
// BEFORE any tweet is sent — replacing the old "check a shared cap, then post 4 times and hope"
// sequence with the same atomic-admission guarantee P2 built for content-calendar.
// Each subsequent `postTweet()` call below drains one already-admitted row via cli.ts's
// pre-admitted-group fast path (source keys match exactly — see cmdPost's callers).
interface ReserveGroupResult {
  ok: boolean;
  reason?: string;
  detail?: string;
  atomicGroupId?: string;
}

// Standard 4-tweet beat suffixes, in root-first order. The 1-tweet never-skip minimal edition
// (composeMinimalBeat) reserves just `["root"]` — see reserveDailyReadGroup's `suffixes` param.
const FULL_BEAT_SUFFIXES = ["root", "reply-2", "reply-3", "cta"];

async function reserveDailyReadGroup(
  editionN: number,
  dryRun: boolean,
  suffixes: string[] = FULL_BEAT_SUFFIXES
): Promise<ReserveGroupResult> {
  const sources = suffixes.map((suffix) => sourceKey(editionN, suffix));
  if (dryRun) {
    console.log(`  [DRY-RUN] Would reserve-group (lane=${PRIMARY_THREAD_LANE}, 13:00-14:00 UTC): ${sources.join(", ")}`);
    return { ok: true, atomicGroupId: "dry-run-atomic-group-id" };
  }

  const args = [
    join(ARC_STARTER_ROOT, "skills/social-x-posting/cli.ts"),
    "reserve-group",
    "--sources", sources.join(","),
    "--thread-ref", sources[0],
    "--lane", PRIMARY_THREAD_LANE,
    "--earliest-time", "13:00",
    "--latest-time", "14:00",
  ];
  const proc = Bun.spawn(["bun", ...args], { cwd: ARC_STARTER_ROOT, stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(stdout); } catch { /* fall through with empty parsed */ }

  if (exitCode === 0 && parsed["ok"]) {
    return { ok: true, atomicGroupId: parsed["atomicGroupId"] as string | undefined };
  }
  return {
    ok: false,
    reason: (parsed["reason"] as string | undefined) ?? "reserve_group_failed",
    detail: (parsed["detail"] as string | undefined) ?? stderr.slice(0, 300) ?? `exit ${exitCode}`,
  };
}

// Writes the SAME hook-state shape sensor.ts already writes to
// db/hook-state/arc-daily-read.json (last_ran/last_result/version/last_defer_reason/
// last_defer_at) so ops/monitor/arc-flywheel-health.ts (control-plane repo) keeps seeing
// the identical contract it already reads — now sourced from reserve-group's OWN defer
// reason (queue-native) instead of the old ad hoc "cap_insufficient" literal. This is the
// "loud, not silent" no-show alert the predecessor panel required, preserved through the
// migration rather than dropped.
async function writeDailyReadDeferState(reason: string, detail?: string): Promise<void> {
  const { readHookState, writeHookState } = await import("../../src/sensors.ts");
  const SENSOR_NAME = "arc-daily-read";
  const priorState = await readHookState(SENSOR_NAME);
  await writeHookState(SENSOR_NAME, {
    ...(priorState ?? { version: 0, last_ran: new Date().toISOString(), last_result: "skip" as const }),
    last_ran: new Date().toISOString(),
    last_result: "skip" as const,
    version: ((priorState?.version as number) ?? 0) + 1,
    last_defer_reason: reason,
    last_defer_detail: detail,
    last_defer_at: new Date().toISOString(),
  });
}

// ---------- Amplification email ----------

async function sendAmplificationEmail(
  editionN: number,
  tweetUrl: string | null,
  beat: Beat,
  dryRun: boolean = false
): Promise<boolean> {
  // Reuse the same credentials as arc-report-email/sensor.ts
  const { getCredential } = await import("../../src/credentials.ts");
  const apiBaseUrl = await getCredential("email", "api_base_url");
  const adminKey = await getCredential("email", "admin_api_key");
  const recipient = await getCredential("email", "report_recipient");

  if (!apiBaseUrl || !adminKey) {
    console.warn("  [EMAIL] email credentials not configured — skipping amplification email");
    return false;
  }

  if (!recipient) {
    console.warn("  [EMAIL] no report_recipient credential — skipping");
    return false;
  }

  const subject = `Arc's Daily Read — Edition ${editionN} ready to amplify`;

  const tweetLink = tweetUrl ? `<a href="${tweetUrl}">${tweetUrl}</a>` : "(tweet URL pending)";

  // beat.chartData is null on a never-skip minimal edition (composeMinimalBeat) — there was no
  // full chart pull for that cycle; fall back to a chart-free line rather than crashing on null.
  const suggestedQuoteTweet = beat.chartData
    ? `My agent Arc just dropped Edition ${editionN} of its Daily Read. ${beat.chartData.totalArtifacts} research passes in the pipeline. Worth a look if you're building on Stacks.`
    : `My agent Arc just dropped Edition ${editionN} of its Daily Read (a minimal edition today — full read next cycle). Worth a look if you're building on Stacks.`;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body { font-family: monospace; max-width: 640px; margin: 40px auto; background: #0a0a0a; color: #e0e0e0; padding: 24px; }
  h2 { color: #f0f0f0; border-bottom: 1px solid #333; padding-bottom: 8px; }
  .tweet { background: #1a1a1a; border-left: 3px solid #1d9bf0; padding: 12px 16px; margin: 12px 0; border-radius: 4px; }
  .label { color: #888; font-size: 0.85em; margin-bottom: 4px; }
  .action { background: #0d1a2e; border: 1px solid #1d9bf0; padding: 12px; border-radius: 4px; margin: 16px 0; }
  .quote { background: #1a1a0d; border-left: 3px solid #f0a500; padding: 12px 16px; margin: 12px 0; border-radius: 4px; }
</style></head>
<body>
  <h2>Arc's Daily Read — Edition ${editionN}</h2>
  <p>Edition ${editionN} is live. Ready to amplify.</p>

  <div class="action">
    <strong>Tweet link:</strong> ${tweetLink}<br>
    <em>(One-tap quote-tweet or reply to amplify into your feed)</em>
  </div>

  <h3>Suggested quote-tweet (your voice, not Arc's):</h3>
  <div class="quote">${suggestedQuoteTweet}</div>

  <h3>The 4-tweet beat (Arc's voice):</h3>
  ${beat.tweets.map((t, i) => `
    <div class="tweet">
      <div class="label">Tweet ${i + 1}${i === 0 ? " (root)" : ""}</div>
      <pre style="white-space:pre-wrap;margin:0">${t}</pre>
    </div>
  `).join("")}

  <hr style="border-color:#333;margin:24px 0">
  <p style="color:#666;font-size:0.85em">
    Reach tracking: organic baseline = 51 followers (2026-06-27).
    If you amplify, reply to this email with the quote-tweet URL so Arc can log amplified vs organic reach.
    If you don't amplify, no action needed — Arc will log "shipped without amplification (operator offline) — dead reach expected."
  </p>
</body>
</html>`;

  const plainText = `Arc's Daily Read — Edition ${editionN}\n\nTweet: ${tweetUrl ?? "(pending)"}\n\nSuggested quote-tweet:\n${suggestedQuoteTweet}\n\nBeat:\n${beat.tweets.join("\n---\n")}`;

  if (dryRun) {
    console.log(`  [DRY-RUN EMAIL] Would send to ${recipient}: "${subject}"`);
    console.log(`  [DRY-RUN EMAIL] Body includes ${beat.tweets.length} tweet drafts + quote-tweet suggestion`);
    return true;
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/send`, {
      method: "POST",
      headers: {
        "X-Admin-Key": adminKey,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        to: recipient,
        subject,
        body: plainText,
        body_html: htmlBody,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`  [EMAIL] send failed: HTTP ${response.status} — ${body}`);
      return false;
    }

    console.log(`  [EMAIL] sent to ${recipient}: "${subject}"`);
    return true;
  } catch (err) {
    console.error(`  [EMAIL] network error: ${err}`);
    return false;
  }
}

// ---------- Logging ----------

/**
 * P1 dev-council fix (lamport/kleppmann): claim this edition_n BEFORE posting any tweets, via a
 * plain INSERT (not OR REPLACE) against the edition_n PRIMARY KEY. This is the linearization
 * point: if two invocations ever compute the same next-edition number (a near-simultaneous
 * retry/race), only the first INSERT wins — the second hits a PK conflict and this function
 * returns false, so the caller aborts BEFORE posting instead of double-posting identical tweets.
 * `finalizeEditionStatus` below then only UPDATEs this already-claimed row — it never INSERTs, so
 * a crash after posting but before finalize leaves a detectable claimed-but-unfinalized row
 * (status='reserving', tweet_id/posted_at NULL) that findResumableEdition() picks up and resumes
 * (arc-day-n-publishing P1, design spec §3.2) rather than a stricter per-tweet checkpoint scheme
 * (still out of scope; the resumable-row check is the producer-side workaround for that).
 *
 * arc-day-n-publishing P1 (design spec §3.1): explicitly sets status='reserving' — the column's
 * table-level DEFAULT is 'shipped', which is correct ONLY for the 4 pre-P1 rows the additive
 * migration backfilled (all confirmed fully shipped in the P0 live-state re-read); a FRESH claim
 * has shipped nothing yet and must never silently inherit that default.
 */
function claimEdition(db: Database, editionN: number, findingSlug: string | null, openingLine: string | null): boolean {
  try {
    db.run(
      `INSERT INTO daily_read_log (edition_n, beat_source, finding_slug, opening_line, status) VALUES (?, ?, ?, ?, 'reserving')`,
      [editionN, `${PRIMARY_THREAD_LANE}:${editionN}`, findingSlug, openingLine]
    );
    return true;
  } catch (error) {
    const errorMessage = String(error);
    if (errorMessage.includes("UNIQUE constraint") || errorMessage.includes("PRIMARY KEY")) return false;
    throw error;
  }
}

/**
 * Finalize an already-claimed edition_n row (see claimEdition) with posting results AND its
 * outbox-derived status (arc-day-n-publishing P1, design spec §3.1): 'shipped' only when every
 * planned tweet posted (a captured tweetId for each); 'partial' when the root posted but a
 * continuation didn't (partial-degraded still counts toward the public streak — computeStreak);
 * 'void' when the root itself never posted (nothing went live — does NOT count toward the
 * streak). Status is derived from send outcomes here, never asserted by the caller.
 */
function finalizeEditionStatus(
  db: Database,
  editionN: number,
  beat: Beat,
  tweetId: string | null,
  status: "shipped" | "partial" | "void",
  voidReason: string | null,
  emailSent: boolean,
  postedAt: string | null
): void {
  const tweetUrl = tweetId ? `https://x.com/${X_HANDLE.slice(1)}/status/${tweetId}` : null;

  db.run(
    `UPDATE daily_read_log SET
       tweet_id = ?, root_tweet_url = ?, thesis_carried = ?, what_got_wrong = ?,
       chart_data = ?, amplification_email_sent = ?, amplification_email_sent_at = ?,
       organic_reach_snapshot = ?, posted_at = ?, status = ?, void_reason = ?
     WHERE edition_n = ?`,
    [
      tweetId,
      tweetUrl,
      beat.thesis,
      null, // what_got_wrong is set on the NEXT beat, looking back
      beat.chartData ? JSON.stringify(beat.chartData) : null,
      emailSent ? 1 : 0,
      emailSent ? new Date().toISOString() : null,
      JSON.stringify({ follower_count_at_post: 51 }), // P2 baseline; updated when live X pull is available
      postedAt,
      status,
      voidReason,
      editionN,
    ]
  );
}

/** Load and validate a `--voice-file` JSON draft written by the dispatch-cycle LLM. */
function loadVoiceDraft(path: string): VoiceDraft {
  const fs = require("fs");
  const raw = JSON.parse(fs.readFileSync(path, "utf-8"));
  if (!Array.isArray(raw.tweets) || raw.tweets.length !== 3 || raw.tweets.some((t: unknown) => typeof t !== "string")) {
    throw new VoiceDraftValidationError(`voice draft at ${path} must be JSON { tweets: [t1, t2, t3] } (3 strings) — the stats footer/CTA is assembled deterministically, do not include a 4th tweet`);
  }
  return { tweets: [raw.tweets[0], raw.tweets[1], raw.tweets[2]] } as VoiceDraft;
}

// ---------- Commands ----------

async function cmdChart() {
  const data = generateChart();
  const sparkline = toSparkline(data.weeks.map((w) => w.count));
  console.log("=== Arc Daily Read — Real-Data Chart ===");
  console.log(`Source: distilled_artifacts table (db/arc.sqlite) — NO AI art`);
  console.log(`Generated: ${data.generatedAt}`);
  console.log(`Total research passes (all time): ${data.totalArtifacts}`);
  console.log(`This week: ${data.thisWeekCount} | Last week: ${data.lastWeekCount}`);
  console.log(`Dominant type: ${data.dominantType}`);
  console.log(`\nWeekly sparkline (last 8 weeks): ${sparkline}`);
  console.log("\nWeekly breakdown:");
  data.weeks.forEach((w) => console.log(`  ${w.week}: ${w.count}`));
  console.log("\nChart text for tweet:");
  console.log(renderChartText(data));
  console.log("\n[ASSERTION: This chart is generated by SQL query on Arc's own distilled_artifacts data.");
  console.log(" No OpenRouter, DALL-E, or image generation API is used. Source: src/db.ts query on db/arc.sqlite]");
}

/**
 * P1: deterministic materials brief for the dispatch-cycle LLM to draft from. Prints the brief
 * and writes it to db/daily-read-materials/edition-<N>.json so the drafting LLM (and this
 * session's verification) can read it as a file.
 */
async function cmdMaterials(dryRun: boolean, editionOverride?: number) {
  console.log("=== Arc Daily Read — Materials Brief (findings-first, P1) ===");
  const brief = composeMaterials(editionOverride);

  if (!brief.finding) {
    console.error("NO ELIGIBLE FINDING: research/INDEX.md parse returned nothing usable (no relevance-4/5 report with both a TL;DR hook and a real file:line citation).");
    process.exit(1);
  }

  console.log(`\nEdition: ${brief.editionN}`);
  console.log(`Selected finding: ${brief.finding.slug} (${brief.finding.title})`);
  console.log(`Hook: ${brief.finding.hook}`);
  console.log(`File:line citation: ${brief.finding.fileLine}`);
  console.log(`Intro style (this edition): ${brief.introStyle}`);
  console.log(`Avoid repeating these openings: ${brief.avoidOpenings.length ? brief.avoidOpenings.join(" | ") : "(none yet — first editions)"}`);
  console.log(`Stats footer (deterministic, goes in tweet 4 only): ${JSON.stringify(brief.statsFooter)}`);
  console.log(`CTA this edition (no-routine-CTA gate, design spec §3.5): ${brief.hasCta ? "YES" : "no — 2 of every 3 editions carry no CTA"}`);
  if (brief.hasCta) console.log(`CTA line (deterministic, do not rewrite the URL): ${brief.ctaLine}`);

  const fs = require("fs");
  if (!fs.existsSync(MATERIALS_DIR)) fs.mkdirSync(MATERIALS_DIR, { recursive: true });
  const outPath = join(MATERIALS_DIR, `edition-${brief.editionN}.json`);
  if (!dryRun) {
    fs.writeFileSync(outPath, JSON.stringify(brief, null, 2));
    console.log(`\nWrote brief to ${outPath}`);
  } else {
    console.log(`\n[DRY-RUN] Would write brief to ${outPath}`);
  }
  console.log(`\nNext step: draft tweets 1-3 in Arc's voice (SOUL.md), save as`);
  console.log(`  ${join(MATERIALS_DIR, `edition-${brief.editionN}.draft.json`)}`);
  console.log(`  shape: { "tweets": ["<tweet1 with hook + file:line>", "<tweet2>", "<tweet3>"] } (3 only — footer/CTA is deterministic, do not draft a tweet 4)`);
  console.log(`Then run: bun cli.ts post --voice-file ${join(MATERIALS_DIR, `edition-${brief.editionN}.draft.json`)}`);
}

async function cmdCompose(dryRun: boolean, voiceFilePath?: string) {
  console.log("=== Arc Daily Read — Beat Composition ===");
  if (!voiceFilePath) {
    console.log("DEFERRED: no --voice-file provided. Run `materials` first, draft the beat in Arc's voice, then `compose --voice-file <path>`.");
    return;
  }
  const editionN = getEditionN();
  const brief = loadMaterialsBrief(join(MATERIALS_DIR, `edition-${editionN}.json`));
  const voiceDraft = loadVoiceDraft(voiceFilePath);
  const beat = composeBeat(brief, voiceDraft);

  console.log(`\nEdition: ${beat.editionN}`);
  console.log(`Finding: ${beat.findingSlug}`);
  console.log(`Thesis (finding hook): ${beat.thesis}`);
  console.log("\n--- 4-tweet beat ---");
  beat.tweets.forEach((t, i) => {
    const charCount = t.length;
    const label = i === 0 ? "ROOT" : i === 3 ? "CTA" : `REPLY-${i + 1}`;
    console.log(`\n[${label}] ${charCount} chars:`);
    console.log(t);
    if (charCount > 240) {
      console.warn(`  WARNING: tweet ${i + 1} exceeds 240 chars (${charCount})`);
    }
  });

  const cap = checkCap();
  console.log("\n--- Cap check ---");
  console.log(`Today's tweets: ${cap.todayCount}/${cap.cap}`);
  console.log(`Slots remaining: ${cap.slotsRemaining}`);
  console.log(`Kill switch: ${cap.killSwitch ? "ACTIVE (outbound_enabled=false)' — would block" : "inactive"}`);
  console.log(`Posting allowed: ${cap.allowed ? "YES" : "NO"}`);

  if (dryRun) {
    console.log("\n[DRY-RUN] No posts sent. Use `post --dry-run` to simulate posting flow.");
  }
}

/** Strict frozen-brief read (TOCTOU-safe, see loadMaterialsBrief) with a lenient fallback for
 *  the never-skip path, where "materials never ran either" is itself a valid failure to survive. */
function loadOrComposeMaterialsBrief(editionN: number): MaterialsBrief {
  try {
    return loadMaterialsBrief(join(MATERIALS_DIR, `edition-${editionN}.json`));
  } catch {
    console.log(`  (no frozen materials brief for edition ${editionN} — composing fresh for the never-skip fallback)`);
    return composeMaterials(editionN);
  }
}

async function cmdPost(dryRun: boolean, voiceFilePath?: string, simulateFailure: boolean = false) {
  console.log(`=== Arc Daily Read — Post ${dryRun ? "(DRY-RUN)" : "(LIVE)"} ===`);

  // Kill switch check — fully deterministic, unchanged by the P1 voice-pass rework.
  // P3 arc-posting-scheduler: cap/window gating moved to reserve-group below (its own
  // lane + the cross-lane DAILY_TWEET_CAP backstop) — checkCap()'s slots-remaining count
  // is legacy/shared-cap visibility only now, not a gate (see checkCap's own comment).
  const cap = checkCap();
  if (cap.killSwitch) {
    console.log("HALTED: kill switch active (outbound_enabled=false)");
    process.exit(0);
  }

  // Already posted today?
  if (alreadyPostedToday() && !dryRun) {
    console.log("SKIPPED: already posted today (daily_read_log row exists for today)");
    process.exit(0);
  }

  // arc-day-n-publishing P1 (design spec §3.2, dev-council/Kleppmann+Lamport, CONFIRMED-applied):
  // crash-resume check BEFORE allocating a new edition number. If a prior run claimed an
  // edition but crashed before finalizing it, resume THAT edition_n with its stored materials
  // — never allocate N+1 and redraft under a new, divergent number (see findResumableEdition).
  const resumeDb = getDb();
  const resumable = findResumableEdition(resumeDb);
  resumeDb.close();
  const editionN = resumable ? resumable.edition_n : getEditionN();
  if (resumable) {
    console.log(`RESUMING edition ${editionN} (status=${resumable.status}) — a prior run claimed this edition but did not finish draining. Using its stored materials/draft, not drafting fresh content or allocating a new number.`);
  }

  // P1: no LLM call happens here — this only reads a voice draft file that was authored
  // upstream by the SOUL.md-gated dispatch-cycle LLM turn. If it's missing, the never-skip
  // fallback below fires instead of deferring (arc-day-n-publishing P1 — deferring forever is
  // exactly the failure class this quest exists to kill).
  if (!voiceFilePath && !simulateFailure) {
    const fs = require("fs");
    const defaultPath = join(MATERIALS_DIR, `edition-${editionN}.draft.json`);
    if (fs.existsSync(defaultPath)) voiceFilePath = defaultPath;
  }

  let beat: Beat;
  let usedNeverSkipFallback = false;
  let fallbackReason = "";
  try {
    if (simulateFailure) {
      throw new VoiceDraftValidationError("--simulate-failure: forcing the never-skip minimal-edition path (verification of design spec §3.4)");
    }
    if (!voiceFilePath) {
      throw new VoiceDraftValidationError(`no voice draft available at ${join(MATERIALS_DIR, `edition-${editionN}.draft.json`)}`);
    }
    // Strict, TOCTOU-safe read (dev-council/kleppmann+newman+hohpe, see loadMaterialsBrief doc
    // comment) — a missing frozen brief here is itself a "full edition can't be produced"
    // signal and falls through to the never-skip minimal edition below, not a silent recompute.
    const brief = loadMaterialsBrief(join(MATERIALS_DIR, `edition-${editionN}.json`));
    const voiceDraft = loadVoiceDraft(voiceFilePath);
    beat = composeBeat(brief, voiceDraft);
  } catch (err) {
    if (!(err instanceof VoiceDraftValidationError)) throw err;
    // arc-day-n-publishing P1 (design spec §3.4, dev-council/Lamport F5, CONFIRMED-applied):
    // NEVER-SKIP degradation. The full edition can't be produced (thin content, drafting or
    // validation failure, or an explicit --simulate-failure proving this path) — emit the
    // 1-tweet minimal edition instead of deferring. The streak still advances.
    console.log(`FULL EDITION UNAVAILABLE (${err.message})`);
    console.log(`NEVER-SKIP: falling back to the 1-tweet minimal edition for edition ${editionN} instead of deferring.`);
    usedNeverSkipFallback = true;
    fallbackReason = err.message;
    const brief = loadOrComposeMaterialsBrief(editionN);
    beat = composeMinimalBeat(brief);
  }
  const postedAt = new Date().toISOString();

  // P3 arc-posting-scheduler: reserve the WHOLE beat (4 tweets normally; 1 for a never-skip
  // minimal edition) as ONE atomic group, in daily-read's OWN lane + its 13:00-14:00 UTC
  // window, BEFORE claiming the edition number or sending anything — so a deferred/rejected
  // reservation never burns an edition_n that would then never post. This is the authoritative
  // cap/window check (replacing the old shared-cap `checkCap().allowed` gate above).
  const suffixes = beat.isMinimal ? ["root"] : FULL_BEAT_SUFFIXES;
  const reservation = await reserveDailyReadGroup(beat.editionN, dryRun, suffixes);
  if (!reservation.ok) {
    console.log(`DEFERRED: reserve-group rejected this edition's beat — reason=${reservation.reason}`);
    console.log(`  detail: ${reservation.detail ?? "(none)"}`);
    if (!dryRun) {
      await writeDailyReadDeferState(reservation.reason ?? "reserve_group_failed", reservation.detail);
    }
    process.exit(0);
  }
  console.log(`Reservation OK — atomic_group_id=${reservation.atomicGroupId} (${suffixes.length}-tweet ${beat.isMinimal ? "MINIMAL never-skip" : "full"} beat)`);

  // Claim this edition_n BEFORE posting anything — the linearization point (see claimEdition
  // doc comment). Skipped entirely when resuming (already claimed by the prior run) and
  // skipped in --dry-run so test runs never mutate daily_read_log.
  //
  // dev-council/Lamport (P3 fix, CONFIRMED CRITICAL — F1): the ORIGINAL version of this
  // block exited on `!claimed` (or would have propagated an exception) WITHOUT releasing
  // the reservation `reserveDailyReadGroup()` just committed. Because `source_key` is
  // UNIQUE and a claimed-but-unfinalized row is now resumed (not recomputed to N+1 — see
  // findResumableEdition), releasing on any claim-failure path remains required so a
  // concurrent/retried run doesn't strand this run's reservation forever.
  if (!dryRun && !resumable) {
    const claimDb = getDb();
    let claimed = false;
    try {
      claimed = claimEdition(claimDb, beat.editionN, beat.findingSlug, beat.openingLine);
    } catch (claimErr) {
      claimDb.close();
      console.log(`ERROR: claimEdition threw — releasing reservation before rethrowing: ${claimErr instanceof Error ? claimErr.message : String(claimErr)}`);
      if (reservation.atomicGroupId && reservation.atomicGroupId !== "dry-run-atomic-group-id") {
        const releaseDb = getDb();
        releaseGroupRemainder(releaseDb, reservation.atomicGroupId, `claimEdition threw for edition ${beat.editionN} — releasing reservation to avoid a permanently-stuck edition`);
        releaseDb.close();
      }
      throw claimErr;
    }
    claimDb.close();
    if (!claimed) {
      console.log(`SKIPPED: edition ${beat.editionN} already claimed in daily_read_log (concurrent run or retry) — releasing this run's reservation and aborting to avoid double-post`);
      if (reservation.atomicGroupId && reservation.atomicGroupId !== "dry-run-atomic-group-id") {
        const releaseDb = getDb();
        const released = releaseGroupRemainder(releaseDb, reservation.atomicGroupId, `edition ${beat.editionN} already claimed elsewhere — releasing this run's now-redundant reservation`);
        releaseDb.close();
        console.log(`  released ${released.length} reserved row(s) for atomic_group_id=${reservation.atomicGroupId}`);
      }
      process.exit(0);
    }
  } else if (dryRun) {
    console.log(`[DRY-RUN] Would claim edition ${beat.editionN} in daily_read_log before posting (skipped for dry-run)`);
  } else {
    console.log(`Edition ${beat.editionN} already claimed (resuming this run) — not calling claimEdition a second time.`);
  }

  console.log(`\nEdition ${beat.editionN} | posting ${beat.tweets.length}-tweet beat...`);

  // arc-day-n-publishing P1: generalized the old hardcoded root/reply-2/reply-3/cta 4-slot
  // sequence to any beat length (1 for the never-skip minimal edition). dev-council/Kleppmann
  // finding #10: an 'unknown'/failed send has no valid reply target — stop draining rather
  // than chain --reply-to a null parent (the beat's status is then derived as 'partial'/'void'
  // below, never silently treated as fully shipped).
  const postedIds: (string | null)[] = [];
  let priorId: string | undefined;
  for (let i = 0; i < beat.tweets.length; i++) {
    const suffix = suffixes[i] ?? `tweet-${i + 1}`;
    const id = await postTweet(beat.tweets[i], sourceKey(beat.editionN, suffix), priorId, i === 0, dryRun);
    postedIds.push(id);
    if (id) {
      priorId = id;
    } else {
      console.log(`  halting drain at tweet ${i + 1}/${beat.tweets.length} — no valid parent for a further --reply-to chain`);
      break;
    }
  }
  while (postedIds.length < beat.tweets.length) postedIds.push(null);

  const rootId = postedIds[0] ?? null;
  const tweetUrl = rootId ? `https://x.com/arc0btc/status/${rootId}` : null;

  // arc-day-n-publishing P1 (design spec §3.1): status derived from send outcomes, never
  // asserted. 'shipped' = every planned tweet posted; 'partial' = root posted but a
  // continuation didn't (still counts toward the public streak, computeStreak); 'void' = the
  // root itself never posted — nothing went live, does not count toward the streak.
  let status: "shipped" | "partial" | "void";
  let voidReason: string | null = null;
  if (!rootId) {
    status = "void";
    voidReason = "root_post_failed";
  } else if (postedIds.every((id) => id !== null)) {
    status = "shipped";
  } else {
    status = "partial";
  }

  // Send amplification email (REQUIRED per D4) — skip for a void edition (nothing to amplify).
  let emailSent = false;
  if (status !== "void") {
    console.log("\nFiring amplification email (D4 — required)...");
    emailSent = await sendAmplificationEmail(beat.editionN, tweetUrl, beat, dryRun);
    if (!emailSent) {
      console.warn("  Amplification email FAILED — logging: 'shipped without amplification (operator offline) — dead reach expected'");
    }
  }

  // Log the beat
  if (!dryRun) {
    const db = getDb();
    finalizeEditionStatus(db, beat.editionN, beat, rootId, status, voidReason, emailSent, status === "void" ? null : postedAt);
    db.close();
    console.log(`\nLogged Edition ${beat.editionN} to daily_read_log (status=${status})`);
  } else {
    console.log(`\n[DRY-RUN] Would log Edition ${beat.editionN} to daily_read_log (status=${status})`);
    console.log(`  tweet_id: ${rootId}`);
    console.log(`  email_sent: ${emailSent}`);
    console.log(`  thesis: ${beat.thesis}`);
  }

  // arc-day-n-publishing P1 (design spec §3.6): queue the SAME-edition blog-publish task via
  // the shared blog-render module — one read = one blog post = one thread. Only for a full
  // (non-minimal) edition that actually shipped or partially shipped (something real to
  // mirror), only when DAYN_MERGED is on, and only once per edition (blog_slug column doubles
  // as the "already queued" guard, so a resumed/retried run never double-queues it).
  if (!beat.isMinimal && status !== "void") {
    const gateDb = getDb();
    const merged = isDaynMergedEnabled(gateDb);
    const already = gateDb.query("SELECT blog_slug FROM daily_read_log WHERE edition_n = ?").get(beat.editionN) as { blog_slug: string | null } | null;
    if (dryRun) {
      console.log(`[DRY-RUN] Would check DAYN_MERGED (currently ${merged ? "ON" : "off"}) and ${merged ? "queue" : "skip queuing"} a blog-publish task for edition ${beat.editionN}.`);
    } else if (merged && !already?.blog_slug) {
      const blogSlug = `${postedAt.slice(0, 10)}-day-${beat.editionN}-${beat.findingSlug ?? "read"}`;
      const built = buildBlogPublishTask({
        slug: blogSlug,
        title: `Day ${beat.editionN} — ${beat.thesis.slice(0, 80)}`,
        sourceArtifactPath: join(MATERIALS_DIR, `edition-${beat.editionN}.json`),
        extraContext: `This is a Day-N merged unit (arc-day-n-publishing P1) — mirror the SAME finding + thread just posted (edition ${beat.editionN}${tweetUrl ? `, tweet ${tweetUrl}` : ""}). Do not draft a separate, independent narrative — one story, one number, one edition.`,
      });
      const { insertTaskDeduped } = await import("../../src/db.ts");
      const blogTaskId = insertTaskDeduped({
        subject: built.subject,
        description: built.description,
        skills: JSON.stringify(built.skills),
        priority: built.priority,
        model: built.model,
        source: sourceKey(beat.editionN, "blog"),
      });
      if (blogTaskId) {
        gateDb.run("UPDATE daily_read_log SET blog_slug = ? WHERE edition_n = ?", [blogSlug, beat.editionN]);
        console.log(`Queued blog-publish task (id=${blogTaskId}, slug=${blogSlug}) — one read = one blog post = one thread.`);
      } else {
        console.log(`Blog-publish task not queued (duplicate source/subject) — slug ${blogSlug} may already be handled.`);
      }
    } else if (!merged) {
      console.log("DAYN_MERGED is off — not queuing a blog-publish task (pre-merge behavior unchanged).");
    } else {
      console.log(`Edition ${beat.editionN} already has a blog-publish task queued (blog_slug=${already?.blog_slug}) — not queuing a second one.`);
    }
    gateDb.close();
  }

  console.log("\n=== Complete ===");
  console.log(`Status: ${status}${usedNeverSkipFallback ? ` (NEVER-SKIP fallback fired: ${fallbackReason})` : ""}`);
  console.log(`Amplification: ${emailSent ? "email sent to operator" : "not sent — dead reach expected"}`);
  console.log(`Organic baseline: 51 followers (P2, 2026-06-27)`);
  console.log(`Reach proof status: CARRIED FORWARD (target ≥10 consecutive beats — see daily_read_log)`);
}

async function cmdStatus() {
  const db = getDb();
  const rows = db.query(
    "SELECT edition_n, posted_at, thesis_carried, amplification_email_sent, tweet_id, status, blog_slug FROM daily_read_log ORDER BY edition_n DESC LIMIT 5"
  ).all() as any[];
  const streak = computeStreak(db);
  const merged = isDaynMergedEnabled(db);
  db.close();

  const cap = checkCap();

  console.log("=== Arc Daily Read — Status ===");
  console.log(`Next edition: ${getEditionN()}`);
  console.log(`Today's tweet count: ${cap.todayCount}/${cap.cap} (${cap.slotsRemaining} slots remaining)`);
  console.log(`Kill switch: ${cap.killSwitch ? "ACTIVE" : "inactive"}`);
  console.log(`Today posted: ${alreadyPostedToday()}`);
  // arc-day-n-publishing P1 (design spec §3.3/§3.6): public streak (status-derived, not a raw
  // PK count — see computeStreak) and the DAYN_MERGED rollout toggle (agent_config, instant
  // single-value rollback lever, §4).
  console.log(`Public streak (consecutive shipped/partial editions): ${streak}`);
  console.log(`"Daily" word allowed in copy: ${canUseDailyWord(streak) ? "YES" : `no (needs streak ≥ ${DAILY_WORD_STREAK_THRESHOLD})`}`);
  console.log(`DAYN_MERGED (merged unit + blog-task queuing): ${merged ? "ON" : "off"}`);
  console.log(`\nRecent beats:`);
  if (rows.length === 0) {
    console.log("  No beats yet. Edition 1 pending.");
  } else {
    rows.forEach((r) => {
      console.log(`  Edition ${r.edition_n} | status: ${r.status ?? "shipped"} | posted: ${r.posted_at ?? "not yet"} | email: ${r.amplification_email_sent ? "sent" : "not sent"} | tweet: ${r.tweet_id ?? "n/a"} | blog: ${r.blog_slug ?? "n/a"}`);
    });
  }
  console.log(`\nReach-proof carry-forward target: ≥10 consecutive beats at UTC 13:00`);
  console.log(`Confirm condition: ≥15 net followers + ≥1 external RT within 7 days of Edition 1`);
  console.log(`Refute condition: <5 net followers after 10 beats with ≥1 operator amplification fired`);
  console.log(`P2 baseline: 51 followers (2026-06-27), 0 external engagement`);
}

// ---------- Main ----------

function argValue(flag: string): string | undefined {
  const argIndex = process.argv.indexOf(flag);
  return argIndex !== -1 ? process.argv[argIndex + 1] : undefined;
}

const command = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
const voiceFileArg = argValue("--voice-file");
const editionArg = argValue("--edition");
const editionOverride = editionArg ? parseInt(editionArg, 10) : undefined;
// arc-day-n-publishing P1 (design spec §3.4): explicit test hook to prove the never-skip
// minimal-edition path on demand, rather than relying on an organic failure to demonstrate it.
const simulateFailure = process.argv.includes("--simulate-failure");

switch (command) {
  case "chart":
    await cmdChart();
    break;
  case "materials":
    await cmdMaterials(dryRun, editionOverride);
    break;
  case "compose":
    await cmdCompose(dryRun, voiceFileArg);
    break;
  case "post":
    await cmdPost(dryRun, voiceFileArg, simulateFailure);
    break;
  case "status":
    await cmdStatus();
    break;
  default:
    console.log("Usage: bun cli.ts <chart|materials|compose|post|status> [--dry-run] [--voice-file <path>] [--edition N] [--simulate-failure]");
    console.log("  chart              Show real-data ASCII chart from distilled_artifacts");
    console.log("  materials          (P1) Deterministic findings-first brief for the LLM voice pass to draft from");
    console.log("  compose            Show the composed 4-tweet beat (requires --voice-file, the LLM-authored draft)");
    console.log("  post               Post the daily beat (use --dry-run to simulate; requires a voice draft, see 'materials')");
    console.log("  post --simulate-failure   (P1) Force the never-skip 1-tweet minimal-edition path, for verification");
    console.log("  status             Show edition log, streak, DAYN_MERGED state, and cap state");
    process.exit(1);
}
