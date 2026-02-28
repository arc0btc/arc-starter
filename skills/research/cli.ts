#!/usr/bin/env bun
// skills/research/cli.ts
// CLI for the research skill. Processes link batches into mission-relevant reports.
// Usage: arc skills run --name research -- <subcommand> [flags]

import { existsSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const RESEARCH_DIR = join(ROOT, "research");

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

function ensureResearchDir(): void {
  if (!existsSync(RESEARCH_DIR)) {
    mkdirSync(RESEARCH_DIR, { recursive: true });
  }
}

function extractUrls(input: string): string[] {
  // Split on commas, newlines, or spaces — then filter for valid URLs
  const candidates = input.split(/[,\n\s]+/).map((s) => s.trim()).filter(Boolean);
  return candidates.filter((c) => {
    try {
      const url = new URL(c);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  });
}

interface LinkAnalysis {
  url: string;
  title: string;
  relevance: "high" | "medium" | "low";
  justification: string;
  takeaways: string[];
  fetchError: string | null;
}

const MISSION_TOPICS = [
  "AIBTC platform",
  "Bitcoin as AI currency",
  "Stacks/Clarity ecosystem",
  "Agent infrastructure",
  "x402 payment protocol",
];

async function fetchAndAnalyze(url: string): Promise<LinkAnalysis> {
  const result: LinkAnalysis = {
    url,
    title: "",
    relevance: "low",
    justification: "",
    takeaways: [],
    fetchError: null,
  };

  try {
    let content: string;
    let title: string;

    // GitHub URLs: use gh CLI for richer data
    const ghMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/?(.*)$/);
    if (ghMatch) {
      const [, owner, repo, rest] = ghMatch;

      if (rest.startsWith("pull/") || rest.startsWith("issues/")) {
        const number = rest.split("/")[1];
        const type = rest.startsWith("pull/") ? "pr" : "issue";
        const proc = Bun.spawnSync(["gh", type, "view", number, "--repo", `${owner}/${repo}`, "--json", "title,body,labels,state"]);
        if (proc.exitCode === 0) {
          const data = JSON.parse(proc.stdout.toString());
          title = data.title || `${owner}/${repo}#${number}`;
          content = `Title: ${data.title}\nState: ${data.state}\nLabels: ${(data.labels || []).map((l: { name: string }) => l.name).join(", ")}\n\n${data.body || ""}`;
        } else {
          throw new Error(`gh CLI failed: ${proc.stderr.toString().trim()}`);
        }
      } else {
        // Repo root or other path
        const proc = Bun.spawnSync(["gh", "repo", "view", `${owner}/${repo}`, "--json", "name,description,repositoryTopics,stargazerCount"]);
        if (proc.exitCode === 0) {
          const data = JSON.parse(proc.stdout.toString());
          title = data.name || `${owner}/${repo}`;
          const topics = (data.repositoryTopics || []).map((t: { name: string }) => t.name);
          content = `Repo: ${owner}/${repo}\nDescription: ${data.description || ""}\nTopics: ${topics.join(", ")}\nStars: ${data.stargazerCount || 0}`;

          // Also get README
          const readmeProc = Bun.spawnSync(["gh", "api", `repos/${owner}/${repo}/readme`, "--jq", ".content"]);
          if (readmeProc.exitCode === 0) {
            const b64 = readmeProc.stdout.toString().trim();
            try {
              content += "\n\nREADME:\n" + atob(b64).slice(0, 3000);
            } catch {
              // base64 decode failed, skip
            }
          }
        } else {
          throw new Error(`gh CLI failed: ${proc.stderr.toString().trim()}`);
        }
      }
    } else {
      // Generic web fetch
      const response = await fetch(url, {
        headers: { "User-Agent": "Arc-Research/1.0" },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      // Extract title from HTML
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      title = titleMatch ? titleMatch[1].trim() : new URL(url).hostname;

      // Strip HTML tags for analysis (rough but functional)
      content = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 5000);
    }

    result.title = title;

    // Evaluate relevance based on content keywords
    const lower = (content + " " + title + " " + url).toLowerCase();
    const signals = {
      high: [
        "aibtc", "ai agent", "autonomous agent", "x402", "stacks", "clarity",
        "bitcoin payment", "machine-to-machine", "agent payment", "sbtc",
        "agent infrastructure", "agent-to-agent", "bitcoin ai", "ai bitcoin",
        "micropayment", "http 402", "payment required",
      ],
      medium: [
        "bitcoin", "btc", "smart contract", "blockchain ai", "web3 ai",
        "llm agent", "agent framework", "ai orchestration", "mcp",
        "tool use", "function calling", "ai automation", "crypto ai",
        "decentralized ai", "agent protocol",
      ],
    };

    const highHits = signals.high.filter((s) => lower.includes(s));
    const medHits = signals.medium.filter((s) => lower.includes(s));

    if (highHits.length >= 2) {
      result.relevance = "high";
      result.justification = `Direct mission hit: ${highHits.slice(0, 3).join(", ")}`;
    } else if (highHits.length === 1 || medHits.length >= 2) {
      result.relevance = "medium";
      const hits = [...highHits, ...medHits].slice(0, 3);
      result.justification = `Adjacent topic: ${hits.join(", ")}`;
    } else if (medHits.length === 1) {
      result.relevance = "low";
      result.justification = `Loosely related: ${medHits[0]}`;
    } else {
      result.relevance = "low";
      result.justification = "No direct mission connection detected";
    }

    // Extract takeaways — first few meaningful sentences
    const sentences = content
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 30 && s.length < 300);

    result.takeaways = sentences.slice(0, 3).map((s) => s + ".");

    if (result.takeaways.length === 0) {
      result.takeaways = [`Content from ${new URL(url).hostname} — review manually for detailed takeaways.`];
    }
  } catch (err) {
    result.fetchError = err instanceof Error ? err.message : String(err);
    result.title = new URL(url).hostname;
    result.justification = "Could not fetch — relevance unknown";
    result.takeaways = ["Fetch failed — review link manually."];
  }

  return result;
}

// ---- Subcommands ----

async function cmdProcess(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.links) {
    process.stderr.write("Usage: arc skills run --name research -- process --links \"url1,url2,...\"\n");
    process.exit(1);
  }

  const urls = extractUrls(flags.links);

  if (urls.length === 0) {
    process.stderr.write("Error: no valid URLs found in --links\n");
    process.exit(1);
  }

  ensureResearchDir();

  process.stdout.write(`Processing ${urls.length} link(s)...\n`);

  // Fetch and analyze all links in parallel
  const analyses = await Promise.allSettled(urls.map((url) => fetchAndAnalyze(url)));

  const results: LinkAnalysis[] = analyses.map((a, i) => {
    if (a.status === "fulfilled") return a.value;
    return {
      url: urls[i],
      title: new URL(urls[i]).hostname,
      relevance: "low" as const,
      justification: "Analysis failed",
      takeaways: [`Error: ${a.reason}`],
      fetchError: String(a.reason),
    };
  });

  // Count by relevance
  const counts = { high: 0, medium: 0, low: 0 };
  for (const r of results) counts[r.relevance]++;

  // Generate report
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const filename = `${timestamp}_research.md`;
  const filepath = join(RESEARCH_DIR, filename);

  const lines: string[] = [
    `# Research Report — ${timestamp}`,
    "",
    `**Links analyzed:** ${results.length}`,
    `**Relevance breakdown:** ${counts.high} high, ${counts.medium} medium, ${counts.low} low`,
    "",
    "---",
    "",
  ];

  for (const r of results) {
    lines.push(`## ${r.title}`);
    lines.push("");
    lines.push(`**URL:** ${r.url}`);
    if (r.fetchError) {
      lines.push(`**Fetch error:** ${r.fetchError}`);
    }
    lines.push(`**Relevance:** ${r.relevance} — ${r.justification}`);
    lines.push("");
    lines.push("### Key Takeaways");
    for (const t of r.takeaways) {
      lines.push(`- ${t}`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  lines.push("## Summary");
  lines.push("");
  lines.push("### Mission Relevance");
  if (counts.high > 0) {
    const highLinks = results.filter((r) => r.relevance === "high");
    lines.push(`- **High relevance (${counts.high}):** ${highLinks.map((r) => r.title).join(", ")}`);
  }
  if (counts.medium > 0) {
    const medLinks = results.filter((r) => r.relevance === "medium");
    lines.push(`- **Medium relevance (${counts.medium}):** ${medLinks.map((r) => r.title).join(", ")}`);
  }
  if (counts.low > 0) {
    lines.push(`- **Low relevance (${counts.low}):** tangential or unfetchable`);
  }
  lines.push("");

  const report = lines.join("\n");
  await Bun.write(filepath, report);

  process.stdout.write(`Report written: research/${filename}\n`);
  process.stdout.write(JSON.stringify({ file: filename, links: results.length, high: counts.high, medium: counts.medium, low: counts.low }, null, 2) + "\n");
}

function cmdList(): void {
  if (!existsSync(RESEARCH_DIR)) {
    process.stdout.write("No research reports yet.\n");
    return;
  }

  const entries = readdirSync(RESEARCH_DIR)
    .filter((e) => e.endsWith("_research.md") && !e.startsWith("."))
    .sort()
    .reverse();

  if (entries.length === 0) {
    process.stdout.write("No research reports yet.\n");
    return;
  }

  process.stdout.write(`Research reports (${entries.length} active):\n\n`);
  for (const entry of entries) {
    const timestamp = entry.replace("_research.md", "");
    process.stdout.write(`  ${timestamp}  research/${entry}\n`);
  }
}

function printUsage(): void {
  process.stdout.write(`research CLI

USAGE
  arc skills run --name research -- <subcommand> [flags]

SUBCOMMANDS
  process --links "url1,url2,..."
    Fetch each link, evaluate mission relevance, produce a timestamped report.

  list
    Show recent research reports (active, not archived).

EXAMPLES
  arc skills run --name research -- process --links "https://example.com/article,https://github.com/owner/repo"
  arc skills run --name research -- list
`);
}

// ---- Entry point ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "process":
      await cmdProcess(args.slice(1));
      break;
    case "list":
      cmdList();
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

main().catch((err) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
