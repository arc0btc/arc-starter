#!/usr/bin/env bun
// skills/arc-article-pipeline/cli.ts
// Arc's Operator-Amplified Long-Form Article Pipeline — P2 of arc-demand-flywheel quest.
//
// Mirrors skills/arc-daily-read/cli.ts's P1 3-step contract (materials -> LLM voice draft ->
// deterministic stage), adapted for long-form: a crown-jewel finding becomes an arc0.me article
// (Arc's own voice) + a long-form X ARTICLE variant in Jason's (@whoabuddy) amplification voice
// — "my agent Arc tested X against its own live code", never undisclosed fronting.
//
// P2 REWORK (2026-07-03, operator correction): the X variant is an X ARTICLE (title + article
// body, ready to paste into X's article composer from @whoabuddy) plus a suggested short
// companion post — NOT a tweet thread. Operator's words: "I thought I was posting X Articles
// from my view as an operator, or whatever would draw more eyes to Arc." The amplification
// email carries the full article draft ready-to-paste.
//
// Every link the pipeline emits is assembled DETERMINISTICALLY (never LLM-authored) and carries
// `?a=wb-amp` — closes the exact class of bug P1 found (a hand-typed CTA silently
// overflowed/truncated a link). The blog leg hands off to Arc's own autonomous blog-publishing
// lane; the X Article leg is delivered to Jason by email and only he posts it, from his own
// account — this pipeline never posts to X and never flips draft:false itself.

import { Database } from "bun:sqlite";
import { join } from "path";
import * as fs from "fs";

const ARC_STARTER_ROOT = join(import.meta.dir, "../../");
const DB_PATH = process.env.ARTICLE_PIPELINE_DB_PATH ?? join(ARC_STARTER_ROOT, "db/arc.sqlite");
const RESEARCH_DIR = join(ARC_STARTER_ROOT, "research");
const INDEX_PATH = join(RESEARCH_DIR, "INDEX.md");
const MATERIALS_DIR = join(ARC_STARTER_ROOT, "db/article-materials");
const DRAFTS_DIR = join(import.meta.dir, "drafts");
const PREVIEW_SITE_DIR = join(ARC_STARTER_ROOT, "db/article-pipeline-preview/site");
const LIVE_SITE_DIR = join(ARC_STARTER_ROOT, "github/arc0btc/arc0me-site");

const ARC0ME_BASE = "https://arc0.me";
const ATTRIBUTION_TAG = "wb-amp";
const FREE_ROOM_URL = `https://whop.com/checkout/plan_arGwx0yFBhYOL?a=${ATTRIBUTION_TAG}`;

// X Article variant constraints — the ONE source of truth. The materials brief embeds the
// object, voiceInstructions interpolate from it, sensor.ts imports it for its task-description
// text (cli.ts's main() is import.meta.main-guarded so the import is side-effect-free), and
// validateXArticle() enforces it — so the drafting LLM's instructions and the validator can
// never silently desync (P2-rework dev-council: hohpe). bodyWordRange's upper bound gets +15%
// enforcement slack (same as the blog leg): "target 1500, hard-reject past 1725" is the full
// contract, documented here rather than hidden in the validator (lamport).
export const X_ARTICLE_CONSTRAINTS = {
  titleMaxChars: 100, // X's article composer title limit
  bodyWordRange: [400, 1500] as [number, number],
  citationWindowChars: 1500, // the file:line proof must land in the first 1500 chars (~ the first two paragraphs)
  companionMaxChars: 240, // leaves headroom for the attached article link in a 280-char post
};

// Same priority list arc-daily-read/cli.ts uses (QUEST.md-named crown jewels), drafted first.
const CROWN_JEWEL_SLUGS = [
  "cost-routing-defaults",
  "agent-memory-hygiene",
  "code-mode-mcp-code-execution",
  "agentic-engineering-discipline",
  "kimi-k2-300-agent-swarm",
];

// Packaged-SKU product URLs, keyed by the report front-matter's `product_id:` field. Only one
// research-sourced SKU is packaged today (P0 finding, 2026-07-03) — extend this map as P3 ships
// more so an article on a packaged topic can CTA straight to the paid deep-dive.
const PACKAGED_PRODUCT_URLS: Record<string, string> = {
  prod_iRxuQeieW4RCm: "https://whop.com/the-loop-graded",
};

// Rotation-window opening styles (kept distinct from arc-daily-read's tweet-length INTRO_STYLES
// since long-form openings have more room) — assigned per article so 3+ consecutive pieces don't
// read as the same template.
const INTRO_STYLES = [
  "lead-with-the-measured-number — state the hook's concrete number/claim in sentence one",
  "lead-with-the-citation — open on the file:line and what it proves before the narrative",
  "lead-with-the-gap — name what's missing before what exists",
  "lead-with-the-question — open with what Arc is genuinely unsure about",
];

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] [arc-article-pipeline/cli] ${message}`);
}

// ---------- DB bootstrap ----------

function getDb(): Database {
  const db = new Database(DB_PATH);
  db.run("PRAGMA journal_mode=WAL");
  // Carry forward the P1 dev-council fix (kleppmann): a busy_timeout against the VM's
  // continuously-writing dispatch loop, so a concurrent writer waits instead of throwing.
  db.run("PRAGMA busy_timeout=5000");

  db.run(`
    CREATE TABLE IF NOT EXISTS article_queue_log (
      article_n INTEGER PRIMARY KEY,
      finding_slug TEXT,
      post_id TEXT,
      status TEXT NOT NULL DEFAULT 'materials',
      hook TEXT,
      file_line TEXT,
      x_variant_path TEXT,
      preview_url TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      staged_at TEXT,
      email_sent_at TEXT
    )
  `);
  // P2-rework dev-council fix (kleppmann F1 / hohpe #1 / lamport #1): idempotency marker for
  // the one irreversible side effect (the amplification email), so a crash-resume never
  // re-sends. Additive, idempotent migration for pre-existing DBs (ALTER throws if the column
  // exists — swallowed deliberately).
  try {
    db.run("ALTER TABLE article_queue_log ADD COLUMN email_sent_at TEXT");
  } catch {
    // column already exists
  }

  return db;
}

// ---------- Finding selection (duplicated from arc-daily-read/cli.ts's parseIndexCandidates()/
// extractFindingMaterials() — that file's own doc comment cites "rule of three, only consumer
// so far" as the reason it wasn't extracted to a shared module. This is now a second consumer;
// flagged for dev-council as a candidate to extract into a shared research/index-parser module
// if a third consumer ever appears. Kept independent for now so a fix to one composer's
// selection logic can't silently change the other's rotation. ----------

interface IndexRow {
  relevance: number;
  reportFile: string;
  slug: string;
  packaged: boolean;
}

interface Finding {
  slug: string;
  reportFile: string;
  title: string;
  hook: string;
  fileLine: string;
  packagedProductUrl: string | null;
}

function parseIndexCandidates(): IndexRow[] {
  const text = fs.readFileSync(INDEX_PATH, "utf-8");
  const lines = text.split("\n");
  const startIdx = lines.findIndex((l) => l.trim() === "## All catalogued reports");
  if (startIdx === -1) return [];

  const rows: IndexRow[] = [];
  // Row shape: | relevance | topics | repos | sku? | packaged? | fetched | [title](path) |
  const rowRe = /^\|\s*(\d+)\s*\|.*\|\s*(y|n)\s*\|\s*[\d.TZ:-]*\s*\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*$/;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## ")) break;
    const m = line.match(rowRe);
    if (!m) continue;
    const relevance = parseInt(m[1], 10);
    if (relevance < 4) continue;
    const packaged = m[2] === "y";
    const reportFile = m[4];
    if (!reportFile.endsWith(".md")) continue;
    const slug = reportFile.replace(/^\d{4}-\d{2}-\d{2}T[\d:-]+Z_/, "").replace(/\.md$/, "");
    rows.push({ relevance, reportFile, slug, packaged });
  }
  return rows;
}

function extractFindingMaterials(reportFile: string): { title: string; hook: string; fileLine: string; packagedProductUrl: string | null } | null {
  // P2-rework dev-council fix (newman #3): findingFromRow passes "" when a staged article's
  // finding has rotated out of INDEX.md — join(RESEARCH_DIR, "") is RESEARCH_DIR itself, which
  // exists, so readFileSync threw an opaque EISDIR on exactly the recovery commands
  // (hand-off/rework-x). Degrade to null instead (packagedProductUrl becomes null downstream).
  if (!reportFile) return null;
  const p = join(RESEARCH_DIR, reportFile);
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, "utf-8");

  const titleMatch = text.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : reportFile;

  let hook = "";
  const tldrIdx = text.search(/^##\s+TL;DR/m);
  if (tldrIdx !== -1) {
    const sectionEnd = text.indexOf("\n## ", tldrIdx + 1);
    const section = text.slice(tldrIdx, sectionEnd === -1 ? undefined : sectionEnd);
    const bulletMarkerRe = /^(?:-|\d+\.)\s+/;
    const blocks = section.split(/\n(?=(?:-|\d+\.)\s)/);
    for (const block of blocks) {
      if (!bulletMarkerRe.test(block)) continue;
      const fullBullet = block.replace(bulletMarkerRe, "").replace(/\s+/g, " ").trim();
      if (/\*\*[^*]+\*\*/.test(fullBullet) || fullBullet.length > 40) {
        hook = fullBullet;
        break;
      }
    }
    if (!hook && section.trim()) {
      // TL;DR is prose, not bullets (e.g. a single paragraph) — take the first sentence-ish chunk.
      const prose = section.replace(/^##\s+TL;DR\s*/i, "").trim();
      if (prose) hook = prose.split(/\n\n/)[0].replace(/\s+/g, " ").trim();
    }
  }
  if (!hook) {
    const skuWhyMatch = text.match(/^sku_why:\s*"?(.+?)"?\s*$/m);
    if (skuWhyMatch) hook = skuWhyMatch[1].trim();
  }
  if (!hook) return null;

  const fileLineMatch = text.match(/`([\w./-]+\.(?:ts|tsx|js|md|json)):(\d+(?:-\d+)?)`/);
  if (!fileLineMatch) return null;
  const fileLine = `${fileLineMatch[1]}:${fileLineMatch[2]}`;

  let packagedProductUrl: string | null = null;
  const packagedMatch = text.match(/^packaged:\s*y/m);
  const productIdMatch = text.match(/^product_id:\s*(\S+)/m);
  if (packagedMatch && productIdMatch) {
    packagedProductUrl = PACKAGED_PRODUCT_URLS[productIdMatch[1]] ?? null;
  }

  return { title, hook, fileLine, packagedProductUrl };
}

/**
 * Round-robin select the next unused relevance-4/5 finding, crown jewels first, using a
 * rotation WINDOW (not an "ever used" set) — same fixed-point bug arc-daily-read's dev-council
 * pass (Lamport) caught and fixed: an "ever used" set collapses to always-the-first-candidate
 * once every candidate has appeared once.
 */
function selectFinding(db: Database, slugOverride?: string): Finding | null {
  const candidates = parseIndexCandidates();
  if (candidates.length === 0) {
    console.error("selectFinding: research/INDEX.md parse yielded 0 relevance-4/5 candidates — check for a format change.");
    return null;
  }

  if (slugOverride) {
    const row = candidates.find((r) => r.slug === slugOverride);
    if (!row) {
      console.error(`selectFinding: --slug ${slugOverride} not found among relevance-4/5 candidates.`);
      return null;
    }
    const materials = extractFindingMaterials(row.reportFile);
    if (!materials) {
      console.error(`selectFinding: --slug ${slugOverride} has no usable hook/citation — cannot use as an override.`);
      return null;
    }
    return { slug: row.slug, reportFile: row.reportFile, ...materials };
  }

  const rank = (row: IndexRow): number => {
    const crownIdx = CROWN_JEWEL_SLUGS.indexOf(row.slug);
    if (crownIdx !== -1) return crownIdx;
    return 100 - row.relevance;
  };
  const ordered = [...candidates].sort((a, b) => rank(a) - rank(b));

  const recentRows = getRecentSlugRows(db, ordered.length);
  const recentlyUsed = new Set(recentRows);

  let pool = ordered.filter((r) => !recentlyUsed.has(r.slug));
  if (pool.length === 0) {
    // P2 dev-council fix (lamport): the original fallback excluded only the single
    // most-recent slug, which for a small candidate pool (e.g. N=3) produces a repeat at
    // gap=2 (…A,_,A,_…) — well inside one rotation cycle, not the "no repeat within a full
    // cycle" property the design intends. Shrink the exclusion window progressively from
    // the full recent history down to 1 until a candidate survives, instead of jumping
    // straight to "exclude only the last one."
    for (let k = recentRows.length; k >= 1; k--) {
      const excludeSet = new Set(recentRows.slice(0, k));
      const candidatePool = ordered.filter((r) => !excludeSet.has(r.slug));
      if (candidatePool.length > 0) {
        pool = candidatePool;
        break;
      }
    }
    if (pool.length === 0) pool = ordered; // only one candidate exists at all
  }

  for (const row of pool) {
    const materials = extractFindingMaterials(row.reportFile);
    if (!materials) continue; // no real citation available — never ship a placeholder
    return { slug: row.slug, reportFile: row.reportFile, ...materials };
  }
  return null;
}

function getArticleN(db: Database): number {
  const row = db.query("SELECT MAX(article_n) as max_n FROM article_queue_log").get() as { max_n: number | null };
  return (row?.max_n ?? 0) + 1;
}

/**
 * P2 dev-council fix (hohpe): `selectFinding()`'s rotation exclusion and the materials brief's
 * `avoidSlugs` (informational, shown to the drafting LLM) were computed via two independently
 * sized queries (rotation used `ordered.length`, avoidSlugs used a hardcoded 5) — a dual
 * source of truth for "recent" that could disagree (for small candidate pools, avoidSlugs
 * could be WIDER than the rotation's actual exclusion, so `validateDraft()`'s avoidSlugs check
 * could reject a finding `selectFinding()` legitimately, correctly chose). Both callers now
 * share this one function with the same window size (the live candidate count), so the two
 * checks can no longer diverge.
 */
function getRecentSlugRows(db: Database, windowSize: number): string[] {
  const rows = db.query(
    "SELECT finding_slug FROM article_queue_log WHERE finding_slug IS NOT NULL ORDER BY article_n DESC LIMIT ?"
  ).all([windowSize]) as { finding_slug: string }[];
  return rows.map((r) => r.finding_slug);
}

function chooseIntroStyle(articleN: number): string {
  return INTRO_STYLES[articleN % INTRO_STYLES.length];
}

// ---------- Materials brief ----------

interface MaterialsBrief {
  articleN: number;
  finding: Finding | null;
  introStyle: string;
  avoidSlugs: string[];
  attributionTag: string;
  freeRoomUrl: string;
  targetWordRange: [number, number];
  xArticleConstraints: typeof X_ARTICLE_CONSTRAINTS;
  voiceInstructions: { blog: string; xArticle: string };
}

function composeMaterials(articleOverride?: number, slugOverride?: string): MaterialsBrief {
  const db = getDb();
  const articleN = articleOverride ?? getArticleN(db);
  const finding = selectFinding(db, slugOverride);
  const introStyle = chooseIntroStyle(articleN);
  // Same window size selectFinding() uses internally (candidate count) — see
  // getRecentSlugRows()'s doc comment (hohpe P2 fix) for why this must not be a different
  // hardcoded number.
  const candidateCount = Math.max(parseIndexCandidates().length, 1);
  const avoidSlugs = getRecentSlugRows(db, candidateCount);
  db.close();

  return {
    articleN,
    finding,
    introStyle,
    avoidSlugs,
    attributionTag: ATTRIBUTION_TAG,
    freeRoomUrl: FREE_ROOM_URL,
    targetWordRange: [700, 1800],
    xArticleConstraints: X_ARTICLE_CONSTRAINTS,
    voiceInstructions: {
      blog: [
        "Arc's own first-person voice, SOUL.md-gated (read ~/arc-starter/SOUL.md before drafting).",
        "Lead with the finding's measured hook AND its file:line citation in the first ~2",
        "paragraphs — this is the lede, not background. Then the 'so what' (what it means for",
        "an agent operator), then the honest gap or open question (SOUL.md: 'I'll admit when I",
        "don't know something'). Do NOT include any CTA, URL, or sign-off — 'stage' appends",
        "those deterministically. No em dashes, no 'Not X. It's Y.' constructions, no banned",
        "openers ('Here's the thing', 'It turns out'), active voice, kill adverbs.",
      ].join(" "),
      // Numbers below are interpolated from X_ARTICLE_CONSTRAINTS — never hand-typed — so the
      // instruction the LLM reads and the validator that judges the result share one source
      // (P2-rework dev-council: hohpe).
      xArticle: [
        "NOT Arc's voice — this is Jason's (@whoabuddy) amplification voice, writing a",
        "long-form X ARTICLE (X's article composer), NOT a tweet thread: first person Jason,",
        "explicitly crediting/quoting Arc throughout ('my agent Arc tested X against its own",
        "live code...' / 'Arc found...'). Never write as if Jason did the technical work",
        "himself, never impersonate Arc; where Arc's own words are quoted they must pass Arc's",
        "SOUL.md voice rules. The measured hook + the file:line citation ('tested against a",
        `live agent') must land within the first ${X_ARTICLE_CONSTRAINTS.citationWindowChars}`,
        "characters (roughly the first two paragraphs) — proof up front, not buried.",
        "body: plain paragraphs separated by blank lines,",
        `${X_ARTICLE_CONSTRAINTS.bodyWordRange[0]}-${X_ARTICLE_CONSTRAINTS.bodyWordRange[1]} words;`,
        "NO markdown syntax (X's composer renders none of it — no #, ##, **, backticks, or",
        "[links]); short bold-free section labels on their own line are fine. title: a",
        `compelling, specific claim, <=${X_ARTICLE_CONSTRAINTS.titleMaxChars} chars.`,
        "companionPost: the short post Jason pairs with the article share",
        `(<=${X_ARTICLE_CONSTRAINTS.companionMaxChars} chars, the article link gets attached`,
        "by X when he posts). Do NOT include any CTA or URL anywhere in",
        "title/body/companionPost — 'stage' appends a deterministic tagged closing. Vary the",
        "rhetorical shape from other staged articles' variants.",
      ].join(" "),
    },
  };
}

class DraftValidationError extends Error {}

function loadMaterialsBrief(path: string): MaterialsBrief {
  if (!fs.existsSync(path)) {
    throw new DraftValidationError(`no materials brief at ${path} — run 'materials' first for this article number`);
  }
  return JSON.parse(fs.readFileSync(path, "utf-8"));
}

interface XArticleDraft {
  title: string;
  body: string;
  companionPost: string;
}

interface ArticleDraft {
  blogTitle: string;
  blogBody: string;
  xArticle: XArticleDraft;
}

function parseXArticleDraft(raw: unknown, where: string): XArticleDraft {
  const x = raw as Record<string, unknown> | null | undefined;
  if (!x || typeof x !== "object") {
    throw new DraftValidationError(`draft at ${where}: missing xArticle object ({ title, body, companionPost }) — the X variant is an X Article now, not a tweet thread`);
  }
  for (const field of ["title", "body", "companionPost"] as const) {
    if (typeof x[field] !== "string" || !(x[field] as string).trim()) {
      throw new DraftValidationError(`draft at ${where}: missing/empty xArticle.${field}`);
    }
  }
  return { title: (x.title as string).trim(), body: (x.body as string).trim(), companionPost: (x.companionPost as string).trim() };
}

function loadDraft(path: string): ArticleDraft {
  const raw = JSON.parse(fs.readFileSync(path, "utf-8"));
  if (typeof raw.blogTitle !== "string" || !raw.blogTitle.trim()) {
    throw new DraftValidationError(`draft at ${path}: missing/empty blogTitle`);
  }
  if (typeof raw.blogBody !== "string" || !raw.blogBody.trim()) {
    throw new DraftValidationError(`draft at ${path}: missing/empty blogBody`);
  }
  return { blogTitle: raw.blogTitle, blogBody: raw.blogBody, xArticle: parseXArticleDraft(raw.xArticle, path) };
}

// ---------- Validation ----------

// No /g flag — .test() with a global regex carries lastIndex state between calls, which the
// original code managed with hand-placed resets after every use. Boolean containment is all
// these checks need; dropping the flag removes the whole discipline-dependent failure class
// (P2-rework dev-council: lamport #8, newman #6).
const RAW_URL_RE = /https?:\/\/(?:[\w-]+\.)?(?:arc0\.me|whop\.com)/i;
// The X Article contract is stronger than the blog one: NO LLM-authored URL of any kind (the
// deterministic closing is appended after validation, so the validator never needs to tolerate
// the pipeline's own links) — not just untagged arc0.me/whop links (lamport #4).
const ANY_URL_RE = /https?:\/\//i;

function validateDraft(brief: MaterialsBrief, draft: ArticleDraft): string[] {
  const errors: string[] = [];
  const finding = brief.finding;
  if (!finding) {
    errors.push("brief has no finding — cannot validate");
    return errors;
  }

  const wordCount = draft.blogBody.trim().split(/\s+/).length;
  const [minW, maxW] = brief.targetWordRange;
  if (wordCount < minW || wordCount > maxW * 1.15) {
    errors.push(`blogBody word count ${wordCount} outside acceptable range [${minW}, ${Math.round(maxW * 1.15)}]`);
  }

  if (!draft.blogBody.includes(finding.fileLine)) {
    errors.push(`blogBody does not contain the required citation "${finding.fileLine}" verbatim`);
  }

  if (RAW_URL_RE.test(draft.blogBody)) {
    errors.push("blogBody contains a hand-authored arc0.me/whop.com URL — links must be appended deterministically by 'stage', not drafted");
  }

  errors.push(...validateXArticle(finding, draft.xArticle));

  const recentSlugSet = new Set(brief.avoidSlugs);
  if (recentSlugSet.has(finding.slug)) {
    errors.push(`finding "${finding.slug}" was staged in the recent rotation window — selection should have avoided a repeat`);
  }

  return errors;
}

/**
 * X Article validation, shared by `stage` (full-draft path) and `rework-x` (regenerate the X
 * variant for an already-staged article). Enforces the same X_ARTICLE_CONSTRAINTS the materials
 * brief advertises to the drafting LLM.
 */
function validateXArticle(finding: Finding, x: XArticleDraft): string[] {
  const errors: string[] = [];
  const { titleMaxChars, bodyWordRange, citationWindowChars, companionMaxChars } = X_ARTICLE_CONSTRAINTS;

  if (x.title.length > titleMaxChars) {
    errors.push(`xArticle.title is ${x.title.length} chars, exceeds X's ${titleMaxChars}-char article title limit`);
  }
  if (/[\r\n\u2028\u2029]/.test(x.title)) {
    errors.push("xArticle.title contains a line break — must be a single line");
  }

  const bodyWords = x.body.trim().split(/\s+/).length;
  const [minW, maxW] = bodyWordRange;
  if (bodyWords < minW || bodyWords > Math.round(maxW * 1.15)) {
    errors.push(`xArticle.body word count ${bodyWords} outside acceptable range [${minW}, ${Math.round(maxW * 1.15)}]`);
  }

  const citationIdx = x.body.indexOf(finding.fileLine);
  if (citationIdx === -1) {
    errors.push(`xArticle.body does not contain the required citation "${finding.fileLine}" verbatim`);
  } else if (citationIdx > citationWindowChars) {
    errors.push(`xArticle.body buries the citation "${finding.fileLine}" at char ${citationIdx} — the "tested against a live agent" proof must land in the first ${citationWindowChars} chars`);
  }

  // X's article composer renders no markdown — pasted syntax shows up as literal characters.
  // Backticks are checked too (P2-rework dev-council: lamport #5, fowler): the file:line
  // citation is extracted FROM a backticked token in the research report, so the drafting LLM
  // copying it verbatim is the single most likely way literal backticks reach the composer.
  if (/^#{1,6}\s/m.test(x.body) || /\*\*[^*\n]+\*\*/.test(x.body) || /\[[^\]\n]+\]\([^)\n]+\)/.test(x.body) || x.body.includes("`")) {
    errors.push("xArticle.body contains markdown syntax (#, **bold**, [](...) or backticks) — X's article composer renders none of it; use plain paragraphs and plain-text citations");
  }

  for (const [field, value] of [["title", x.title], ["body", x.body], ["companionPost", x.companionPost]] as const) {
    if (ANY_URL_RE.test(value)) {
      errors.push(`xArticle.${field} contains a hand-authored URL — every link is appended deterministically by the closing`);
    }
  }

  if (x.companionPost.length > companionMaxChars) {
    errors.push(`xArticle.companionPost is ${x.companionPost.length} chars, exceeds ${companionMaxChars} (headroom for the attached article link)`);
  }

  return errors;
}

// ---------- Deterministic link assembly ----------

function buildBlogClosing(finding: Finding, postId: string): string {
  const lines = [
    "---",
    "",
    `If you're an agent operator: give this to your agent — the free room has real signal, not marketing copy: ${FREE_ROOM_URL}`,
  ];
  if (finding.packagedProductUrl) {
    lines.push("", `Want the graded, packaged version of this topic? [Get it here](${finding.packagedProductUrl}?a=${ATTRIBUTION_TAG}) — tested against a live agent, not a concept note.`);
  }
  lines.push("", "---", "", `*— [arc0.btc](https://arc0.me) · [verify](/blog/${postId}.json)*`, "");
  return lines.join("\n");
}

/**
 * Deterministic closing appended to the X Article body — the only place links appear. Plain
 * text (X's composer auto-links raw URLs; it renders no markdown), written in Jason's framing
 * (he is the one posting the article), crediting Arc explicitly. Every link carries
 * `?a=wb-amp`, code-assembled, never LLM-authored.
 */
function buildXArticleClosing(finding: Finding, postId: string): string {
  const blogUrl = `${ARC0ME_BASE}/blog/${postId}/?a=${ATTRIBUTION_TAG}`;
  const lines = [
    "—",
    "",
    `Arc's original writeup, with every citation: ${blogUrl}`,
    "",
    `If you operate agents: Arc keeps a free room with its raw research feed, real signal, no marketing: ${FREE_ROOM_URL}`,
  ];
  if (finding.packagedProductUrl) {
    lines.push("", `The graded, packaged version of this topic, tested against a live agent: ${finding.packagedProductUrl}?a=${ATTRIBUTION_TAG}`);
  }
  return lines.join("\n");
}

function assembleXArticle(finding: Finding, postId: string, x: XArticleDraft): XArticleDraft & { finalBody: string } {
  return { ...x, finalBody: `${x.body.trim()}\n\n${buildXArticleClosing(finding, postId)}` };
}

// ---------- Mention-map pre-fill (arc-demand-gen P3) ----------
//
// Pre-fills @-mentions for accounts an Article genuinely references, drawn from an
// operator-curated map (social_accounts.mention_candidate=1, aliases in mention_aliases —
// see ops/migrations/2026-07-05-p3-mention-map.ts). MAP-GATED ONLY: an entity not in the map is
// never invented as an @-tag, and an alias that does not literally appear in the drafted text
// produces no mention at all — this is deterministic text-matching against operator-curated
// data, never LLM guessing. Mirrors the existing "never LLM-authored, code-assembled" discipline
// buildXArticleClosing already uses for links.
//
// dev-council (5-lens) reviewed this section against the live diff. Design fixed per unanimous/
// convergent findings: (1) Lamport + Fowler independently proved the original "mutate `result`
// as you go" approach could re-match a JUST-INSERTED "(@handle)" annotation as a fresh
// occurrence of an unrelated alias (e.g. two candidates sharing a nested alias) — detection now
// runs ONLY against the immutable original `text`; insertions are computed as a batch of
// (position, candidate) pairs and applied right-to-left (descending position) so no earlier
// offset ever shifts and no injected text is ever re-scanned. (2) `loadMentionCandidates` now
// orders `ORDER BY id` so candidate order — and therefore which insertions land — is
// deterministic across runs (Fowler, Lamport). (3) Kleppmann + Hohpe: logging moved out of this
// function entirely — `prefillMentions` now returns the matches instead of writing
// `article_mention_log` itself, so the CALLER logs only after `writeXArticleFiles` has durably
// written the article to disk (see cmdStage/cmdReworkX) — the log no longer asserts a mention
// was "surfaced" before the artifact that surfaces it exists. (4) Kleppmann: `recordMentionEvents`
// uses `INSERT OR IGNORE` (a structural idempotency guarantee) instead of string-matching
// "UNIQUE constraint" in a thrown error's message.

interface MentionCandidate {
  accountId: number;
  handle: string;
  aliases: string[];
}

export function loadMentionCandidates(db: Database): MentionCandidate[] {
  const rows = db
    .query(
      "SELECT id, handle, mention_aliases FROM social_accounts WHERE mention_candidate = 1 AND mention_aliases IS NOT NULL ORDER BY id"
    )
    .all() as { id: number; handle: string; mention_aliases: string }[];
  const candidates: MentionCandidate[] = [];
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.mention_aliases);
    } catch {
      log(`WARN: mention_aliases for social_accounts.id=${row.id} (${row.handle}) is not valid JSON — skipping this candidate`);
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    const aliases = parsed.filter((a): a is string => typeof a === "string" && a.trim().length > 0);
    if (aliases.length === 0) continue;
    for (const alias of aliases) {
      if (alias.length < 4) {
        log(`WARN: mention_aliases for social_accounts.id=${row.id} (${row.handle}) includes a short alias "${alias}" — short aliases risk matching unrelated mid-prose text; consider a more specific alias`);
      }
    }
    candidates.push({ accountId: row.id, handle: row.handle, aliases });
  }
  return candidates;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface MentionMatch {
  accountId: number;
  handle: string;
  alias: string;
  field: "body" | "companionPost";
}

/**
 * Case-insensitive whole-word/phrase match of each candidate's aliases against the ORIGINAL
 * `text` only (never against a partially-annotated copy — see the design note above). On the
 * FIRST match of an alias, an insertion of " (@handle)" is scheduled right after that
 * occurrence; insertions are then applied right-to-left so earlier positions (computed against
 * the original string) stay valid. If a candidate's insertion would push the field past
 * `maxLength` (used for companionPost's 240-char X limit), that one insertion is skipped rather
 * than silently blowing the budget the pipeline's own validator enforces. If `@handle` is
 * already present anywhere in `text` (a rework re-run), the candidate is skipped entirely — no
 * double-tag.
 */
export function applyMentionPrefill(
  text: string,
  candidates: MentionCandidate[],
  field: "body" | "companionPost",
  maxLength?: number,
  maxMatches?: number
): { text: string; matches: MentionMatch[] } {
  type Insertion = { at: number; candidate: MentionCandidate; alias: string };
  const insertions: Insertion[] = [];
  for (const candidate of candidates) {
    if (new RegExp(`@${escapeRegExp(candidate.handle)}\\b`, "i").test(text)) continue;
    for (const alias of candidate.aliases) {
      const match = new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i").exec(text);
      if (!match) continue;
      insertions.push({ at: match.index + match[0].length, candidate, alias });
      break; // one insertion per candidate per field — first matching alias wins
    }
  }

  // arc-strategy-panel (washington): curation-completeness pressure should never become a
  // per-article tagging quota. Cap at the first N matches in reading order (ascending
  // position), not an arbitrary subset -- a reader sees the earliest-referenced entities
  // tagged, not a random sample.
  insertions.sort((a, b) => a.at - b.at);
  const capped = maxMatches !== undefined ? insertions.slice(0, Math.max(0, maxMatches)) : insertions;

  // Apply right-to-left: an insertion at a larger offset never invalidates the offset of one
  // computed at a smaller offset against the same original `text`.
  capped.sort((a, b) => b.at - a.at);
  let result = text;
  const matches: MentionMatch[] = [];
  for (const ins of capped) {
    const candidateResult = `${result.slice(0, ins.at)} (@${ins.candidate.handle})${result.slice(ins.at)}`;
    if (maxLength !== undefined && candidateResult.length > maxLength) {
      log(`Mention pre-fill: skipping @${ins.candidate.handle} in ${field} — insertion would exceed the ${maxLength}-char limit`);
      continue;
    }
    result = candidateResult;
    matches.push({ accountId: ins.candidate.accountId, handle: ins.candidate.handle, alias: ins.alias, field });
  }
  matches.reverse(); // restore original (left-to-right) order for readable logs/log rows
  return { text: result, matches };
}

/**
 * Persists mention events. Idempotent via a structural DB guarantee (INSERT OR IGNORE against
 * source_key's UNIQUE constraint), not error-message string-matching — a different UNIQUE
 * violation (e.g. a source_key collision bug) is never silently swallowed as "already logged"
 * because there is nothing to catch; SQLite itself decides whether the row is new.
 */
export function recordMentionEvents(db: Database, articleN: number, matches: MentionMatch[]): void {
  for (const m of matches) {
    const sourceKey = `article-mention:${articleN}:${m.accountId}:${m.field}`;
    db.run(
      `INSERT OR IGNORE INTO article_mention_log (source_key, article_n, account_id, handle, matched_alias, surfaced_in) VALUES (?, ?, ?, ?, ?, ?)`,
      [sourceKey, articleN, m.accountId, m.handle, m.alias, m.field]
    );
  }
}

/**
 * Applies the mention-map to both fields of an X Article draft. Called AFTER validateXArticle
 * (so validation runs against the drafting LLM's authentic text, never against pipeline-inserted
 * annotations) and BEFORE assembleXArticle (so the pre-filled text is what gets written to disk
 * and emailed). Returns the matches for the CALLER to persist via recordMentionEvents() — only
 * after writeXArticleFiles has durably written the article, so the log never asserts a mention
 * was surfaced in an artifact that doesn't yet exist on disk.
 */
// arc-strategy-panel (washington): a hard ceiling on distinct accounts tagged per Article,
// independent of how many candidates are curated -- prevents curation-completeness pressure
// ("we have 6 candidates, so tag all 6 whenever they match") from becoming a tagging quota.
export const MAX_MENTIONS_PER_ARTICLE = 3;

export function prefillMentions(
  db: Database,
  x: XArticleDraft
): { draft: XArticleDraft; matches: MentionMatch[] } {
  const candidates = loadMentionCandidates(db);
  if (candidates.length === 0) return { draft: x, matches: [] };
  const bodyResult = applyMentionPrefill(x.body, candidates, "body", undefined, MAX_MENTIONS_PER_ARTICLE);
  const remainingBudget = MAX_MENTIONS_PER_ARTICLE - bodyResult.matches.length;
  const companionResult = applyMentionPrefill(
    x.companionPost,
    candidates,
    "companionPost",
    X_ARTICLE_CONSTRAINTS.companionMaxChars,
    remainingBudget
  );
  const allMatches = [...bodyResult.matches, ...companionResult.matches];
  if (allMatches.length > 0) {
    log(`Mention pre-fill: ${allMatches.length} @-mention(s): ${allMatches.map((m) => `@${m.handle} (${m.field})`).join(", ")}`);
  }
  return { draft: { title: x.title, body: bodyResult.text, companionPost: companionResult.text }, matches: allMatches };
}

// Atomic single-file write (temp + rename, same discipline ensurePreviewSiteCopy already uses)
// — a crash mid-write can never leave a torn/half-written file for a later JSON.parse to choke
// on (P2-rework dev-council: kleppmann F3).
function writeFileAtomic(path: string, content: string): void {
  const tempFilePath = `${path}.tmp-${process.pid}`;
  fs.writeFileSync(tempFilePath, content);
  fs.renameSync(tempFilePath, path);
}

/**
 * Persist the assembled X Article variant to drafts/ in two forms: a JSON sidecar (the machine
 * source of truth `hand-off` re-reads — no fragile markdown re-parsing; carries BOTH the raw
 * LLM `body` and the assembled `finalBody` so the artifact stays losslessly re-validatable and
 * re-assemblable — kleppmann F4/fowler #1) and a human-readable .md derived from it (the .json
 * is canonical). The .md is written first, the .json last (atomically), so the sidecar's
 * presence implies a complete pair. Returns the .md path (recorded as `x_variant_path`).
 */
function writeXArticleFiles(
  articleN: number,
  finding: Finding,
  postId: string,
  xArticle: XArticleDraft & { finalBody: string }
): string {
  if (!fs.existsSync(DRAFTS_DIR)) fs.mkdirSync(DRAFTS_DIR, { recursive: true });
  const jsonPath = join(DRAFTS_DIR, `article-${articleN}-x-article.json`);
  const sidecarJson = JSON.stringify({
    title: xArticle.title,
    body: xArticle.body,
    finalBody: xArticle.finalBody,
    companionPost: xArticle.companionPost,
    postId,
    findingSlug: finding.slug,
    generatedAt: new Date().toISOString(),
  }, null, 2);

  const mdPath = join(DRAFTS_DIR, `article-${articleN}-x-article.md`);
  const mdContent = [
    `# Article ${articleN} X Article variant — ready to paste into X's article composer, NOT posted`,
    `Finding: ${finding.slug} | Blog post: ${postId} | Voice: @whoabuddy amplifying Arc (quote/credit, never undisclosed fronting)`,
    "",
    `## Title (${xArticle.title.length} chars)`,
    "",
    xArticle.title,
    "",
    "## Article body (plain text — X's composer renders no markdown)",
    "",
    xArticle.finalBody,
    "",
    `## Suggested companion post (${xArticle.companionPost.length} chars — X attaches the article link when posting)`,
    "",
    xArticle.companionPost,
    "",
  ].join("\n");
  writeFileAtomic(mdPath, mdContent);
  writeFileAtomic(jsonPath, sidecarJson);
  return mdPath;
}

// ---------- Claim (linearization, before any side effects) ----------

type ClaimResult = "claimed" | "resume" | "already-staged";

/**
 * P2 dev-council fix (kleppmann/lamport, both flagged this as the top finding): the original
 * design treated ANY existing row as a hard abort ("already claimed, retry-safe abort"). But
 * `status='staging'` is not a terminal state — it means "claimed, side effects in progress OR
 * crashed mid-flight," and the code had no way to tell those apart, permanently wedging an
 * article number if `stage` died between the claim and `finalizeArticle`. Only `status='staged'`
 * is genuinely terminal (finished, do not redo). A `status='staging'` row is now a RESUME
 * signal, not an abort signal — `cmdStage` re-attempts the side effects (createBlogDraft /
 * writeBlogBody / deployPreview are all safe to re-run for the same slug: blog-publishing's
 * `create` warns-and-continues on an existing directory rather than crashing, and the preview
 * build/deploy is naturally idempotent — same content in, same site out).
 */
function claimArticle(db: Database, articleN: number, finding: Finding): ClaimResult {
  const existing = db.query("SELECT status FROM article_queue_log WHERE article_n = ?").get([articleN]) as { status: string } | null;
  if (existing) {
    return existing.status === "staged" ? "already-staged" : "resume";
  }
  try {
    db.run(
      `INSERT INTO article_queue_log (article_n, finding_slug, status, hook, file_line) VALUES (?, ?, 'staging', ?, ?)`,
      [articleN, finding.slug, finding.hook, finding.fileLine]
    );
    return "claimed";
  } catch (error) {
    const errorMessage = String(error);
    // Lost a race against a concurrent claimer between the SELECT above and this INSERT —
    // treat identically to finding it already existed.
    if (errorMessage.includes("UNIQUE constraint") || errorMessage.includes("PRIMARY KEY")) return "resume";
    throw error;
  }
}

function finalizeArticle(db: Database, articleN: number, postId: string, previewUrl: string, xVariantPath: string): void {
  db.run(
    `UPDATE article_queue_log SET status = 'staged', post_id = ?, preview_url = ?, x_variant_path = ?, staged_at = ? WHERE article_n = ?`,
    [postId, previewUrl, xVariantPath, new Date().toISOString(), articleN]
  );
}

// ---------- Shell helpers ----------

async function runCommand(command: string[], cwd: string, env?: Record<string, string>): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(command, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

function slugify(text: string): string {
  // P2 fix (found live, 2026-07-03): the original regex DELETED punctuation instead of
  // replacing it with a separator, so a title containing a file:line citation like
  // "dispatch.ts:137-149" collapsed to the illegible "dispatchts137-149" (dot and colon
  // vanished with no boundary left behind). Convert any run of non-alphanumeric characters
  // to a single hyphen instead, so word boundaries survive.
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function resolveFnmBinDir(): string {
  const whichNpm = Bun.spawnSync(["which", "npm"]);
  if (whichNpm.exitCode === 0) return "";
  const fnmDir = join(process.env.HOME ?? "/root", ".local/share/fnm/node-versions");
  const ls = Bun.spawnSync(["ls", fnmDir]);
  if (ls.exitCode === 0) {
    const versions = ls.stdout.toString().trim().split("\n").filter(Boolean).sort().reverse();
    if (versions[0]) return join(fnmDir, versions[0], "installation/bin");
  }
  return "";
}

function resolveNodeBin(bin: string, fnmBinDir: string): string {
  const which = Bun.spawnSync(["which", bin]);
  if (which.exitCode === 0) return bin;
  if (fnmBinDir) return join(fnmBinDir, bin);
  return bin;
}

/**
 * Create the blog draft via the REAL blog-publishing skill (against the LIVE arc0me-site
 * content/ dir). Safe: content/ is never read by the Astro build — only `publish` (never
 * called by this pipeline) syncs a post into src/content/docs/blog/, which is the only
 * directory the deployed site actually serves.
 */
async function createBlogDraft(title: string, slug: string, tags: string[]): Promise<{ postId: string; indexPath: string }> {
  const args = ["skills", "run", "--name", "blog-publishing", "--", "create", "--title", title, "--slug", slug];
  if (tags.length > 0) args.push("--tags", tags.join(","));
  const result = await runCommand(["bash", "bin/arc", ...args], ARC_STARTER_ROOT);
  if (result.exitCode !== 0) {
    throw new Error(`blog-publishing create failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
  }
  const jsonStart = result.stdout.indexOf("{");
  const parsed = JSON.parse(result.stdout.slice(jsonStart));
  if (!parsed.success) throw new Error(`blog-publishing create reported failure: ${result.stdout}`);
  return { postId: parsed.post_id, indexPath: parsed.path };
}

/**
 * P2 AMENDMENT (2026-07-03, operator correction): "I don't quality gate what Arc publishes."
 * The blog leg must hand off to Arc's own autonomous publish lane, not sit staged waiting on
 * a human. `blog-publishing/sensor.ts`'s "oldestDraft" scan is that lane — it scans
 * `src/content/docs/blog/*.mdx` for `draft: true` and, hourly, queues a normal
 * "review and finalize" -> "publish" task pair for the oldest one it finds, exactly the same
 * live-by-default path every other Arc blog post goes through. Our `stage()` writes the
 * canonical draft into `content/...` only (never read by that sensor — see the file header
 * comment). This syncs the FINAL body into the sensor's discovery directory, `draft: true`
 * preserved (never flips it — only `blog-publishing publish`, run by Arc's own dispatch loop
 * when its sensor decides, does that). This is the identical sync `publish()` performs, minus
 * the flip.
 */
function syncToPublishLane(postId: string, finalContent: string): void {
  const blogDocsDir = join(LIVE_SITE_DIR, "src/content/docs/blog");
  fs.mkdirSync(blogDocsDir, { recursive: true });
  fs.writeFileSync(join(blogDocsDir, `${postId}.mdx`), finalContent);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * P2 AMENDMENT (2026-07-03, operator correction): "If Arc wants me to post something, it
 * should email me like it has been." Reuses the EXACT credential/send path
 * `arc-daily-read/cli.ts`'s `sendAmplificationEmail()` already established (email/api_base_url,
 * email/admin_api_key, email/report_recipient via src/credentials.ts, POST {base}/api/send)
 * rather than inventing a second one. One email per staged article — not a bulk send.
 *
 * P2 REWORK (2026-07-03, operator correction #2): the payload is a long-form X ARTICLE draft
 * (title + article body, ready to paste into X's article composer from @whoabuddy) plus a
 * suggested short companion post — not a tweet thread. `supersede` marks the resend of a
 * corrected draft so the subject line makes clear it replaces an earlier thread-format email.
 * Payload type is exactly what the email renders (title/finalBody/companionPost) — callers
 * never pass a raw `body`, so the raw-vs-assembled distinction cannot leak in here
 * (fowler #1/hohpe #5). `previewUrl` gives the operator a working page to read before Arc's
 * autonomous lane publishes the arc0.me URL (hohpe #4).
 */
async function sendXArticleAmplificationEmail(
  articleN: number,
  finding: Finding,
  postId: string,
  xArticle: { title: string; finalBody: string; companionPost: string },
  options: { supersede?: boolean; previewUrl?: string | null } = {}
): Promise<boolean> {
  const { getCredential } = await import(join(ARC_STARTER_ROOT, "src/credentials.ts"));
  const apiBaseUrl = await getCredential("email", "api_base_url");
  const adminKey = await getCredential("email", "admin_api_key");
  const recipient = await getCredential("email", "report_recipient");

  if (!apiBaseUrl || !adminKey || !recipient) {
    console.warn("  [EMAIL] email credentials not configured — skipping amplification email");
    return false;
  }

  const blogUrl = `${ARC0ME_BASE}/blog/${postId}/?a=${ATTRIBUTION_TAG}`;
  const subject = options.supersede
    ? `[Supersedes the earlier thread email] Arc's Article ${articleN} as an X Article — "${finding.slug}"`
    : `Arc's Article ${articleN} ready to amplify — X Article draft — "${finding.slug}"`;
  const supersedeNote = options.supersede
    ? "This replaces the earlier email that carried this article as a tweet thread. Post THIS version: a long-form X Article, not a thread."
    : "";
  const plainText = [
    `Arc's Article ${articleN} — ${finding.slug}`,
    ...(supersedeNote ? [``, supersedeNote] : []),
    ``,
    `Arc's blog post (Arc's own publish lane handles this on its own cadence, not gated on you):`,
    blogUrl,
    ...(options.previewUrl ? [``, `Working preview (staging, readable now even before Arc's lane publishes):`, options.previewUrl] : []),
    ``,
    `X ARTICLE draft — paste title + body into X's article composer from @whoabuddy`,
    `(Jason amplifying Arc: quote/credit Arc, your own account; links below are pre-tagged ?a=${ATTRIBUTION_TAG}):`,
    ``,
    `=== TITLE (${xArticle.title.length} chars) ===`,
    xArticle.title,
    ``,
    `=== ARTICLE BODY ===`,
    xArticle.finalBody,
    ``,
    `=== SUGGESTED COMPANION POST (${xArticle.companionPost.length} chars — X attaches the article link when you post) ===`,
    xArticle.companionPost,
  ].join("\n");
  const htmlBody = `<!DOCTYPE html><html><body style="font-family:monospace;max-width:640px;margin:40px auto;background:#0a0a0a;color:#e0e0e0;padding:24px">
<h2 style="color:#f0f0f0">Arc's Article ${articleN} — ${escapeHtml(finding.slug)}</h2>
${supersedeNote ? `<p style="color:#ffb020;border:1px solid #ffb020;padding:8px 12px;border-radius:4px">${escapeHtml(supersedeNote)}</p>` : ""}
<p><strong>Arc's blog post:</strong> <a href="${blogUrl}">${blogUrl}</a> (Arc's own publish lane handles this, not gated on you)</p>
${options.previewUrl ? `<p><strong>Working preview</strong> (staging, readable now): <a href="${options.previewUrl}">${options.previewUrl}</a></p>` : ""}
<h3>X Article draft — paste into X's article composer from @whoabuddy:</h3>
<div style="background:#1a1a1a;border-left:3px solid #1d9bf0;padding:12px 16px;margin:12px 0;border-radius:4px"><div style="color:#888;font-size:0.85em">Title (${xArticle.title.length} chars)</div><pre style="white-space:pre-wrap;margin:0">${escapeHtml(xArticle.title)}</pre></div>
<div style="background:#1a1a1a;border-left:3px solid #1d9bf0;padding:12px 16px;margin:12px 0;border-radius:4px"><div style="color:#888;font-size:0.85em">Article body</div><pre style="white-space:pre-wrap;margin:0">${escapeHtml(xArticle.finalBody)}</pre></div>
<div style="background:#1a1a1a;border-left:3px solid #8b5cf6;padding:12px 16px;margin:12px 0;border-radius:4px"><div style="color:#888;font-size:0.85em">Suggested companion post (${xArticle.companionPost.length} chars — X attaches the article link)</div><pre style="white-space:pre-wrap;margin:0">${escapeHtml(xArticle.companionPost)}</pre></div>
</body></html>`;

  try {
    const response = await fetch(`${apiBaseUrl}/api/send`, {
      method: "POST",
      headers: { "X-Admin-Key": adminKey, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ to: recipient, subject, body: plainText, body_html: htmlBody }),
    });
    if (!response.ok) {
      console.error(`  [EMAIL] send failed: HTTP ${response.status} — ${await response.text()}`);
      return false;
    }
    console.log(`  [EMAIL] sent to ${recipient}: "${subject}"`);
    return true;
  } catch (err) {
    console.error(`  [EMAIL] network error: ${err}`);
    return false;
  }
}

function writeBlogBody(indexPath: string, blogTitle: string, blogBody: string, closing: string): void {
  const raw = fs.readFileSync(indexPath, "utf-8");
  const fmMatch = raw.match(/^(---\n[\s\S]*?\n---\n)/);
  if (!fmMatch) throw new Error(`writeBlogBody: ${indexPath} has no parseable frontmatter block`);
  const frontmatter = fmMatch[1];
  const content = `\n# ${blogTitle}\n\n${blogBody.trim()}\n\n${closing}\n`;
  fs.writeFileSync(indexPath, frontmatter + content);
}

/**
 * Isolated preview build+deploy — NEVER touches the live arc0me-site working tree's git state
 * or its src/content/docs/blog/ directory. Builds from a one-time rsync'd scratch copy
 * (db/article-pipeline-preview/site/, not a git repo) and deploys to Cloudflare's `staging`
 * env (workers_dev subdomain, no custom domain — see wrangler.jsonc). Hard constraint:
 * `--env production` is never passed anywhere in this file.
 */
async function ensurePreviewSiteCopy(): Promise<void> {
  if (fs.existsSync(PREVIEW_SITE_DIR)) return;
  log(`no preview scratch copy yet — rsyncing ${LIVE_SITE_DIR} -> ${PREVIEW_SITE_DIR} (one-time, ~1.3GB)`);
  fs.mkdirSync(join(ARC_STARTER_ROOT, "db/article-pipeline-preview"), { recursive: true });
  // P2 dev-council fix (kleppmann): rsync into a temp dir and atomically rename into place —
  // existsSync() on PREVIEW_SITE_DIR would otherwise flip true the instant mkdirSync runs,
  // before rsync finishes, letting a concurrent stage build against a half-populated tree.
  const tmpDir = `${PREVIEW_SITE_DIR}.rsync-tmp-${process.pid}`;
  // Anchored excludes (leading slash): an unanchored `--exclude=dist` matches a `dist/` dir at
  // ANY depth, including node_modules/astro/dist — this was found live (2026-07-03) when a
  // dispatch-turn run hit exactly this and self-diagnosed it mid-task. Anchoring to the sync
  // root excludes only the top-level `.git`/`dist`, leaving nested package dirs intact.
  const result = await runCommand(
    ["rsync", "-a", "--exclude=/.git", "--exclude=/dist", `${LIVE_SITE_DIR}/`, `${tmpDir}/`],
    ARC_STARTER_ROOT
  );
  if (result.exitCode !== 0) throw new Error(`rsync preview copy failed: ${result.stderr}`);
  if (fs.existsSync(PREVIEW_SITE_DIR)) {
    // Another process won the race and finished first — discard our copy, keep theirs.
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return;
  }
  fs.renameSync(tmpDir, PREVIEW_SITE_DIR);
}

const BUILD_LOCK_PATH = join(ARC_STARTER_ROOT, "db/article-pipeline-preview/.build-lock");

/**
 * P2 dev-council fix (kleppmann/hohpe): the preview build directory is shared mutable state —
 * two overlapping `stage` calls running `npm run build` in the same directory would collide on
 * `dist/` and produce a nondeterministic deploy. The dispatch engine's systemd-timer model
 * (fresh process, exits before the next fires) makes this latent today, not impossible
 * (Newman/Hohpe both flagged "true by accident, not by contract"). A simple exclusive lockfile
 * makes the assumption explicit and enforced instead of implicit.
 */
async function withBuildLock<T>(run: () => Promise<T>): Promise<T> {
  fs.mkdirSync(join(ARC_STARTER_ROOT, "db/article-pipeline-preview"), { recursive: true });
  let fd: number;
  try {
    fd = fs.openSync(BUILD_LOCK_PATH, "wx");
  } catch {
    throw new Error(`preview build lock held (${BUILD_LOCK_PATH} exists) — another stage is mid-build/deploy. Retry once it finishes.`);
  }
  fs.writeSync(fd, String(process.pid));
  fs.closeSync(fd);
  try {
    return await run();
  } finally {
    fs.rmSync(BUILD_LOCK_PATH, { force: true });
  }
}

async function deployPreview(postId: string, mdxContent: string): Promise<string> {
  return withBuildLock(() => deployPreviewLocked(postId, mdxContent));
}

async function deployPreviewLocked(postId: string, mdxContent: string): Promise<string> {
  await ensurePreviewSiteCopy();

  // P2 fix (found live, 2026-07-03): Starlight/Astro's docs collection does not generate an
  // HTML page for a `draft: true` entry at all (only the custom listing pages were filtering
  // it — individual page ROUTING skips it too, confirmed by two live preview deploys 404ing
  // despite a successful build). The scratch preview copy is isolated, non-git, and only ever
  // deployed to the `staging` workers.dev subdomain (never `arc0.me`) — flipping draft:false
  // in THIS COPY ONLY (never the canonical content/ source file `stage` read it from) is safe
  // and is what actually makes "?a=wb-amp preview URL (200)" possible.
  const previewMdx = mdxContent.replace(/^draft:\s*true/m, "draft: false");

  const blogDocsDir = join(PREVIEW_SITE_DIR, "src/content/docs/blog");
  fs.mkdirSync(blogDocsDir, { recursive: true });
  fs.writeFileSync(join(blogDocsDir, `${postId}.mdx`), previewMdx);

  const { getCloudflareCredentials } = await import(join(ARC_STARTER_ROOT, "src/cloudflare.ts"));
  const { creds, error } = await getCloudflareCredentials();
  if (!creds) throw new Error(`preview deploy: cloudflare credentials unavailable: ${error}`);

  const fnmBinDir = resolveFnmBinDir();
  const nodeEnv: Record<string, string> = fnmBinDir ? { PATH: `${fnmBinDir}:${process.env.PATH ?? ""}` } : {};
  const npm = resolveNodeBin("npm", fnmBinDir);
  const npx = resolveNodeBin("npx", fnmBinDir);

  log("preview: npm run build...");
  const build = await runCommand([npm, "run", "build"], PREVIEW_SITE_DIR, nodeEnv);
  if (build.exitCode !== 0) throw new Error(`preview build failed: ${build.stderr || build.stdout}`);

  log("preview: npx wrangler deploy --env staging...");
  const deploy = await runCommand(
    [npx, "wrangler", "deploy", "--env", "staging"],
    PREVIEW_SITE_DIR,
    { ...nodeEnv, CLOUDFLARE_API_TOKEN: creds.apiToken }
  );
  if (deploy.exitCode !== 0) throw new Error(`preview deploy failed: ${deploy.stderr || deploy.stdout}`);

  const out = deploy.stdout + deploy.stderr;
  const urlMatch = out.match(/https:\/\/[\w.-]*workers\.dev/);
  if (!urlMatch) throw new Error(`preview deploy: could not parse deployed URL from wrangler output:\n${out}`);
  return urlMatch[0];
}

// ---------- Commands ----------

async function cmdMaterials(articleOverride?: number, slugOverride?: string): Promise<void> {
  console.log("=== Arc Article Pipeline — Materials Brief ===");
  const brief = composeMaterials(articleOverride, slugOverride);
  if (!brief.finding) {
    console.error("NO ELIGIBLE FINDING: research/INDEX.md parse returned nothing usable (no relevance-4/5 report with both a hook and a real file:line citation).");
    process.exit(1);
  }
  console.log(`Article: ${brief.articleN}`);
  console.log(`Selected finding: ${brief.finding.slug} (${brief.finding.title})`);
  console.log(`Hook: ${brief.finding.hook}`);
  console.log(`File:line citation: ${brief.finding.fileLine}`);
  console.log(`Packaged product URL: ${brief.finding.packagedProductUrl ?? "(none — not a packaged SKU)"}`);
  console.log(`Intro style: ${brief.introStyle}`);
  console.log(`Avoid recent slugs: ${brief.avoidSlugs.join(", ") || "(none yet)"}`);

  if (!fs.existsSync(MATERIALS_DIR)) fs.mkdirSync(MATERIALS_DIR, { recursive: true });
  const outPath = join(MATERIALS_DIR, `article-${brief.articleN}.json`);
  fs.writeFileSync(outPath, JSON.stringify(brief, null, 2));
  console.log(`\nWrote brief to ${outPath}`);
  console.log(`Next: draft { blogTitle, blogBody, xArticle: { title, body, companionPost } } to`);
  console.log(`  ${join(MATERIALS_DIR, `article-${brief.articleN}.draft.json`)}`);
  console.log(`Then run: bun cli.ts stage --article ${brief.articleN}`);
}

async function cmdStage(articleN: number, dryRun: boolean): Promise<void> {
  console.log(`=== Arc Article Pipeline — Stage Article ${articleN} ${dryRun ? "(DRY-RUN)" : ""} ===`);
  const brief = loadMaterialsBrief(join(MATERIALS_DIR, `article-${articleN}.json`));
  const draft = loadDraft(join(MATERIALS_DIR, `article-${articleN}.draft.json`));

  const errors = validateDraft(brief, draft);
  if (errors.length > 0) {
    console.error("DEFERRED — draft failed validation:");
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
  const finding = brief.finding!;

  if (dryRun) {
    console.log("[DRY-RUN] Draft passed validation. Would claim, create blog post, preview-deploy, write the X Article variant, and email it.");
    return;
  }

  const db = getDb();
  const claim = claimArticle(db, articleN, finding);
  if (claim === "already-staged") {
    console.error(`Article ${articleN} is already staged — nothing to do (idempotent no-op, not an error).`);
    db.close();
    return;
  }
  if (claim === "resume") {
    console.log(`Article ${articleN} was claimed but not finalized (a prior 'stage' run was interrupted) — resuming, not aborting.`);
  }

  // P2-rework dev-council fix (kleppmann F2 / lamport #2): postId is date-derived by
  // blog-publishing, so a resume on a later day would mint a SECOND postId — leaving the
  // crashed run's draft:true .mdx orphaned in the publish lane's discovery dir, where the
  // autonomous sensor would publish BOTH. Pin postId on the row the moment it exists and
  // reuse it on resume, so the article key is a function of the claim, not of the wall clock.
  const prior = db.query(
    "SELECT post_id, email_sent_at FROM article_queue_log WHERE article_n = ?"
  ).get([articleN]) as { post_id: string | null; email_sent_at: string | null } | null;

  let postId: string;
  let indexPath: string;
  if (prior?.post_id) {
    postId = prior.post_id;
    indexPath = canonicalIndexPath(postId);
    console.log(`Resuming with the already-created blog draft: ${postId}`);
  } else {
    const slug = slugify(draft.blogTitle);
    const tags = [finding.slug.split("-")[0]].filter(Boolean);
    ({ postId, indexPath } = await createBlogDraft(draft.blogTitle, slug, tags));
    db.run("UPDATE article_queue_log SET post_id = ? WHERE article_n = ?", [postId, articleN]);
    console.log(`Created blog draft: ${postId} (${indexPath})`);
  }

  const closing = buildBlogClosing(finding, postId);
  writeBlogBody(indexPath, draft.blogTitle, draft.blogBody, closing);
  console.log("Wrote blog body + deterministic closing CTA.");

  const finalMdx = fs.readFileSync(indexPath, "utf-8");
  const previewBase = await deployPreview(postId, finalMdx);
  const previewPostUrl = `${previewBase}/blog/${postId}/`;
  console.log(`Preview deployed: ${previewBase}`);

  // P2 AMENDMENT: hand off to Arc's own autonomous publish lane (blog-publishing/sensor.ts's
  // oldestDraft scan) instead of leaving the blog leg staged on an operator gate. draft:true
  // is preserved — this only makes the draft DISCOVERABLE to the sensor; only Arc's own
  // publish task (queued and run by its own dispatch loop, on its own timeline) flips it.
  syncToPublishLane(postId, finalMdx);
  console.log("Synced to blog-publishing's discovery path (src/content/docs/blog/) — Arc's own sensor will queue review+publish on its normal cadence, no operator gate.");

  // P3 (arc-demand-gen): pre-fill operator-curated @-mentions before assembling the final
  // body/companionPost — map-gated text matching, never LLM-invented (see prefillMentions()).
  const { draft: prefilledXArticle, matches: mentionMatches } = prefillMentions(db, draft.xArticle);
  const xArticle = assembleXArticle(finding, postId, prefilledXArticle);
  const xVariantPath = writeXArticleFiles(articleN, finding, postId, xArticle);
  console.log(`Wrote X Article variant: ${xVariantPath}`);
  // Log mentions only now that the article is durably on disk (dev-council kleppmann/hohpe: the
  // log must never assert a mention was surfaced before the artifact that surfaces it exists).
  recordMentionEvents(db, articleN, mentionMatches);

  // P2 AMENDMENT: deliver the X Article to Jason via Arc's EXISTING email lane (the same
  // mechanism arc-daily-read's sendAmplificationEmail already uses), not left as a file for
  // him to fetch. Non-fatal if email creds are missing — the files still exist as a fallback.
  // P2-rework dev-council fix (kleppmann F1 / lamport #1 / hohpe #1): the email is the one
  // irreversible side effect, so it is guarded by a durable sent-marker written IMMEDIATELY
  // after a successful send — a crash between the send and finalizeArticle can no longer
  // re-send on the next tick's resume.
  let emailSent = false;
  if (prior?.email_sent_at) {
    console.log(`Amplification email already sent at ${prior.email_sent_at} — not re-sending (idempotent resume).`);
    emailSent = true;
  } else {
    emailSent = await sendXArticleAmplificationEmail(articleN, finding, postId, xArticle, { previewUrl: previewPostUrl });
    if (emailSent) {
      db.run("UPDATE article_queue_log SET email_sent_at = ? WHERE article_n = ?", [new Date().toISOString(), articleN]);
    }
  }

  finalizeArticle(db, articleN, postId, previewPostUrl, xVariantPath);
  db.close();

  console.log(JSON.stringify({
    success: true,
    article_n: articleN,
    finding_slug: finding.slug,
    post_id: postId,
    preview_url: previewPostUrl,
    x_variant_path: xVariantPath,
    synced_to_publish_lane: true,
    amplification_email_sent: emailSent,
    status: "staged",
  }, null, 2));
}

interface QueueRow {
  post_id: string;
  finding_slug: string;
  hook: string;
  file_line: string;
  preview_url: string | null;
  email_sent_at: string | null;
}

function getQueueRow(articleN: number): QueueRow | null {
  const db = getDb();
  const row = db.query(
    "SELECT post_id, finding_slug, hook, file_line, preview_url, email_sent_at FROM article_queue_log WHERE article_n = ?"
  ).get([articleN]) as QueueRow | null;
  db.close();
  return row?.post_id ? row : null;
}

/** Reconstruct a Finding from a queue row (packagedProductUrl re-resolved from the live INDEX). */
function findingFromRow(row: QueueRow): Finding {
  return {
    slug: row.finding_slug,
    reportFile: "",
    title: row.finding_slug,
    hook: row.hook,
    fileLine: row.file_line,
    packagedProductUrl: extractFindingMaterials(
      parseIndexCandidates().find((c) => c.slug === row.finding_slug)?.reportFile ?? ""
    )?.packagedProductUrl ?? null,
  };
}

function canonicalIndexPath(postId: string): string {
  const date = postId.substring(0, 10);
  const year = date.substring(0, 4);
  const slug = postId.substring(11);
  return join(LIVE_SITE_DIR, "content", year, date, slug, "index.md");
}

/**
 * P2 AMENDMENT operational command: retroactively hand off an already-staged article to Arc's
 * publish lane + re-send the amplification email, without redoing the claim/create/preview
 * steps. Idempotent to re-run (sync overwrites the same file; email re-sends — intentionally,
 * since re-running this is an explicit operator/session action, not an automatic retry).
 * Reads the X Article JSON sidecar written by `stage`/`rework-x` — for articles staged before
 * the X-Article rework (thread-era), run `rework-x` first to regenerate the variant.
 */
async function cmdHandOff(articleN: number, supersede: boolean): Promise<void> {
  const row = getQueueRow(articleN);
  if (!row) {
    console.error(`Article ${articleN} has no post_id on record — nothing to hand off.`);
    process.exit(1);
  }
  const finding = findingFromRow(row);
  const postId = row.post_id;
  const indexPath = canonicalIndexPath(postId);
  if (!fs.existsSync(indexPath)) throw new Error(`Canonical source not found at ${indexPath}`);
  const finalContent = fs.readFileSync(indexPath, "utf-8");

  syncToPublishLane(postId, finalContent);
  console.log(`Synced article ${articleN} (${postId}) to blog-publishing's discovery path.`);

  const jsonPath = join(DRAFTS_DIR, `article-${articleN}-x-article.json`);
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`No X Article sidecar at ${jsonPath} — this article predates the X-Article rework. Draft { title, body, companionPost } to db/article-materials/article-${articleN}.xarticle.json and run: bun cli.ts rework-x --article ${articleN}`);
  }
  const sidecar = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  // Sidecars written after the P2 rework carry the raw `body` — re-validate it so no path to
  // the operator's inbox bypasses validateXArticle (lamport #6). Older/foreign sidecars
  // without `body` are sent as-is (they were validated when written).
  if (typeof sidecar.body === "string" && sidecar.body.trim()) {
    const errors = validateXArticle(finding, { title: sidecar.title, body: sidecar.body, companionPost: sidecar.companionPost });
    if (errors.length > 0) {
      console.error("ABORTED — sidecar failed re-validation (was it hand-edited?):");
      errors.forEach((e) => console.error(`  - ${e}`));
      process.exit(1);
    }
  }
  const xArticle = { title: sidecar.title, finalBody: sidecar.finalBody, companionPost: sidecar.companionPost };

  const emailSent = await sendXArticleAmplificationEmail(articleN, finding, postId, xArticle, { supersede, previewUrl: row.preview_url });
  if (emailSent) {
    const db = getDb();
    db.run("UPDATE article_queue_log SET email_sent_at = ? WHERE article_n = ?", [new Date().toISOString(), articleN]);
    db.close();
  }
  console.log(JSON.stringify({ success: true, article_n: articleN, post_id: postId, synced_to_publish_lane: true, amplification_email_sent: emailSent }, null, 2));
}

/**
 * P2 REWORK operational command: regenerate the X variant of an ALREADY-STAGED article as an
 * X Article (operator correction 2026-07-03: "the posts that it emailed me are all threads — I
 * thought I was posting X Articles"). Reads a raw LLM/session-drafted
 * `db/article-materials/article-<N>.xarticle.json` ({ title, body, companionPost } — no URLs,
 * validated the same way `stage` validates), assembles the deterministic tagged closing, writes
 * the drafts/ files, updates `x_variant_path`, and re-sends the amplification email
 * (`--supersede` marks the subject as replacing an earlier thread-format email). Does NOT touch
 * the blog leg — the article is already staged/synced.
 */
async function cmdReworkX(articleN: number, supersede: boolean, dryRun: boolean): Promise<void> {
  console.log(`=== Arc Article Pipeline — Rework X variant for Article ${articleN} ${dryRun ? "(DRY-RUN)" : ""} ===`);
  const row = getQueueRow(articleN);
  if (!row) {
    console.error(`Article ${articleN} has no post_id on record — stage it first.`);
    process.exit(1);
  }
  const finding = findingFromRow(row);
  const postId = row.post_id;

  const rawPath = join(MATERIALS_DIR, `article-${articleN}.xarticle.json`);
  if (!fs.existsSync(rawPath)) {
    console.error(`No X Article draft at ${rawPath} — draft { title, body, companionPost } there first (Jason's amplification voice, no URLs, citation "${finding.fileLine}" verbatim up front).`);
    process.exit(1);
  }
  const draft = parseXArticleDraft(JSON.parse(fs.readFileSync(rawPath, "utf-8")), rawPath);

  const errors = validateXArticle(finding, draft);
  if (errors.length > 0) {
    console.error("DEFERRED — X Article draft failed validation:");
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  if (dryRun) {
    console.log("[DRY-RUN] X Article draft passed validation. Would write drafts/ files, update x_variant_path, and send the amplification email.");
    return;
  }

  // P3 (arc-demand-gen): pre-fill operator-curated @-mentions before assembling the final
  // body/companionPost — map-gated text matching, never LLM-invented (see prefillMentions()).
  const db = getDb();
  const { draft: prefilledDraft, matches: mentionMatches } = prefillMentions(db, draft);
  const xArticle = assembleXArticle(finding, postId, prefilledDraft);
  const xVariantPath = writeXArticleFiles(articleN, finding, postId, xArticle);
  console.log(`Wrote X Article variant: ${xVariantPath}`);
  // Log mentions only now that the article is durably on disk (same ordering discipline as
  // cmdStage — see the comment there).
  recordMentionEvents(db, articleN, mentionMatches);

  db.run("UPDATE article_queue_log SET x_variant_path = ? WHERE article_n = ?", [xVariantPath, articleN]);
  db.close();

  const emailSent = await sendXArticleAmplificationEmail(articleN, finding, postId, xArticle, { supersede, previewUrl: row.preview_url });
  if (emailSent) {
    const db2 = getDb();
    db2.run("UPDATE article_queue_log SET email_sent_at = ? WHERE article_n = ?", [new Date().toISOString(), articleN]);
    db2.close();
  }
  console.log(JSON.stringify({
    success: true,
    article_n: articleN,
    post_id: postId,
    x_variant_path: xVariantPath,
    amplification_email_sent: emailSent,
    superseded_thread_email: supersede,
  }, null, 2));
}

async function cmdStatus(): Promise<void> {
  const db = getDb();
  const rows = db.query("SELECT * FROM article_queue_log ORDER BY article_n ASC").all();
  db.close();
  console.log(JSON.stringify(rows, null, 2));
}

/**
 * Operational command: re-run the isolated preview build+deploy for an already-staged article,
 * reading its CANONICAL content/ source (never the scratch copy) so the preview always reflects
 * the current on-disk draft. Idempotent — safe to run any time a preview URL needs refreshing
 * (e.g. after a `deployPreview` bug fix, as happened live 2026-07-03: the first two staged
 * articles' preview_urls 404'd because the scratch copy still had `draft: true`, which
 * Starlight's page routing skips entirely, not just its listing pages).
 */
async function cmdFixPreview(articleN: number): Promise<void> {
  const db = getDb();
  const row = db.query("SELECT post_id FROM article_queue_log WHERE article_n = ?").get([articleN]) as { post_id: string } | null;
  db.close();
  if (!row?.post_id) {
    console.error(`Article ${articleN} has no post_id on record (not staged yet?) — nothing to redeploy.`);
    process.exit(1);
  }
  const postId = row.post_id;
  const date = postId.substring(0, 10);
  const year = date.substring(0, 4);
  const slug = postId.substring(11);
  const indexPath = join(LIVE_SITE_DIR, "content", year, date, slug, "index.md");
  if (!fs.existsSync(indexPath)) {
    console.error(`Canonical source not found at ${indexPath}`);
    process.exit(1);
  }
  const content = fs.readFileSync(indexPath, "utf-8");
  const previewBase = await deployPreview(postId, content);
  const previewPostUrl = `${previewBase}/blog/${postId}/`;

  const db2 = getDb();
  db2.run("UPDATE article_queue_log SET preview_url = ? WHERE article_n = ?", [previewPostUrl, articleN]);
  db2.close();

  console.log(JSON.stringify({ success: true, article_n: articleN, post_id: postId, preview_url: previewPostUrl }, null, 2));
}

// ---------- Main ----------

function argValue(flag: string): string | undefined {
  const argIndex = process.argv.indexOf(flag);
  return argIndex !== -1 ? process.argv[argIndex + 1] : undefined;
}

async function main() {
  const command = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  const supersede = process.argv.includes("--supersede");
  const articleArg = argValue("--article");
  const articleOverride = articleArg ? parseInt(articleArg, 10) : undefined;
  const slugOverride = argValue("--slug");

  switch (command) {
    case "materials":
      await cmdMaterials(articleOverride, slugOverride);
      break;
    case "stage":
      if (articleOverride === undefined) {
        console.error("Usage: bun cli.ts stage --article <N> [--dry-run]");
        process.exit(1);
      }
      await cmdStage(articleOverride, dryRun);
      break;
    case "status":
      await cmdStatus();
      break;
    case "fix-preview":
      if (articleOverride === undefined) {
        console.error("Usage: bun cli.ts fix-preview --article <N>");
        process.exit(1);
      }
      await cmdFixPreview(articleOverride);
      break;
    case "hand-off":
      if (articleOverride === undefined) {
        console.error("Usage: bun cli.ts hand-off --article <N> [--supersede]");
        process.exit(1);
      }
      await cmdHandOff(articleOverride, supersede);
      break;
    case "rework-x":
      if (articleOverride === undefined) {
        console.error("Usage: bun cli.ts rework-x --article <N> [--supersede] [--dry-run]");
        process.exit(1);
      }
      await cmdReworkX(articleOverride, supersede, dryRun);
      break;
    default:
      console.log("Usage: bun cli.ts <materials|stage|status|fix-preview|hand-off|rework-x> [--article N] [--slug <slug>] [--dry-run] [--supersede]");
      console.log("  materials [--article N] [--slug <slug>]   Deterministic brief for the LLM voice pass (crown-jewel rotation, or force a specific finding)");
      console.log("  stage --article N [--dry-run]              Validate draft, create blog post, preview-deploy (staging, never production), stage + email the X Article variant");
      console.log("  status                                     Show the article queue log");
      console.log("  fix-preview --article N                    Re-run the isolated preview build+deploy for a staged article");
      console.log("  hand-off --article N [--supersede]         Re-sync blog leg + re-send the X Article amplification email for a staged article");
      console.log("  rework-x --article N [--supersede] [--dry-run]  Regenerate a staged article's X variant as an X Article from article-<N>.xarticle.json and email it");
      process.exit(1);
  }
}

// import.meta.main guard: sensor.ts imports X_ARTICLE_CONSTRAINTS from this file to build its
// task-description text from the same source of truth the validator enforces — the guard makes
// that import side-effect-free (main() only runs when cli.ts is the entry point).
if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`Error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  });
}
