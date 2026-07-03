#!/usr/bin/env bun
// skills/arc-packaging/cli.ts
// The standing packaging pipeline stage — P3 of arc-demand-flywheel quest.
//
// Extends research/INDEX.md's existing SKU backlog (produced by arc-link-research's
// reindex/catalog) into an ACTIONABLE stage: materials picks the next unpackaged
// relevance>=4 sku_candidate off the backlog, the dispatch-cycle LLM drafts dual-audience-frame
// copy (SOUL.md-gated), and stage deterministically mints the Whop SKU (whop create-product),
// closes the loop on the research shelf (arc-link-research mark-packaged), and grants members
// a free redemption path (whop unlock-all). Mirrors arc-article-pipeline's (P2) materials ->
// LLM draft -> deterministic stage contract — same shape, different destination.
//
// New Whop products are created HIDDEN by create-product's own existing default; this pipeline
// does not need an operator gate to mint (no money moves, nothing goes public until the
// operator flips visibility) — it stops at "packaged", same posture as P1's daily-read.

import { Database } from "bun:sqlite";
import { join } from "path";
import * as fs from "fs";

const ARC_STARTER_ROOT = join(import.meta.dir, "../../");
const DB_PATH = process.env.ARC_PACKAGING_DB_PATH ?? join(ARC_STARTER_ROOT, "db/arc.sqlite");
const RESEARCH_DIR = join(ARC_STARTER_ROOT, "research");
const INDEX_PATH = join(RESEARCH_DIR, "INDEX.md");
const MATERIALS_DIR = join(ARC_STARTER_ROOT, "db/packaging-materials");

const DEFAULT_PRICE_USD = 9;
const SKU_BACKLOG_HEADING = "## SKU backlog — sku_candidate, not yet packaged";

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

// ---------- SKU backlog parsing (research/INDEX.md's own pre-filtered table — already
// sku_candidate:y AND packaged:n, no need to re-derive those flags here) ----------

interface BacklogRow {
  relevance: number;
  topics: string;
  repos: string;
  skuWhy: string;
  reportFile: string;
}

function parseSkuBacklog(): BacklogRow[] {
  const text = fs.readFileSync(INDEX_PATH, "utf-8");
  const lines = text.split("\n");
  const startIdx = lines.findIndex((l) => l.trim() === SKU_BACKLOG_HEADING);
  if (startIdx === -1) return [];

  const rows: BacklogRow[] = [];
  let sawHeader = false;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## ")) break;
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;

    const parts = trimmed.split("|").map((s) => s.trim());
    // parts[0] = "" (leading pipe), [1]=relevance, [2]=topics, [3]=repos, [4]=sku_why, [5]=report link, [6]="" (trailing pipe)
    if (!sawHeader) {
      if (/^relevance$/i.test(parts[1] ?? "")) sawHeader = true;
      continue;
    }
    if (/^:?-+:?$/.test((parts[1] ?? "").replace(/\s/g, ""))) continue; // markdown separator row

    const relevance = parseInt(parts[1] ?? "", 10);
    if (!Number.isFinite(relevance)) continue;
    const linkMatch = (parts[5] ?? "").match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (!linkMatch) continue;

    rows.push({
      relevance,
      topics: parts[2] ?? "",
      repos: parts[3] ?? "",
      skuWhy: parts[4] ?? "",
      reportFile: linkMatch[2],
    });
  }
  return rows;
}

/**
 * Pick the next candidate: relevance descending, then FIFO (oldest report filename first —
 * report filenames lead with an ISO timestamp) within a relevance tier, skipping anything
 * already present in packaging_queue_log (queued, claimed, or packaged — a report only ever
 * gets ONE row, the natural key is report_file).
 */
function selectCandidate(db: Database, reportOverride?: string): BacklogRow | null {
  const rows = parseSkuBacklog().filter((r) => r.relevance >= 4);
  if (rows.length === 0) return null;

  if (reportOverride) {
    return rows.find((r) => r.reportFile === reportOverride) ?? null;
  }

  const queued = new Set(
    (db.query("SELECT report_file FROM packaging_queue_log").all() as { report_file: string }[]).map(
      (r) => r.report_file,
    ),
  );
  const ordered = [...rows].sort((a, b) => {
    if (b.relevance !== a.relevance) return b.relevance - a.relevance;
    return a.reportFile.localeCompare(b.reportFile);
  });
  return ordered.find((r) => !queued.has(r.reportFile)) ?? null;
}

function slugify(text: string): string {
  // Same fix as arc-article-pipeline's slugify (P2, found live 2026-07-03): replace runs of
  // non-alphanumeric characters with a single hyphen instead of deleting them, so word
  // boundaries survive (e.g. a title containing "dispatch.ts:137" doesn't collapse illegibly).
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
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

// ---------- Materials brief ----------

interface MaterialsBrief {
  reportFile: string;
  slug: string;
  route: string;
  relevance: number;
  skuWhy: string;
  reportPath: string;
  suggestedPriceUsd: number;
  voiceInstructions: {
    human: string;
    agent: string;
  };
  sanitizationChecklist: string[];
}

function composeMaterials(reportOverride?: string): { db: Database; brief: MaterialsBrief | null } {
  const db = getDb();
  const candidate = selectCandidate(db, reportOverride);
  if (!candidate) return { db, brief: null };

  const slug = slugFromReportFile(candidate.reportFile);
  const route = slugify(slug);
  const reportPath = join(RESEARCH_DIR, candidate.reportFile);

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
    suggestedPriceUsd: DEFAULT_PRICE_USD,
    voiceInstructions: {
      human:
        'Description MUST include the human frame, verbatim or near-verbatim: "operator: give this to your agent". ' +
        "The buyer is a human agent-operator who hands this report to their own AI agent to read/use — audience is LOCKED to agent operators (QUEST.md #11), not general Bitcoin/Stacks readers.",
      agent:
        'Description MUST include the agent frame, verbatim or near-verbatim: "read this content". ' +
        "An autonomous agent reading the product description directly should understand it can pay via this Whop checkout now to read the report immediately; you may mention arc0btc.com's x402 rail exists for direct agent-to-agent payment, but do not invent a specific new endpoint URL — P3 does not wire new x402 catalog entries.",
    },
    sanitizationChecklist: [
      "no API keys, tokens, passwords, private-key material",
      "no internal IPs / VM hostnames / SSH details",
      "no un-redacted credential-adjacent operational detail",
      "no unreleased strategic plans not meant for a paying stranger",
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
  console.log(`\nWrote brief to ${outPath}`);
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
    throw new Error(`missing draft: ${p} — write { title, headline, description } first (see materials output)`);
  }
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function validateDraft(draft: Draft, reportMarkdown: string): string[] {
  const errors: string[] = [];
  if (!draft.title) errors.push("draft.title missing");
  if (!draft.description) errors.push("draft.description missing");
  const descLower = (draft.description ?? "").toLowerCase();
  if (!descLower.includes("operator") || !descLower.includes("give this to your agent")) {
    errors.push('description missing the required human frame ("operator: give this to your agent")');
  }
  if (!descLower.includes("read this content")) {
    errors.push('description missing the required agent frame ("read this content")');
  }
  const scanText = [reportMarkdown, draft.title, draft.headline ?? "", draft.description].join("\n");
  for (const hit of sanitizeScan(scanText)) {
    errors.push(`SANITIZATION: ${hit}`);
  }
  return errors;
}

async function runCommand(
  command: string[],
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(command, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

function parseJsonTail(stdout: string): Record<string, unknown> {
  const jsonStart = stdout.indexOf("{");
  if (jsonStart === -1) throw new Error(`no JSON found in output: ${stdout}`);
  return JSON.parse(stdout.slice(jsonStart));
}

async function cmdStage(reportFile: string, dryRun: boolean): Promise<void> {
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

  const draft = loadDraft(row.slug);
  const reportPath = join(RESEARCH_DIR, reportFile);
  const reportMarkdown = fs.readFileSync(reportPath, "utf-8");
  const errors = validateDraft(draft, reportMarkdown);
  if (errors.length > 0) {
    console.error("DEFERRED — stage validation failed:");
    errors.forEach((e) => console.error(`  - ${e}`));
    db.close();
    process.exit(1);
  }

  if (dryRun) {
    console.log("[DRY-RUN] validation + sanitization scan passed. Would claim, create-product, mark-packaged, unlock-all.");
    db.close();
    return;
  }

  // Resume-tolerant claim (P2's exact fix: no hard-abort on crash, just mark claimed and move on).
  db.run(
    `UPDATE packaging_queue_log SET status = 'claimed', claimed_at = ? WHERE report_file = ? AND status != 'packaged'`,
    [new Date().toISOString(), reportFile],
  );

  const price = draft.price ?? DEFAULT_PRICE_USD;
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
    reportPath,
  ];
  const createResult = await runCommand(["bash", "bin/arc", ...createArgs], ARC_STARTER_ROOT);
  if (createResult.exitCode !== 0) {
    throw new Error(`whop create-product failed (exit ${createResult.exitCode}): ${createResult.stderr || createResult.stdout}`);
  }
  const createJson = parseJsonTail(createResult.stdout) as {
    product_id: string;
    plan_id: string;
    constants?: { PRODUCT_CHECKOUT_URL?: string };
  };
  console.log(`Created Whop product: ${createJson.product_id} (plan ${createJson.plan_id})`);

  const markResult = await runCommand(
    ["bash", "bin/arc", "skills", "run", "--name", "arc-link-research", "--", "mark-packaged", "--report", reportFile, "--product", createJson.product_id],
    ARC_STARTER_ROOT,
  );
  if (markResult.exitCode !== 0) {
    throw new Error(`arc-link-research mark-packaged failed (exit ${markResult.exitCode}): ${markResult.stderr || markResult.stdout}`);
  }
  console.log("Marked packaged in research/INDEX.md.");

  const unlockResult = await runCommand(
    [
      "bash",
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
    ],
    ARC_STARTER_ROOT,
  );
  if (unlockResult.exitCode !== 0) {
    throw new Error(`whop unlock-all failed (exit ${unlockResult.exitCode}): ${unlockResult.stderr || unlockResult.stdout}`);
  }
  const unlockJson = parseJsonTail(unlockResult.stdout) as { promo_id?: string; checkout_url?: string };
  console.log(`Membership unlock-all wired: promo ${unlockJson.promo_id ?? "?"}`);

  db.run(
    `UPDATE packaging_queue_log SET status = 'packaged', product_id = ?, plan_id = ?, promo_code_id = ?, packaged_at = ? WHERE report_file = ?`,
    [createJson.product_id, createJson.plan_id, unlockJson.promo_id ?? null, new Date().toISOString(), reportFile],
  );
  db.close();

  console.log(
    JSON.stringify(
      {
        success: true,
        report_file: reportFile,
        product_id: createJson.product_id,
        plan_id: createJson.plan_id,
        promo_id: unlockJson.promo_id ?? null,
        checkout_url: createJson.constants?.PRODUCT_CHECKOUT_URL ?? null,
        unlock_checkout_url: unlockJson.checkout_url ?? null,
        status: "packaged",
      },
      null,
      2,
    ),
  );
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
      await cmdStage(report, args.includes("--dry-run"));
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
          "  materials [--report <filename-in-research/>]   pick the next backlog candidate, write a materials brief",
          "  stage --report <filename> [--dry-run]          validate the draft + sanitization scan, then mint the SKU",
          "  status                                          show packaging_queue_log",
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
