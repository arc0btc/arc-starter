#!/usr/bin/env bun
// skills/arc-link-research/cli.ts
// CLI for the research skill. Processes link batches into mission-relevant reports.
// Usage: arc skills run --name research -- <subcommand> [flags]

import { existsSync, readdirSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getCredential } from "../../src/credentials.ts";
import {
  parseFrontmatter,
  serializeFrontmatter,
  validateFrontmatter,
  emptyFrontmatter,
  type ResearchFrontmatter,
} from "./lib/frontmatter.ts";
import { buildIndex, findCoverage, type CatalogEntry } from "./lib/catalog.ts";

const ROOT = join(import.meta.dir, "..", "..");
const RESEARCH_DIR = join(ROOT, "research");
const CACHE_DIR = join(import.meta.dir, "cache");
const INDEX_FILE = "INDEX.md";

// Signal filing paused 2026-05-19 per whoabuddy policy (task #17094).
// Mirrors the gate in aibtc-news-editorial, arxiv-research, bitcoin-macro sensors.
// Re-enable: flip to false (grep `SIGNAL_FILING_DISABLED` to find all gates).
const SIGNAL_FILING_DISABLED = true;

// ---- AI-025: Topic controlled-vocabulary ------------------------------------
//
// The dedup shelf and SKU backlog use topic tags to surface coverage gaps.
// Unknown topics drift the catalog. TOPIC_VOCAB defines the canonical set;
// the reindex pass warns on out-of-vocab topics (non-blocking).
// The research-to-SKU pipeline (P10B) will expand this set per batch.
const TOPIC_VOCAB = new Set([
  // agent harness & architecture
  "agent-harness", "agent-runtime", "agent-architecture", "dispatch-loop",
  "task-queue", "state-machine", "memory", "feedback-loop",
  // bitcoin & stacks
  "bitcoin", "stacks", "clarity", "smart-contracts", "sbtc", "l2",
  "lightning", "ordinals", "runes", "bns",
  // monetization & x402
  "x402", "monetization", "payments", "whop", "subscription",
  // tooling
  "testing", "verification", "ci-cd", "deployment", "monitoring",
  // research
  "llm", "prompt-engineering", "tool-use", "rag", "multi-agent",
]);

/** Return topics that are NOT in TOPIC_VOCAB (for reindex warnings). */
function unknownTopics(topics: string[]): string[] {
  return topics.filter((t) => !TOPIC_VOCAB.has(t));
}

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

// ---- Catalog (research/INDEX.md) — the research-to-SKU shelf -------------------

function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Map the mechanical high/medium/low rating to the 0–5 arc_relevance scale. A
 *  mechanical keyword pass is shallow, so it caps at 4 (a deep, repo-grounded agent
 *  report earns 5); low → 1, the anti-slop skip threshold. */
function relevanceToNumber(r: "high" | "medium" | "low"): number {
  return r === "high" ? 4 : r === "medium" ? 2 : 1;
}

/** Load every standard-front-matter report in research/. Reports without a
 *  research front-matter block (pre-standard) are counted as legacy, not indexed. */
function loadCatalogEntries(): { entries: CatalogEntry[]; legacyCount: number } {
  ensureResearchDir();
  const files = readdirSync(RESEARCH_DIR).filter(
    (f) => f.endsWith(".md") && f !== INDEX_FILE && !f.startsWith("."),
  );
  const entries: CatalogEntry[] = [];
  let legacyCount = 0;
  for (const f of files) {
    let content: string;
    try {
      content = readFileSync(join(RESEARCH_DIR, f), "utf8");
    } catch {
      continue; // unreadable file (e.g. removed mid-scan) — skip, don't crash the reindex
    }
    const fm = parseFrontmatter(content);
    if (fm) entries.push({ path: f, fm });
    else legacyCount++;
  }
  return { entries, legacyCount };
}

/** Rebuild research/INDEX.md from the current reports. Returns the counts.
 *  NOTE (cost): a full readdir + readFile of every report. Cheap at hundreds of
 *  reports (sub-100ms); if research/ ever grows past ~1000, make reindex incremental. */
function writeIndex(): { catalogued: number; legacyCount: number } {
  const { entries, legacyCount } = loadCatalogEntries();
  const body = buildIndex(entries, { generatedAt: isoNow(), legacyCount });
  writeFileSync(join(RESEARCH_DIR, INDEX_FILE), body);
  return { catalogued: entries.length, legacyCount };
}

/** Replace (or insert) the leading front-matter block of a report's content. */
function replaceFrontmatter(content: string, fm: ResearchFrontmatter): string {
  const block = serializeFrontmatter(fm);
  if (/^---\n[\s\S]*?\n---\n?/.test(content)) {
    return content.replace(/^---\n[\s\S]*?\n---\n?/, block);
  }
  return block + "\n" + content; // no existing block — prepend
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

function extractSectionUrls(readmeContent: string, sectionName: string): string[] {
  const lines = readmeContent.split("\n");
  // Strip emoji/punctuation for fuzzy match
  const normalize = (s: string) => s.replace(/[^\w\s-]/g, "").trim().toLowerCase();
  const target = normalize(sectionName);
  let inSection = false;
  const sectionLines: string[] = [];

  for (const line of lines) {
    if (/^##\s/.test(line)) {
      const heading = normalize(line.replace(/^##\s+/, ""));
      if (!inSection && (heading === target || heading.startsWith(target) || target.startsWith(heading))) {
        inSection = true;
        continue;
      } else if (inSection) {
        break;
      }
    }
    if (inSection) sectionLines.push(line);
  }

  return extractEmbeddedUrls(sectionLines.join("\n"));
}

async function fetchFullReadme(owner: string, repo: string): Promise<string | null> {
  const proc = Bun.spawnSync(["gh", "api", `repos/${owner}/${repo}/readme`, "--jq", ".content"]);
  if (proc.exitCode !== 0) return null;
  const b64 = proc.stdout.toString().trim();
  try {
    return atob(b64);
  } catch {
    return null;
  }
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
  devToolTags: string[];
}

// Signal routing keywords — matched against content to route high-relevance
// research into aibtc-network signal filing tasks
const DEV_TOOL_SIGNALS = [
  "autonomous agent", "claude code", "agent skill", "mcp",
  "model context protocol", "mcp server", "x402", "agent framework",
  "llm routing", "llm-routing", "tool use", "tool-use", "function calling",
  "multi-agent", "agentic", "agent orchestrat", "agent infrastructure",
  "codegen agent", "agent loop", "agent scheduler", "agent workflow",
  "sdk release", "api deprecat", "developer tool", "dev tool",
  "agent tool", "a2a protocol", "agent-to-agent",
  "langchain", "langgraph", "crewai", "autogen", "openai agents",
  "ai coding", "code assistant", "agent runtime",
];

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

interface TweetPrescreen {
  accessible: boolean;
  reason: string | null;
}

// Lightweight existence check: minimal fields, no content fetch needed.
// Returns accessible=true if we can't determine status (avoids false positives).
async function prescreenTweet(tweetId: string): Promise<TweetPrescreen> {
  const params = { "tweet.fields": "id" };
  let data: Record<string, unknown> | null = null;

  try {
    const xCreds = await loadXCreds();
    if (xCreds) {
      data = await xApiGet(`/tweets/${tweetId}`, xCreds, params);
    } else {
      const bearerToken = await loadBearerToken();
      if (!bearerToken) return { accessible: true, reason: null };
      data = await xApiGetBearer(`/tweets/${tweetId}`, bearerToken, params);
    }
  } catch (e) {
    process.stderr.write(`prescreen lenient-default for ${tweetId}: ${(e as Error).message}\n`);
    return { accessible: true, reason: null };
  }

  if (!data) return { accessible: false, reason: "API returned HTTP error" };

  // If response has no data key, tweet is inaccessible (deleted or protected)
  if (!data["data"]) {
    const errors = data["errors"] as Array<Record<string, unknown>> | undefined;
    const title = (errors?.[0]?.["title"] as string) || "inaccessible";
    if (title.toLowerCase().includes("not found")) {
      return { accessible: false, reason: "tweet deleted or not found" };
    }
    if (title.toLowerCase().includes("authorization")) {
      return { accessible: false, reason: "tweet protected or private" };
    }
    return { accessible: false, reason: title };
  }

  return { accessible: true, reason: null };
}

async function prescreenXUrls(urls: string[]): Promise<{ accessible: string[]; skipped: Array<{ url: string; reason: string }> }> {
  const xItems: Array<{ url: string; tweetId: string }> = [];
  const accessible: string[] = [];

  for (const url of urls) {
    const tweetId = parseTweetUrl(url);
    if (tweetId) {
      xItems.push({ url, tweetId });
    } else {
      accessible.push(url);
    }
  }

  if (xItems.length === 0) return { accessible, skipped: [] };

  const checks = await Promise.allSettled(
    xItems.map(async ({ url, tweetId }) => {
      const result = await prescreenTweet(tweetId);
      return { url, ...result };
    })
  );

  const skipped: Array<{ url: string; reason: string }> = [];
  for (const [i, check] of checks.entries()) {
    if (check.status === "fulfilled") {
      if (check.value.accessible) {
        accessible.push(check.value.url);
      } else {
        skipped.push({ url: check.value.url, reason: check.value.reason ?? "inaccessible" });
      }
    } else {
      accessible.push(xItems[i].url);
    }
  }

  return { accessible, skipped };
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

    // Article tweets: the t.co entity in tweet text self-redirects to x.com/i/article/<tweet_id>.
    // Article body is already captured in contentParts above — skip embedded extraction to
    // avoid following the self-referential link and fetching the JS-wall splash.
    const embedded = articleContent ? [] : extractEmbeddedUrls(tweetText);

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

  // Re-route to X API if the redirect chain (e.g. t.co → x.com) lands on a tweet or
  // an article URL (x.com/i/article/<id>). Without this, the response body is just the
  // "JavaScript is not available" splash (~493 bytes of useless noise).
  const redirectedUrl = response.url;
  const redirectedTweetId = parseTweetUrl(redirectedUrl);
  const articleIdMatch = redirectedUrl !== url
    ? redirectedUrl.match(/(?:x\.com|twitter\.com)\/i\/article\/(\d+)/)
    : null;

  if (redirectedTweetId && redirectedUrl !== url) {
    const tweet = await fetchRawContent(redirectedUrl);
    return { ...tweet, url };
  }
  if (articleIdMatch) {
    // t.co → x.com/i/article/<id>: article ID equals the source tweet ID.
    // Re-fetch via X API using a synthetic /status/<id> URL so parseTweetUrl picks it up.
    const tweetContent = await fetchRawContent(`https://x.com/i/status/${articleIdMatch[1]}`);
    return { ...tweetContent, url };
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
    devToolTags: [],
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

    // Dev-tool tag detection for signal routing
    result.devToolTags = DEV_TOOL_SIGNALS.filter((s) => lower.includes(s));

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
        devToolTags: [],
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

  const section = flags.section?.trim() || null;
  let urls = extractUrls(flags.links);

  if (urls.length === 0) {
    process.stderr.write("Error: no valid URLs found in --links\n");
    process.exit(1);
  }

  ensureResearchDir();

  // Pre-screen X/Twitter links — skip deleted/protected tweets before wasting a dispatch cycle
  let skippedTweets: Array<{ url: string; reason: string }> = [];
  const xUrlCount = urls.filter((u) => parseTweetUrl(u) !== null).length;
  if (xUrlCount > 0) {
    process.stdout.write(`Pre-screening ${xUrlCount} X/Twitter link(s)...\n`);
    const prescreen = await prescreenXUrls(urls);
    skippedTweets = prescreen.skipped;
    for (const s of skippedTweets) {
      process.stdout.write(`  [skip] ${s.url} — ${s.reason}\n`);
    }
    if (skippedTweets.length > 0) {
      process.stdout.write(`Pre-screen: ${skippedTweets.length} skipped, ${prescreen.accessible.length} proceeding\n\n`);
    }
    urls = prescreen.accessible;
  }

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
        devToolTags: [],
      });
    }
  }

  // If --section is set, override embedded URLs for GitHub repo inputs with section-scoped extraction.
  // Without this, fetchRawContent truncates README at 3000 chars and always returns the first section's links.
  if (section) {
    allEmbeddedUrls.length = 0;
    for (const inputUrl of urls) {
      const ghMatch = inputUrl.match(/github\.com\/([^/]+)\/([^/?#]+)/);
      if (ghMatch) {
        const [, owner, repo] = ghMatch;
        process.stdout.write(`\nExtracting section "${section}" from ${owner}/${repo}...\n`);
        const readme = await fetchFullReadme(owner, repo);
        if (readme) {
          const sectionUrls = extractSectionUrls(readme, section);
          process.stdout.write(`  Found ${sectionUrls.length} URL(s) in section\n`);
          allEmbeddedUrls.push(...sectionUrls);
        } else {
          process.stderr.write(`  Warning: could not fetch README for ${owner}/${repo}\n`);
        }
      }
    }
  }

  // Follow embedded URLs from tweets (e.g. article links) — fetch and cache, then analyze
  const newEmbedded = allEmbeddedUrls.filter((u) => !urls.includes(u));
  if (newEmbedded.length > 0) {
    process.stdout.write(`\nFollowing ${newEmbedded.length} embedded link(s)...\n`);
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
          devToolTags: [],
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

  // Standard machine front-matter (research-to-SKU pipeline): fill what the
  // mechanical pass can know; the deep, repo-grounded fields (repos_touched,
  // sku_candidate) stay conservative — an agent-written report sets those properly.
  const fm: ResearchFrontmatter = {
    ...emptyFrontmatter(),
    source_url: urls.length === 1 ? urls[0] : "batch",
    fetched_at: timestamp,
    task_id: flags.task ?? "",
    parent: flags.parent ?? "",
    topics: [...new Set(results.flatMap((r) => r.devToolTags))].slice(0, 8),
    arc_relevance: results.length > 0 ? Math.max(...results.map((r) => relevanceToNumber(r.relevance))) : 0,
    repos_touched: "unknown",
    sku_candidate: false,
    packaged: false,
  };

  const lines: string[] = [
    `# Research Report — ${timestamp}`,
    "",
    `**Links analyzed:** ${results.length}`,
    `**Relevance breakdown:** ${counts.high} high, ${counts.medium} medium, ${counts.low} low`,
    ...(skippedTweets.length > 0 ? [`**Skipped (inaccessible X links):** ${skippedTweets.length}`] : []),
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

  if (skippedTweets.length > 0) {
    lines.push("## Skipped (Inaccessible X Links)");
    lines.push("");
    for (const s of skippedTweets) {
      lines.push(`- ${s.url} — ${s.reason}`);
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

  const report = serializeFrontmatter(fm) + "\n" + lines.join("\n");
  await Bun.write(filepath, report);

  process.stdout.write(`Report written: research/${filename}\n`);

  // Keep the catalog current — best-effort so a reindex hiccup never fails the run.
  try {
    const { catalogued, legacyCount } = writeIndex();
    process.stdout.write(`research/INDEX.md updated: ${catalogued} catalogued, ${legacyCount} legacy\n`);
  } catch (e) {
    process.stderr.write(`Warning: INDEX.md reindex skipped — ${e instanceof Error ? e.message : String(e)}\n`);
  }

  process.stdout.write(JSON.stringify({ file: filename, links: results.length, high: counts.high, medium: counts.medium, low: counts.low }, null, 2) + "\n");

  // Signal routing: HIGH relevance + dev-tool tags + extractable content → queue aibtc-network signal filing task
  // infrastructure beat retired (410) 2026-05-07; aibtc-network covers agent tooling, MCP, orchestration
  // Skip links where content couldn't be extracted (JS walls, t.co with no server-side content, etc.)
  const devToolHighLinks = results.filter(
    (r) => r.relevance === "high" && r.devToolTags.length > 0 && !r.fetchError
      && !r.takeaways[0]?.includes("review manually")
  );
  if (devToolHighLinks.length > 0) {
    if (SIGNAL_FILING_DISABLED) {
      process.stdout.write(`Signal routing: skipped ${devToolHighLinks.length} link(s) — SIGNAL_FILING_DISABLED\n`);
    } else {
      routeAibtcNetworkSignal(devToolHighLinks, filename);
    }
  }
}

function routeAibtcNetworkSignal(links: LinkAnalysis[], reportFile: string): void {
  const linkSummary = links
    .map((l) => `- ${l.title} (${l.url}): ${l.justification} [dev-tool tags: ${l.devToolTags.join(", ")}]`)
    .join("\n");
  const subject = `File aibtc-network signal from research (${links.length} high-relevance link(s))`;
  const description = [
    `Research report: arc-link-research/${reportFile}`,
    "",
    "High-relevance agent tooling/infrastructure links found:",
    linkSummary,
    "",
    "Instructions:",
    "1. Read the research report for full context",
    "2. Compose a signal: arc skills run --name aibtc-news-editorial -- compose-signal --beat aibtc-network",
    "3. Follow editorial guide for aibtc-network beat voice and sourcing",
    "4. File the signal: arc skills run --name aibtc-news-editorial -- file-signal --beat aibtc-network ...",
    "Note: aibtc-network covers AIBTC network activity, agent tooling, MCP, orchestration, protocol releases.",
  ].join("\n");

  const arcBin = join(ROOT, "bin", "arc");
  const proc = Bun.spawnSync([
    arcBin, "tasks", "add",
    "--subject", subject,
    "--skills", "aibtc-news-editorial,arc-link-research",
    "--priority", "5",
    "--model", "sonnet",
    "--description", description,
  ]);

  if (proc.exitCode === 0) {
    process.stdout.write(`Signal routing: queued aibtc-network signal filing task (${links.length} link(s))\n`);
  } else {
    process.stderr.write(`Signal routing: failed to queue task — ${proc.stderr.toString()}\n`);
  }
}

async function cmdPrescreen(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.links) {
    process.stderr.write("Usage: arc skills run --name arc-link-research -- prescreen --links \"url1,url2,...\"\n");
    process.exit(1);
  }

  const urls = extractUrls(flags.links);
  const xUrlCount = urls.filter((u) => parseTweetUrl(u) !== null).length;

  if (xUrlCount === 0) {
    process.stdout.write(`No X/Twitter links found. ${urls.length} other URL(s) pass through.\n`);
    process.stdout.write(JSON.stringify({ accessible: urls, skipped: [] }, null, 2) + "\n");
    return;
  }

  process.stdout.write(`Pre-screening ${xUrlCount} X/Twitter link(s)...\n`);
  const { accessible, skipped } = await prescreenXUrls(urls);

  for (const s of skipped) {
    process.stdout.write(`  [skip] ${s.url} — ${s.reason}\n`);
  }

  process.stdout.write(`\nResult: ${accessible.length} accessible, ${skipped.length} skipped\n`);
  process.stdout.write(JSON.stringify({ accessible, skipped }, null, 2) + "\n");
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

/** AI-027: Retro-migrate legacy research reports to the standard front-matter format.
 *  Legacy reports have no leading ---...--- front-matter block. For each:
 *    - Extract the ISO timestamp from the filename (YYYY-MM-DDTHH:MM:SSZ_research.md).
 *    - Prepend an emptyFrontmatter() block with fetched_at = filename-ts, source_url = "legacy-migration".
 *    - Write back. A report that can't be parsed as a filename ISO is skipped with a warning.
 *  Returns { migrated, skipped, total }. Idempotent: re-running won't touch already-standard reports.
 */
function cmdMigrateLegacy(): void {
  ensureResearchDir();
  const files = readdirSync(RESEARCH_DIR).filter(
    (f) => f.endsWith(".md") && f !== INDEX_FILE && !f.startsWith("."),
  );
  let migrated = 0;
  let skipped = 0;
  let alreadyStandard = 0;
  for (const f of files) {
    let raw: string;
    try {
      raw = readFileSync(join(RESEARCH_DIR, f), "utf8");
    } catch {
      skipped++;
      continue;
    }
    const existing = parseFrontmatter(raw);
    if (existing) {
      alreadyStandard++;
      continue; // already has front-matter — skip
    }
    // Extract ISO timestamp from filename: YYYY-MM-DDTHH:MM:SSZ_research.md
    const m = f.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/);
    const fetchedAt = m ? m[1] : "";
    if (!fetchedAt) {
      process.stderr.write(`  migrate-legacy: skipping ${f} — filename has no ISO timestamp\n`);
      skipped++;
      continue;
    }
    const fm = {
      ...emptyFrontmatter(),
      source_url: "legacy-migration",
      fetched_at: fetchedAt,
      arc_relevance: 0,
    };
    const updated = replaceFrontmatter(raw, fm);
    writeFileSync(join(RESEARCH_DIR, f), updated);
    migrated++;
  }
  const { entries, legacyCount } = loadCatalogEntries();
  writeFileSync(join(RESEARCH_DIR, INDEX_FILE), buildIndex(entries, { generatedAt: isoNow(), legacyCount }));
  process.stdout.write(
    `migrate-legacy: migrated ${migrated} of ${migrated + skipped + alreadyStandard} legacy reports (${alreadyStandard} already standard, ${skipped} skipped). INDEX rebuilt: ${entries.length} catalogued, ${legacyCount} legacy remaining.\n`,
  );
}

function cmdReindex(): void {
  const { entries, legacyCount } = loadCatalogEntries();
  const body = buildIndex(entries, { generatedAt: isoNow(), legacyCount });
  writeFileSync(join(RESEARCH_DIR, INDEX_FILE), body);
  process.stdout.write(`research/${INDEX_FILE} rebuilt: ${entries.length} catalogued, ${legacyCount} legacy (no front-matter)\n`);

  // Surface validation warnings so a malformed / slop-shaped report isn't trusted
  // blindly (the standard's anti-slop gates are warnings, not hard blocks).
  let warned = 0;
  let malformedCount = 0; // AI-026: distinct counter for reports with standard front-matter but invalid fields
  let vocabWarnings = 0;  // AI-025: topics outside TOPIC_VOCAB
  for (const e of entries) {
    const w = validateFrontmatter(e.fm);
    if (w.length > 0) {
      warned++;
      malformedCount++; // AI-026: count separately (front-matter present but fails validation)
      process.stderr.write(`  ⚠ ${e.path}: ${w.join("; ")}\n`);
    }
    // AI-025: warn on unknown topics (controlled-vocab drift)
    const unknown = unknownTopics(e.fm.topics);
    if (unknown.length > 0) {
      vocabWarnings++;
      process.stderr.write(`  topic-vocab: ${e.path}: unknown topic(s): ${unknown.join(", ")}\n`);
    }
  }
  if (warned > 0) process.stderr.write(`${warned} report(s) have front-matter warnings (above).\n`);
  if (malformedCount > 0) process.stderr.write(`${malformedCount} malformed-standard report(s) (front-matter present but fields invalid).\n`); // AI-026
  if (vocabWarnings > 0) process.stderr.write(`${vocabWarnings} report(s) have out-of-vocab topics (see TOPIC_VOCAB in cli.ts to expand). // AI-025\n`);

  // Anti-slop tell: an implausibly high share flagged sku_candidate (the "don't SKU
  // everything" guardrail). Only meaningful once the catalog is non-trivial.
  const skuCount = entries.filter((e) => e.fm.sku_candidate).length;
  if (entries.length >= 5 && skuCount / entries.length > 0.5) {
    process.stderr.write(
      `⚠ ${skuCount}/${entries.length} reports flagged sku_candidate (>50%) — review for slop; the SKU bar is "packaged, this would sell," not "interesting".\n`,
    );
  }
}

function cmdMarkPackaged(args: string[]): void {
  // Close the catalog↔Whop loop: once create-product mints a SKU from a report, flip
  // the report's front-matter packaged:y + record the product id so it leaves the SKU
  // backlog (otherwise create-product would restock the same SKU forever — council cairn).
  const flags = parseFlags(args);
  if (!flags.report || !flags.product) {
    process.stderr.write('Usage: mark-packaged --report "<filename-in-research/>" --product "<prod_id>"\n');
    process.exit(1);
  }
  const filepath = join(RESEARCH_DIR, flags.report);
  if (!existsSync(filepath)) {
    process.stderr.write(`Error: research/${flags.report} not found\n`);
    process.exit(1);
  }
  const content = readFileSync(filepath, "utf8");
  const fm = parseFrontmatter(content);
  if (!fm) {
    process.stderr.write(`Error: research/${flags.report} has no standard front-matter (can't mark packaged)\n`);
    process.exit(1);
  }
  fm.packaged = true;
  fm.product_id = flags.product;
  writeFileSync(filepath, replaceFrontmatter(content, fm));
  const { catalogued, legacyCount } = writeIndex();
  process.stdout.write(
    `Marked research/${flags.report} packaged (product ${flags.product}); INDEX rebuilt: ${catalogued} catalogued, ${legacyCount} legacy\n`,
  );
}

function cmdCatalog(): void {
  const { entries, legacyCount } = loadCatalogEntries();
  const skuBacklog = entries.filter((e) => e.fm.sku_candidate && !e.fm.packaged);
  process.stdout.write(
    JSON.stringify(
      {
        catalogued: entries.length,
        legacy_no_frontmatter: legacyCount,
        sku_backlog: skuBacklog.map((e) => ({
          report: e.path,
          arc_relevance: e.fm.arc_relevance,
          topics: e.fm.topics,
          repos_touched: e.fm.repos_touched,
          sku_why: e.fm.sku_why,
        })),
        note: "rebuild research/INDEX.md with `reindex`",
      },
      null,
      2,
    ) + "\n",
  );
}

function cmdCheck(args: string[]): void {
  // Dedup gate: is a url/topic already covered? Use BEFORE researching a link so we
  // update an existing report rather than fork a duplicate (anti-slop discipline).
  const flags = parseFlags(args);
  if (!flags.url && !flags.topic) {
    process.stderr.write('Usage: check --url "<url>" | --topic "a,b"\n');
    process.exit(1);
  }
  const { entries } = loadCatalogEntries();
  const topics = flags.topic ? flags.topic.split(",").map((t) => t.trim()).filter(Boolean) : [];
  const hits = findCoverage(entries, { url: flags.url, topics });
  process.stdout.write(
    JSON.stringify(
      {
        query: { url: flags.url ?? null, topics },
        covered: hits.length > 0,
        guidance: hits.length > 0 ? "already covered — update the existing report if there's new signal; do NOT fork a duplicate" : "not covered — safe to research",
        matches: hits.map((e) => ({ report: e.path, topics: e.fm.topics, arc_relevance: e.fm.arc_relevance, source_url: e.fm.source_url })),
      },
      null,
      2,
    ) + "\n",
  );
}


// ---- AI-024: Compile / slug-cache paid deliverable builder ----
//
// Wraps a research report into a self-contained paid HTML deliverable.
// Slug cache persists compiled deliverables for quick re-serve.
//
// CLI: arc skills run --name arc-link-research -- compile --report <filename.md> [--force]
//      arc skills run --name arc-link-research -- list-compiled

const COMPILED_DIR = join(CACHE_DIR, "compiled");
const SLUG_CACHE_PATH = join(CACHE_DIR, "slug-cache.json");

interface SlugCacheEntry {
  slug: string;
  report: string;           // source report filename (relative to RESEARCH_DIR)
  compiled_at: string;      // ISO8601
  size_bytes: number;
  title: string;
}

type SlugCache = Record<string, SlugCacheEntry>;

function loadSlugCache(): SlugCache {
  if (!existsSync(SLUG_CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(SLUG_CACHE_PATH, "utf8")) as SlugCache;
  } catch {
    return {};
  }
}

function saveSlugCache(cache: SlugCache): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(SLUG_CACHE_PATH, JSON.stringify(cache, null, 2) + "\n");
}

function slugify(name: string): string {
  return name
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function extractTitle(md: string, filename: string): string {
  const h1 = md.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  // Fall back to the frontmatter title or slugified filename
  const fmTitle = md.match(/^title:\s*"?(.+?)"?$/im);
  if (fmTitle) return fmTitle[1].trim();
  return slugify(filename).replace(/-/g, " ");
}

function extractHeadings(md: string): string[] {
  const headings: string[] = [];
  for (const line of md.split("\n")) {
    const m = line.match(/^#{2,3}\s+(.+)$/);
    if (m) headings.push(m[1].trim());
  }
  return headings.slice(0, 6); // max 6 headings for quiz
}

function buildQuiz(headings: string[]): string {
  if (headings.length === 0) return "";
  // Generate 2-3 questions from section headings
  const picked = headings.slice(0, 3);
  const questions = picked.map((h, i) => {
    return `<div class="quiz-question">
  <p><strong>Q${i + 1}:</strong> Based on the "${h}" section, what is the key takeaway for Bitcoin-native agent development?</p>
  <textarea class="quiz-answer" rows="3" placeholder="Your answer..."></textarea>
</div>`;
  });
  return `<section class="quiz">
  <h2>Reflection Questions</h2>
  <p class="quiz-intro">Use these to solidify your understanding. No submission required — this is for your own synthesis.</p>
  ${questions.join("\n  ")}
</section>`;
}

function markdownToHtmlBody(md: string): string {
  // Minimal markdown → HTML: headings, bold, code blocks, paragraphs, lists.
  // Not a full parser — sufficient for research reports (no tables, no complex nesting).
  let html = md;

  // Code blocks (``` ... ```)
  html = html.replace(/```([\w]*?)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const cls = lang ? ` class="language-${lang}"` : "";
    return `<pre><code${cls}>${code.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Headings
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Horizontal rule
  html = html.replace(/^---+$/gm, "<hr>");

  // Unordered lists (simple)
  html = html.replace(/^[-*]\s+(.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/gs, "<ul>$&</ul>");

  // Paragraphs (blank-line separated)
  const blocks = html.split(/\n{2,}/);
  html = blocks.map((block) => {
    const trimmed = block.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("<h") || trimmed.startsWith("<pre") ||
        trimmed.startsWith("<ul") || trimmed.startsWith("<hr") ||
        trimmed.startsWith("<div") || trimmed.startsWith("<section")) {
      return trimmed;
    }
    // Wrap bare text in <p>
    return `<p>${trimmed.replace(/\n/g, " ")}</p>`;
  }).join("\n");

  return html;
}

function buildPaidHtml(opts: {
  title: string;
  compiledAt: string;
  sourceReport: string;
  bodyMd: string;
  quiz: string;
}): string {
  const bodyHtml = markdownToHtmlBody(opts.bodyMd);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${opts.title} — Arc Research</title>
  <style>
    :root { --bg: #0d1117; --surface: #161b22; --border: #30363d; --text: #c9d1d9; --muted: #8b949e; --accent: #f7931a; --link: #58a6ff; }
    body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", monospace; max-width: 720px; margin: 0 auto; padding: 2rem 1rem; line-height: 1.7; }
    h1, h2, h3 { color: #e6edf3; }
    h1 { border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
    code { background: var(--surface); border: 1px solid var(--border); border-radius: 3px; padding: 0.1em 0.3em; font-size: 0.9em; }
    pre { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 1rem; overflow-x: auto; }
    pre code { background: none; border: none; padding: 0; }
    hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }
    a { color: var(--link); }
    ul { padding-left: 1.5rem; }
    li { margin: 0.3rem 0; }
    .meta { color: var(--muted); font-size: 0.85em; margin-bottom: 2rem; }
    .identity { border-left: 3px solid var(--accent); padding-left: 1rem; margin-bottom: 2rem; font-size: 0.9em; color: var(--muted); }
    .quiz { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 1.5rem; margin: 2rem 0; }
    .quiz h2 { margin-top: 0; }
    .quiz-intro { color: var(--muted); font-size: 0.9em; }
    .quiz-question { margin: 1.5rem 0; }
    .quiz-answer { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; color: var(--text); padding: 0.5rem; font-family: inherit; resize: vertical; }
    .cta { background: var(--surface); border: 1px solid var(--accent); border-radius: 6px; padding: 1.5rem; margin: 2rem 0; text-align: center; }
    .cta a { color: var(--accent); font-weight: bold; }
    .footer { color: var(--muted); font-size: 0.8em; text-align: center; margin-top: 3rem; border-top: 1px solid var(--border); padding-top: 1rem; }
  </style>
</head>
<body>
  <div class="identity">
    <strong>Arc</strong> · <code>arc0.btc</code> · Bitcoin-native agent research<br>
    Stacks: <code>SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B</code>
  </div>

  <h1>${opts.title}</h1>
  <div class="meta">
    Compiled: ${opts.compiledAt}<br>
    Source: <code>${opts.sourceReport}</code>
  </div>

  <hr>

  ${bodyHtml}

  <hr>

  ${opts.quiz}

  <div class="cta">
    <p>This report is from the <strong>hash-it-out</strong> research library.<br>
    Join Arc's paid room for live research threads, Q&amp;A, and new reports as they ship.</p>
    <a href="https://whop.com/hash-it-out/?a=arc0btc">Join hash-it-out on Whop</a>
  </div>

  <div class="footer">
    Arc · arc0.btc · autonomously compiled · not financial advice
  </div>
</body>
</html>`;
}

async function cmdCompile(rawArgs: string[]): Promise<void> {
  const flags = parseFlags(rawArgs);
  const reportFile = flags["report"];
  if (!reportFile) {
    process.stderr.write("Error: --report <filename.md> is required\n");
    process.exit(1);
  }

  const force = rawArgs.includes("--force");
  const reportPath = join(RESEARCH_DIR, reportFile);
  if (!existsSync(reportPath)) {
    process.stderr.write(`Error: report not found: ${reportPath}\n`);
    process.exit(1);
  }

  const md = readFileSync(reportPath, "utf8");
  const title = extractTitle(md, reportFile);
  const slug = slugify(reportFile);
  const compiledAt = new Date().toISOString();

  const cache = loadSlugCache();
  if (cache[slug] && !force) {
    process.stdout.write(
      `Already compiled: ${slug} (${cache[slug].compiled_at}). Use --force to recompile.\n`
    );
    process.stdout.write(JSON.stringify(cache[slug], null, 2) + "\n");
    return;
  }

  const headings = extractHeadings(md);
  const quiz = buildQuiz(headings);
  const html = buildPaidHtml({ title, compiledAt, sourceReport: reportFile, bodyMd: md, quiz });

  if (!existsSync(COMPILED_DIR)) mkdirSync(COMPILED_DIR, { recursive: true });
  const outPath = join(COMPILED_DIR, `${slug}.html`);
  writeFileSync(outPath, html, "utf8");

  const entry: SlugCacheEntry = {
    slug,
    report: reportFile,
    compiled_at: compiledAt,
    size_bytes: html.length,
    title,
  };
  cache[slug] = entry;
  saveSlugCache(cache);

  process.stdout.write(`Compiled: ${outPath}\n`);
  process.stdout.write(JSON.stringify(entry, null, 2) + "\n");
}

function cmdListCompiled(): void {
  const cache = loadSlugCache();
  const entries = Object.values(cache);
  if (entries.length === 0) {
    process.stdout.write("No compiled deliverables in slug cache.\n");
    return;
  }
  process.stdout.write(`Compiled deliverables (${entries.length}):\n\n`);
  for (const e of entries.sort((a, b) => b.compiled_at.localeCompare(a.compiled_at))) {
    const sizeKb = (e.size_bytes / 1024).toFixed(1);
    process.stdout.write(`  ${e.slug}\n    title: ${e.title}\n    report: ${e.report}\n    compiled: ${e.compiled_at}  size: ${sizeKb}KB\n\n`);
  }
}

function printUsage(): void {
  process.stdout.write(`arc-link-research CLI

USAGE
  arc skills run --name arc-link-research -- <subcommand> [flags]

SUBCOMMANDS
  prescreen --links "url1,url2,..."
    Check X/Twitter links for existence before queueing research tasks.
    Outputs JSON with accessible and skipped arrays. Use before arc tasks add.

  process --links "url1,url2,..." [--section "Section Name"]
    Fetch each link, evaluate mission relevance, produce a timestamped report.
    X/Twitter links are pre-screened automatically; inaccessible tweets are skipped.
    --section: when the link is a GitHub awesome-list repo, extract URLs only from the
    named ## heading range. Fuzzy-matched (strips emoji/punctuation). Required for
    awesome-list tasks that include a "Section: X" hint in the task description.

  list
    Show recent research reports (active, not archived).

  migrate-legacy
    Retro-migrate all legacy research reports (no front-matter) to the standard
    front-matter format (AI-027). Idempotent — re-running won't touch already-standard
    reports. Run once to migrate the ~147 pre-standard reports. Then reindex.

  reindex
    Rebuild research/INDEX.md (the catalog) from every report's front-matter.
    Reports without standard front-matter are counted as legacy, not indexed.

  catalog
    Print the catalog summary + the SKU backlog (sku_candidate, not yet packaged).

  check --url "<url>" | --topic "a,b"
    Dedup gate: is this url/topic already covered? Run BEFORE researching a link.

  mark-packaged --report "<file>" --product "<prod_id>"
    Flip a report packaged:y + record its Whop product id (after create-product mints
    the SKU) so it leaves the SKU backlog. Then reindexes.

  compile --report "<file.md>" [--force]
    Wrap a research report into a self-contained paid HTML deliverable with title,
    body, quiz questions (derived from section headings), and a Whop CTA. Writes to
    cache/compiled/<slug>.html and updates cache/slug-cache.json.
    Use --force to recompile an already-cached deliverable.

  list-compiled
    Print all compiled deliverables from the slug cache.

EXAMPLES
  arc skills run --name arc-link-research -- prescreen --links "https://x.com/user/status/123,https://x.com/user/status/456"
  arc skills run --name arc-link-research -- process --links "https://example.com/article,https://github.com/owner/repo"
  arc skills run --name arc-link-research -- list
  arc skills run --name arc-link-research -- reindex
  arc skills run --name arc-link-research -- check --topic "harness,verification"
`);
}

// ---- Entry point ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "prescreen":
      await cmdPrescreen(args.slice(1));
      break;
    case "process":
      await cmdProcess(args.slice(1));
      break;
    case "list":
      cmdList();
      break;
    case "reindex":
      cmdReindex();
      break;
    case "migrate-legacy":
      cmdMigrateLegacy(); // AI-027: retro-migrate 147 legacy reports to standard front-matter
      break;
    case "catalog":
      cmdCatalog();
      break;
    case "check":
      cmdCheck(args.slice(1));
      break;
    case "mark-packaged":
      cmdMarkPackaged(args.slice(1));
      break;
    case "compile":
      await cmdCompile(args.slice(1));
      break;
    case "list-compiled":
      cmdListCompiled();
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
