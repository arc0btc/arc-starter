#!/usr/bin/env bun
// skills/arc-packaging/cli.ts
// The standing packaging pipeline stage — P3 of arc-demand-flywheel quest.
//
// Extends research/INDEX.md's existing SKU backlog (produced by arc-link-research's
// reindex/catalog) into an ACTIONABLE stage: materials picks the next unpackaged
// relevance>=4 sku_candidate off the backlog, the dispatch-cycle LLM drafts dual-audience-frame
// copy (SOUL.md-gated), and stage deterministically mints the Whop SKU (whop create-product),
// closes the loop on the research shelf (arc-link-research mark-packaged), and grants members
// a free redemption path (whop unlock-all, entitlement-only by default — see below). Mirrors
// arc-article-pipeline's (P2) materials -> LLM draft -> deterministic stage contract.
//
// New Whop products PUBLISH BY DEFAULT (operator directive 2026-07-03: "the SKUs are up to arc
// to manage/publish and don't need my review either. same as the blog"). stage mints hidden
// (create-product's unchanged default), wires mark-packaged + the member unlock promo, and
// then — as the TERMINAL mutation — flips product+plan visible via whop set-visibility
// (dev-council/Newman 2026-07-03: publish is the commit step, so the public storefront never
// shows a SKU whose deliverable or member promo isn't wired yet; a failed flip leaves the row
// 'claimed' for resume, and the operator email reports the READ-BACK visibility, not intent).
// --keep-hidden opts a single stage run back into the old hidden-awaiting-flip behavior.
// The pipeline still gates on the operator before any member-facing ANNOUNCEMENT fires
// (publishing to the storefront ≠ pushing into paying members' chat) — see the unlock-all
// call in cmdStage below (dev-council:
// Newman flagged the original design's automatic chat post as a real premature-exposure risk
// even though it isn't a QUEST.md hard gate; fixed here by defaulting to --skip-chat and
// notifying the operator by email instead, mirroring Hohpe's "no operator feedback loop"
// finding — one fix closes both).
//
// dev-council + arc-strategy-panel (5-lens + 7-expert, run as parallel subagents — the
// `Workflow` tool was unavailable this session, same substitute P1/P2 used) reviewed this code
// and the SKU copy before deploy. Every CONFIRMED finding is fixed here; PLAUSIBLE/deferred
// items are documented in the phase's verify artifact, not silently dropped.

import { Database } from "bun:sqlite";
import { join } from "path";
import * as fs from "fs";
import { runCommand, slugify } from "../../src/utils.ts";
import { initDatabase } from "../../src/db.ts";
import { selectCandidate } from "./lib/backlog.ts";
import { renderSkuCover } from "./lib/cover.ts";
// control-plane-remediation Phase 7 (track c), P6 defect row 39: keeps checkout_config's
// stable 'latest-report' pointer current on every SUCCESSFUL $9 SKU publish, so a surface can
// embed one durable URL instead of a SKU-specific one that goes stale as the rolling window
// rotates. Never called on a failed/hidden publish (see the `published` gate below).
import { setLatestReportCheckoutUrl } from "../arc-attribution/lib/checkout-url.ts";
// Dedup-before-mint gate (panel #21499 pipeline fix, promised in the published post/thread but
// not shipped at the time — see task #23665): reuse arc-link-research's own catalog dedup logic
// instead of re-implementing url/topic matching here (findCoverage is already the single answer
// to "is this already covered?" for the research shelf itself).
import { findCoverage, type CatalogEntry } from "../arc-link-research/lib/catalog.ts";
import { parseFrontmatter } from "../arc-link-research/lib/frontmatter.ts";

const ARC_STARTER_ROOT = join(import.meta.dir, "../../");
const DB_PATH = process.env.ARC_PACKAGING_DB_PATH ?? join(ARC_STARTER_ROOT, "db/arc.sqlite");
const RESEARCH_DIR = join(ARC_STARTER_ROOT, "research");
const RESEARCH_ARCHIVE_DIR = join(RESEARCH_DIR, "archive");
const INDEX_PATH = join(RESEARCH_DIR, "INDEX.md");
const MATERIALS_DIR = join(ARC_STARTER_ROOT, "db/packaging-materials");

// Reports can be archived out of research/ into research/archive/ between the time the
// sensor queues them and the time materials/stage actually reads the file — fall back to
// the archive location so a rotation doesn't silently produce an empty report body.
function resolveReportPath(reportFile: string): string {
  const primary = join(RESEARCH_DIR, reportFile);
  if (fs.existsSync(primary)) return primary;
  const archived = join(RESEARCH_ARCHIVE_DIR, reportFile);
  if (fs.existsSync(archived)) return archived;
  return primary;
}

const DEFAULT_PRICE_USD = 9;

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] [arc-packaging/cli] ${message}`);
}

// ---------- DB bootstrap ----------

function getDb(): Database {
  const db = new Database(DB_PATH);
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA busy_timeout=5000"); // same P1/P2 fix — wait on the live dispatch loop, don't throw

  db.run(`
    CREATE TABLE IF NOT EXISTS packaging_queue_log (
      report_file TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      route TEXT NOT NULL,
      relevance INTEGER,
      sku_why TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      product_id TEXT,
      plan_id TEXT,
      promo_code_id TEXT,
      queued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      claimed_at TEXT,
      packaged_at TEXT
    )
  `);

  // #24240 fix: slug is derived from reportFile with the date-timestamp prefix stripped, which
  // collapses every generically-named "<timestamp>_research.md" report to the identical slug
  // "research" — every materials/draft/deliverable/quiz/cover file on disk was keyed on that
  // colliding slug, so a stale draft from a prior report could be silently read (or overwritten)
  // by the wrong candidate. Key on the full, always-unique report_file instead; slug/route stay
  // cosmetic (Whop product route only). SQLite has no "ADD COLUMN IF NOT EXISTS" — catch-and-
  // ignore duplicate-column errors, matching arc-daily-read's finding_report_file migration.
  try {
    db.run("ALTER TABLE packaging_queue_log ADD COLUMN file_key TEXT");
  } catch (error) {
    if (!String(error).includes("duplicate column")) throw error;
  }

  return db;
}

function slugFromReportFile(reportFile: string): string {
  return reportFile.replace(/^\d{4}-\d{2}-\d{2}T[\d:-]+Z_/, "").replace(/\.md$/, "");
}

// Unique per report_file (unlike slug, which collapses generically-named reports to "research")
// — every on-disk materials/draft/deliverable/quiz/cover filename keys on this, not slug.
function fileKeyFromReportFile(reportFile: string): string {
  return reportFile.replace(/\.md$/, "").replace(/[^a-zA-Z0-9_-]/g, "-");
}

// ---------- Sanitization net (deterministic regex pre-flight; the qualitative dev-council
// read for proprietary-edge material happens BEFORE drafting, outside this tool) ----------

const SECRET_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /api[_-]?key\s*[:=]\s*["']?[a-zA-Z0-9_-]{16,}/i,
  /password\s*[:=]\s*\S+/i,
  /\b192\.168\.\d{1,3}\.\d{1,3}\b/,
  /ARC_CREDS_PASSWORD/,
  /-----BEGIN (RSA|OPENSSH|PRIVATE|EC) /,
  /secret[_-]?key\s*[:=]/i,
  /Bearer [a-zA-Z0-9_.-]{20,}/,
];

function sanitizeScan(text: string): string[] {
  const hits: string[] = [];
  for (const re of SECRET_PATTERNS) {
    const m = text.match(re);
    if (m) hits.push(`pattern /${re.source}/ matched: "${m[0].slice(0, 48)}${m[0].length > 48 ? "..." : ""}"`);
  }
  return hits;
}

// ---------- Deliverable cleanup (dev-council/arc-strategy-panel: Kim, 2026-07-03) ----------
//
// A raw research report is written for ARC'S OWN engineering backlog, not for a paying
// stranger: it carries a "Recommendations" table tagged effort/impact/risk/target-repo (Arc's
// roadmap, not the buyer's), a "Provenance" section with internal cache-file hashes and
// dispatch task IDs, and `[[wiki-link]]`-style cross-references into Arc's own memory system
// that resolve to nothing outside it. Kim's review: this is a DIFFERENT failure mode than the
// operator's "dry and programmatic" complaint (that was about voice; this is about a buyer
// finding they're holding Arc's internal homework) — and it is fixable with a deterministic,
// no-new-authoring strip pass, so it runs automatically here rather than being a per-report
// manual chore. Applied to every future SKU, not just this phase's batch.
function cleanDeliverableMarkdown(text: string): string {
  let out = text;

  // Strip the leading YAML front-matter block (everything between the first two "---" lines) —
  // it carries internal-only bookkeeping (task_id, parent, cached_path — a VM filesystem path,
  // sku_why, packaged flag) a paying stranger has no use for. Gap found live during this
  // phase's own verify pass (a report with no "## " headings at all — bold-text section markers
  // instead — sailed through the Recommendations-strip untouched, but its front-matter was
  // still visible verbatim at the top of the deliverable); fixed here for all future SKUs and
  // re-applied retroactively to this phase's own batch (see the verify artifact).
  if (out.startsWith("---\n")) {
    const secondFence = out.indexOf("\n---\n", 4);
    if (secondFence !== -1) {
      out = out.slice(secondFence + 5);
    }
  }

  // Reports use TWO different section-heading styles inconsistently: ATX ("## Recommendations")
  // and standalone bold ("**Recommendations**", no "#"). An ATX-only regex silently missed the
  // bold-style variant live on the one SKU this phase's own dispatch loop drafted autonomously
  // (found during this phase's verify pass) — dropSection() below recognizes both.
  const isHeadingLine = (line: string): boolean =>
    /^#{1,6}\s+\S/.test(line) || /^\*\*[^*]+\*\*\s*$/.test(line);
  const headingText = (line: string): string =>
    line.replace(/^#{1,6}\s+/, "").replace(/^\*\*|\*\*\s*$/g, "").trim();

  const dropSections = (text: string, matchesHeading: RegExp): string => {
    const lines = text.split("\n");
    const out2: string[] = [];
    let skipping = false;
    for (const line of lines) {
      if (isHeadingLine(line)) {
        skipping = matchesHeading.test(headingText(line));
        if (skipping) continue; // drop the heading line itself too
      } else if (line.trim() === "---") {
        skipping = false; // a divider always ends a skip, heading or not
      }
      if (!skipping) out2.push(line);
    }
    return out2.join("\n");
  };

  // Drop any recommendations section entirely — own-backlog planning (effort/impact/risk/
  // target-repo tags aimed at Arc's engineering queue), not customer content.
  out = dropSections(out, /recommendations/i);

  // [[wiki-link]] -> plain text (strip the double brackets, keep the readable label).
  out = out.replace(/\[\[([^\]]+)\]\]/g, "$1");

  // Provenance sections carry legitimate value (source URLs a buyer can independently verify —
  // REPORT-TEMPLATE.md calls this "the receipt standard") mixed with internal-only bookkeeping
  // (cache file hashes/paths). Keep the section, strip only the cache references — narrow and
  // safe: this exact pattern never appears in a substantive claim, only in source-tracking, so a
  // document-wide strip doesn't risk cutting a legitimate file:line citation elsewhere.
  out = out.replace(/\s*[—-]?\s*[Cc]ache\s+`[^`]+`/g, "");
  out = out.replace(/\n## Provenance\b/, "\n## How this was verified");

  return out.trim() + "\n";
}

// ---------- Materials brief ----------

interface MaterialsBrief {
  reportFile: string;
  slug: string;
  fileKey: string;
  route: string;
  relevance: number;
  skuWhy: string;
  reportPath: string;
  reportMarkdown: string;
  suggestedPriceUsd: number;
  voiceInstructions: {
    human: string;
    agent: string;
    quiz: string;
  };
  sanitizationChecklist: string[];
}

function composeMaterials(
  reportOverride?: string,
  slugOverride?: string,
): { db: Database; brief: MaterialsBrief | null } {
  const db = getDb();
  const candidate = selectCandidate(db, INDEX_PATH, reportOverride);
  if (!candidate) return { db, brief: null };

  // Some report filenames carry no descriptive slug after the leading ISO-timestamp prefix is
  // stripped (e.g. a batch-triage file literally named "<timestamp>_research.md" derives the
  // generic slug "research") — --slug lets a human supply a real one so the Whop product route
  // isn't a meaningless URL. Auto-derived otherwise.
  const slug = slugOverride ? slugify(slugOverride) : slugFromReportFile(candidate.reportFile);
  const route = slugify(slug);
  const fileKey = fileKeyFromReportFile(candidate.reportFile);
  const reportPath = resolveReportPath(candidate.reportFile);
  const reportMarkdown = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, "utf-8") : "";

  db.run(
    `INSERT OR IGNORE INTO packaging_queue_log (report_file, slug, route, relevance, sku_why, status, file_key) VALUES (?, ?, ?, ?, ?, 'queued', ?)`,
    [candidate.reportFile, slug, route, candidate.relevance, candidate.skuWhy, fileKey],
  );
  // A resumed row (materials re-run on an already-queued candidate, e.g. after an interrupted
  // attempt) may predate this fix and have a NULL file_key — backfill it so stage's SELECT * read
  // is never stuck with the old, potentially-colliding value.
  db.run(`UPDATE packaging_queue_log SET file_key = ? WHERE report_file = ? AND file_key IS NULL`, [
    fileKey,
    candidate.reportFile,
  ]);

  const brief: MaterialsBrief = {
    reportFile: candidate.reportFile,
    slug,
    fileKey,
    route,
    relevance: candidate.relevance,
    skuWhy: candidate.skuWhy,
    reportPath,
    reportMarkdown,
    suggestedPriceUsd: DEFAULT_PRICE_USD,
    voiceInstructions: {
      human:
        'Description MUST include the human frame, verbatim or near-verbatim: "operator: give this to your agent". ' +
        "The buyer is a human agent-operator who hands this report to their own AI agent to read/use — audience is LOCKED to agent operators (QUEST.md #11), not general Bitcoin/Stacks readers. " +
        "Lead with the report's real measured hook/number in the FIRST sentence — do not bury it in sentence two or three (arc-strategy-panel/Hale finding).",
      agent:
        'Description MUST include the agent frame, verbatim or near-verbatim: "read this content". ' +
        "Do NOT claim x402 delivers this product 'immediately' or 'now' — the x402 rail is not yet wired to this specific catalog entry. Say payment is via the Whop checkout below, and that direct x402 agent-to-agent payment for this catalog is coming (point to arc0btc.com for endpoints that ARE live now). Overclaiming a payment path that doesn't work yet is a real broken-transaction risk for an agent buyer, not a soft marketing exaggeration (arc-strategy-panel/Voss finding).",
      quiz:
        'REQUIRED (control-plane-remediation Phase 2, row 62 — "research -> report -> quiz" was decided but never wired). ' +
        'Draft "quiz": { "questions": [...], "minimumCorrect": <int> } with AT LEAST 3 questions drawn from THIS report\'s ' +
        'actual claims (never invented facts) — each question is { "question_text", "question_type": "multiple_choice"|' +
        '"true_false"|"short_answer"|"multiple_select", "correct_answer", "options"? (multiple_choice/multiple_select ' +
        'need 4 options with exactly the right ones is_correct:true) }. Mirror the live examples already attached to ' +
        "other SKUs (skills/whop/assets/p2-covers/*.quiz.json) for exact shape. minimumCorrect defaults to ceil(60% of " +
        "question count) if omitted. stage will hard-fail (DEFERRED) without this.",
    },
    sanitizationChecklist: [
      "no API keys, tokens, passwords, private-key material",
      "no internal IPs / VM hostnames / SSH details",
      "no un-redacted credential-adjacent operational detail",
      "no unreleased strategic plans not meant for a paying stranger",
      'vary the closing sentence PER SKU — do not reuse the same closing across multiple products, that is the "same intro every time" problem relocated to the paywall (arc-strategy-panel/Reyes finding)',
    ],
  };

  return { db, brief };
}

async function cmdMaterials(reportOverride?: string, slugOverride?: string): Promise<void> {
  console.log("=== arc-packaging — Materials Brief ===");
  const { db, brief } = composeMaterials(reportOverride, slugOverride);
  if (!brief) {
    console.error(
      "NO ELIGIBLE CANDIDATE: research/INDEX.md's SKU backlog has no relevance>=4 report that isn't already queued/packaged.",
    );
    db.close();
    process.exit(1);
  }
  console.log(`Candidate: ${brief.reportFile} (relevance ${brief.relevance})`);
  console.log(`Slug: ${brief.slug} | Route: ${brief.route} | File key: ${brief.fileKey}`);
  console.log(`sku_why: ${brief.skuWhy}`);

  if (!fs.existsSync(MATERIALS_DIR)) fs.mkdirSync(MATERIALS_DIR, { recursive: true });
  const outPath = join(MATERIALS_DIR, `${brief.fileKey}.json`);
  fs.writeFileSync(outPath, JSON.stringify(brief, null, 2));
  console.log(`\nWrote brief to ${outPath} (includes the report's full text — reportMarkdown).`);
  console.log(`Next: draft { "title": "...", "headline": "...", "description": "...", "quiz": {...} } to`);
  console.log(`  ${join(MATERIALS_DIR, `${brief.fileKey}.draft.json`)}`);
  console.log(`  (quiz is REQUIRED — see voiceInstructions.quiz in the brief above; stage attaches it AND`);
  console.log(`  generates+attaches a cover automatically, but will keep the SKU hidden if either fails)`);
  console.log(`Then run: bun cli.ts stage --report ${brief.reportFile}`);
  db.close();
}

// ---------- Stage (deterministic) ----------

// Mirrors whop/cli.ts's QuizQuestion shape exactly (create-product --quiz / attach-deliverable
// --quiz both read this JSON verbatim) — control-plane-remediation Phase 2, row 62: every SKU
// now REQUIRES a quiz in the draft, same enforcement tier as the dual-audience-frame description.
interface QuizQuestion {
  question_text: string;
  question_type: "short_answer" | "true_false" | "multiple_choice" | "multiple_select";
  correct_answer: string;
  options?: Array<{ option_text: string; is_correct: boolean }>;
}

interface Draft {
  title: string;
  headline?: string;
  description: string;
  price?: number;
  quiz: { questions: QuizQuestion[]; minimumCorrect?: number };
}

export function loadDraft(fileKey: string): Draft {
  const p = join(MATERIALS_DIR, `${fileKey}.draft.json`);
  if (!fs.existsSync(p)) {
    throw new Error(`DEFERRED — missing draft: ${p}. Write { title, headline, description, quiz } first (see materials output), then re-run stage.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (e) {
    throw new Error(
      `DEFERRED — ${p} is not valid JSON (${e instanceof Error ? e.message : String(e)}). Fix the file's JSON syntax and re-run stage — do not delete it, the draft content may still be salvageable.`,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`DEFERRED — ${p} must be a JSON object with { title, description } (got ${typeof parsed}).`);
  }
  const d = parsed as Record<string, unknown>;
  if (typeof d.title !== "string" || !d.title.trim()) {
    throw new Error(`DEFERRED — ${p} is missing a non-empty string "title".`);
  }
  if (typeof d.description !== "string" || !d.description.trim()) {
    throw new Error(`DEFERRED — ${p} is missing a non-empty string "description".`);
  }
  if (d.headline !== undefined && typeof d.headline !== "string") {
    throw new Error(`DEFERRED — ${p}'s "headline" must be a string if present.`);
  }
  if (d.price !== undefined && typeof d.price !== "number") {
    throw new Error(`DEFERRED — ${p}'s "price" must be a number if present.`);
  }
  // Structural shape only here (matches title/description's style) — the ">=3 questions"
  // business rule lives in validateDraft alongside the other stage-time content checks.
  if (typeof d.quiz !== "object" || d.quiz === null || !Array.isArray((d.quiz as Record<string, unknown>).questions)) {
    throw new Error(
      `DEFERRED — ${p} is missing "quiz": { questions: [...] } — every SKU now requires a quiz draft (control-plane-remediation Phase 2, row 62). See MaterialsBrief.voiceInstructions.quiz for the required shape.`,
    );
  }
  return d as unknown as Draft;
}

export function validateDraft(draft: Draft, reportMarkdown: string, forceSanitization: boolean): string[] {
  const errors: string[] = [];
  const descLower = (draft.description ?? "").toLowerCase();
  if (!descLower.includes("operator") || !descLower.includes("give this to your agent")) {
    errors.push('description missing the required human frame ("operator: give this to your agent")');
  }
  if (!descLower.includes("read this content")) {
    errors.push('description missing the required agent frame ("read this content")');
  }
  // Whop's products.create rejects headline > 80 chars live (discovered running this pipeline
  // for real, 2026-07-03: "Headline is too long (maximum is 80 characters)") — catch it here,
  // deterministically, before the subprocess call, instead of failing mid-stage against a real
  // API after the row is already claimed.
  if (draft.headline && draft.headline.length > 80) {
    errors.push(`headline is ${draft.headline.length} chars, Whop's products.create limit is 80 — shorten it`);
  }
  // title hit the same 80-char products.create limit live, 2026-07-09 (task #21874) — a 111-char
  // title only surfaced as a raw Whop 400/422 after create-product had already run.
  if (draft.title && draft.title.length > 80) {
    errors.push(`title is ${draft.title.length} chars, Whop's products.create limit is 80 — shorten it`);
  }
  // description hit Whop's products.create 1500-char limit live, 2026-07-08 (task #21744) — this
  // check was documented in SKILL.md but never actually landed in code; adding it now alongside
  // the title/headline checks above.
  if (draft.description && draft.description.length > 1500) {
    errors.push(
      `description is ${draft.description.length} chars, Whop's products.create limit is 1500 — shorten it`,
    );
  }
  if (!forceSanitization) {
    const scanText = [reportMarkdown, draft.title, draft.headline ?? "", draft.description].join("\n");
    for (const hit of sanitizeScan(scanText)) {
      errors.push(`SANITIZATION: ${hit}`);
    }
  }
  // Quiz — REQUIRED (control-plane-remediation Phase 2, row 62): loadDraft already checked the
  // structural shape; this is the business rule (matches the other content checks' severity).
  const questions = draft.quiz?.questions ?? [];
  if (questions.length < 3) {
    errors.push(`quiz has ${questions.length} question(s), at least 3 are required`);
  }
  questions.forEach((q, i) => {
    if (!q.question_text || !q.question_text.trim()) errors.push(`quiz question ${i + 1} is missing question_text`);
    if (!q.correct_answer || !String(q.correct_answer).trim()) errors.push(`quiz question ${i + 1} is missing correct_answer`);
    if (!["short_answer", "true_false", "multiple_choice", "multiple_select"].includes(q.question_type)) {
      errors.push(`quiz question ${i + 1} has an invalid question_type: ${q.question_type}`);
    }
    if ((q.question_type === "multiple_choice" || q.question_type === "multiple_select") && (!q.options || q.options.length < 2)) {
      errors.push(`quiz question ${i + 1} (${q.question_type}) needs at least 2 "options"`);
    }
  });
  return errors;
}

function parseJsonTail(stdout: string): Record<string, unknown> {
  const jsonStart = stdout.indexOf("{");
  if (jsonStart === -1) throw new Error(`no JSON found in output: ${stdout}`);
  return JSON.parse(stdout.slice(jsonStart));
}

/**
 * Dedup-before-mint gate: does an ALREADY-PACKAGED report (a report with a live Whop product)
 * cover the same url/topics as the candidate about to be minted? Reuses arc-link-research's own
 * findCoverage() rather than re-deriving overlap logic — this skill and arc-link-research must
 * never disagree on what "already covered" means (same class of dual-source-of-truth trap
 * lib/backlog.ts's doc comment already warns about for backlog SELECTION; this is the same
 * discipline applied to dedup).
 */
function findDuplicateCoverage(reportFile: string): CatalogEntry[] {
  const files = fs.readdirSync(RESEARCH_DIR).filter((f) => f.endsWith(".md") && f !== "INDEX.md");
  const packaged: CatalogEntry[] = [];
  for (const f of files) {
    if (f === reportFile) continue; // never compare a candidate against itself
    let content: string;
    try {
      content = fs.readFileSync(join(RESEARCH_DIR, f), "utf-8");
    } catch {
      continue; // unreadable (e.g. removed mid-scan) — skip, don't crash stage over it
    }
    const fm = parseFrontmatter(content);
    if (fm && fm.packaged) packaged.push({ path: f, fm });
  }

  const ownReportPath = resolveReportPath(reportFile);
  const ownContent = fs.existsSync(ownReportPath) ? fs.readFileSync(ownReportPath, "utf-8") : "";
  const ownFm = parseFrontmatter(ownContent);
  if (!ownFm) return [];
  return findCoverage(packaged, { url: ownFm.source_url, topics: ownFm.topics });
}

type ClaimResult = "claimed" | "resumed" | "already-packaged";

/**
 * Atomic-enough claim via compare-and-swap on the row's status (dev-council: Kleppmann flagged
 * the earlier bare UPDATE as lacking the linearization point P2's claimArticle() has via its
 * INSERT+UNIQUE-catch — this restores an equivalent guarantee for an already-inserted row using
 * an `UPDATE ... WHERE status = 'queued'` guard and checking the SQLite `changes` count). Three
 * outcomes: freshly claimed (proceed), resumed (a prior attempt was interrupted after this
 * process's own claim — proceed, same as P2), or already-packaged (idempotent no-op).
 */
function claimCandidate(db: Database, reportFile: string): ClaimResult {
  const before = db.query("SELECT status FROM packaging_queue_log WHERE report_file = ?").get(reportFile) as
    | { status: string }
    | null;
  if (!before) throw new Error(`claimCandidate: no row for ${reportFile} — run materials first`);
  if (before.status === "packaged") return "already-packaged";
  if (before.status === "claimed") return "resumed"; // this process (or a prior run) already holds it

  const result = db.run(
    `UPDATE packaging_queue_log SET status = 'claimed', claimed_at = ? WHERE report_file = ? AND status = 'queued'`,
    [new Date().toISOString(), reportFile],
  );
  if (result.changes === 0) {
    // Lost the race (or the row moved between the SELECT above and this UPDATE) — re-read and
    // resolve rather than assume.
    const after = db.query("SELECT status FROM packaging_queue_log WHERE report_file = ?").get(reportFile) as {
      status: string;
    };
    return after.status === "packaged" ? "already-packaged" : "resumed";
  }
  return "claimed";
}

async function cmdStage(
  reportFile: string,
  dryRun: boolean,
  forceSanitization: boolean,
  deliverableOverride?: string,
  keepHidden = false,
  routeOverride?: string,
): Promise<void> {
  console.log(`=== arc-packaging — Stage ${reportFile} ${dryRun ? "(DRY-RUN)" : ""} ===`);
  const db = getDb();
  const row = db.query("SELECT * FROM packaging_queue_log WHERE report_file = ?").get(reportFile) as
    | { report_file: string; slug: string; route: string; status: string; file_key: string | null }
    | null;
  if (!row) {
    console.error(`no queued row for ${reportFile} — run 'materials' first`);
    db.close();
    process.exit(1);
  }
  if (row.status === "packaged") {
    console.log(`${reportFile} is already packaged — idempotent no-op, not an error.`);
    db.close();
    return;
  }
  // Pre-#24240 rows may have a NULL file_key (materials never re-run since the migration) —
  // fall back to deriving it fresh rather than silently reading the old, potentially-colliding
  // slug-keyed files.
  const fileKey = row.file_key ?? fileKeyFromReportFile(row.report_file);

  let draft: Draft;
  try {
    draft = loadDraft(fileKey);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    db.close();
    process.exit(1);
  }

  const reportPath = resolveReportPath(reportFile);
  const rawReportMarkdown = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, "utf-8") : "";
  const errors = validateDraft(draft, rawReportMarkdown, forceSanitization);
  if (errors.length > 0) {
    console.error("DEFERRED — stage validation failed:");
    errors.forEach((e) => console.error(`  - ${e}`));
    if (!forceSanitization && errors.some((e) => e.startsWith("SANITIZATION:"))) {
      console.error(
        "  (a sanitization hit can be a false positive on legitimate research content — re-run with --force-sanitization ONLY after a human confirms the flagged text is not actually a secret; this flag is never used by the automated sensor path)",
      );
    }
    db.close();
    process.exit(1);
  }

  const dupes = findDuplicateCoverage(reportFile);
  if (dupes.length > 0) {
    console.error(
      `DEFERRED — dedup-before-mint gate: ${reportFile} overlaps ${dupes.length} already-packaged report(s), no SKU will be minted:`,
    );
    for (const d of dupes) console.error(`  - ${d.path} (product ${d.fm.product_id || "?"}, topics: ${d.fm.topics.join(", ")})`);
    if (dryRun) {
      db.close();
      return;
    }
    db.run(
      `UPDATE packaging_queue_log SET status = 'duplicate', claimed_at = ? WHERE report_file = ?`,
      [new Date().toISOString(), reportFile],
    );
    console.error(`Marked ${reportFile} 'duplicate' in packaging_queue_log — will not be re-selected.`);
    db.close();
    process.exit(1);
  }

  if (dryRun) {
    console.log(
      `[DRY-RUN] validation + sanitization scan passed, no duplicate coverage found. Would claim, create-product (hidden), mark-packaged, unlock-all (silent)${keepHidden ? ", then stop (--keep-hidden)" : ", then set-visibility visible (live on the storefront)"}.`,
    );
    db.close();
    return;
  }

  const claim = claimCandidate(db, reportFile);
  if (claim === "already-packaged") {
    console.log(`${reportFile} is already packaged — idempotent no-op, not an error.`);
    db.close();
    return;
  }
  if (claim === "resumed") {
    console.log(`${reportFile} was claimed but not finalized (a prior 'stage' run was interrupted) — resuming, not aborting.`);
  }

  // A --route override lets an operator fix a generic auto-derived route (e.g. "research")
  // that Whop rejects as already reserved by another creator, without touching the row's slug
  // (which the draft filename and deliverable path are keyed on) or resorting to raw SQL.
  if (routeOverride) {
    const newRoute = slugify(routeOverride);
    db.run(`UPDATE packaging_queue_log SET route = ? WHERE report_file = ?`, [newRoute, reportFile]);
    row.route = newRoute;
  }

  const price = draft.price ?? DEFAULT_PRICE_USD;
  // --deliverable lets a report ship an ALREADY-POLISHED standalone deliverable (e.g. a guide
  // an earlier session hand-authored from this same report) instead of the raw research report
  // + automatic strip pass. `report_file`/mark-packaged bookkeeping still tracks the ORIGINAL
  // research report identity — only the content attached to the Whop product changes. Skips
  // cleanDeliverableMarkdown (a manually-supplied override is assumed already customer-ready;
  // running the strip regexes on hand-authored prose risks mangling it).
  let cleanedMarkdown: string;
  if (deliverableOverride) {
    if (!fs.existsSync(deliverableOverride)) {
      throw new Error(`--deliverable path does not exist: ${deliverableOverride}`);
    }
    cleanedMarkdown = fs.readFileSync(deliverableOverride, "utf-8");
    console.log(`Using deliverable override: ${deliverableOverride} (skipping auto-strip — assumed already customer-ready)`);
  } else {
    cleanedMarkdown = cleanDeliverableMarkdown(rawReportMarkdown);
  }
  const cleanedPath = join(MATERIALS_DIR, `${fileKey}.deliverable.md`);
  fs.writeFileSync(cleanedPath, cleanedMarkdown);

  // Quiz — REQUIRED (row 62): write the validated draft.quiz to its own JSON file, in the exact
  // shape whop/cli.ts's create-product --quiz already reads (skills/whop/assets/p2-covers/
  // *.quiz.json is the live-proven format). Passed at create time so the deliverable (report +
  // quiz) attaches atomically with the SKU's mint, matching create-product's own "no bare SKU"
  // design instead of a separate attach-deliverable follow-up call.
  const quizPath = join(MATERIALS_DIR, `${fileKey}.quiz.json`);
  fs.writeFileSync(quizPath, JSON.stringify(draft.quiz, null, 2));

  const createArgs = [
    "skills",
    "run",
    "--name",
    "whop",
    "--",
    "create-product",
    "--title",
    draft.title,
    "--route",
    row.route,
    "--price",
    String(price),
    "--description",
    draft.description,
    ...(draft.headline ? ["--headline", draft.headline] : []),
    "--report",
    cleanedPath,
    "--quiz",
    quizPath,
  ];
  const createResult = await runCommand("bash", ["bin/arc", ...createArgs]);
  if (createResult.exitCode !== 0) {
    throw new Error(`whop create-product failed (exit ${createResult.exitCode}): ${createResult.stderr || createResult.stdout}`);
  }
  const createJson = parseJsonTail(createResult.stdout) as {
    product_id: string;
    plan_id: string;
    constants?: { PRODUCT_CHECKOUT_URL?: string };
    deliverable?: { quiz_lesson_id?: string | null } | null;
  };
  console.log(`Created Whop product: ${createJson.product_id} (plan ${createJson.plan_id})`);
  const quizOk = createJson.deliverable?.quiz_lesson_id != null;
  console.log(`Quiz attached: ${quizOk} (lesson ${createJson.deliverable?.quiz_lesson_id ?? "none"})`);
  // Record the irreversible external effect (a real Whop product now exists) the instant it's
  // known, before the next subprocess call, so a crash after this point is still fully
  // auditable from the DB alone (dev-council: Kleppmann's audit-gap note).
  db.run(`UPDATE packaging_queue_log SET product_id = ?, plan_id = ? WHERE report_file = ?`, [
    createJson.product_id,
    createJson.plan_id,
    reportFile,
  ]);

  const markResult = await runCommand("bash", [
    "bin/arc",
    "skills",
    "run",
    "--name",
    "arc-link-research",
    "--",
    "mark-packaged",
    "--report",
    reportFile,
    "--product",
    createJson.product_id,
  ]);
  if (markResult.exitCode !== 0) {
    throw new Error(`arc-link-research mark-packaged failed (exit ${markResult.exitCode}): ${markResult.stderr || markResult.stdout}`);
  }
  console.log("Marked packaged in research/INDEX.md.");

  // Entitlement only, silent by default — no automatic member-facing announcement. dev-council
  // (Newman): the original design's automatic chat post fired a live $0 checkout link to real
  // paying members three subprocesses deep with no operator visibility (a real premature-
  // exposure risk, even though a single paid-chat post isn't a QUEST.md hard gate). Note the
  // storefront itself is NO LONGER operator-gated (2026-07-03 directive: SKUs publish
  // autonomously) — this --skip-chat gate survives on member-chat grounds alone: a push into
  // paying members' chat is a different act than a new item appearing in a public catalog.
  // The operator email below (Hohpe's "no feedback loop" fix) gives the operator everything
  // needed to post the announcement themselves, or to explicitly ask Arc to.
  const unlockResult = await runCommand("bash", [
    "bin/arc",
    "skills",
    "run",
    "--name",
    "whop",
    "--",
    "unlock-all",
    "--product",
    createJson.product_id,
    "--plan",
    createJson.plan_id,
    "--title",
    draft.title,
    "--skip-chat",
  ]);
  if (unlockResult.exitCode !== 0) {
    throw new Error(`whop unlock-all failed (exit ${unlockResult.exitCode}): ${unlockResult.stderr || unlockResult.stdout}`);
  }
  const unlockJson = parseJsonTail(unlockResult.stdout) as { promo_id?: string; checkout_url?: string };
  console.log(`Membership unlock-all wired (silent — promo ${unlockJson.promo_id ?? "?"}, no chat post fired).`);

  // Cover — REQUIRED (row 61): deterministic, no LLM call (see lib/cover.ts). Generated AFTER
  // create-product so it can be attributed to the real product id in its filename, and BEFORE
  // the publish gate below so a render/upload failure can hold the SKU hidden rather than
  // shipping a visible product with an empty gallery (the exact row-61 failure mode).
  let coverOk = false;
  try {
    const coverPng = await renderSkuCover(draft.title, draft.headline ?? "", new Date().toISOString().slice(0, 10));
    const coverPath = join(MATERIALS_DIR, `${fileKey}.cover.png`);
    fs.writeFileSync(coverPath, coverPng);
    const coverResult = await runCommand("bash", [
      "bin/arc", "skills", "run", "--name", "whop", "--",
      "update-product", "--product", createJson.product_id, "--cover", coverPath,
    ]);
    if (coverResult.exitCode !== 0) {
      console.error(`whop update-product --cover failed (exit ${coverResult.exitCode}): ${coverResult.stderr || coverResult.stdout}`);
    } else {
      const coverJson = parseJsonTail(coverResult.stdout) as { after?: { gallery_images?: unknown[] } };
      coverOk = Array.isArray(coverJson.after?.gallery_images) && coverJson.after!.gallery_images!.length > 0;
    }
  } catch (e) {
    console.error(`cover generation failed (non-fatal to packaging, blocks auto-publish below): ${e instanceof Error ? e.message : String(e)}`);
  }
  console.log(`Cover attached: ${coverOk}`);

  // Publish LAST — the commit step (operator directive 2026-07-03: SKUs publish autonomously,
  // same as the blog; dev-council/Newman: publish must be the TERMINAL mutation so the public
  // storefront never shows a SKU whose deliverable or member $0 promo isn't wired yet). This
  // runs before the status='packaged' update on purpose: a crash or a failed flip leaves the
  // row 'claimed', so the resume path re-runs the whole (idempotent) chain including this
  // flip, instead of stranding a packaged-but-hidden SKU. `published` is read back from what
  // Whop actually returned, never assumed from the flag (dev-council: Kleppmann/Lamport/Hohpe).
  //
  // control-plane-remediation Phase 2 (row 61/62/63): cover+quiz are now REQUIRED stage steps —
  // a caller NOT passing --keep-hidden no longer guarantees a visible SKU. If either failed, the
  // SKU stays hidden regardless of the flag (loud log, not a thrown error — packaging itself
  // still succeeded and the row is still marked 'packaged' below; a human/future run retries
  // `update-product --cover` / `attach-deliverable --quiz` then `set-visibility` by hand).
  let published = false;
  const publishBlockedReason = !coverOk ? "cover generation/attach failed" : !quizOk ? "quiz did not attach" : null;
  if (keepHidden) {
    console.log("Kept hidden (--keep-hidden) — publish later via `whop set-visibility ... --visibility visible`.");
  } else if (publishBlockedReason) {
    console.log(`Kept hidden — auto-publish REQUIRES cover+quiz (row 61/62 gate): ${publishBlockedReason}. Fix and re-run \`whop set-visibility --product ${createJson.product_id} --plan ${createJson.plan_id} --visibility visible\` manually once resolved.`);
  } else {
    const visResult = await runCommand("bash", [
      "bin/arc",
      "skills",
      "run",
      "--name",
      "whop",
      "--",
      "set-visibility",
      "--product",
      createJson.product_id,
      "--plan",
      createJson.plan_id,
      "--visibility",
      "visible",
    ]);
    if (visResult.exitCode !== 0) {
      throw new Error(`whop set-visibility failed (exit ${visResult.exitCode}): ${visResult.stderr || visResult.stdout}`);
    }
    const visJson = parseJsonTail(visResult.stdout) as {
      after?: { visibility?: string; plan?: { visibility?: string } | null };
    };
    published = visJson.after?.visibility === "visible" && visJson.after?.plan?.visibility === "visible";
    if (!published) {
      throw new Error(
        `set-visibility read-back did not confirm visible (got ${JSON.stringify(visJson.after)}) — row left 'claimed' for resume`,
      );
    }
    console.log(`Published — product ${createJson.product_id} + plan ${createJson.plan_id} visible on the storefront (read back).`);

    // control-plane-remediation Phase 7 (track c), P6 defect row 39: this is the ONLY place
    // the stable 'latest-report' checkout_config pointer gets updated — right after `published`
    // is confirmed true from Whop's own read-back (not from the flag), same trust boundary the
    // rest of this function already uses. A failed/hidden publish (publishBlockedReason above,
    // or --keep-hidden) never reaches here, so the pointer only ever points at a SKU that's
    // actually live — a stale-but-valid old URL is safer than one to a product that never
    // published.
    const stableCheckoutUrl = createJson.constants?.PRODUCT_CHECKOUT_URL ?? null;
    if (stableCheckoutUrl) {
      try {
        setLatestReportCheckoutUrl(stableCheckoutUrl);
        console.log(`Stable checkout-URL pointer (checkout_config.latest-report) updated -> ${stableCheckoutUrl}`);
      } catch (e) {
        // Non-fatal to packaging (the SKU itself published successfully) — logged loudly so a
        // missing/broken pointer is visible, not silently stale.
        console.error(`setLatestReportCheckoutUrl failed (non-fatal, packaging still succeeded): ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      console.error("No PRODUCT_CHECKOUT_URL in create-product's constants — stable checkout-URL pointer NOT updated this run.");
    }
  }

  db.run(
    `UPDATE packaging_queue_log SET status = 'packaged', promo_code_id = ?, packaged_at = ? WHERE report_file = ?`,
    [unlockJson.promo_id ?? null, new Date().toISOString(), reportFile],
  );
  db.close();

  const productPageUrl = createJson.constants?.PRODUCT_CHECKOUT_URL ?? null;
  const emailSent = await sendPackagingReviewEmail({
    reportFile,
    title: draft.title,
    productId: createJson.product_id,
    planId: createJson.plan_id,
    checkoutUrl: productPageUrl,
    promoId: unlockJson.promo_id ?? null,
    memberCheckoutUrl: unlockJson.checkout_url ?? null,
    published,
    priceUsd: price,
  });

  console.log(
    JSON.stringify(
      {
        success: true,
        report_file: reportFile,
        product_id: createJson.product_id,
        plan_id: createJson.plan_id,
        promo_id: unlockJson.promo_id ?? null,
        checkout_url: productPageUrl,
        unlock_checkout_url: unlockJson.checkout_url ?? null,
        operator_review_email_sent: emailSent,
        status: "packaged",
      },
      null,
      2,
    ),
  );
}

// ---------- Operator notification (dev-council: Hohpe's "no feedback loop" finding) ----------
//
// Reuses arc-daily-read's/arc-article-pipeline's established email lane (email/api_base_url,
// email/admin_api_key, email/report_recipient via src/credentials.ts, POST {base}/api/send)
// rather than inventing a second one. One email per packaged SKU — not a bulk send.
async function sendPackagingReviewEmail(info: {
  reportFile: string;
  title: string;
  productId: string;
  planId: string;
  checkoutUrl: string | null;
  promoId: string | null;
  memberCheckoutUrl: string | null;
  published: boolean;
  priceUsd: number;
}): Promise<boolean> {
  try {
    const { getCredential } = await import(join(ARC_STARTER_ROOT, "src/credentials.ts"));
    const apiBaseUrl = await getCredential("email", "api_base_url");
    const adminKey = await getCredential("email", "admin_api_key");
    const recipient = await getCredential("email", "report_recipient");
    if (!apiBaseUrl || !adminKey || !recipient) {
      log("email credentials not configured — skipping packaging review email");
      return false;
    }

    const subject = info.published
      ? `New Whop SKU published — "${info.title}" (live on the storefront)`
      : `New Whop SKU packaged — "${info.title}" (hidden, ready for your review)`;
    const statusLines = info.published
      ? [
          `Status: PUBLISHED — live and buyable on the public storefront (product + plan visible).`,
          `Per your 2026-07-03 directive, SKUs publish autonomously, same as the blog. No action`,
          `needed; this email is your visibility, not a review gate.`,
        ]
      : [
          `Status: HIDDEN — not on the public storefront, reachable only by direct link. Nothing`,
          `changes for buyers or members until you flip visibility.`,
        ];
    const closingLines = info.published
      ? [
          `The member announcement stays operator-gated — the redemption link has NOT been posted`,
          `into the paid chat. Post it yourself or ask Arc to.`,
          ``,
          `Rollback (pulls it off the storefront):`,
          `  bash bin/arc skills run --name whop -- set-visibility --product ${info.productId} --plan ${info.planId} --visibility hidden`,
        ]
      : [
          `When you're ready: flip the product visible, and post the member redemption link into`,
          `the paid chat yourself (or ask Arc to) — packaging stops here on purpose so a real`,
          `person reviews a new SKU before it reaches a paying member.`,
        ];
    const plainText = [
      `Arc packaged a new $${info.priceUsd} SKU from ${info.reportFile}: "${info.title}".`,
      ``,
      ...statusLines,
      ``,
      `Product page / checkout: ${info.checkoutUrl ?? "(see whop dashboard, product " + info.productId + ")"}`,
      `Product ID: ${info.productId} | Plan ID: ${info.planId}`,
      ``,
      `Membership unlock-all is wired (silent — no announcement has been posted yet):`,
      `  Promo: ${info.promoId ?? "(none)"}`,
      `  Member $0 redemption link: ${info.memberCheckoutUrl ?? "(none)"}`,
      ``,
      ...closingLines,
    ].join("\n");
    const response = await fetch(`${apiBaseUrl}/api/send`, {
      method: "POST",
      headers: { "X-Admin-Key": adminKey, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ to: recipient, subject, body: plainText }),
    });
    if (!response.ok) {
      log(`packaging review email failed (non-fatal): HTTP ${response.status} — ${await response.text()}`);
      return false;
    }
    return true;
  } catch (e) {
    log(`packaging review email failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

async function cmdStatus(): Promise<void> {
  const db = getDb();
  const rows = db.query("SELECT * FROM packaging_queue_log ORDER BY queued_at DESC").all();
  console.log(JSON.stringify(rows, null, 2));
  db.close();
}

// ---------- CLI entry ----------

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

async function main() {
  // src/db.ts's getDatabase() (used by setLatestReportCheckoutUrl in `stage`) throws unless the
  // shared handle is initialized first. Idempotent — mirrors other CLI entry points. Without it,
  // stage's checkout_config 'latest-report' pointer update silently no-ops (caught non-fatally).
  initDatabase();
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "clean-deliverable": {
      // Debug/recovery command: regenerate a cleaned deliverable from a raw research report
      // without going through the full materials/stage flow — used to recover a product whose
      // attached deliverable predates a cleanDeliverableMarkdown fix (re-run, then
      // `whop attach-deliverable --product <id> --report <out-path>` to refresh Whop's copy).
      const report = argValue(args, "--report");
      const out = argValue(args, "--out");
      if (!report || !out) {
        console.error("clean-deliverable requires --report <filename-in-research/> --out <path>");
        process.exit(1);
      }
      const raw = fs.readFileSync(join(RESEARCH_DIR, report), "utf-8");
      fs.writeFileSync(out, cleanDeliverableMarkdown(raw));
      console.log(`Wrote cleaned deliverable to ${out}`);
      break;
    }
    case "materials": {
      await cmdMaterials(argValue(args, "--report"), argValue(args, "--slug"));
      break;
    }
    case "stage": {
      const report = argValue(args, "--report");
      if (!report) {
        console.error("stage requires --report <filename-in-research/>");
        process.exit(1);
      }
      await cmdStage(
        report,
        args.includes("--dry-run"),
        args.includes("--force-sanitization"),
        argValue(args, "--deliverable"),
        args.includes("--keep-hidden"),
        argValue(args, "--route"),
      );
      break;
    }
    case "status": {
      await cmdStatus();
      break;
    }
    default: {
      console.error(
        [
          "arc-packaging CLI — the standing packaging pipeline stage",
          "",
          "  materials [--report <filename-in-research/>] [--slug <slug>]  pick the next backlog candidate, write a materials brief",
          "                                                                (--slug overrides the auto-derived slug/route for a report whose",
          "                                                                filename has no descriptive part, e.g. a batch-triage file)",
          "  stage --report <filename> [--dry-run] [--force-sanitization] [--deliverable <path>] [--keep-hidden] [--route <slug>]",
          "                                                                validate the draft (+ sanitization scan unless forced), then mint AND",
          "                                                                PUBLISH the SKU (visible on the storefront — operator directive 2026-07-03)",
          "  status                                                        show packaging_queue_log",
          "",
          "  --keep-hidden: mint without publishing (old behavior — hidden until a set-visibility flip).",
          "  --force-sanitization: human-only escape hatch for a confirmed sanitizer false positive.",
          "  Never used by the automated sensor path.",
          "  --deliverable <path>: ship an already-polished standalone file instead of the raw",
          "  research report + auto-strip pass (report_file identity/mark-packaged still tracks",
          "  the original research report).",
          "  --route <slug>: override the auto-derived route (persisted to packaging_queue_log)",
          "  for when Whop rejects it as already reserved by another creator — e.g. a generic",
          "  slug like \"research\".",
        ].join("\n"),
      );
      process.exit(command ? 1 : 0);
    }
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`arc-packaging: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
