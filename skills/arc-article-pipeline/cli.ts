#!/usr/bin/env bun
// skills/arc-article-pipeline/cli.ts
// Arc's Operator-Amplified Long-Form Article Pipeline — P2 of arc-demand-flywheel quest.
//
// Mirrors skills/arc-daily-read/cli.ts's P1 3-step contract (materials -> LLM voice draft ->
// deterministic stage), adapted for long-form: a crown-jewel finding becomes an arc0.me article
// (Arc's own voice) + an X-thread variant in Jason's (@whoabuddy) amplification voice — "my
// agent Arc tested X against its own live code", never undisclosed fronting. Every link the
// pipeline emits is assembled DETERMINISTICALLY (never LLM-authored) and carries `?a=wb-amp` —
// closes the exact class of bug P1 found (a hand-typed CTA silently overflowed/truncated a
// link). Firing (blog publish + git commit/push, or posting the X thread from Jason's own
// account) is always a separate, manual, human-initiated step — this pipeline only gets a
// finding to "staged."

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
const X_HANDLE = "@arc0btc";

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
      staged_at TEXT
    )
  `);

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
  xThreadConstraints: { minTweets: number; maxTweets: number; maxCharsPerTweet: number };
  voiceInstructions: { blog: string; xThread: string };
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
    xThreadConstraints: { minTweets: 3, maxTweets: 6, maxCharsPerTweet: 280 },
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
      xThread: [
        "NOT Arc's voice — this is Jason's (@whoabuddy) amplification voice: first person",
        "Jason, explicitly crediting/quoting Arc ('my agent Arc tested X against its own live",
        "code...' / 'Arc found...'). Never write as if Jason did the technical work himself,",
        "never impersonate Arc. Tweet 1 must contain the hook's core claim + the file:line",
        "citation. Do NOT include any CTA or URL in any tweet — 'stage' appends a final",
        "deterministic CTA tweet with the tagged link. Vary the rhetorical shape from any",
        "other staged article's thread (avoid repeating the same skeleton across editions).",
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

interface ArticleDraft {
  blogTitle: string;
  blogBody: string;
  xThread: string[];
}

function loadDraft(path: string): ArticleDraft {
  const raw = JSON.parse(fs.readFileSync(path, "utf-8"));
  if (typeof raw.blogTitle !== "string" || !raw.blogTitle.trim()) {
    throw new DraftValidationError(`draft at ${path}: missing/empty blogTitle`);
  }
  if (typeof raw.blogBody !== "string" || !raw.blogBody.trim()) {
    throw new DraftValidationError(`draft at ${path}: missing/empty blogBody`);
  }
  if (!Array.isArray(raw.xThread) || raw.xThread.length < 1 || raw.xThread.some((t: unknown) => typeof t !== "string")) {
    throw new DraftValidationError(`draft at ${path}: xThread must be a non-empty string array (excluding the deterministic final CTA tweet)`);
  }
  return { blogTitle: raw.blogTitle, blogBody: raw.blogBody, xThread: raw.xThread };
}

// ---------- Validation ----------

const RAW_URL_RE = /(https?:\/\/(?:[\w-]+\.)?(?:arc0\.me|whop\.com)\S*)/gi;

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
  RAW_URL_RE.lastIndex = 0;

  const { minTweets, maxTweets, maxCharsPerTweet } = brief.xThreadConstraints;
  if (draft.xThread.length < minTweets || draft.xThread.length > maxTweets) {
    errors.push(`xThread has ${draft.xThread.length} tweets, outside [${minTweets}, ${maxTweets}]`);
  }
  draft.xThread.forEach((t, i) => {
    if (t.length > maxCharsPerTweet) errors.push(`xThread[${i}] is ${t.length} chars, exceeds ${maxCharsPerTweet}`);
    if (RAW_URL_RE.test(t)) errors.push(`xThread[${i}] contains a hand-authored URL — the CTA link is appended deterministically`);
    RAW_URL_RE.lastIndex = 0;
  });
  if (draft.xThread.length > 0 && !draft.xThread[0].includes(finding.fileLine)) {
    errors.push(`xThread[0] does not contain the required citation "${finding.fileLine}" verbatim`);
  }

  const recentSlugSet = new Set(brief.avoidSlugs);
  if (recentSlugSet.has(finding.slug)) {
    errors.push(`finding "${finding.slug}" was staged in the recent rotation window — selection should have avoided a repeat`);
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

function buildXCtaTweet(postId: string, finding: Finding): string {
  const blogUrl = `${ARC0ME_BASE}/blog/${postId}/?a=${ATTRIBUTION_TAG}`;
  let tweet = `Arc's full writeup, citations included: ${blogUrl}\nFree room for agent operators who want to feed their agents real signal: ${FREE_ROOM_URL}`;
  if (finding.packagedProductUrl) {
    const withProduct = `${tweet}\nGraded version: ${finding.packagedProductUrl}?a=${ATTRIBUTION_TAG}`;
    if (withProduct.length <= 280) tweet = withProduct;
  }
  if (tweet.length > 280) {
    throw new Error(`buildXCtaTweet: assembled CTA tweet is ${tweet.length} chars, exceeds 280 — shorten FREE_ROOM_URL or blogUrl construction`);
  }
  return tweet;
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
  } catch (err) {
    const msg = String(err);
    // Lost a race against a concurrent claimer between the SELECT above and this INSERT —
    // treat identically to finding it already existed.
    if (msg.includes("UNIQUE constraint") || msg.includes("PRIMARY KEY")) return "resume";
    throw err;
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

/**
 * P2 AMENDMENT (2026-07-03, operator correction): "If Arc wants me to post something, it
 * should email me like it has been." Reuses the EXACT credential/send path
 * `arc-daily-read/cli.ts`'s `sendAmplificationEmail()` already established (email/api_base_url,
 * email/admin_api_key, email/report_recipient via src/credentials.ts, POST {base}/api/send)
 * rather than inventing a second one. One email per staged article — not a bulk send.
 */
async function sendXThreadAmplificationEmail(
  articleN: number,
  finding: Finding,
  postId: string,
  fullThread: string[],
  dryRun: boolean = false
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
  const subject = `Arc's Article ${articleN} ready to amplify — "${finding.slug}"`;
  const plainText = [
    `Arc's Article ${articleN} — ${finding.slug}`,
    ``,
    `Blog post (Arc's dispatch loop will publish this on its own cadence, not gated on you):`,
    blogUrl,
    ``,
    `X-thread ready to post from @whoabuddy — quote/credit Arc, your own voice, your own account:`,
    ``,
    ...fullThread.map((t, i) => `Tweet ${i + 1} (${t.length} chars):\n${t}\n`),
  ].join("\n");
  const htmlBody = `<!DOCTYPE html><html><body style="font-family:monospace;max-width:640px;margin:40px auto;background:#0a0a0a;color:#e0e0e0;padding:24px">
<h2 style="color:#f0f0f0">Arc's Article ${articleN} — ${finding.slug}</h2>
<p><strong>Blog post:</strong> <a href="${blogUrl}">${blogUrl}</a> (Arc's own publish lane handles this, not gated on you)</p>
<h3>X-thread ready to post from @whoabuddy:</h3>
${fullThread.map((t, i) => `<div style="background:#1a1a1a;border-left:3px solid #1d9bf0;padding:12px 16px;margin:12px 0;border-radius:4px"><div style="color:#888;font-size:0.85em">Tweet ${i + 1}</div><pre style="white-space:pre-wrap;margin:0">${t}</pre></div>`).join("")}
</body></html>`;

  if (dryRun) {
    console.log(`  [DRY-RUN EMAIL] Would send to ${recipient}: "${subject}"`);
    return true;
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/send`, {
      method: "POST",
      headers: { "X-Admin-Key": adminKey, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ to: recipient, subject, body: plainText, html: htmlBody }),
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
async function withBuildLock<T>(fn: () => Promise<T>): Promise<T> {
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
    return await fn();
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
  console.log(`Next: draft { blogTitle, blogBody, xThread: [...] } to`);
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
    console.log("[DRY-RUN] Draft passed validation. Would claim, create blog post, preview-deploy, and write X-thread draft.");
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

  const slug = slugify(draft.blogTitle);
  const tags = [finding.slug.split("-")[0]].filter(Boolean);
  const { postId, indexPath } = await createBlogDraft(draft.blogTitle, slug, tags);
  console.log(`Created blog draft: ${postId} (${indexPath})`);

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

  const ctaTweet = buildXCtaTweet(postId, finding);
  const fullThread = [...draft.xThread, ctaTweet];
  if (!fs.existsSync(DRAFTS_DIR)) fs.mkdirSync(DRAFTS_DIR, { recursive: true });
  const xVariantPath = join(DRAFTS_DIR, `article-${articleN}-x-thread.md`);
  const xContent = [
    `# Article ${articleN} X-thread variant — staged, NOT posted`,
    `Finding: ${finding.slug} | Blog post: ${postId} | Voice: @whoabuddy amplifying Arc (quote/credit, never undisclosed fronting)`,
    "",
    ...fullThread.map((t, i) => `## Tweet ${i + 1} (${t.length} chars)\n\n${t}\n`),
  ].join("\n");
  fs.writeFileSync(xVariantPath, xContent);
  console.log(`Wrote X-thread variant: ${xVariantPath}`);

  // P2 AMENDMENT: deliver the X-thread to Jason via Arc's EXISTING email lane (the same
  // mechanism arc-daily-read's sendAmplificationEmail already uses), not left as a file for
  // him to fetch. Non-fatal if email creds are missing — the file still exists as a fallback.
  const emailSent = await sendXThreadAmplificationEmail(articleN, finding, postId, fullThread);

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

/**
 * P2 AMENDMENT operational command: retroactively hand off an already-staged article (staged
 * before this amendment landed) to Arc's publish lane + send the amplification email, without
 * redoing the claim/create/preview steps. Idempotent to re-run (sync overwrites the same file;
 * email re-sends — intentionally, since re-running this is an explicit operator/session action,
 * not an automatic retry).
 */
async function cmdHandOff(articleN: number): Promise<void> {
  const db = getDb();
  const row = db.query(
    "SELECT post_id, finding_slug, hook, file_line FROM article_queue_log WHERE article_n = ?"
  ).get([articleN]) as { post_id: string; finding_slug: string; hook: string; file_line: string } | null;
  db.close();
  if (!row?.post_id) {
    console.error(`Article ${articleN} has no post_id on record — nothing to hand off.`);
    process.exit(1);
  }
  const finding: Finding = {
    slug: row.finding_slug,
    reportFile: "",
    title: row.finding_slug,
    hook: row.hook,
    fileLine: row.file_line,
    packagedProductUrl: extractFindingMaterials(
      parseIndexCandidates().find((c) => c.slug === row.finding_slug)?.reportFile ?? ""
    )?.packagedProductUrl ?? null,
  };
  const postId = row.post_id;
  const date = postId.substring(0, 10);
  const year = date.substring(0, 4);
  const slug = postId.substring(11);
  const indexPath = join(LIVE_SITE_DIR, "content", year, date, slug, "index.md");
  if (!fs.existsSync(indexPath)) throw new Error(`Canonical source not found at ${indexPath}`);
  const finalContent = fs.readFileSync(indexPath, "utf-8");

  syncToPublishLane(postId, finalContent);
  console.log(`Synced article ${articleN} (${postId}) to blog-publishing's discovery path.`);

  const xVariantPath = join(DRAFTS_DIR, `article-${articleN}-x-thread.md`);
  if (!fs.existsSync(xVariantPath)) throw new Error(`X-thread file not found at ${xVariantPath}`);
  const xContent = fs.readFileSync(xVariantPath, "utf-8");
  const fullThread = xContent
    .split(/^## Tweet \d+ \(\d+ chars\)\n\n/m)
    .slice(1)
    .map((s) => s.trim());

  const emailSent = await sendXThreadAmplificationEmail(articleN, finding, postId, fullThread);
  console.log(JSON.stringify({ success: true, article_n: articleN, post_id: postId, synced_to_publish_lane: true, amplification_email_sent: emailSent }, null, 2));
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
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const command = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
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
        console.error("Usage: bun cli.ts hand-off --article <N>");
        process.exit(1);
      }
      await cmdHandOff(articleOverride);
      break;
    default:
      console.log("Usage: bun cli.ts <materials|stage|status> [--article N] [--slug <slug>] [--dry-run]");
      console.log("  materials [--article N] [--slug <slug>]   Deterministic brief for the LLM voice pass (crown-jewel rotation, or force a specific finding)");
      console.log("  stage --article N [--dry-run]              Validate draft, create blog post, preview-deploy (staging, never production), stage X-thread");
      console.log("  status                                     Show the article queue log");
      process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
