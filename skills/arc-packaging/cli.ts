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
// New Whop products are created HIDDEN by create-product's own existing default; this pipeline
// does not need an operator gate to MINT (no money moves, nothing is publicly discoverable
// until the operator's separate visibility flip). It DOES gate on the operator before any
// member-facing announcement fires — see the unlock-all call in cmdStage below (dev-council:
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
import { selectCandidate } from "./lib/backlog.ts";

const ARC_STARTER_ROOT = join(import.meta.dir, "../../");
const DB_PATH = process.env.ARC_PACKAGING_DB_PATH ?? join(ARC_STARTER_ROOT, "db/arc.sqlite");
const RESEARCH_DIR = join(ARC_STARTER_ROOT, "research");
const INDEX_PATH = join(RESEARCH_DIR, "INDEX.md");
const MATERIALS_DIR = join(ARC_STARTER_ROOT, "db/packaging-materials");

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

  return db;
}

function slugFromReportFile(reportFile: string): string {
  return reportFile.replace(/^\d{4}-\d{2}-\d{2}T[\d:-]+Z_/, "").replace(/\.md$/, "");
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

  // Drop the "## Recommendations" section entirely (own-backlog planning, not customer content).
  // Stops at the next "## " heading or "---" divider, whichever comes first.
  out = out.replace(/\n## Recommendations\b[\s\S]*?(?=\n## |\n---\n|$)/, "\n");

  // [[wiki-link]] -> plain text (strip the double brackets, keep the readable label).
  out = out.replace(/\[\[([^\]]+)\]\]/g, "$1");

  // Relabel "## Provenance" as customer-facing, and drop internal-only lines (cache paths,
  // task IDs) while keeping the plain-English source/date claims that back the "tested against
  // a live agent" proof.
  out = out.replace(/\n## Provenance\b/, "\n## How this was verified");
  out = out
    .split("\n")
    .filter((line) => !/cache[`:]|task[_ ]?#?\d|task_id/i.test(line) || !line.trim().startsWith("-"))
    .join("\n");

  return out.trim() + "\n";
}

// ---------- Materials brief ----------

interface MaterialsBrief {
  reportFile: string;
  slug: string;
  route: string;
  relevance: number;
  skuWhy: string;
  reportPath: string;
  reportMarkdown: string;
  suggestedPriceUsd: number;
  voiceInstructions: {
    human: string;
    agent: string;
  };
  sanitizationChecklist: string[];
}

function composeMaterials(reportOverride?: string): { db: Database; brief: MaterialsBrief | null } {
  const db = getDb();
  const candidate = selectCandidate(db, INDEX_PATH, reportOverride);
  if (!candidate) return { db, brief: null };

  const slug = slugFromReportFile(candidate.reportFile);
  const route = slugify(slug);
  const reportPath = join(RESEARCH_DIR, candidate.reportFile);
  const reportMarkdown = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, "utf-8") : "";

  db.run(
    `INSERT OR IGNORE INTO packaging_queue_log (report_file, slug, route, relevance, sku_why, status) VALUES (?, ?, ?, ?, ?, 'queued')`,
    [candidate.reportFile, slug, route, candidate.relevance, candidate.skuWhy],
  );

  const brief: MaterialsBrief = {
    reportFile: candidate.reportFile,
    slug,
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

async function cmdMaterials(reportOverride?: string): Promise<void> {
  console.log("=== arc-packaging — Materials Brief ===");
  const { db, brief } = composeMaterials(reportOverride);
  if (!brief) {
    console.error(
      "NO ELIGIBLE CANDIDATE: research/INDEX.md's SKU backlog has no relevance>=4 report that isn't already queued/packaged.",
    );
    db.close();
    process.exit(1);
  }
  console.log(`Candidate: ${brief.reportFile} (relevance ${brief.relevance})`);
  console.log(`Slug: ${brief.slug} | Route: ${brief.route}`);
  console.log(`sku_why: ${brief.skuWhy}`);

  if (!fs.existsSync(MATERIALS_DIR)) fs.mkdirSync(MATERIALS_DIR, { recursive: true });
  const outPath = join(MATERIALS_DIR, `${brief.slug}.json`);
  fs.writeFileSync(outPath, JSON.stringify(brief, null, 2));
  console.log(`\nWrote brief to ${outPath} (includes the report's full text — reportMarkdown).`);
  console.log(`Next: draft { "title": "...", "headline": "...", "description": "..." } to`);
  console.log(`  ${join(MATERIALS_DIR, `${brief.slug}.draft.json`)}`);
  console.log(`Then run: bun cli.ts stage --report ${brief.reportFile}`);
  db.close();
}

// ---------- Stage (deterministic) ----------

interface Draft {
  title: string;
  headline?: string;
  description: string;
  price?: number;
}

function loadDraft(slug: string): Draft {
  const p = join(MATERIALS_DIR, `${slug}.draft.json`);
  if (!fs.existsSync(p)) {
    throw new Error(`DEFERRED — missing draft: ${p}. Write { title, headline, description } first (see materials output), then re-run stage.`);
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
  return d as unknown as Draft;
}

function validateDraft(draft: Draft, reportMarkdown: string, forceSanitization: boolean): string[] {
  const errors: string[] = [];
  const descLower = (draft.description ?? "").toLowerCase();
  if (!descLower.includes("operator") || !descLower.includes("give this to your agent")) {
    errors.push('description missing the required human frame ("operator: give this to your agent")');
  }
  if (!descLower.includes("read this content")) {
    errors.push('description missing the required agent frame ("read this content")');
  }
  if (!forceSanitization) {
    const scanText = [reportMarkdown, draft.title, draft.headline ?? "", draft.description].join("\n");
    for (const hit of sanitizeScan(scanText)) {
      errors.push(`SANITIZATION: ${hit}`);
    }
  }
  return errors;
}

function parseJsonTail(stdout: string): Record<string, unknown> {
  const jsonStart = stdout.indexOf("{");
  if (jsonStart === -1) throw new Error(`no JSON found in output: ${stdout}`);
  return JSON.parse(stdout.slice(jsonStart));
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
  const before = db.query("SELECT status FROM packaging_queue_log WHERE report_file = ?").get([reportFile]) as
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
    const after = db.query("SELECT status FROM packaging_queue_log WHERE report_file = ?").get([reportFile]) as {
      status: string;
    };
    return after.status === "packaged" ? "already-packaged" : "resumed";
  }
  return "claimed";
}

async function cmdStage(reportFile: string, dryRun: boolean, forceSanitization: boolean): Promise<void> {
  console.log(`=== arc-packaging — Stage ${reportFile} ${dryRun ? "(DRY-RUN)" : ""} ===`);
  const db = getDb();
  const row = db.query("SELECT * FROM packaging_queue_log WHERE report_file = ?").get([reportFile]) as
    | { report_file: string; slug: string; route: string; status: string }
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

  let draft: Draft;
  try {
    draft = loadDraft(row.slug);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    db.close();
    process.exit(1);
  }

  const reportPath = join(RESEARCH_DIR, reportFile);
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

  if (dryRun) {
    console.log("[DRY-RUN] validation + sanitization scan passed. Would claim, create-product, mark-packaged, unlock-all (silent).");
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

  const price = draft.price ?? DEFAULT_PRICE_USD;
  const cleanedMarkdown = cleanDeliverableMarkdown(rawReportMarkdown);
  const cleanedPath = join(MATERIALS_DIR, `${row.slug}.deliverable.md`);
  fs.writeFileSync(cleanedPath, cleanedMarkdown);

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
  ];
  const createResult = await runCommand("bash", ["bin/arc", ...createArgs]);
  if (createResult.exitCode !== 0) {
    throw new Error(`whop create-product failed (exit ${createResult.exitCode}): ${createResult.stderr || createResult.stdout}`);
  }
  const createJson = parseJsonTail(createResult.stdout) as {
    product_id: string;
    plan_id: string;
    constants?: { PRODUCT_CHECKOUT_URL?: string };
  };
  console.log(`Created Whop product: ${createJson.product_id} (plan ${createJson.plan_id})`);
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
  // paying members three subprocesses deep with no operator visibility, contradicting the
  // "nothing public until the operator's visibility flip" framing (a real premature-exposure
  // risk, even though a single paid-chat post isn't a QUEST.md hard gate). The operator email
  // below (Hohpe's "no feedback loop" fix) gives the operator everything needed to post the
  // announcement themselves once they've reviewed the SKU, or to explicitly ask Arc to.
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

    const subject = `New Whop SKU packaged — "${info.title}" (hidden, ready for your review)`;
    const plainText = [
      `Arc packaged a new $9 SKU from ${info.reportFile}: "${info.title}".`,
      ``,
      `Status: HIDDEN — not on the public storefront, reachable only by direct link. Nothing`,
      `changes for buyers or members until you flip visibility.`,
      ``,
      `Product page / checkout: ${info.checkoutUrl ?? "(see whop dashboard, product " + info.productId + ")"}`,
      `Product ID: ${info.productId} | Plan ID: ${info.planId}`,
      ``,
      `Membership unlock-all is wired (silent — no announcement has been posted yet):`,
      `  Promo: ${info.promoId ?? "(none)"}`,
      `  Member $0 redemption link: ${info.memberCheckoutUrl ?? "(none)"}`,
      ``,
      `When you're ready: flip the product visible, and post the member redemption link into`,
      `the paid chat yourself (or ask Arc to) — packaging stops here on purpose so a real`,
      `person reviews a new SKU before it reaches a paying member.`,
    ].join("\n");
    const res = await fetch(`${apiBaseUrl}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminKey}` },
      body: JSON.stringify({ to: recipient, subject, text: plainText }),
    });
    return res.ok;
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
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "materials": {
      await cmdMaterials(argValue(args, "--report"));
      break;
    }
    case "stage": {
      const report = argValue(args, "--report");
      if (!report) {
        console.error("stage requires --report <filename-in-research/>");
        process.exit(1);
      }
      await cmdStage(report, args.includes("--dry-run"), args.includes("--force-sanitization"));
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
          "  materials [--report <filename-in-research/>]                pick the next backlog candidate, write a materials brief",
          "  stage --report <filename> [--dry-run] [--force-sanitization]  validate the draft (+ sanitization scan unless forced), then mint the SKU",
          "  status                                                        show packaging_queue_log",
          "",
          "  --force-sanitization: human-only escape hatch for a confirmed sanitizer false positive.",
          "  Never used by the automated sensor path.",
        ].join("\n"),
      );
      process.exit(command ? 1 : 0);
    }
  }
}

main().catch((error) => {
  console.error(`arc-packaging: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
