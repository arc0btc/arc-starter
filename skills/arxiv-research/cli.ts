#!/usr/bin/env bun
// skills/arxiv-research/cli.ts
// CLI for arXiv research. Fetches papers, compiles digests, lists outputs.
// Usage: arc skills run --name arxiv-research -- <subcommand> [flags]

import { existsSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { insertTask, pendingTaskExistsForSource, isBeatOnCooldown } from "../../src/db.ts";

const ROOT = join(import.meta.dir, "..", "..");
const ARXIV_DIR = join(ROOT, "research", "arxiv");
const ARXIV_API = "http://export.arxiv.org/api/query";
const DEFAULT_CATEGORIES = ["cs.AI", "cs.CL", "cs.LG", "cs.MA"];
const DEFAULT_MAX = 50;

// ---- Helpers ----

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return flags;
}

function ensureDir(): void {
  if (!existsSync(ARXIV_DIR)) {
    mkdirSync(ARXIV_DIR, { recursive: true });
  }
}

// ---- arXiv API types ----

interface ArxivPaper {
  arxiv_id: string;
  title: string;
  authors: string[];
  abstract: string;
  categories: string[];
  primary_category: string;
  published: string;
  updated: string;
  pdf_url: string;
  abs_url: string;
}

// ---- XML parsing (no deps) ----

function extractTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

function extractAllTags(xml: string, tag: string): string[] {
  const results: string[] = [];
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1].replace(/\s+/g, " ").trim());
  }
  return results;
}

function extractAttr(xml: string, tag: string, attr: string): string[] {
  const results: string[] = [];
  const regex = new RegExp(`<${tag}[^>]*?${attr}="([^"]*)"`, "g");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1]);
  }
  return results;
}

function parseArxivResponse(xml: string): ArxivPaper[] {
  const papers: ArxivPaper[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];

    const rawId = extractTag(block, "id");
    const arxivId = rawId.replace("http://arxiv.org/abs/", "").replace(/v\d+$/, "");
    const title = extractTag(block, "title");
    const abstract = extractTag(block, "summary");
    const published = extractTag(block, "published");
    const updated = extractTag(block, "updated");

    // Authors: <author><name>...</name></author>
    const authorBlocks = extractAllTags(block, "author");
    const authors = authorBlocks.map((a) => extractTag(a, "name")).filter(Boolean);

    // Categories
    const categories = extractAttr(block, "category", "term");
    const primaryCat = block.match(/arxiv:primary_category[^>]*term="([^"]*)"/)?.[1] ?? categories[0] ?? "";

    // Links
    const pdfMatch = block.match(/<link[^>]*title="pdf"[^>]*href="([^"]*)"/);
    const pdfUrl = pdfMatch ? pdfMatch[1] : `https://arxiv.org/pdf/${arxivId}`;
    const absUrl = `https://arxiv.org/abs/${arxivId}`;

    if (arxivId && title) {
      papers.push({
        arxiv_id: arxivId,
        title,
        authors,
        abstract,
        categories,
        primary_category: primaryCat,
        published,
        updated,
        pdf_url: pdfUrl,
        abs_url: absUrl,
      });
    }
  }

  return papers;
}

// ---- Relevance scoring for LLM/agent papers ----

interface ScoredPaper extends ArxivPaper {
  relevance_score: number;
  relevance_tags: string[];
}

const RELEVANCE_SIGNALS: Array<{ pattern: RegExp; weight: number; tag: string }> = [
  { pattern: /\blarge language model/i, weight: 3, tag: "LLM" },
  { pattern: /\bLLM\b/, weight: 3, tag: "LLM" },
  { pattern: /\bGPT[-\s]?[34o]/i, weight: 2, tag: "LLM" },
  { pattern: /\bClaude\b/i, weight: 2, tag: "LLM" },
  { pattern: /\btransformer/i, weight: 1, tag: "transformer" },
  { pattern: /\bautonomous agent/i, weight: 4, tag: "agent" },
  { pattern: /\bAI agent/i, weight: 4, tag: "agent" },
  { pattern: /\bagent[-\s]?based/i, weight: 3, tag: "agent" },
  { pattern: /\bmulti[-\s]?agent/i, weight: 4, tag: "multi-agent" },
  { pattern: /\btool[-\s]?use\b/i, weight: 3, tag: "tool-use" },
  { pattern: /\bfunction[-\s]?call/i, weight: 3, tag: "tool-use" },
  { pattern: /\bchain[-\s]?of[-\s]?thought/i, weight: 2, tag: "reasoning" },
  { pattern: /\breasoning\b/i, weight: 2, tag: "reasoning" },
  { pattern: /\bplanning\b/i, weight: 2, tag: "planning" },
  { pattern: /\bRL[HF]+\b/, weight: 2, tag: "alignment" },
  { pattern: /\balignment\b/i, weight: 2, tag: "alignment" },
  { pattern: /\bsafety\b/i, weight: 1, tag: "safety" },
  { pattern: /\bfine[-\s]?tun/i, weight: 2, tag: "fine-tuning" },
  { pattern: /\bprompt\b/i, weight: 1, tag: "prompting" },
  { pattern: /\bin[-\s]?context learning/i, weight: 2, tag: "ICL" },
  { pattern: /\bretrieval[-\s]?augmented/i, weight: 2, tag: "RAG" },
  { pattern: /\bRAG\b/, weight: 2, tag: "RAG" },
  { pattern: /\bcode[-\s]?gen/i, weight: 2, tag: "code-gen" },
  { pattern: /\bbenchmark/i, weight: 1, tag: "benchmark" },
  { pattern: /\bscaling\b/i, weight: 1, tag: "scaling" },
  { pattern: /\bmemory\b/i, weight: 1, tag: "memory" },
  { pattern: /\borchestrat/i, weight: 3, tag: "orchestration" },
  { pattern: /\bMCP\b/, weight: 3, tag: "MCP" },
  { pattern: /\bmodel context protocol/i, weight: 3, tag: "MCP" },
];

function scorePaper(paper: ArxivPaper): ScoredPaper {
  const text = `${paper.title} ${paper.abstract}`;
  let score = 0;
  const tags = new Set<string>();

  for (const signal of RELEVANCE_SIGNALS) {
    if (signal.pattern.test(text)) {
      score += signal.weight;
      tags.add(signal.tag);
    }
  }

  // Boost for primary agent/LLM categories
  if (paper.primary_category === "cs.MA") score += 3;
  if (paper.primary_category === "cs.CL") score += 1;
  if (paper.primary_category === "cs.AI") score += 1;

  return { ...paper, relevance_score: score, relevance_tags: [...tags] };
}

// ---- Quantum beat keyword matching (title + abstract) ----
// Mirrors sensor.ts QUANTUM_KEYWORDS but applied to full paper content after fetch.

const QUANTUM_KEYWORDS = [
  /\bpost[-\s]?quantum/i,
  /\bquantum[-\s]?(attack|threat|resist|safe|secur)/i,
  /\b(break|break.*ECDSA|attack.*ECDSA|ECDSA.*break)/i,
  /\bquantum.*bitcoin/i,
  /\bbitcoin.*quantum/i,
  /\bquantum.*cryptocurren/i,
  /\bShor'?s algorithm/i,
  /\bGrover'?s algorithm/i,
  /\bquantum.*key.*distribut/i,
  /\bquantum[-\s]?resistant/i,
  /\bquantum[-\s]?proof/i,
  /\blattice[-\s]?based.*crypt/i,
  /\bNIST.*post[-\s]?quantum/i,
  /\bP2QRH\b/,
  /\bBIP[-\s]?360\b/,
  /\bquantum.*hash/i,
  /\bquantum.*elliptic/i,
];

function isQuantumBeatPaper(title: string, abstract: string): boolean {
  return QUANTUM_KEYWORDS.some((re) => re.test(title) || re.test(abstract));
}

// ---- Subcommands ----

async function cmdFetch(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const categories = flags.categories ? flags.categories.split(",") : DEFAULT_CATEGORIES;
  const maxResults = flags.max ? parseInt(flags.max, 10) : DEFAULT_MAX;

  const catQuery = categories.map((c) => `cat:${c}`).join("+OR+");
  const url = `${ARXIV_API}?search_query=${catQuery}&sortBy=submittedDate&sortOrder=descending&max_results=${maxResults}`;

  process.stderr.write(`Fetching arXiv papers: ${categories.join(", ")} (max ${maxResults})...\n`);

  const response = await fetch(url, {
    headers: { "User-Agent": "Arc-Agent/1.0 (arc@arc0btc.com)" },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    process.stderr.write(`Error: arXiv API returned ${response.status}\n`);
    process.exit(1);
  }

  const xml = await response.text();
  const papers = parseArxivResponse(xml);

  if (papers.length === 0) {
    process.stderr.write("No papers found.\n");
    process.exit(0);
  }

  // Score and sort by relevance
  const scored = papers.map(scorePaper).sort((a, b) => b.relevance_score - a.relevance_score);

  // Save raw fetch to a temp JSON for compile to use
  ensureDir();
  const fetchFile = join(ARXIV_DIR, ".latest_fetch.json");
  await Bun.write(fetchFile, JSON.stringify(scored, null, 2));

  process.stderr.write(`Fetched ${scored.length} papers. Saved to .latest_fetch.json\n`);

  // Output summary
  const relevant = scored.filter((p) => p.relevance_score >= 3);
  process.stdout.write(JSON.stringify({
    total: scored.length,
    relevant: relevant.length,
    categories,
    top_papers: relevant.slice(0, 10).map((p) => ({
      id: p.arxiv_id,
      title: p.title,
      score: p.relevance_score,
      tags: p.relevance_tags,
      published: p.published,
    })),
  }, null, 2) + "\n");
}

async function cmdCompile(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  ensureDir();

  const fetchFile = join(ARXIV_DIR, ".latest_fetch.json");
  if (!existsSync(fetchFile)) {
    process.stderr.write("Error: no fetched papers found. Run 'fetch' first.\n");
    process.exit(1);
  }

  const raw = await Bun.file(fetchFile).text();
  const papers: ScoredPaper[] = JSON.parse(raw);

  // Filter for relevant papers (score >= 3)
  const relevant = papers.filter((p) => p.relevance_score >= 3);

  if (relevant.length === 0) {
    process.stderr.write("No papers scored high enough for the digest (min score: 3).\n");
    process.exit(0);
  }

  // Group by primary tag
  const groups = new Map<string, ScoredPaper[]>();
  for (const paper of relevant) {
    const primaryTag = paper.relevance_tags[0] ?? "general";
    const group = groups.get(primaryTag) ?? [];
    group.push(paper);
    groups.set(primaryTag, group);
  }

  // Determine date for the digest
  const dateStr = flags.date ?? new Date().toISOString().split("T")[0];
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const filename = `${timestamp}_arxiv_digest.md`;
  const filepath = join(ARXIV_DIR, filename);

  // Build digest markdown
  const lines: string[] = [
    `# arXiv Digest — ${dateStr}`,
    "",
    `**Generated:** ${timestamp}`,
    `**Papers reviewed:** ${papers.length}`,
    `**Relevant papers:** ${relevant.length}`,
    `**Categories:** ${DEFAULT_CATEGORIES.join(", ")}`,
    "",
    "---",
    "",
  ];

  // Executive summary
  lines.push("## Highlights");
  lines.push("");
  const topPapers = relevant.slice(0, 5);
  for (const paper of topPapers) {
    lines.push(`- **${paper.title}** (${paper.relevance_tags.join(", ")}) — score ${paper.relevance_score}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // Grouped sections
  const tagOrder = ["agent", "multi-agent", "LLM", "tool-use", "reasoning", "RAG", "alignment", "orchestration", "MCP"];
  const sortedTags = [...groups.keys()].sort((a, b) => {
    const aIdx = tagOrder.indexOf(a);
    const bIdx = tagOrder.indexOf(b);
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
  });

  for (const tag of sortedTags) {
    const group = groups.get(tag)!;
    const tagLabel = tag.charAt(0).toUpperCase() + tag.slice(1);
    lines.push(`## ${tagLabel}`);
    lines.push("");

    for (const paper of group) {
      lines.push(`### ${paper.title}`);
      lines.push("");
      lines.push(`- **arXiv:** [${paper.arxiv_id}](${paper.abs_url})`);
      lines.push(`- **Authors:** ${paper.authors.slice(0, 5).join(", ")}${paper.authors.length > 5 ? " et al." : ""}`);
      lines.push(`- **Published:** ${paper.published.split("T")[0]}`);
      lines.push(`- **Categories:** ${paper.categories.join(", ")}`);
      lines.push(`- **Relevance:** ${paper.relevance_score} (${paper.relevance_tags.join(", ")})`);
      lines.push("");

      // Truncate abstract for digest
      const abstract = paper.abstract.length > 500
        ? paper.abstract.slice(0, 497) + "..."
        : paper.abstract;
      lines.push(`> ${abstract}`);
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  // Footer
  lines.push("## Stats");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Total papers | ${papers.length} |`);
  lines.push(`| Relevant (score >= 3) | ${relevant.length} |`);
  lines.push(`| Categories | ${DEFAULT_CATEGORIES.join(", ")} |`);

  const tagCounts = [...groups.entries()]
    .map(([tag, papers]) => `${tag}: ${papers.length}`)
    .join(", ");
  lines.push(`| By topic | ${tagCounts} |`);
  lines.push("");
  lines.push("*Compiled by Arc (arc0.btc) — paid research feed at arc0btc.com*");
  lines.push("");

  const digest = lines.join("\n");
  await Bun.write(filepath, digest);

  process.stdout.write(`Digest written: research/arxiv/${filename}\n`);
  process.stdout.write(JSON.stringify({
    file: filename,
    total_papers: papers.length,
    relevant_papers: relevant.length,
    topics: Object.fromEntries(groups.entries().map(([k, v]) => [k, v.length])),
  }, null, 2) + "\n");
}

// ---- Signal task auto-queuing ----

async function cmdQueueSignals(): Promise<void> {
  const fetchFile = join(ARXIV_DIR, ".latest_fetch.json");
  if (!existsSync(fetchFile)) {
    process.stderr.write("No fetched papers found. Run 'fetch' first.\n");
    process.exit(0);
  }

  const raw = await Bun.file(fetchFile).text();
  const papers: ScoredPaper[] = JSON.parse(raw);
  const today = new Date().toISOString().split("T")[0];

  // Quantum beat: match on both title and abstract (richer than sensor's title-only pass)
  const quantumPapers = papers.filter((p) => isQuantumBeatPaper(p.title, p.abstract));

  if (quantumPapers.length === 0) {
    process.stdout.write("No quantum-relevant papers found in latest fetch.\n");
    return;
  }

  process.stderr.write(`Found ${quantumPapers.length} quantum-relevant paper(s).\n`);

  if (isBeatOnCooldown("quantum", 60)) {
    process.stdout.write("Beat cooldown active for quantum (60min) — skipping signal task creation.\n");
    return;
  }

  const quantumSource = `cli:arxiv-research:quantum-signal-${today}`;
  if (pendingTaskExistsForSource(quantumSource)) {
    process.stdout.write("Quantum signal task already queued for today.\n");
    return;
  }

  const paperList = quantumPapers
    .slice(0, 5)
    .map((p) => {
      const snippet = p.abstract.slice(0, 200).replace(/\n/g, " ");
      return `- ${p.title} (${p.arxiv_id})\n  ${snippet}...`;
    })
    .join("\n");

  insertTask({
    subject: `File quantum beat signal from arXiv digest (${quantumPapers.length} paper(s))`,
    description:
      `${quantumPapers.length} quantum-relevant paper(s) found in today's arXiv fetch (title+abstract match):\n\n` +
      paperList + "\n\n" +
      "Instructions:\n" +
      "1. Confirm papers address quantum computing impacts on Bitcoin (ECDSA/SHA-256 threats, post-quantum BIPs, Shor/Grover relevance, NIST PQC standards)\n" +
      "2. Pick the top 1-2 most newsworthy papers\n" +
      "3. Compose a signal: arc skills run --name aibtc-news-editorial -- compose-signal --beat quantum\n" +
      "4. File the signal: arc skills run --name aibtc-news-editorial -- file-signal --beat quantum --headline \"...\" --claim \"...\" --evidence \"...\" --implication \"...\" --sources '[{\"url\":\"https://arxiv.org/abs/{id}\",\"title\":\"{title}\"}]' --tags \"quantum,bitcoin,post-quantum\" --force",
    skills: JSON.stringify(["aibtc-news-editorial", "arxiv-research"]),
    priority: 6,
    model: "sonnet",
    status: "pending",
    source: quantumSource,
  });

  process.stdout.write(`Quantum signal task queued (${quantumPapers.length} matching papers).\n`);
}

// ---- KV Publishing ----

const KV_NAMESPACE_ID = "32f0010c773d42c1bad0ca3125817544";
const CF_ACCOUNT_ID = "916093ba9c76cdc56aad0e16161675f1";

interface DigestMeta {
  date: string;
  generated: string;
  papersReviewed: number;
  relevantPapers: number;
  categories: string[];
  highlights: Array<{ title: string; tags: string[]; score: number }>;
}

function parseDigestMeta(markdown: string): DigestMeta {
  const dateMatch = markdown.match(/^# arXiv Digest — (\d{4}-\d{2}-\d{2})/m);
  const genMatch = markdown.match(/\*\*Generated:\*\* (.+)/);
  const reviewedMatch = markdown.match(/\*\*Papers reviewed:\*\* (\d+)/);
  const relevantMatch = markdown.match(/\*\*Relevant papers:\*\* (\d+)/);
  const catsMatch = markdown.match(/\*\*Categories:\*\* (.+)/);

  const date = dateMatch?.[1] ?? "unknown";
  const generated = genMatch?.[1] ?? new Date().toISOString();
  const papersReviewed = parseInt(reviewedMatch?.[1] ?? "0", 10);
  const relevantPapers = parseInt(relevantMatch?.[1] ?? "0", 10);
  const categories = catsMatch?.[1]?.split(", ") ?? [];

  // Extract highlights from the ## Highlights section
  const highlights: DigestMeta["highlights"] = [];
  const hlMatch = markdown.match(/## Highlights\n\n([\s\S]*?)(?=\n---)/);
  if (hlMatch) {
    const hlLines = hlMatch[1].split("\n").filter((l) => l.startsWith("- **"));
    for (const line of hlLines) {
      const titleMatch = line.match(/\*\*(.+?)\*\*/);
      const tagsMatch = line.match(/\(([^)]+)\)/);
      const scoreMatch = line.match(/score (\d+)/);
      if (titleMatch) {
        highlights.push({
          title: titleMatch[1],
          tags: tagsMatch?.[1]?.split(", ") ?? [],
          score: parseInt(scoreMatch?.[1] ?? "0", 10),
        });
      }
    }
  }

  return { date, generated, papersReviewed, relevantPapers, categories, highlights };
}

async function kvPut(apiToken: string, key: string, value: string): Promise<boolean> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`;
  const resp = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "text/plain" },
    body: value,
    signal: AbortSignal.timeout(15000),
  });
  return resp.ok;
}

async function kvGet(apiToken: string, key: string): Promise<string | null> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiToken}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) return null;
  return resp.text();
}

async function cmdPublish(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  ensureDir();

  // Pre-flight: verify Cloudflare token (account-scoped endpoint)
  const { verifyCloudflareToken, getCloudflareCredentials } = await import("../../src/cloudflare.ts");
  const verify = await verifyCloudflareToken();
  if (!verify.ok) {
    process.stderr.write(`Error: Cloudflare pre-flight failed: ${verify.error}\n`);
    process.exit(1);
  }
  const { creds: cfCreds } = await getCloudflareCredentials();
  if (!cfCreds) { process.stderr.write("cloudflare credentials missing after verify — unreachable\n"); process.exit(1); }
  const apiToken = cfCreds.apiToken;

  // Find digest to publish
  let digestFile: string;
  if (flags.date) {
    // Find digest matching the date
    const entries = readdirSync(ARXIV_DIR).filter((e) => e.endsWith("_arxiv_digest.md"));
    const match = entries.find((e) => e.startsWith(flags.date));
    if (!match) {
      process.stderr.write(`Error: no digest found for date ${flags.date}\n`);
      process.exit(1);
    }
    digestFile = join(ARXIV_DIR, match);
  } else if (flags.file) {
    digestFile = flags.file.startsWith("/") ? flags.file : join(ARXIV_DIR, flags.file);
  } else {
    // Use latest digest
    const entries = readdirSync(ARXIV_DIR)
      .filter((e) => e.endsWith("_arxiv_digest.md"))
      .sort()
      .reverse();
    if (entries.length === 0) {
      process.stderr.write("Error: no digests found. Run 'fetch' then 'compile' first.\n");
      process.exit(1);
    }
    digestFile = join(ARXIV_DIR, entries[0]);
  }

  if (!existsSync(digestFile)) {
    process.stderr.write(`Error: file not found: ${digestFile}\n`);
    process.exit(1);
  }

  const markdown = await Bun.file(digestFile).text();
  const meta = parseDigestMeta(markdown);

  process.stderr.write(`Publishing digest for ${meta.date} (${meta.relevantPapers} papers)...\n`);

  // Write to KV: meta, content, latest pointer, and index
  const metaOk = await kvPut(apiToken, `research:meta:${meta.date}`, JSON.stringify(meta));
  const contentOk = await kvPut(apiToken, `research:content:${meta.date}`, markdown);
  const latestOk = await kvPut(apiToken, "research:latest-key", meta.date);

  if (!metaOk || !contentOk || !latestOk) {
    process.stderr.write("Error: failed to write one or more KV keys.\n");
    process.exit(1);
  }

  // Update the index (list of all dates)
  const existingIndex = await kvGet(apiToken, "research:index");
  const dates: string[] = existingIndex ? JSON.parse(existingIndex) : [];
  if (!dates.includes(meta.date)) {
    dates.push(meta.date);
    dates.sort().reverse(); // newest first
  }
  await kvPut(apiToken, "research:index", JSON.stringify(dates));

  process.stdout.write(JSON.stringify({
    success: true,
    date: meta.date,
    papersReviewed: meta.papersReviewed,
    relevantPapers: meta.relevantPapers,
    highlights: meta.highlights.length,
    kvKeys: [
      `research:meta:${meta.date}`,
      `research:content:${meta.date}`,
      "research:latest-key",
      "research:index",
    ],
  }, null, 2) + "\n");
}

function cmdList(args: string[]): void {
  const flags = parseFlags(args);
  const limit = flags.limit ? parseInt(flags.limit, 10) : 10;

  if (!existsSync(ARXIV_DIR)) {
    process.stdout.write("No arXiv digests yet.\n");
    return;
  }

  const entries = readdirSync(ARXIV_DIR)
    .filter((e) => e.endsWith("_arxiv_digest.md"))
    .sort()
    .reverse()
    .slice(0, limit);

  if (entries.length === 0) {
    process.stdout.write("No arXiv digests yet.\n");
    return;
  }

  process.stdout.write(`arXiv digests (${entries.length}):\n\n`);
  for (const entry of entries) {
    const timestamp = entry.replace("_arxiv_digest.md", "");
    process.stdout.write(`  ${timestamp}  research/arxiv/${entry}\n`);
  }
}

function printUsage(): void {
  process.stdout.write(`arxiv-research CLI

USAGE
  arc skills run --name arxiv-research -- <subcommand> [flags]

SUBCOMMANDS
  fetch [--categories "cs.AI,cs.CL,cs.LG,cs.MA"] [--max 50]
    Fetch recent papers from arXiv, score for LLM/agent relevance.

  compile [--date YYYY-MM-DD]
    Compile a digest from fetched papers. Writes ISO-8601 timestamped file.

  list [--limit 10]
    Show recent digests.

  publish-digest [--date YYYY-MM-DD] [--file FILENAME]
    Publish a digest to the arc0.me research feed (Cloudflare KV).
    Without flags, publishes the latest digest.

  queue-signals
    Read .latest_fetch.json and auto-create signal filing tasks for quantum-relevant
    papers (title+abstract match). Respects beat cooldown and dedup guards.
    Run after 'compile' — wired into AGENT.md digest workflow.

EXAMPLES
  arc skills run --name arxiv-research -- fetch
  arc skills run --name arxiv-research -- fetch --categories "cs.CL,cs.MA" --max 100
  arc skills run --name arxiv-research -- compile --date 2026-03-05
  arc skills run --name arxiv-research -- queue-signals
  arc skills run --name arxiv-research -- list
  arc skills run --name arxiv-research -- publish-digest
  arc skills run --name arxiv-research -- publish-digest --date 2026-03-06
`);
}

// ---- Entry point ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "fetch":
      await cmdFetch(args.slice(1));
      break;
    case "compile":
      await cmdCompile(args.slice(1));
      break;
    case "list":
      cmdList(args.slice(1));
      break;
    case "publish-digest":
      await cmdPublish(args.slice(1));
      break;
    case "queue-signals":
      await cmdQueueSignals();
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      break;
    default:
      process.stderr.write(`Error: unknown subcommand '${sub}'\n\n`);
      printUsage();
      process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
