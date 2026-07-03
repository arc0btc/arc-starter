#!/usr/bin/env bun
// skills/arc-daily-read/cli.ts
// Arc's Daily Read — P3 of arc-demand-distribution quest.
// Real-data chart + daily named first-person beat + amplification email hook.
// NO decorative AI art. Chart = SQL query on distilled_artifacts. Zero image generation.

import { Database } from "bun:sqlite";
import { join } from "path";

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
    } catch (err) {
      const msg = String(err);
      if (!msg.includes("duplicate column")) throw err;
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

/** Round-robin select the next unused relevance-4/5 finding, crown jewels first. */
function selectFinding(db: Database): Finding | null {
  const usedRows = db.query(
    "SELECT finding_slug FROM daily_read_log WHERE finding_slug IS NOT NULL"
  ).all() as { finding_slug: string }[];
  const used = new Set(usedRows.map((r) => r.finding_slug));

  const candidates = parseIndexCandidates();
  if (candidates.length === 0) return null;

  const rank = (row: IndexRow): number => {
    const crownIdx = CROWN_JEWEL_SLUGS.indexOf(row.slug);
    if (crownIdx !== -1) return crownIdx; // 0-4, highest priority
    return 100 - row.relevance; // relevance 5 -> 95, relevance 4 -> 96 (lower = higher priority)
  };
  const ordered = [...candidates].sort((a, b) => rank(a) - rank(b));

  // Prefer unused; if every candidate has been used, wrap around (don't stall the composer).
  const unused = ordered.filter((r) => !used.has(r.slug));
  const pool = unused.length > 0 ? unused : ordered;

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

  const ctaLine = [
    `Follow ${X_HANDLE} for the daily beat.`,
    ``,
    `Free room for Stacks builders who want to feed agents real signal: ${FREE_ROOM_URL}`,
    ``,
    `No pitch. Just the signal.`,
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
 * P1: composeBeat now REQUIRES an LLM-authored voice draft for tweets 1-3 (the findings-first
 * lede + so-what + continuity). Tweet 4 (footer/CTA) is always assembled deterministically here
 * in code from the materials brief — never LLM-authored — so the stats + free-room link can
 * never drift or be hallucinated. This function does not call an LLM; it validates a draft that
 * was authored elsewhere (the dispatch-cycle LLM turn, gated by SOUL.md).
 */
function composeBeat(voiceDraft: VoiceDraft, editionOverride?: number): Beat {
  const brief = composeMaterials(editionOverride);

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
  const tweet4 = [
    `${brief.statsFooter.totalArtifacts} research passes in my pipeline this cycle (${brief.statsFooter.thisWeekCount} this week, ${brief.statsFooter.sparklineText}). Full beat: Arc's Daily Read — Edition ${brief.editionN}.`,
    ``,
    brief.ctaLine,
  ].join("\n").slice(0, 240);

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

function checkCap(): CapStatus {
  const db = new Database(DB_PATH, { readonly: true });

  // Kill switch check
  const ksRow = db.query("SELECT value FROM agent_config WHERE key = 'outbound_enabled'").get() as { value: string } | null;
  const killSwitch = ksRow?.value === "false";

  // Daily tweet count
  const countRow = db.query(
    "SELECT COUNT(*) as n FROM x_post_log WHERE date(posted_at) = date('now')"
  ).get() as { n: number };

  db.close();

  const DAILY_TWEET_CAP = 6;
  const todayCount = countRow.n;
  const slotsRemaining = DAILY_TWEET_CAP - todayCount;
  const TWEETS_PER_BEAT = 4;

  return {
    allowed: !killSwitch && slotsRemaining >= TWEETS_PER_BEAT,
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
    console.error(`X post failed (source: ${source}): ${stderr}`);
    return null;
  }

  // Parse tweet ID from output
  const match = stdout.match(/tweet_id[:\s]+(\d+)/i) || stdout.match(/"id":\s*"(\d+)"/);
  const tweetId = match?.[1] ?? null;
  console.log(`  Posted ${source}: tweet_id=${tweetId ?? "unknown"}`);
  return tweetId;
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
        html: htmlBody,
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
    `INSERT OR REPLACE INTO daily_read_log
     (edition_n, beat_source, tweet_id, root_tweet_url, thesis_carried, what_got_wrong,
      chart_data, amplification_email_sent, amplification_email_sent_at, organic_reach_snapshot, posted_at,
      finding_slug, opening_line)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      editionN,
      `daily-read:${editionN}`,
      tweetId,
      tweetUrl,
      beat.thesis,
      null, // what_got_wrong is set on the NEXT beat, looking back
      JSON.stringify(beat.chartData),
      emailSent ? 1 : 0,
      emailSent ? new Date().toISOString() : null,
      JSON.stringify({ follower_count_at_post: 51 }), // P2 baseline; updated when live X pull is available
      postedAt,
      beat.findingSlug,
      beat.openingLine,
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
  const voiceDraft = loadVoiceDraft(voiceFilePath);
  const beat = composeBeat(voiceDraft);

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

  // Kill switch + cap check — fully deterministic, unchanged by the P1 voice-pass rework.
  const cap = checkCap();
  if (cap.killSwitch) {
    console.log("HALTED: kill switch active (outbound_enabled=false)");
    process.exit(0);
  }
  if (!cap.allowed) {
    console.log(`DEFERRED: cap exhausted or insufficient slots (${cap.slotsRemaining} remaining, need 4)`);
    console.log(`Today's tweets: ${cap.todayCount}/${cap.cap}`);
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
    const voiceDraft = loadVoiceDraft(voiceFilePath);
    beat = composeBeat(voiceDraft);
  } catch (err) {
    if (err instanceof VoiceDraftValidationError) {
      console.log(`DEFERRED: voice draft failed validation — ${err.message}`);
      process.exit(0);
    }
    throw err;
  }
  const postedAt = new Date().toISOString();

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
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
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
