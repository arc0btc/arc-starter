#!/usr/bin/env bun
// skills/arc-email-channel/cli.ts
//
// P6 (arc-demand-flywheel) — findings/arXiv digest renderer for Arc's free-tier email channel.
//
// Sources content from LIVE data only:
//   - research/*.md front-matter (relevance-4/5 crown-jewel findings) via the same parser
//     arc-link-research already uses for research/INDEX.md — no hand-rolled markdown parsing.
//   - daily_read_log / article_queue_log (arc.sqlite) for any already-posted/staged findings
//     from the P1 daily-read and P2 article pipelines — degrades gracefully to empty (neither
//     table has a live-fired row yet as of this phase; that is expected, not a bug).
//   - research/arxiv/*_arxiv_digest.md, correctly embargo-gated: a digest is only free once
//     10 days have passed (P4's established free/paid boundary policy). As of this phase, ALL
//     existing digests are still inside their embargo window — the arXiv section renders empty
//     with a computed "unlocks on <date>" teaser. THIS IS CORRECT BEHAVIOR. Do not bypass it.
//
// Hard constraint (quest doctrine): this script NEVER fans out to the full subscriber list.
// `send-test` only ever mails the explicit seed recipient(s) passed via --to (defaulting to the
// `email/report_recipient` credential) and requires --live to actually send (dry-run by default).

import { Database } from "bun:sqlite";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { Glob } from "bun";

const ARC_STARTER_ROOT = join(import.meta.dir, "../../");
const RESEARCH_DIR = join(ARC_STARTER_ROOT, "research");
const ARXIV_DIR = join(RESEARCH_DIR, "arxiv");
const DB_PATH = join(ARC_STARTER_ROOT, "db/arc.sqlite");

const ARXIV_EMBARGO_DAYS = 10; // matches P4's established digest-content embargo policy

interface Finding {
  relevance: number;
  topics: string[];
  why: string;
  filePath: string;
  fileName: string;
  fetchedAt: string;
  citation: string | null; // a real file:line reference pulled from the report body
  title: string;
}

/** Pull the first `# Heading` line as a title, falling back to the filename. */
function extractTitle(content: string, fallback: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

/** Pull one real file:line citation out of a report body — the corpus's "tested against a live agent" proof. */
function extractCitation(content: string): string | null {
  const match = content.match(/[A-Za-z0-9_./-]+\.(?:ts|tsx|md):[0-9]+/);
  return match ? match[0] : null;
}

async function collectTopFindings(limit = 5): Promise<Finding[]> {
  const { parseFrontmatter } = await import(
    join(ARC_STARTER_ROOT, "skills/arc-link-research/lib/frontmatter.ts")
  );

  const glob = new Glob("*.md");
  const findings: Finding[] = [];

  for await (const fileName of glob.scan({ cwd: RESEARCH_DIR, absolute: false })) {
    if (fileName === "INDEX.md") continue;
    const filePath = join(RESEARCH_DIR, fileName);
    const content = await Bun.file(filePath).text();
    const fm = parseFrontmatter(content);
    if (!fm) continue;
    if (fm.arc_relevance < 4) continue;

    findings.push({
      relevance: fm.arc_relevance,
      topics: fm.topics,
      why: fm.sku_why || "",
      filePath: fileName,
      fileName,
      fetchedAt: fm.fetched_at,
      citation: extractCitation(content),
      title: extractTitle(content, fileName),
    });
  }

  findings.sort((a, b) => b.relevance - a.relevance || b.fetchedAt.localeCompare(a.fetchedAt));
  return findings.slice(0, limit);
}

interface ArxivStatus {
  eligible: Array<{ fileName: string; digestDate: string; embargoDate: string }>;
  nextUnlock: string | null; // ISO date of the soonest embargo lift among currently-ineligible digests
}

/** Parse the leading ISO8601 date out of a `<ISO>_arxiv_digest.md` filename. */
function parseDigestDate(fileName: string): Date | null {
  const match = fileName.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)_arxiv_digest\.md$/);
  return match ? new Date(match[1]) : null;
}

async function computeArxivEmbargo(): Promise<ArxivStatus> {
  const eligible: ArxivStatus["eligible"] = [];
  let soonestIneligibleEmbargo: Date | null = null;

  let files: string[] = [];
  try {
    const glob = new Glob("*_arxiv_digest.md");
    for await (const f of glob.scan({ cwd: ARXIV_DIR, absolute: false })) files.push(f);
  } catch {
    // research/arxiv/ may not exist in some environments — degrade to "no digests"
    return { eligible: [], nextUnlock: null };
  }

  const now = new Date();
  for (const fileName of files) {
    const digestDate = parseDigestDate(fileName);
    if (!digestDate) continue;
    const embargoDate = new Date(digestDate.getTime() + ARXIV_EMBARGO_DAYS * 24 * 60 * 60 * 1000);
    if (now >= embargoDate) {
      eligible.push({ fileName, digestDate: digestDate.toISOString(), embargoDate: embargoDate.toISOString() });
    } else if (!soonestIneligibleEmbargo || embargoDate < soonestIneligibleEmbargo) {
      soonestIneligibleEmbargo = embargoDate;
    }
  }

  return { eligible, nextUnlock: soonestIneligibleEmbargo ? soonestIneligibleEmbargo.toISOString() : null };
}

interface LiveChannelItem {
  kind: "daily-read" | "article";
  title: string;
  hook: string | null;
  fileLine: string | null;
  url: string | null;
}

/** Pull any already-fired/staged daily-read + article content — degrades to [] if none exist yet (expected on a fresh DB). */
function collectLiveChannelContent(): LiveChannelItem[] {
  if (!existsSync(DB_PATH)) return [];
  const db = new Database(DB_PATH, { readonly: true });
  const items: LiveChannelItem[] = [];

  try {
    const dailyRows = db
      .query(
        "SELECT finding_slug, opening_line, root_tweet_url FROM daily_read_log WHERE posted_at IS NOT NULL AND finding_slug IS NOT NULL ORDER BY edition_n DESC LIMIT 3"
      )
      .all() as Array<{ finding_slug: string; opening_line: string | null; root_tweet_url: string | null }>;
    for (const row of dailyRows) {
      items.push({ kind: "daily-read", title: row.finding_slug, hook: row.opening_line, fileLine: null, url: row.root_tweet_url });
    }
  } catch {
    // table may not exist in an older DB snapshot — degrade silently
  }

  try {
    const articleRows = db
      .query(
        "SELECT finding_slug, hook, file_line, preview_url FROM article_queue_log WHERE status != 'materials' ORDER BY article_n DESC LIMIT 3"
      )
      .all() as Array<{ finding_slug: string; hook: string | null; file_line: string | null; preview_url: string | null }>;
    for (const row of articleRows) {
      items.push({ kind: "article", title: row.finding_slug, hook: row.hook, fileLine: row.file_line, url: row.preview_url });
    }
  } catch {
    // degrade silently
  }

  db.close();
  return items;
}

interface Digest {
  subject: string;
  text: string;
  html: string;
}

async function renderDigest(): Promise<Digest> {
  const findings = await collectTopFindings(5);
  const arxiv = await computeArxivEmbargo();
  const liveChannel = collectLiveChannelContent();

  const today = new Date().toISOString().slice(0, 10);
  const subject = `Arc's Research Digest — ${today}`;

  const findingLines = findings.map(
    (f, i) =>
      `${i + 1}. ${f.title} (relevance ${f.relevance}/5)\n   ${f.why || f.topics.join(", ")}\n   ${f.citation ? `Tested against live code: ${f.citation}` : ""}`
  );

  const arxivLine = arxiv.eligible.length > 0
    ? `arXiv digest(s) now free: ${arxiv.eligible.map((e) => e.fileName).join(", ")}`
    : arxiv.nextUnlock
      ? `Next arXiv digest unlocks free on ${arxiv.nextUnlock.slice(0, 10)} (10-day embargo, per Arc's free/paid boundary policy).`
      : "No arXiv digests in the pipeline yet.";

  const liveChannelLines = liveChannel.map((item) => `- [${item.kind}] ${item.title}${item.hook ? `: ${item.hook}` : ""}`);

  const text = [
    `Arc's Research Digest — ${today}`,
    "",
    "This week's findings, tested against Arc's own live code:",
    "",
    ...findingLines,
    "",
    arxivLine,
    "",
    liveChannelLines.length > 0 ? "From the daily read / article pipeline:\n" + liveChannelLines.join("\n") : "",
    "",
    "Unsubscribe anytime — link in every edition.",
  ]
    .filter(Boolean)
    .join("\n");

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body { font-family: monospace; max-width: 640px; margin: 40px auto; background: #0a0a0a; color: #e0e0e0; padding: 24px; }
    h2 { color: #f0f0f0; border-bottom: 1px solid #333; padding-bottom: 8px; }
    .finding { background: #1a1a1a; border-left: 3px solid #1d9bf0; padding: 12px 16px; margin: 12px 0; border-radius: 4px; }
    .citation { color: #888; font-size: 0.85em; }
    .teaser { background: #1a1a0d; border-left: 3px solid #f0a500; padding: 12px 16px; margin: 12px 0; border-radius: 4px; }
  </style></head><body>
    <h2>Arc's Research Digest — ${today}</h2>
    <p>This week's findings, tested against Arc's own live code:</p>
    ${findings
      .map(
        (f) =>
          `<div class="finding"><strong>${f.title}</strong> (relevance ${f.relevance}/5)<br>${f.why || f.topics.join(", ")}${f.citation ? `<br><span class="citation">Tested against live code: ${f.citation}</span>` : ""}</div>`
      )
      .join("")}
    <div class="teaser">${arxivLine}</div>
    ${liveChannelLines.length > 0 ? `<p>From the daily read / article pipeline:</p><ul>${liveChannel.map((item) => `<li>[${item.kind}] ${item.title}${item.hook ? `: ${item.hook}` : ""}</li>`).join("")}</ul>` : ""}
    <hr style="border-color:#333;margin:24px 0">
    <p style="color:#666;font-size:0.85em">Unsubscribe anytime — link in every edition.</p>
  </body></html>`;

  return { subject, text, html };
}

async function cmdRenderDigest() {
  const digest = await renderDigest();
  console.log(`Subject: ${digest.subject}\n`);
  console.log(digest.text);
}

async function cmdSendTest(args: string[]) {
  const live = args.includes("--live");
  const toIdx = args.indexOf("--to");
  const explicitTo = toIdx >= 0 ? args[toIdx + 1] : null;

  const { getCredential } = await import(join(ARC_STARTER_ROOT, "src/credentials.ts"));
  const apiBaseUrl = await getCredential("email", "api_base_url");
  const adminKey = await getCredential("email", "admin_api_key");
  const reportRecipient = await getCredential("email", "report_recipient");

  const to = explicitTo || reportRecipient;
  if (!to) {
    console.error("No recipient — pass --to <email> or set email/report_recipient credential.");
    process.exit(1);
  }
  if (!apiBaseUrl || !adminKey) {
    console.error("Email credentials not configured (email/api_base_url, email/admin_api_key).");
    process.exit(1);
  }

  const digest = await renderDigest();

  if (!live) {
    console.log(`[DRY-RUN] Would send to: ${to}`);
    console.log(`[DRY-RUN] Subject: ${digest.subject}`);
    console.log(`[DRY-RUN] Body (text) length: ${digest.text.length} chars`);
    console.log("[DRY-RUN] Pass --live to actually send via /api/send-digest.");
    return;
  }

  console.log(`[LIVE] Sending digest to seed recipient: ${to}`);
  const response = await fetch(`${apiBaseUrl}/api/send-digest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Key": adminKey },
    body: JSON.stringify({
      subject: digest.subject,
      body: digest.text,
      body_html: digest.html,
      recipients: [to], // seed-list only — never a subscriber-table fan-out
    }),
  });

  if (!response.ok) {
    console.error(`Send failed: HTTP ${response.status} — ${await response.text()}`);
    process.exit(1);
  }
  const result = await response.json();
  console.log("Result:", JSON.stringify(result, null, 2));
}

async function main() {
  const [, , command, ...args] = process.argv;
  switch (command) {
    case "render-digest":
      await cmdRenderDigest();
      break;
    case "send-test":
      await cmdSendTest(args);
      break;
    default:
      console.log("Usage: bun cli.ts <render-digest|send-test [--live] [--to <email>]>");
      process.exit(1);
  }
}

main();
