#!/usr/bin/env bun
// skills/arc-link-research/cli.ts
// CLI for the research skill. Processes link batches into mission-relevant reports.
// Usage: arc skills run --name research -- <subcommand> [flags]

import { existsSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getCredential } from "../../src/credentials.ts";

const ROOT = join(import.meta.dir, "..", "..");
const RESEARCH_DIR = join(ROOT, "arc-link-research");
const CACHE_DIR = join(RESEARCH_DIR, "cache");

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

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

interface CachedContent {
  url: string;
  fetchedAt: string;
  contentType: "html" | "tweet" | "github";
  title: string;
  rawContent: string;
  embeddedUrls: string[];
}

async function urlHash(url: string): Promise<string> {
  const data = new TextEncoder().encode(url);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

async function getCached(url: string): Promise<CachedContent | null> {
  ensureCacheDir();
  const hash = await urlHash(url);
  const path = join(CACHE_DIR, `${hash}.json`);
  if (!existsSync(path)) return null;
  try {
    const raw = await Bun.file(path).text();
    return JSON.parse(raw) as CachedContent;
  } catch {
    return null;
  }
}

async function writeCache(entry: CachedContent): Promise<void> {
  ensureCacheDir();
  const hash = await urlHash(entry.url);
  const path = join(CACHE_DIR, `${hash}.json`);
  await Bun.write(path, JSON.stringify(entry, null, 2));
}

function extractEmbeddedUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s"'<>)\]]+/g;
  const matches = text.match(urlRegex) || [];
  return matches.filter((u) => {
    try {
      const parsed = new URL(u);
      // Skip x.com/twitter.com self-references (t.co is fine — those are outbound links)
      if (parsed.hostname === "x.com" || parsed.hostname === "twitter.com") return false;
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  });
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
  "Security practices (wallets, keys, automation)",
  "AI/agent monetization patterns",
  "Orchestrator/dispatch architecture",
  "X/social platform dynamics for agents",
];

// ---- X API OAuth 1.0a (reused from social-x-ecosystem) ----

function percentEncode(text: string): string {
  return encodeURIComponent(text)
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

function generateNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) {
    nonce += chars[byte % chars.length];
  }
  return nonce;
}

async function hmacSha1(key: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

interface XOAuthCreds {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

async function loadXCreds(): Promise<XOAuthCreds | null> {
  try {
    const apiKey = await getCredential("x", "consumer_key");
    const apiSecret = await getCredential("x", "consumer_secret");
    const accessToken = await getCredential("x", "access_token");
    const accessTokenSecret = await getCredential("x", "access_token_secret");
    if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) return null;
    return { apiKey, apiSecret, accessToken, accessTokenSecret };
  } catch {
    return null;
  }
}

async function loadBearerToken(): Promise<string | null> {
  try {
    return await getCredential("x", "bearer_token") || null;
  } catch {
    return null;
  }
}

async function xApiGetBearer(
  endpoint: string,
  bearerToken: string,
  queryParams: Record<string, string> = {}
): Promise<Record<string, unknown> | null> {
  const baseUrl = `https://api.x.com/2${endpoint}`;
  const url = Object.keys(queryParams).length > 0
    ? `${baseUrl}?${new URLSearchParams(queryParams).toString()}`
    : baseUrl;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${bearerToken}` },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) return null;
  return (await response.json()) as Record<string, unknown>;
}

async function xApiGet(
  endpoint: string,
  creds: XOAuthCreds,
  queryParams: Record<string, string> = {}
): Promise<Record<string, unknown> | null> {
  const baseUrl = `https://api.x.com/2${endpoint}`;
  const url = Object.keys(queryParams).length > 0
    ? `${baseUrl}?${new URLSearchParams(queryParams).toString()}`
    : baseUrl;

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: generateNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };

  const allParams = { ...oauthParams, ...queryParams };
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys
    .map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
    .join("&");
  const signatureBase = `GET&${percentEncode(baseUrl)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(creds.apiSecret)}&${percentEncode(creds.accessTokenSecret)}`;
  const signature = await hmacSha1(signingKey, signatureBase);

  oauthParams["oauth_signature"] = signature;
  const headerParts = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(", ");

  const response = await fetch(url, {
    headers: { Authorization: `OAuth ${headerParts}` },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as Record<string, unknown>;
}

// Extract tweet ID from x.com or twitter.com URLs
function parseTweetUrl(url: string): string | null {
  const match = url.match(/(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)/);
  return match ? match[1] : null;
}

// ---- Fetch & Analyze ----

async function fetchRawContent(url: string): Promise<CachedContent> {
  const timestamp = new Date().toISOString();

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
        const title = data.title || `${owner}/${repo}#${number}`;
        const content = `Title: ${data.title}\nState: ${data.state}\nLabels: ${(data.labels || []).map((l: { name: string }) => l.name).join(", ")}\n\n${data.body || ""}`;
        return { url, fetchedAt: timestamp, contentType: "github", title, rawContent: content, embeddedUrls: extractEmbeddedUrls(content) };
      } else {
        throw new Error(`gh CLI failed: ${proc.stderr.toString().trim()}`);
      }
    } else {
      const proc = Bun.spawnSync(["gh", "repo", "view", `${owner}/${repo}`, "--json", "name,description,repositoryTopics,stargazerCount"]);
      if (proc.exitCode === 0) {
        const data = JSON.parse(proc.stdout.toString());
        const title = data.name || `${owner}/${repo}`;
        const topics = (data.repositoryTopics || []).map((t: { name: string }) => t.name);
        let content = `Repo: ${owner}/${repo}\nDescription: ${data.description || ""}\nTopics: ${topics.join(", ")}\nStars: ${data.stargazerCount || 0}`;

        const readmeProc = Bun.spawnSync(["gh", "api", `repos/${owner}/${repo}/readme`, "--jq", ".content"]);
        if (readmeProc.exitCode === 0) {
          const b64 = readmeProc.stdout.toString().trim();
          try {
            content += "\n\nREADME:\n" + atob(b64).slice(0, 3000);
          } catch {
            // base64 decode failed, skip
          }
        }
        return { url, fetchedAt: timestamp, contentType: "github", title, rawContent: content, embeddedUrls: extractEmbeddedUrls(content) };
      } else {
        throw new Error(`gh CLI failed: ${proc.stderr.toString().trim()}`);
      }
    }
  }

  // Tweet URLs: use X API — OAuth 1.0a if available, bearer token fallback for read-only
  const tweetId = parseTweetUrl(url);
  if (tweetId) {
    const tweetQueryParams = {
      "tweet.fields": "created_at,author_id,public_metrics,conversation_id,in_reply_to_user_id,note_tweet,article,entities",
      "expansions": "author_id",
      "user.fields": "id,name,username,description",
    };

    let tweetData: Record<string, unknown> | null = null;
    const xCreds = await loadXCreds();
    if (xCreds) {
      tweetData = await xApiGet(`/tweets/${tweetId}`, xCreds, tweetQueryParams);
    } else {
      const bearerToken = await loadBearerToken();
      if (!bearerToken) {
        throw new Error("Fetch failed — no X credentials configured (need bearer_token or OAuth 1.0a creds)");
      }
      tweetData = await xApiGetBearer(`/tweets/${tweetId}`, bearerToken, tweetQueryParams);
    }

    if (!tweetData) {
      throw new Error("Fetch failed — X API tweet lookup returned empty");
    }

    const tweet = tweetData["data"] as Record<string, unknown> | undefined;
    if (!tweet) {
      throw new Error("Fetch failed, needs X API auth — no tweet data in response");
    }

    const tweetText = (tweet["text"] as string) || "";
    const noteTweet = tweet["noteTweet"] ?? tweet["note_tweet"];
    const fullText: string = (noteTweet as Record<string, unknown> | undefined)?.["text"] as string
      ?? (noteTweet as string | undefined)
      ?? tweetText;
    const articleContent = tweet["article"] as Record<string, unknown> | undefined;
    const authorId = (tweet["author_id"] as string) || "unknown";

    const includes = tweetData["includes"] as Record<string, unknown[]> | undefined;
    const users = (includes?.["users"] || []) as Array<Record<string, string>>;
    const author = users.find((u) => u["id"] === authorId);
    const authorName = author?.["name"] || "unknown";
    const authorUsername = author?.["username"] || "unknown";
    const authorDescription = author?.["description"] || "";

    const displayText = fullText;
    const title = `@${authorUsername}: ${displayText.slice(0, 80)}${displayText.length > 80 ? "..." : ""}`;
    const contentParts = [
      `Tweet by @${authorUsername} (${authorName})`,
      `Author bio: ${authorDescription}`,
      `Text: ${displayText}`,
      `Created: ${tweet["created_at"] || "unknown"}`,
      `Metrics: ${JSON.stringify(tweet["public_metrics"] || {})}`,
    ];
    if (articleContent) {
      const articleText = (articleContent["text"] as string) || JSON.stringify(articleContent);
      contentParts.push(`Article content: ${articleText.slice(0, 50000)}`);
    }
    const content = contentParts.join("\n");

    // Extract embedded URLs from tweet text (t.co links, article URLs)
    const embedded = extractEmbeddedUrls(tweetText);

    return { url, fetchedAt: timestamp, contentType: "tweet", title, rawContent: content, embeddedUrls: embedded };
  }

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
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : new URL(url).hostname;

  const stripped = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 10000);

  return { url, fetchedAt: timestamp, contentType: "html", title, rawContent: stripped, embeddedUrls: extractEmbeddedUrls(stripped) };
}

async function fetchWithCache(url: string): Promise<CachedContent> {
  const cached = await getCached(url);
  if (cached) {
    process.stdout.write(`  [cache hit] ${url}\n`);
    return cached;
  }

  process.stdout.write(`  [fetching] ${url}\n`);
  const content = await fetchRawContent(url);
  await writeCache(content);
  return content;
}

function analyzeContent(url: string, title: string, content: string): LinkAnalysis {
  const result: LinkAnalysis = {
    url,
    title,
    relevance: "low",
    justification: "",
    takeaways: [],
    fetchError: null,
  };

  result.title = title;

  // Evaluate relevance based on content keywords
    const lower = (content + " " + title + " " + url).toLowerCase();
    const signals = {
      high: [
        // Core mission
        "aibtc", "ai agent", "autonomous agent", "x402", "stacks", "clarity",
        "bitcoin payment", "machine-to-machine", "agent payment", "sbtc",
        "agent infrastructure", "agent-to-agent", "bitcoin ai", "ai bitcoin",
        "micropayment", "http 402", "payment required",
        // Security (wallets are money)
        "wallet security", "key management", "seed phrase", "private key",
        "api key leak", "credential rotation", "supply chain attack",
        "dependency vulnerability", "automated security", "agent security",
        "security rule", "security tip", "vibe cod",
        // Monetization
        "ai monetization", "agent revenue", "saas ai", "ai pricing",
        "ai business model", "llm cost", "api monetization", "ai startup",
        "agent marketplace", "ai service", "make money ai", "ai income",
        "money on the table", "llm money", "llm business",
        // Orchestrator/dispatch
        "agent orchestrat", "dispatch", "task queue", "agent loop",
        "agent scheduler", "multi-agent", "agent workflow", "agentic",
        "claude code", "cursor agent", "devin", "codegen agent",
      ],
      medium: [
        "bitcoin", "btc", "smart contract", "blockchain ai", "web3 ai",
        "llm agent", "agent framework", "ai orchestration", "mcp",
        "tool use", "function calling", "ai automation", "crypto ai",
        "decentralized ai", "agent protocol",
        // Security (broader)
        "security", "cybersecurity", "vault", "secret management", "2fa", "oauth",
        "encryption", "zero trust", "vulnerability",
        // Social/X dynamics
        "ai twitter", "bot detection", "social media ai", "engagement",
        "posting strategy", "content strategy", "brand voice",
        "audience growth", "ai influencer",
        // Monetization (broader)
        "freelance ai", "consulting ai", "revenue model", "side project",
        "passive income", "digital product",
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

  return result;
}

async function fetchAndAnalyze(url: string): Promise<{ analysis: LinkAnalysis; embeddedUrls: string[] }> {
  try {
    const cached = await fetchWithCache(url);
    const analysis = analyzeContent(url, cached.title, cached.rawContent);
    return { analysis, embeddedUrls: cached.embeddedUrls };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      analysis: {
        url,
        title: new URL(url).hostname,
        relevance: "low",
        justification: `Fetch failed — ${errorMsg}`,
        takeaways: ["Fetch failed — review link manually or check authentication."],
        fetchError: errorMsg,
      },
      embeddedUrls: [],
    };
  }
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

  const results: LinkAnalysis[] = [];
  const allEmbeddedUrls: string[] = [];

  for (let i = 0; i < analyses.length; i++) {
    const a = analyses[i];
    if (a.status === "fulfilled") {
      results.push(a.value.analysis);
      allEmbeddedUrls.push(...a.value.embeddedUrls);
    } else {
      results.push({
        url: urls[i],
        title: new URL(urls[i]).hostname,
        relevance: "low" as const,
        justification: "Analysis failed",
        takeaways: [`Error: ${a.reason}`],
        fetchError: String(a.reason),
      });
    }
  }

  // Follow embedded URLs from tweets (e.g. article links) — fetch and cache, then analyze
  const newEmbedded = allEmbeddedUrls.filter((u) => !urls.includes(u));
  if (newEmbedded.length > 0) {
    process.stdout.write(`\nFollowing ${newEmbedded.length} embedded link(s) from tweets...\n`);
    const embeddedAnalyses = await Promise.allSettled(newEmbedded.map((u) => fetchAndAnalyze(u)));
    for (let i = 0; i < embeddedAnalyses.length; i++) {
      const a = embeddedAnalyses[i];
      if (a.status === "fulfilled") {
        results.push(a.value.analysis);
      } else {
        results.push({
          url: newEmbedded[i],
          title: new URL(newEmbedded[i]).hostname,
          relevance: "low" as const,
          justification: "Embedded link fetch failed",
          takeaways: [`Error: ${a.reason}`],
          fetchError: String(a.reason),
        });
      }
    }
  }

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

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
