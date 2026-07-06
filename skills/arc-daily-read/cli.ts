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
import { releaseGroupRemainder } from "../social-engine/admission.ts";

const ARC_STARTER_ROOT = join(import.meta.dir, "../../");
// P1 (arc-demand-flywheel): env override lets verification/testing point at a scratch copy
// of the DB without ever touching the live daily_read_log. Defaults to the real path — zero
// behavior change in production.
const DB_PATH = process.env.DAILY_READ_DB_PATH ?? join(ARC_STARTER_ROOT, "db/arc.sqlite");
const RESEARCH_DIR = join(ARC_STARTER_ROOT, "research");
const INDEX_PATH = join(RESEARCH_DIR, "INDEX.md");
const MATERIALS_DIR = join(ARC_STARTER_ROOT, "db/daily-read-materials");
const FREE_ROOM_URL = "https://whop.com/checkout/plan_arGwx0yFBhYOL?a=x-human";
const X_HANDLE = "@arc0btc";

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
  db.run(`
    CREATE TABLE IF NOT EXISTS daily_read_log (
      edition_n INTEGER PRIMARY KEY,
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
  // SQLite has no "ADD COLUMN IF NOT EXISTS" — catch-and-ignore duplicate-column errors,
  // matching this file's existing CREATE TABLE IF NOT EXISTS idempotency style.
  for (const migration of [
    "ALTER TABLE daily_read_log ADD COLUMN finding_slug TEXT",
    "ALTER TABLE daily_read_log ADD COLUMN opening_line TEXT",
  ]) {
    try {
      db.run(migration);
    } catch (error) {
      const errorMessage = String(error);
      if (!errorMessage.includes("duplicate column")) throw error;
    }
  }

  return db;
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
  ).all([ordered.length]) as { finding_slug: string }[];
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
  ).all([n]) as { opening_line: string }[];
  return rows.map((r) => r.opening_line);
}

// ---------- Beat composition ----------

interface Beat {
  tweets: string[];
  editionN: number;
  thesis: string;
  chartData: ChartData;
  findingSlug: string | null;
  openingLine: string | null;
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
  ctaLine: string;
  chartData: ChartData;
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
  const ctaLine = [
    `Follow ${X_HANDLE} for the daily beat.`,
    ``,
    `Free room for agent operators who want to feed their agents real signal: ${FREE_ROOM_URL}`,
  ].join("\n");

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

  // Tweet 4: deterministic footer/appendix — stats + CTA, moved OFF the lede per P1 phase goal.
  // Kept terse deliberately: this tweet must also carry the CTA link in the same 240 chars, and
  // the full annotated sparkline text (renderChartText) doesn't fit alongside it — see the
  // ctaLine comment above for the overflow this was fixed from.
  const tweet4 = [
    `${brief.statsFooter.totalArtifacts} research passes in my pipeline, ${brief.statsFooter.thisWeekCount} this week. Edition ${brief.editionN}.`,
    ``,
    brief.ctaLine,
  ].join("\n");
  if (tweet4.length > 240) {
    // Should be unreachable given the fixed-length fields above, but fail loudly rather than
    // silently truncate the CTA link out of the tweet again.
    throw new VoiceDraftValidationError(`deterministic tweet 4 (footer+CTA) exceeds 240 chars (${tweet4.length}) — shorten the footer/CTA template, do not let this silently truncate`);
  }

  return {
    tweets: [tweet1, tweet2, tweet3, tweet4],
    editionN: brief.editionN,
    thesis: brief.finding.hook,
    chartData: brief.chartData, // reuse — avoid a second identical generateChart() DB round-trip
    findingSlug: brief.finding.slug,
    openingLine,
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

  // Parse tweet ID from output
  const match = stdout.match(/tweet_id[:\s]+(\d+)/i) || stdout.match(/"id":\s*"(\d+)"/);
  const tweetId = match?.[1] ?? null;
  console.log(`  Posted ${source}: tweet_id=${tweetId ?? "unknown"}`);
  return tweetId;
}

// ---------- P3 arc-posting-scheduler: atomic whole-beat reservation ----------
//
// Reserves the WHOLE 4-tweet beat (root + reply-2 + reply-3 + cta) as ONE atomic group,
// in daily-read's OWN `lane='daily-read'`, inside its 13:00-14:00 UTC window, BEFORE any
// tweet is sent — replacing the old "check a shared cap, then post 4 times and hope"
// sequence with the same atomic-admission guarantee P2 built for content-calendar.
// Each subsequent `postTweet()` call below drains one already-admitted row via cli.ts's
// pre-admitted-group fast path (source keys match exactly — see cmdPost's callers).
interface ReserveGroupResult {
  ok: boolean;
  reason?: string;
  detail?: string;
  atomicGroupId?: string;
}

async function reserveDailyReadGroup(editionN: number, dryRun: boolean): Promise<ReserveGroupResult> {
  const sources = [
    `daily-read:${editionN}:root`,
    `daily-read:${editionN}:reply-2`,
    `daily-read:${editionN}:reply-3`,
    `daily-read:${editionN}:cta`,
  ];
  if (dryRun) {
    console.log(`  [DRY-RUN] Would reserve-group (lane=daily-read, 13:00-14:00 UTC): ${sources.join(", ")}`);
    return { ok: true, atomicGroupId: "dry-run-atomic-group-id" };
  }

  const args = [
    join(ARC_STARTER_ROOT, "skills/social-x-posting/cli.ts"),
    "reserve-group",
    "--sources", sources.join(","),
    "--thread-ref", sources[0],
    "--lane", "daily-read",
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

  const suggestedQuoteTweet = `My agent Arc just dropped Edition ${editionN} of its Daily Read. ${beat.chartData.totalArtifacts} research passes in the pipeline. Worth a look if you're building on Stacks.`;

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
 * `logBeat` below then only UPDATEs this already-claimed row to finalize it after posting
 * succeeds — it never INSERTs, so a crash after posting but before finalize leaves a detectable
 * claimed-but-unfinalized row (finding_slug set, tweet_id/posted_at NULL) rather than silently
 * allowing a full repost. (A stricter fix — checkpointing per-tweet post state so a crash mid-
 * thread can safely resume — is out of scope for this phase; flagged as a carry-forward.)
 */
function claimEdition(db: Database, editionN: number, findingSlug: string | null, openingLine: string | null): boolean {
  try {
    db.run(
      `INSERT INTO daily_read_log (edition_n, beat_source, finding_slug, opening_line) VALUES (?, ?, ?, ?)`,
      [editionN, `daily-read:${editionN}`, findingSlug, openingLine]
    );
    return true;
  } catch (error) {
    const errorMessage = String(error);
    if (errorMessage.includes("UNIQUE constraint") || errorMessage.includes("PRIMARY KEY")) return false;
    throw error;
  }
}

/** Finalize an already-claimed edition_n row (see claimEdition) with posting results. */
function logBeat(
  db: Database,
  editionN: number,
  beat: Beat,
  tweetId: string | null,
  emailSent: boolean,
  postedAt: string
): void {
  const tweetUrl = tweetId ? `https://x.com/${X_HANDLE.slice(1)}/status/${tweetId}` : null;

  db.run(
    `UPDATE daily_read_log SET
       tweet_id = ?, root_tweet_url = ?, thesis_carried = ?, what_got_wrong = ?,
       chart_data = ?, amplification_email_sent = ?, amplification_email_sent_at = ?,
       organic_reach_snapshot = ?, posted_at = ?
     WHERE edition_n = ?`,
    [
      tweetId,
      tweetUrl,
      beat.thesis,
      null, // what_got_wrong is set on the NEXT beat, looking back
      JSON.stringify(beat.chartData),
      emailSent ? 1 : 0,
      emailSent ? new Date().toISOString() : null,
      JSON.stringify({ follower_count_at_post: 51 }), // P2 baseline; updated when live X pull is available
      postedAt,
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
  console.log(`CTA line (deterministic, do not rewrite the URL): ${brief.ctaLine}`);

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

async function cmdPost(dryRun: boolean, voiceFilePath?: string) {
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

  // P1: no LLM call happens here — this only reads a voice draft file that was authored
  // upstream by the SOUL.md-gated dispatch-cycle LLM turn. If it's missing, DEFER — never
  // silently fall back to the old pipeline-stats template (that would regress the exact
  // problem this phase fixes).
  if (!voiceFilePath) {
    const fs = require("fs");
    const defaultPath = join(MATERIALS_DIR, `edition-${getEditionN()}.draft.json`);
    if (fs.existsSync(defaultPath)) {
      voiceFilePath = defaultPath;
    } else {
      console.log("DEFERRED: no voice draft available — run 'materials' then draft the beat before 'post'");
      console.log(`  expected: ${defaultPath}`);
      process.exit(0);
    }
  }

  let beat: Beat;
  try {
    const editionN = getEditionN();
    const brief = loadMaterialsBrief(join(MATERIALS_DIR, `edition-${editionN}.json`));
    const voiceDraft = loadVoiceDraft(voiceFilePath);
    beat = composeBeat(brief, voiceDraft);
  } catch (err) {
    if (err instanceof VoiceDraftValidationError) {
      console.log(`DEFERRED: voice draft failed validation — ${err.message}`);
      process.exit(0);
    }
    throw err;
  }
  const postedAt = new Date().toISOString();

  // P3 arc-posting-scheduler: reserve the WHOLE 4-tweet beat as ONE atomic group, in
  // daily-read's OWN lane + its 13:00-14:00 UTC window, BEFORE claiming the edition
  // number or sending anything — so a deferred/rejected reservation never burns an
  // edition_n that would then never post. This is now the authoritative cap/window
  // check (replacing the old shared-cap `checkCap().allowed` gate above).
  const reservation = await reserveDailyReadGroup(beat.editionN, dryRun);
  if (!reservation.ok) {
    console.log(`DEFERRED: reserve-group rejected this edition's beat — reason=${reservation.reason}`);
    console.log(`  detail: ${reservation.detail ?? "(none)"}`);
    if (!dryRun) {
      await writeDailyReadDeferState(reservation.reason ?? "reserve_group_failed", reservation.detail);
    }
    process.exit(0);
  }
  console.log(`Reservation OK — atomic_group_id=${reservation.atomicGroupId}`);

  // Claim this edition_n BEFORE posting anything — the linearization point (see claimEdition
  // doc comment). Skipped in --dry-run so test runs never mutate daily_read_log.
  //
  // dev-council/Lamport (P3 fix, CONFIRMED CRITICAL — F1): the ORIGINAL version of this
  // block exited on `!claimed` (or would have propagated an exception) WITHOUT releasing
  // the reservation `reserveDailyReadGroup()` just committed. Because `source_key` is
  // UNIQUE and `getEditionN()` reads `daily_read_log` (untouched by the orphaned
  // `outbound_action` rows), the NEXT tick recomputes the SAME edition N, composes the
  // SAME `daily-read:N:*` keys, and `reserve-group`'s idempotency check finds them
  // already `queued` → `already_exists` → deferred, forever. That is a PERMANENT,
  // self-inflicted starvation of daily-read — the exact failure class this quest exists
  // to kill, reintroduced through this seam. Fix: release the reservation on ANY
  // claim-failure path (`!claimed` OR an exception) before exiting/rethrowing.
  if (!dryRun) {
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
  } else {
    console.log(`[DRY-RUN] Would claim edition ${beat.editionN} in daily_read_log before posting (skipped for dry-run)`);
  }

  console.log(`\nEdition ${beat.editionN} | ${cap.slotsRemaining} slots available`);
  console.log("Posting 4-tweet beat...");

  // Post root
  const rootId = await postTweet(beat.tweets[0], `daily-read:${beat.editionN}:root`, undefined, true, dryRun);

  // Post reply-2
  const reply2Id = await postTweet(beat.tweets[1], `daily-read:${beat.editionN}:reply-2`, rootId ?? undefined, false, dryRun);

  // Post reply-3
  const reply3Id = await postTweet(beat.tweets[2], `daily-read:${beat.editionN}:reply-3`, reply2Id ?? undefined, false, dryRun);

  // Post CTA
  const ctaId = await postTweet(beat.tweets[3], `daily-read:${beat.editionN}:cta`, reply3Id ?? undefined, false, dryRun);

  const tweetUrl = rootId ? `https://x.com/arc0btc/status/${rootId}` : null;

  // Send amplification email (REQUIRED per D4)
  console.log("\nFiring amplification email (D4 — required)...");
  const emailSent = await sendAmplificationEmail(beat.editionN, tweetUrl, beat, dryRun);

  if (!emailSent) {
    console.warn("  Amplification email FAILED — logging: 'shipped without amplification (operator offline) — dead reach expected'");
  }

  // Log the beat
  if (!dryRun) {
    const db = getDb();
    logBeat(db, beat.editionN, beat, rootId, emailSent, postedAt);
    db.close();
    console.log(`\nLogged Edition ${beat.editionN} to daily_read_log`);
  } else {
    console.log(`\n[DRY-RUN] Would log Edition ${beat.editionN} to daily_read_log`);
    console.log(`  tweet_id: ${rootId}`);
    console.log(`  email_sent: ${emailSent}`);
    console.log(`  thesis: ${beat.thesis}`);
  }

  console.log("\n=== Complete ===");
  console.log(`Amplification: ${emailSent ? "email sent to operator" : "not sent — dead reach expected"}`);
  console.log(`Organic baseline: 51 followers (P2, 2026-06-27)`);
  console.log(`Reach proof status: CARRIED FORWARD (target ≥10 consecutive beats — see daily_read_log)`);
}

async function cmdStatus() {
  const db = getDb();
  const rows = db.query(
    "SELECT edition_n, posted_at, thesis_carried, amplification_email_sent, tweet_id FROM daily_read_log ORDER BY edition_n DESC LIMIT 5"
  ).all() as any[];
  db.close();

  const cap = checkCap();

  console.log("=== Arc Daily Read — Status ===");
  console.log(`Next edition: ${getEditionN()}`);
  console.log(`Today's tweet count: ${cap.todayCount}/${cap.cap} (${cap.slotsRemaining} slots remaining)`);
  console.log(`Kill switch: ${cap.killSwitch ? "ACTIVE" : "inactive"}`);
  console.log(`Today posted: ${alreadyPostedToday()}`);
  console.log(`\nRecent beats:`);
  if (rows.length === 0) {
    console.log("  No beats yet. Edition 1 pending.");
  } else {
    rows.forEach((r) => {
      console.log(`  Edition ${r.edition_n} | posted: ${r.posted_at ?? "not yet"} | email: ${r.amplification_email_sent ? "sent" : "not sent"} | tweet: ${r.tweet_id ?? "n/a"}`);
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
    await cmdPost(dryRun, voiceFileArg);
    break;
  case "status":
    await cmdStatus();
    break;
  default:
    console.log("Usage: bun cli.ts <chart|materials|compose|post|status> [--dry-run] [--voice-file <path>] [--edition N]");
    console.log("  chart           Show real-data ASCII chart from distilled_artifacts");
    console.log("  materials       (P1) Deterministic findings-first brief for the LLM voice pass to draft from");
    console.log("  compose         Show the composed 4-tweet beat (requires --voice-file, the LLM-authored draft)");
    console.log("  post            Post the daily beat (use --dry-run to simulate; requires a voice draft, see 'materials')");
    console.log("  status          Show edition log and cap state");
    process.exit(1);
}
