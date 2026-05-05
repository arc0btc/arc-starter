#!/usr/bin/env bun
// skills/aibtc-news-editorial/cli.ts
// CLI for claiming beats, filing signals, listing beats/signals, and checking correspondent status

import { readHookState, writeHookState } from "../../src/sensors.ts";
import { ARC_BTC_ADDRESS } from "../../src/identity.ts";
import { getCredential } from "../../src/credentials.ts";

const API_BASE = "https://aibtc.news/api";
const SENSOR_NAME = "aibtc-news-editorial";

// ---- Helpers ----

class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

function log(message: string): void {
  console.error(`[${new Date().toISOString()}] [aibtc-news/cli] ${message}`);
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        flags[key] = "true";
      } else {
        flags[key] = args[i + 1];
        i++;
      }
    }
  }
  return flags;
}

async function callApi(
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  authHeaders?: { address: string; signature: string; timestamp: number }
): Promise<Record<string, unknown>> {
  const url = `${API_BASE}${endpoint}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authHeaders) {
    headers["X-BTC-Address"] = authHeaders.address;
    headers["X-BTC-Signature"] = authHeaders.signature;
    // API expects Unix seconds; timestamp may be ms if > 1e12
    const timestamp = authHeaders.timestamp > 1e12 ? Math.floor(authHeaders.timestamp / 1000) : authHeaders.timestamp;
    headers["X-BTC-Timestamp"] = String(timestamp);
  }
  const options: RequestInit = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    throw new ApiError(response.status, `API error ${response.status}: ${JSON.stringify(data)}`);
  }

  return data as Record<string, unknown>;
}

/**
 * Execute an x402-paid request via the wallet skill's x402 runner.
 * Used as fallback when POST /api/signals returns 402 (payment required).
 */
async function x402Request(
  method: string,
  url: string,
  data?: Record<string, unknown>,
  extraHeaders?: Record<string, string>
): Promise<unknown> {
  const args = [
    "bash", "bin/arc", "skills", "run", "--name", "bitcoin-wallet", "--",
    "x402", "execute-endpoint",
    "--method", method,
    "--url", url,
    "--auto-approve",
  ];

  if (data) {
    args.push("--data", JSON.stringify(data));
  }

  if (extraHeaders && Object.keys(extraHeaders).length > 0) {
    args.push("--headers", JSON.stringify(extraHeaders));
  }

  log(`x402 request: ${method} ${url}`);

  const proc = Bun.spawn(args, {
    cwd: process.cwd(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const combined = stdout + stderr;
    const retryMatch = combined.match(/retry.after[:\s]*(\d+)/i)
      || combined.match(/(\d+)\s*(?:seconds?|s)\s*remaining/i);
    if (retryMatch || combined.includes("429") || combined.includes("rate limit")) {
      const retrySeconds = retryMatch ? parseInt(retryMatch[1], 10) : undefined;
      const retryAt = retrySeconds
        ? new Date(Date.now() + retrySeconds * 1000).toISOString()
        : undefined;
      throw new Error(
        `Rate limited (429).${retrySeconds ? ` Retry after ${retrySeconds}s (${retryAt}).` : ""} Raw: ${combined.slice(0, 300)}`
      );
    }
    throw new Error(`x402 request failed (exit ${exitCode}): ${combined.slice(0, 500)}`);
  }

  // Parse JSON from stdout
  const trimmed = stdout.trim();
  const jsonStart = trimmed.indexOf("{");
  if (jsonStart === -1) {
    throw new Error(`No JSON in x402 response. Output: ${trimmed.slice(0, 300)}`);
  }

  // Find the outermost JSON object
  let depth = 0;
  let jsonEnd = jsonStart;
  for (let i = jsonStart; i < trimmed.length; i++) {
    if (trimmed[i] === "{") depth++;
    else if (trimmed[i] === "}") {
      depth--;
      if (depth === 0) {
        jsonEnd = i + 1;
        break;
      }
    }
  }

  return JSON.parse(trimmed.substring(jsonStart, jsonEnd));
}

async function signMessage(message: string): Promise<string> {
  // Call wallet skill to sign message with BIP-137
  const proc = Bun.spawn(
    ["bash", "bin/arc", "skills", "run", "--name", "bitcoin-wallet", "--", "btc-sign", "--message", message],
    {
      cwd: process.cwd(),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`Wallet signing failed: ${stderr}`);
  }

  // Extract JSON output from stdout (wallet outputs logs to stderr, JSON to stdout)
  const combined = (stdout + stderr).trim();

  // Find the first { and try to parse from there
  const jsonStart = combined.indexOf("{");
  if (jsonStart === -1) {
    throw new Error(`No JSON output from wallet signing. Output: ${combined}`);
  }

  // Try parsing from the first { onwards, handling potential trailing garbage
  for (let endIdx = combined.length; endIdx > jsonStart; endIdx--) {
    try {
      const potentialJson = combined.substring(jsonStart, endIdx);
      const result = JSON.parse(potentialJson);
      if (result.signatureBase64) {
        return result.signatureBase64;
      }
      if (result.signature) {
        return result.signature;
      }
    } catch {
      // Try shorter substring
    }
  }

  throw new Error(`No valid signature field in wallet response. Output: ${combined}`);
}

function validateBtcAddress(addr: string): boolean {
  // P2WPKH Bech32 format: bc1q[25-87 alphanumeric]
  return /^bc1[a-zA-HJ-NP-Z0-9]{25,87}$/.test(addr);
}

function validateSlug(slug: string): boolean {
  // Lowercase alphanumeric with hyphens, 3-50 chars, no leading/trailing hyphens
  return /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug) || /^[a-z0-9]$/.test(slug);
}

// ---- Beat Slug Existence Validation (drift detection) ----

const BEAT_CACHE_FILE = "db/beat-slug-cache.json";
const BEAT_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface BeatSlugCache {
  fetchedAt: number;
  slugs: string[];
}

async function fetchBeatSlugs(): Promise<string[]> {
  const response = await fetch(`${API_BASE}/beats`);
  if (!response.ok) {
    throw new Error(`Failed to fetch beats list: HTTP ${response.status}`);
  }
  const data = await response.json() as Array<{ slug: string }>;
  if (!Array.isArray(data)) {
    throw new Error(`Unexpected /beats response format`);
  }
  return data.map((b) => b.slug).filter((s) => typeof s === "string");
}

async function validateBeatExists(beat: string): Promise<void> {
  // Check file-based cache first (shared across invocations in same dispatch window)
  try {
    const cacheFile = Bun.file(BEAT_CACHE_FILE);
    if (await cacheFile.exists()) {
      const cache = await cacheFile.json() as BeatSlugCache;
      if (typeof cache.fetchedAt === "number" && Date.now() - cache.fetchedAt < BEAT_CACHE_TTL_MS) {
        if (!cache.slugs.includes(beat)) {
          throw new Error(
            `Beat slug '${beat}' not found on aibtc.news. Available beats: ${cache.slugs.join(", ")} (cached)`
          );
        }
        log(`beat '${beat}' validated via cache (age: ${Math.round((Date.now() - cache.fetchedAt) / 1000)}s)`);
        return;
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Beat slug")) throw e;
    // Cache read/parse error — fall through to API fetch
  }

  // Fetch fresh list from API
  log(`fetching beats list for slug validation`);
  const slugs = await fetchBeatSlugs();

  // Write cache (non-fatal if it fails)
  try {
    const cache: BeatSlugCache = { fetchedAt: Date.now(), slugs };
    await Bun.write(BEAT_CACHE_FILE, JSON.stringify(cache));
  } catch {
    log(`Warning: failed to write beat slug cache`);
  }

  if (!slugs.includes(beat)) {
    throw new Error(
      `Beat slug '${beat}' not found on aibtc.news. Available beats: ${slugs.join(", ")}`
    );
  }
  log(`beat '${beat}' validated (${slugs.length} beats fetched from API)`);
}

// ---- Narrative Thread Helpers ----

const NARRATIVE_HOOK_STATE_KEY = "ordinals-market-data";
const MAX_NARRATIVE_SIGNALS = 3;
const MAX_NARRATIVE_SUMMARY_LENGTH = 500;

interface NarrativeSignalEntry {
  category: string;
  headline: string;
  claim: string;
  timestamp: string;
}

interface NarrativeThread {
  signals: NarrativeSignalEntry[];
  summary: string;
  weekStarted: string;
  archived?: string[];
}

/**
 * Update the narrative thread in hook state after a successful signal filing.
 * Appends the new signal, trims to last 3, and regenerates the summary.
 * Uses beat-specific hook state key (ordinals → ordinals-market-data, others → <beat>-editorial).
 */
async function updateNarrativeThread(headline: string, claim: string, beat?: string): Promise<void> {
  const hookKey = beat === "ordinals" || !beat ? NARRATIVE_HOOK_STATE_KEY : `${beat}-editorial`;
  const rawState = (await readHookState(hookKey)) as Record<string, unknown> | null;
  if (!rawState) {
    log(`narrative: no ${hookKey} hook state found, skipping update`);
    return;
  }

  // Extract or infer category from headline/tags
  const category = inferCategoryFromHeadline(headline);

  // Initialize thread if missing
  if (!rawState.narrativeThread) {
    const now = new Date();
    const day = now.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setUTCDate(monday.getUTCDate() - diff);
    rawState.narrativeThread = {
      signals: [],
      summary: "",
      weekStarted: monday.toISOString().slice(0, 10),
      archived: [],
    };
  }

  const thread = rawState.narrativeThread as NarrativeThread;

  // Append new signal entry
  thread.signals.push({
    category,
    headline: headline.slice(0, 120),
    claim: claim.slice(0, 300),
    timestamp: new Date().toISOString(),
  });

  // Trim to last MAX_NARRATIVE_SIGNALS
  if (thread.signals.length > MAX_NARRATIVE_SIGNALS) {
    thread.signals.splice(0, thread.signals.length - MAX_NARRATIVE_SIGNALS);
  }

  // Regenerate summary from the last 3 signals
  thread.summary = generateNarrativeSummary(thread.signals);

  await writeHookState(hookKey, rawState as Parameters<typeof writeHookState>[1]);
}

/** Infer category from headline keywords. */
function inferCategoryFromHeadline(headline: string): string {
  const lower = headline.toLowerCase();
  if (lower.includes("inscription") || lower.includes("inscri")) return "inscriptions";
  if (lower.includes("brc-20") || lower.includes("brc20")) return "brc20";
  if (lower.includes("fee") || lower.includes("mempool")) return "fees";
  if (lower.includes("nft") || lower.includes("floor") || lower.includes("collection")) return "nft-floors";
  if (lower.includes("rune")) return "runes";
  if (lower.includes("sdk") || lower.includes("api") || lower.includes("framework") || lower.includes("clarinet") || lower.includes("stacks.js")) return "dev-tools";
  if (lower.includes("release") || lower.includes("deprecat") || lower.includes("migration")) return "dev-tools";
  return "general";
}

/** Generate a max-500-char narrative summary from recent signals. */
function generateNarrativeSummary(signals: NarrativeSignalEntry[]): string {
  if (signals.length === 0) return "";

  const parts = signals.map((s) => {
    const claimSnippet = s.claim.length > 120 ? s.claim.slice(0, 117) + "..." : s.claim;
    return `[${s.category}] ${claimSnippet}`;
  });

  let summary = parts.join(" | ");
  if (summary.length > MAX_NARRATIVE_SUMMARY_LENGTH) {
    summary = summary.slice(0, MAX_NARRATIVE_SUMMARY_LENGTH - 3) + "...";
  }
  return summary;
}

// ---- Signal Composition Helpers ----

function generateHeadline(observation: string): string {
  // Extract first sentence, up to 120 chars
  const sentenceMatch = observation.match(/^(.+?)(?:\.\s|\.$|[!?])/);
  const firstSentence = sentenceMatch
    ? sentenceMatch[1].trim()
    : observation.split("\n")[0].trim();

  if (firstSentence.length <= 120) {
    return firstSentence;
  }

  const truncated = firstSentence.substring(0, 117);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 80 ? truncated.substring(0, lastSpace) : truncated) + "...";
}

function buildContent(observation: string): string {
  const trimmed = observation.trim();
  if (trimmed.length <= 1000) {
    return trimmed;
  }

  const truncated = trimmed.substring(0, 997);
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf(". "),
    truncated.lastIndexOf(".\n"),
    truncated.lastIndexOf("! "),
    truncated.lastIndexOf("? ")
  );

  if (lastSentenceEnd > 800) {
    return truncated.substring(0, lastSentenceEnd + 1).trim();
  }

  return truncated.trimEnd() + "...";
}

interface ValidationResult {
  headlineLength: number;
  contentLength: number;
  sourceCount: number;
  tagCount: number;
  withinLimits: boolean;
  warnings: string[];
}

function validateSignal(
  headline: string,
  content: string,
  sources: Array<{ url: string; title: string }>,
  tags: string[]
): ValidationResult {
  const warnings: string[] = [];

  if (headline.length > 120) {
    warnings.push(`Headline too long: ${headline.length}/120 chars`);
  }
  if (headline.endsWith(".")) {
    warnings.push("Headline should not end with a period");
  }
  if (content.length > 1000) {
    warnings.push(`Content too long: ${content.length}/1000 chars`);
  }
  if (content.length < 50) {
    warnings.push(`Content very short: ${content.length} chars`);
  }
  if (sources.length > 5) {
    warnings.push(`Too many sources: ${sources.length}/5 max`);
  }
  if (sources.length === 0) {
    warnings.push("No sources provided — Ordinals Business signals should cite data");
  }
  if (tags.length > 10) {
    warnings.push(`Too many tags: ${tags.length}/10 max`);
  }

  // Voice checks
  const hypeWords = /\b(moon|pump|dump|amazing|huge|incredible|massive|biggest)\b/i;
  if (hypeWords.test(headline) || hypeWords.test(content)) {
    warnings.push("Hype language detected — use neutral vocabulary");
  }
  if (/^(I |We |My |Our )/i.test(content)) {
    warnings.push("First person detected — use third person only");
  }
  if (/[!]{1,}/.test(headline)) {
    warnings.push("Exclamation marks in headline — remove");
  }

  return {
    headlineLength: headline.length,
    contentLength: content.length,
    sourceCount: sources.length,
    tagCount: tags.length,
    withinLimits:
      headline.length <= 120 &&
      content.length <= 1000 &&
      sources.length <= 5 &&
      tags.length <= 10,
    warnings,
  };
}

// ---- Subcommands ----

async function cmdClaimBeat(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.beat || !flags.name) {
    console.error(
      "Usage: arc skills run --name aibtc-news -- claim-beat --beat <slug> --name <name> [--description <desc>] [--color <hex>]"
    );
    process.exit(1);
  }

  const beat = flags.beat.toLowerCase();
  const name = flags.name;
  const description = flags.description || undefined;
  const color = flags.color || undefined;

  // Validate inputs
  if (!validateSlug(beat)) {
    console.error(`Invalid beat slug: ${beat}`);
    process.exit(1);
  }

  if (name.length > 100) {
    console.error("Beat name too long (max 100 chars)");
    process.exit(1);
  }

  if (description && description.length > 500) {
    console.error("Description too long (max 500 chars)");
    process.exit(1);
  }

  if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
    console.error("Invalid color format (must be #RRGGBB)");
    process.exit(1);
  }

  try {
    // Format message for signing: "METHOD /path:unix_seconds" (API v2 format)
    const timestamp = Math.floor(Date.now() / 1000);
    const message = `POST /api/beats:${timestamp}`;
    log(`Signing message: ${message}`);

    const signature = await signMessage(message);
    log(`Got signature: ${signature.slice(0, 20)}...`);

    // Call API
    const body: Record<string, unknown> = {
      slug: beat,
      name,
      created_by: ARC_BTC_ADDRESS,
    };

    if (description) body.description = description;
    if (color) body.color = color;

    const result = await callApi("POST", "/beats", body, {
      address: ARC_BTC_ADDRESS,
      signature,
      timestamp,
    });

    log(`Beat claimed successfully`);
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    const error = e as Error;
    log(`Error: ${error.message}`);
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
  }
}

async function cmdFileSignal(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.beat || !flags.claim || !flags.evidence || !flags.implication) {
    console.error(
      "Usage: arc skills run --name aibtc-news -- file-signal --beat <slug> --claim <text> --evidence <text> --implication <text> [--headline <text>] [--sources <json>] [--tags <comma-sep>] [--disclosure <text>] [--force]"
    );
    process.exit(1);
  }

  const beat = flags.beat.toLowerCase();
  const claim = flags.claim;
  const evidence = flags.evidence;
  const implication = flags.implication;
  const headline = flags.headline || undefined;
  // Disclosure is REQUIRED by aibtc.news — signals without it get rejected.
  // Format (PR #226): 'model-id, https://aibtc.news/api/skills?slug=beat'
  const modelId = process.env.ARC_DISPATCH_MODEL || "claude-sonnet-4-6";
  const disclosure =
    flags.disclosure ||
    `${modelId}, https://aibtc.news/api/skills?slug=${beat}`;
  const force = flags.force !== undefined;
  const sourcesJson = flags.sources ? JSON.parse(flags.sources) : undefined;
  const tagsStr = flags.tags || "";

  // Validate inputs
  if (!validateSlug(beat)) {
    console.error(`Invalid beat slug: ${beat}`);
    process.exit(1);
  }

  // Validate beat exists on aibtc.news (catches slug drift before judge-signal runs)
  try {
    await validateBeatExists(beat);
  } catch (e) {
    const error = e as Error;
    log(`Beat existence check failed: ${error.message}`);
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
  }

  if (claim.length < 1 || claim.length > 1000) {
    console.error("Claim must be 1-1000 chars");
    process.exit(1);
  }

  if (evidence.length < 1 || evidence.length > 1000) {
    console.error("Evidence must be 1-1000 chars");
    process.exit(1);
  }

  if (implication.length < 1 || implication.length > 1000) {
    console.error("Implication must be 1-1000 chars");
    process.exit(1);
  }

  if (headline && headline.length > 120) {
    console.error("Headline too long (max 120 chars)");
    process.exit(1);
  }

  // Parse tags
  const tags = tagsStr
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 2 && t.length <= 30);

  if (tags.length > 10) {
    console.error("Too many tags (max 10)");
    process.exit(1);
  }

  try {
    // Pre-flight: judge-signal quality gate (skip with --force)
    if (!force) {
      log(`running judge-signal pre-flight`);
      const judgeSources: Array<{ url: string; title: string }> = Array.isArray(sourcesJson) ? sourcesJson : [];
      const judgeResult = await judgeSignalCore(beat, claim, evidence, implication, headline || "", judgeSources);
      if (judgeResult.verdict === "Fail") {
        const failedCriteria = Object.entries(judgeResult.criteria).filter(([, c]) => !c.pass).map(([k]) => k);
        log(`judge-signal pre-flight FAILED: ${failedCriteria.join(", ")} — aborting file-signal`);
        console.error(JSON.stringify({
          error: "Signal quality check failed — use --force to bypass",
          verdict: judgeResult.verdict,
          summary: judgeResult.summary,
          recommendations: judgeResult.recommendations,
        }, null, 2));
        process.exit(1);
      }
      log(`judge-signal pre-flight PASSED`);
    } else {
      log(`--force: skipping judge-signal pre-flight`);
    }

    // Combine claim, evidence, implication into content
    const content = `${claim} ${evidence} ${implication}`;

    if (content.length > 1000) {
      console.error("Combined content too long (max 1000 chars total)");
      process.exit(1);
    }

    // Format message for signing: "METHOD /path:unix_seconds" (API v2 format)
    const timestamp = Math.floor(Date.now() / 1000);
    const message = `POST /api/signals:${timestamp}`;
    log(`Signing message: ${message}`);

    const signature = await signMessage(message);
    log(`Got signature: ${signature.slice(0, 20)}...`);

    // Call API — auth via headers; body fields required by API
    const body: Record<string, unknown> = {
      btc_address: ARC_BTC_ADDRESS,
      beat_slug: beat,
      content,
    };

    if (headline) body.headline = headline;
    body.disclosure = disclosure; // Always include — required by aibtc.news
    if (sourcesJson) body.sources = sourcesJson;
    if (tags.length > 0) body.tags = tags;

    let result: Record<string, unknown>;
    try {
      result = await callApi("POST", "/signals", body, {
        address: ARC_BTC_ADDRESS,
        signature,
        timestamp,
      });
      log(`Signal filed successfully (BIP-137)`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        log(`Signal filing requires payment (402) — falling back to x402 payment flow`);
        const tsStr = String(timestamp);
        result = await x402Request("POST", `${API_BASE}/signals`, body, {
          "X-BTC-Address": ARC_BTC_ADDRESS,
          "X-BTC-Signature": signature,
          "X-BTC-Timestamp": tsStr,
        }) as Record<string, unknown>;
        log(`Signal filed successfully (x402)`);
      } else {
        throw e;
      }
    }

    console.log(JSON.stringify(result, null, 2));

    // Post-filing: update narrative thread for the filed beat
    try {
      await updateNarrativeThread(headline || generateHeadline(claim), claim, beat);
      log(`narrative thread updated for beat ${beat}`);
    } catch (narrativeErr) {
      // Non-fatal — don't fail the signal filing over narrative tracking
      log(`narrative update failed (non-fatal): ${(narrativeErr as Error).message}`);
    }
  } catch (e) {
    const error = e as Error;
    log(`Error: ${error.message}`);
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
  }
}

async function cmdListBeats(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const filter = flags.filter || "all";
  const agent = flags.agent || undefined;

  const validFilters = ["claimed", "unclaimed", "all"];
  if (!validFilters.includes(filter)) {
    console.error(`Invalid filter: ${filter}. Must be one of: ${validFilters.join(", ")}`);
    process.exit(1);
  }

  if (agent && !validateBtcAddress(agent)) {
    console.error(`Invalid BTC address: ${agent}`);
    process.exit(1);
  }

  try {
    let endpoint = "/beats";
    if (filter !== "all") {
      endpoint += `?filter=${filter}`;
    }
    if (agent) {
      endpoint += (endpoint.includes("?") ? "&" : "?") + `agent=${agent}`;
    }

    const result = await callApi("GET", endpoint);
    log(`Listed beats`);
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    const error = e as Error;
    log(`Error: ${error.message}`);
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
  }
}

async function cmdStatus(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const agent = flags.agent || ARC_BTC_ADDRESS;

  if (!validateBtcAddress(agent)) {
    console.error(`Invalid BTC address: ${agent}`);
    process.exit(1);
  }

  try {
    const result = await callApi("GET", `/status/${agent}`);
    log(`Got status for ${agent}`);
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    const error = e as Error;
    log(`Error: ${error.message}`);
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
  }
}

async function cmdListSignals(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const beat = flags.beat ? flags.beat.toLowerCase() : undefined;
  const agent = flags.agent || undefined;
  const limit = flags.limit ? parseInt(flags.limit) : 50;
  const since = flags.since || undefined;

  if (beat && !validateSlug(beat)) {
    console.error(`Invalid beat slug: ${beat}`);
    process.exit(1);
  }

  if (agent && !validateBtcAddress(agent)) {
    console.error(`Invalid BTC address: ${agent}`);
    process.exit(1);
  }

  if (limit < 1 || limit > 100) {
    console.error("Limit must be between 1 and 100");
    process.exit(1);
  }

  try {
    const params = new URLSearchParams();
    if (beat) params.append("beat", beat);
    if (agent) params.append("agent", agent);
    params.append("limit", String(limit));
    if (since) params.append("since", since);

    const endpoint = `/signals?${params.toString()}`;
    const result = await callApi("GET", endpoint);
    log(`Listed signals`);
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    const error = e as Error;
    log(`Error: ${error.message}`);
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
  }
}

async function cmdCorrespondents(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const limit = flags.limit ? parseInt(flags.limit) : 50;
  const sort = flags.sort || "score";

  if (limit < 1 || limit > 100) {
    console.error("Limit must be between 1 and 100");
    process.exit(1);
  }

  const validSort = ["score", "signals", "streak", "days-active"];
  if (!validSort.includes(sort)) {
    console.error(`Invalid sort: ${sort}. Must be one of: ${validSort.join(", ")}`);
    process.exit(1);
  }

  try {
    const endpoint = `/correspondents?limit=${limit}&sort=${sort}`;
    const result = await callApi("GET", endpoint);
    log(`Listed correspondents`);
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    const error = e as Error;
    log(`Error: ${error.message}`);
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
  }
}

async function cmdCompileBrief(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const beatSlug = flags.beat ? flags.beat.toLowerCase() : undefined;

  if (beatSlug && !validateSlug(beatSlug)) {
    console.error(`Invalid beat slug: ${beatSlug}`);
    process.exit(1);
  }

  try {
    // First check Arc's status to see if score >= 50
    const statusResult = await callApi("GET", `/status/${ARC_BTC_ADDRESS}`);
    const status = statusResult as Record<string, unknown>;
    // API doesn't return score field — calculate locally from components
    const totalSignals = (status.totalSignals as number) || 0;
    const streak = (status.streak as Record<string, unknown>) || {};
    const streakCurrent = (streak.current as number) || 0;
    const daysActive = Array.isArray(streak.history) ? streak.history.length : 0;
    const score = totalSignals * 10 + streakCurrent * 5 + daysActive * 2;

    if (score < 50) {
      throw new Error(
        `Cannot compile brief: score ${score} is below minimum 50. File more signals to increase your score.`
      );
    }

    // Record today as the brief compilation date in hook-state at task start
    const today = new Date().toISOString().split("T")[0];
    const hookState = await readHookState(SENSOR_NAME);
    await writeHookState(SENSOR_NAME, {
      ...(hookState ?? { last_ran: new Date().toISOString(), last_result: "ok", version: 1, consecutive_failures: 0 }),
      lastBriefDate: today,
    });
    log(`updated hook-state: lastBriefDate = ${today}`);

    // Format message for signing: "METHOD /path:unix_seconds" (API v2 format)
    const timestamp = Math.floor(Date.now() / 1000);
    const message = `POST /brief:${timestamp}`;
    log(`Signing message: ${message}`);

    const signature = await signMessage(message);
    log(`Got signature: ${signature.slice(0, 20)}...`);

    // Call API to compile brief
    const body: Record<string, unknown> = {
      btc_address: ARC_BTC_ADDRESS,
      date: today,
    };

    if (beatSlug) body.beat = beatSlug;

    const result = await callApi("POST", "/brief", body, {
      address: ARC_BTC_ADDRESS,
      signature,
      timestamp,
    });

    log(`Brief compiled successfully`);
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    const error = e as Error;
    log(`Error: ${error.message}`);
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
  }
}

async function cmdComposeSignal(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const beat = (flags.beat || "ordinals").toLowerCase();
  const observation = flags.observation;
  const headlineOverride = flags.headline;
  const sourcesJson = flags.sources || "[]";
  const tagsJson = flags.tags || "[]";

  if (!observation || observation.trim().length === 0) {
    console.error(
      "Usage: arc skills run --name aibtc-news -- compose-signal --beat <slug> --observation <text> [--headline <text>] [--sources <json>] [--tags <json>]"
    );
    process.exit(1);
  }

  try {
    // Parse sources
    let sources: Array<{ url: string; title: string }>;
    try {
      sources = JSON.parse(sourcesJson);
    } catch {
      console.error(`Invalid --sources JSON: ${sourcesJson}`);
      process.exit(1);
    }

    // Parse tags
    let additionalTags: string[];
    try {
      additionalTags = JSON.parse(tagsJson);
    } catch {
      console.error(`Invalid --tags JSON: ${tagsJson}`);
      process.exit(1);
    }

    // Build headline and content
    const headline = headlineOverride || generateHeadline(observation);
    const content = buildContent(observation);

    // Merge tags (beat-specific tag always included)
    const beatTag = beat === "ordinals" ? "ordinals-business" : beat;
    const allTags = [...new Set([beatTag, ...additionalTags])];

    // Validate
    const validation = validateSignal(headline, content, sources, allTags);

    const signal = {
      headline,
      content,
      beat: beatTag,
      sources: sources.map((s) => s.url),
      tags: allTags,
    };

    console.log(JSON.stringify({ signal, validation }, null, 2));
  } catch (e) {
    const error = e as Error;
    log(`Error: ${error.message}`);
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
  }
}

async function cmdCheckSources(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const sourcesJson = flags.sources;

  if (!sourcesJson) {
    console.error(
      'Usage: arc skills run --name aibtc-news -- check-sources --sources \'[{"url":"...","title":"..."}]\''
    );
    process.exit(1);
  }

  try {
    let sources: Array<{ url: string; title: string }>;
    try {
      sources = JSON.parse(sourcesJson);
    } catch {
      console.error(`Invalid --sources JSON: ${sourcesJson}`);
      process.exit(1);
    }

    if (sources.length === 0) {
      throw new Error("--sources array is empty");
    }

    if (sources.length > 5) {
      throw new Error(`Too many sources: max 5, got ${sources.length}`);
    }

    const results = await Promise.all(
      sources.map(async (src) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        try {
          const response = await fetch(src.url, {
            method: "HEAD",
            signal: controller.signal,
          });
          clearTimeout(timeout);
          return {
            url: src.url,
            title: src.title || "",
            reachable: response.ok || response.status === 405,
            status: response.status,
            note:
              response.status === 405
                ? "HEAD not allowed but server responded"
                : undefined,
          };
        } catch (fetchError: unknown) {
          clearTimeout(timeout);
          const isTimeout =
            fetchError instanceof Error && fetchError.name === "AbortError";
          return {
            url: src.url,
            title: src.title || "",
            reachable: false,
            status: null,
            note: isTimeout ? "Request timed out after 5 seconds" : String(fetchError),
          };
        }
      })
    );

    const allReachable = results.every((r) => r.reachable);

    console.log(
      JSON.stringify(
        {
          results,
          allReachable,
          summary: allReachable
            ? `All ${results.length} source(s) are reachable.`
            : `${results.filter((r) => !r.reachable).length} of ${results.length} source(s) are unreachable.`,
        },
        null,
        2
      )
    );
  } catch (e) {
    const error = e as Error;
    log(`Error: ${error.message}`);
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
  }
}

async function cmdEditorialGuide(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const beat = (flags.beat || "ordinals").toLowerCase();

  // Beat-specific editorial guides
  const EDITORIAL_GUIDES: Record<string, Record<string, unknown>> = {
    ordinals: {
      beat: {
        id: "ordinals-business",
        name: "Ordinals Business",
        description:
          "Inscription volumes, BRC-20 markets, Ordinals marketplace metrics, collection activity, and NFT economic trends on Bitcoin.",
      },
      scope: {
        covers: [
          "Inscription volumes and inscription velocity trends",
          "BRC-20 token issuance, trading volume, and market cap",
          "Ordinals marketplace listings, auctions, and sales",
          "NFT collection activity, floor prices, and rarity analysis",
          "Bitcoin inscription economic metrics and demand trends",
          "Trader and collector behavior patterns",
          "Cross-marketplace comparison and market liquidity",
        ],
        doesNotCover: [
          "Ethereum or Solana NFTs (Bitcoin only)",
          "Cryptocurrency price speculation",
          "Technical blockchain data without market context",
          "Developer tooling (use dev-tools beat)",
        ],
      },
      voice: {
        structure: "Claim → Evidence → Implication. Every signal.",
        principles: [
          "One signal = one observation. No bundling.",
          "Lead with the most important fact.",
          "Target 150-400 chars. Max 1,000.",
          "Headline under 120 chars, no trailing period.",
          "No first person. No speculation without data.",
          "No hype: moon, pump, dump, amazing, huge.",
          "Quantify: inscription counts, BRC-20 supplies, floor prices in sats.",
          "Attribute: data sources, marketplace, timestamp.",
        ],
        vocabulary: {
          use: ["rose", "fell", "signals", "indicates", "suggests", "notably", "meanwhile", "held steady"],
          avoid: ["moon", "pump", "dump", "amazing", "huge", "incredible"],
        },
        headlineFormat: "[Subject] [Action] — [Implication] (max 120 chars, no period)",
        headlineExamples: [
          "Ordinals Inscriptions Rose 12% — BRC-20 Volume Surge Continues",
          "Yuga Labs Collection Hits New Floor — 0.5 BTC Demand Persists",
          "BRC-20 ORDI Token Supply: 21M — Market Cap Now 2B Sats",
        ],
      },
      sourcesAndMetrics: {
        everyCycle: [
          { source: "Unisat API", metric: "Inscription volumes, holder count" },
          { source: "Magic Eden", metric: "Ordinals marketplace volume, floor prices" },
          { source: "OKX NFT", metric: "Cross-exchange trading activity" },
        ],
        daily: [
          { source: "BRC-20 ledgers", metric: "Token issuance and trading" },
          { source: "Ordinals collection floors", metric: "Price movements" },
        ],
      },
      tags: {
        alwaysInclude: ["ordinals-business"],
        taxonomy: ["ordinals-business", "inscriptions", "brc20", "marketplace", "collection", "floor", "volume", "trading", "issuance"],
      },
      antiPatterns: [
        "Never speculate on price direction without volume or supply data.",
        "Never report unverified floor prices — cite the marketplace.",
        "Never hype rarity — describe with data.",
        "Correct errors publicly — trust compounds.",
      ],
    },
    "dev-tools": {
      beat: {
        id: "dev-tools",
        name: "Dev Tools",
        description:
          "Developer tooling, SDKs, APIs, frameworks, and infrastructure for building on Bitcoin and Stacks.",
      },
      scope: {
        covers: [
          "SDK releases, deprecations, and breaking changes (Stacks.js, Hiro, Clarinet, etc.)",
          "API availability, rate limits, and migration paths",
          "Developer framework updates and new tooling launches",
          "Smart contract development tools and static analysis",
          "Testing infrastructure and CI/CD for blockchain development",
          "Developer adoption metrics and ecosystem growth signals",
          "Documentation quality and developer experience improvements",
        ],
        doesNotCover: [
          "Protocol-level consensus changes (use protocol-infra beat)",
          "DeFi yield strategies or token prices (use defi-yields beat)",
          "Ordinals marketplace metrics (use ordinals beat)",
          "General cryptocurrency news without developer impact",
        ],
      },
      voice: {
        structure: "Claim → Evidence → Implication. Every signal.",
        principles: [
          "One signal = one observation. No bundling.",
          "Lead with the most important fact.",
          "Target 150-400 chars. Max 1,000.",
          "Headline under 120 chars, no trailing period.",
          "No first person. No speculation without data.",
          "No hype: revolutionary, game-changing, groundbreaking.",
          "Quantify: version numbers, download counts, API response times, breaking changes count.",
          "Attribute: GitHub repos, release notes, changelog URLs.",
        ],
        vocabulary: {
          use: ["ships", "deprecates", "introduces", "migrates", "adds support for", "removes", "stabilizes", "targets"],
          avoid: ["revolutionary", "game-changing", "groundbreaking", "amazing", "incredible", "exciting"],
        },
        headlineFormat: "[Tool/SDK] [Action] — [Developer Impact] (max 120 chars, no period)",
        headlineExamples: [
          "Stacks.js v7.2 Ships sBTC Helpers — Reduces Integration Boilerplate by 60%",
          "Clarinet v2.8 Adds Fuzz Testing — Smart Contract Security Tooling Matures",
          "Hiro API Deprecates v1 Endpoints — Migration Deadline Set for Q2 2026",
        ],
      },
      sourcesAndMetrics: {
        everyCycle: [
          { source: "GitHub releases", metric: "Version bumps, breaking changes, new features" },
          { source: "npm/crates.io", metric: "Download trends, dependency adoption" },
          { source: "Developer docs", metric: "API changes, deprecation notices" },
        ],
        daily: [
          { source: "arXiv CS papers", metric: "Relevant research with Bitcoin/blockchain developer implications" },
          { source: "Stacks ecosystem repos", metric: "Commit velocity, issue trends" },
        ],
      },
      tags: {
        alwaysInclude: ["dev-tools"],
        taxonomy: ["dev-tools", "sdk", "api", "framework", "testing", "smart-contract", "documentation", "migration", "release"],
      },
      antiPatterns: [
        "Never report a release without checking the actual changelog.",
        "Never conflate protocol changes with tooling changes.",
        "Never speculate on adoption without download or usage data.",
        "Correct errors publicly — trust compounds.",
      ],
    },
  };

  try {
    const guide = EDITORIAL_GUIDES[beat];
    if (!guide) {
      console.error(`No editorial guide for beat '${beat}'. Available: ${Object.keys(EDITORIAL_GUIDES).join(", ")}`);
      process.exit(1);
    }

    console.log(JSON.stringify(guide, null, 2));
  } catch (e) {
    const error = e as Error;
    log(`Error: ${error.message}`);
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
  }
}

// ---- Signal Judge ----

interface JudgeResult {
  verdict: "Pass" | "Fail";
  criteria: Record<string, { pass: boolean; reason: string }>;
  summary: string;
  recommendations: string[];
}

async function judgeSignalCore(
  beat: string,
  claim: string,
  evidence: string,
  implication: string,
  headline: string,
  sources: Array<{ url: string; title: string }>
): Promise<JudgeResult> {
  const criteria: Record<string, { pass: boolean; reason: string }> = {};

  // --- Criterion 1: Claim-Evidence-Implication structure ---
  const structureIssues: string[] = [];
  if (claim.trim().length < 20)
    structureIssues.push(`Claim too short (${claim.trim().length} chars, min 20)`);
  if (evidence.trim().length < 20)
    structureIssues.push(`Evidence too short (${evidence.trim().length} chars, min 20)`);
  if (implication.trim().length < 20)
    structureIssues.push(`Implication too short (${implication.trim().length} chars, min 20)`);
  if (claim.trim() === evidence.trim())
    structureIssues.push("Claim and evidence are identical — must be distinct");
  if (evidence.trim() === implication.trim())
    structureIssues.push("Evidence and implication are identical — must be distinct");

  criteria.structure = {
    pass: structureIssues.length === 0,
    reason:
      structureIssues.length === 0
        ? "Claim, evidence, and implication are distinct and sufficiently detailed"
        : structureIssues.join("; "),
  };

  // --- Criterion 2: Voice — no hype language ---
  const hypePattern =
    /\b(moon(?:ing)?|pump(?:ing)?|dump(?:ing)?|amazing|huge|incredible|massive|biggest|skyrocket(?:ing)?|explod(?:e|ing)|crush(?:ing)?)\b/i;
  const allText = `${headline} ${claim} ${evidence} ${implication}`;
  const hypeMatch = allText.match(hypePattern);
  const firstPersonPattern = /^(I |We |My |Our )/i;
  const firstPerson =
    firstPersonPattern.test(claim) ||
    firstPersonPattern.test(evidence) ||
    firstPersonPattern.test(implication);

  const voiceIssues: string[] = [];
  if (hypeMatch) voiceIssues.push(`Hype word detected: "${hypeMatch[0]}" — use neutral vocabulary`);
  if (firstPerson) voiceIssues.push("First person detected — use third person only");
  if (/[!]/.test(headline)) voiceIssues.push("Exclamation mark in headline — remove");

  criteria.voice = {
    pass: voiceIssues.length === 0,
    reason:
      voiceIssues.length === 0
        ? "Neutral voice, no hype language detected"
        : voiceIssues.join("; "),
  };

  // --- Criterion 3: Sourcing with reachable URLs ---
  if (sources.length === 0) {
    criteria.sourcing = {
      pass: false,
      reason: "No sources provided — signals must cite verifiable data",
    };
  } else if (sources.length > 5) {
    criteria.sourcing = {
      pass: false,
      reason: `Too many sources: ${sources.length}/5 max`,
    };
  } else {
    const reachabilityResults = await Promise.all(
      sources.map(async (src) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
          const response = await fetch(src.url, {
            method: "HEAD",
            signal: controller.signal,
          });
          clearTimeout(timeout);
          return { url: src.url, reachable: response.ok || response.status === 405 };
        } catch {
          clearTimeout(timeout);
          return { url: src.url, reachable: false };
        }
      })
    );
    const unreachable = reachabilityResults.filter((r) => !r.reachable);
    if (unreachable.length > 0) {
      criteria.sourcing = {
        pass: false,
        reason: `${unreachable.length} source(s) unreachable: ${unreachable.map((r) => r.url).join(", ")}`,
      };
    } else {
      criteria.sourcing = {
        pass: true,
        reason: `All ${sources.length} source(s) verified reachable`,
      };
    }
  }

  // --- Criterion 4: Beat-appropriate scope (LLM judge) ---
  try {
    criteria.beat_scope = await judgeBeatScope(beat, claim, evidence, implication);
  } catch (e) {
    const scopeError = e as Error;
    log(`Beat scope judge error: ${scopeError.message}`);
    criteria.beat_scope = {
      pass: false,
      reason: `Beat scope check failed: ${scopeError.message}`,
    };
  }

  const allPass = Object.values(criteria).every((c) => c.pass);
  const failedCriteria = Object.entries(criteria)
    .filter(([, c]) => !c.pass)
    .map(([k]) => k);

  return {
    verdict: allPass ? "Pass" : "Fail",
    criteria,
    summary: allPass
      ? "Signal meets all quality criteria. Ready to file."
      : `Signal failed ${failedCriteria.length} criterion/criteria: ${failedCriteria.join(", ")}`,
    recommendations: allPass ? [] : failedCriteria.map((k) => criteria[k].reason),
  };
}

// Beat scope reference for the judge prompt
const BEAT_SCOPE_REF: Record<string, string> = {
  "ordinals-business":
    "Inscription volumes, BRC-20 markets, Ordinals marketplace metrics, collection activity, NFT economics on Bitcoin",
  "dev-tools":
    "Developer tooling, SDKs, APIs, frameworks, testing infrastructure, and developer experience for Bitcoin/Stacks ecosystem",
  "deal-flow":
    "Real-time market signals, sats auctions, Ordinals bounties, x402 commerce, DAO treasury activity",
  "protocol-infra":
    "Stacks protocol development, security, consensus, sBTC peg mechanics, tooling, SIPs",
  "btc-macro": "Bitcoin price, ETFs, mining economics, macro sentiment",
  "dao-watch": "DAO governance, proposals, treasury movements, voting outcomes",
  "network-ops":
    "Stacks health, block times, signer participation, network anomalies",
  "defi-yields": "BTCFi yields, sBTC flows, Zest/ALEX/Bitflow rates",
  "agent-commerce": "x402 transactions, agent payment flows, escrow mechanics",
};

function buildBeatScopePrompt(
  beat: string,
  claim: string,
  evidence: string,
  implication: string
): string {
  const beatDescription = BEAT_SCOPE_REF[beat] || `${beat} domain content`;

  return `You are evaluating whether an aibtc-news signal is appropriate for its declared editorial beat.

## Criterion: Beat-Appropriate Scope
A signal must cover content that falls within the declared beat's editorial scope. Filing a signal about the wrong domain wastes correspondent reputation and misleads readers.

## PASS means:
The signal's claim, evidence, and implication clearly describe events, metrics, or observations within the declared beat's scope. The primary subject matter belongs to the beat's domain.

## FAIL means:
The signal's primary content belongs to a different beat, or the connection to the declared beat requires a stretch. Content that is merely adjacent to the beat (e.g., a protocol change that incidentally affects Ordinals costs is still a protocol-infra signal, not ordinals-business).

## Beat Scope Reference:
${Object.entries(BEAT_SCOPE_REF)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n")}

## Examples

### Example 1 (PASS)
Beat: ordinals-business
Claim: Ordinals inscription volume rose 23% week-over-week on Bitcoin mainnet.
Evidence: Unisat API recorded 142,000 new inscriptions Jan 15-21, up from 115,000 the prior week.
Implication: Sustained demand signals collector interest persists despite BTC price consolidation.
Critique: Inscription volume is the primary ordinals-business metric. Evidence cites a specific data source. Implication is market-contextual. Content is squarely in scope.
Verdict: Pass

### Example 2 (FAIL)
Beat: ordinals-business
Claim: Stacks Protocol SIP-028 passed governance vote with 78% approval.
Evidence: 142 sBTC signers voted in favor of the proposed fee change.
Implication: Protocol upgrade enables faster sBTC settlement, reducing Ordinals inscription costs.
Critique: The primary content — SIP governance vote and signer participation — belongs to protocol-infra beat. The ordinals connection (reduced inscription costs) is secondary and incidental. Should be filed under protocol-infra.
Verdict: Fail

### Example 3 (PASS)
Beat: deal-flow
Claim: Magic Eden processed 890 BTC Ordinals auction settlements in 24 hours.
Evidence: On-chain data shows 890 UTXO transfers matching Magic Eden auction patterns, totaling 0.42 BTC volume.
Implication: Marketplace velocity signals active secondary market demand for established Ordinals collections.
Critique: Auction settlements and marketplace velocity are core deal-flow metrics. Evidence is on-chain verifiable. Content is clearly in scope.
Verdict: Pass

### Example 4 (FAIL)
Beat: btc-macro
Claim: ALEX DEX recorded its highest single-day trading volume since Q3 2025.
Evidence: ALEX protocol reported $4.2M in 24-hour swap volume across its BTC-correlated pairs.
Implication: DeFi activity on Stacks is recovering alongside broader BTC market sentiment.
Critique: DEX trading volume on ALEX is a defi-yields signal. While the BTC sentiment angle exists, the primary observation (DEX volume) belongs to defi-yields. BTC macro signals should focus on BTC price, ETFs, or mining metrics.
Verdict: Fail

## Your Task
Evaluate the following signal for beat-appropriate scope. Output JSON only — no other text:
{"critique": "...", "result": "Pass" or "Fail"}

Beat: ${beat}
Claim: ${claim}
Evidence: ${evidence}
Implication: ${implication}`;
}

async function judgeBeatScope(
  beat: string,
  claim: string,
  evidence: string,
  implication: string
): Promise<{ pass: boolean; reason: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    log("ANTHROPIC_API_KEY not set — skipping LLM beat scope check");
    return {
      pass: true,
      reason:
        "Beat scope check skipped (ANTHROPIC_API_KEY not set) — verify manually",
    };
  }

  const prompt = buildBeatScopePrompt(beat, claim, evidence, implication);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    content: Array<{ text: string }>;
  };
  const text = data.content[0]?.text || "{}";

  // Extract JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`No JSON in LLM response: ${text}`);
  }

  const parsed = JSON.parse(jsonMatch[0]) as {
    critique: string;
    result: string;
  };
  const pass = parsed.result === "Pass";
  return {
    pass,
    reason: parsed.critique || (pass ? "In scope for beat" : "Out of scope for beat"),
  };
}

async function cmdJudgeSignal(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.beat || !flags.claim || !flags.evidence || !flags.implication) {
    console.error(
      "Usage: arc skills run --name aibtc-news -- judge-signal --beat <slug> --claim <text> --evidence <text> --implication <text> [--headline <text>] [--sources <json>]"
    );
    process.exit(1);
  }

  const beat = flags.beat.toLowerCase();
  const claim = flags.claim;
  const evidence = flags.evidence;
  const implication = flags.implication;
  const headline = flags.headline || "";
  const sourcesJson = flags.sources || "[]";

  let sources: Array<{ url: string; title: string }>;
  try {
    sources = JSON.parse(sourcesJson);
  } catch {
    console.error(`Invalid --sources JSON: ${sourcesJson}`);
    process.exit(1);
  }

  const result = await judgeSignalCore(beat, claim, evidence, implication, headline, sources);
  const failedCriteria = Object.entries(result.criteria).filter(([, c]) => !c.pass).map(([k]) => k);
  log(result.verdict === "Pass" ? "Signal passed all quality checks" : `Signal failed: ${failedCriteria.join(", ")}`);
  console.log(JSON.stringify(result, null, 2));

  if (result.verdict === "Fail") {
    process.exit(2); // Distinguishable from usage error (1)
  }
}

// ---- Unisat Market Data ----

const UNISAT_API_BASE = "https://open-api.unisat.io";
const RATE_LIMIT_DELAY_MS = 200;

async function unisatFetch(
  endpoint: string,
  apiKey: string
): Promise<Record<string, unknown>> {
  const url = `${UNISAT_API_BASE}${endpoint}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Unisat API error ${response.status}: ${text}`);
  }

  return (await response.json()) as Record<string, unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cmdLeaderboard(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const limit = flags.limit ? parseInt(flags.limit) : 20;

  if (limit < 1 || limit > 100) {
    console.error("Limit must be between 1 and 100");
    process.exit(1);
  }

  try {
    const result = await callApi("GET", `/leaderboard?limit=${limit}`);
    log(`Fetched leaderboard`);
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    const error = e as Error;
    log(`Error: ${error.message}`);
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
  }
}

async function cmdFetchOrdinalsData(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const ticker = flags.ticker || undefined;

  try {
    const apiKey = await getCredential("unisat", "api_key");
    if (!apiKey) {
      throw new Error(
        "Unisat API key not configured. Set it with: arc creds set --service unisat --key api_key --value <key>"
      );
    }

    const results: Record<string, unknown> = {};

    // 1. BRC-20 status (top tokens by volume)
    log("Fetching BRC-20 status...");
    try {
      results.brc20Status = await unisatFetch("/v1/indexer/brc20/status", apiKey);
    } catch (e) {
      const error = e as Error;
      log(`BRC-20 status fetch failed: ${error.message}`);
      results.brc20Status = { error: error.message };
    }

    await sleep(RATE_LIMIT_DELAY_MS);

    // 2. Inscription recent events
    log("Fetching inscription events...");
    try {
      results.inscriptionEvents = await unisatFetch(
        "/v1/indexer/inscription/info/recent?limit=20",
        apiKey
      );
    } catch (e) {
      const error = e as Error;
      log(`Inscription events fetch failed: ${error.message}`);
      results.inscriptionEvents = { error: error.message };
    }

    // 3. Optional ticker detail
    if (ticker) {
      await sleep(RATE_LIMIT_DELAY_MS);
      log(`Fetching BRC-20 ticker detail: ${ticker}...`);
      try {
        results.tickerInfo = await unisatFetch(
          `/v1/indexer/brc20/${encodeURIComponent(ticker)}/info`,
          apiKey
        );
      } catch (e) {
        const error = e as Error;
        log(`Ticker info fetch failed: ${error.message}`);
        results.tickerInfo = { error: error.message };
      }
    }

    results.fetchedAt = new Date().toISOString();
    results.source = "unisat";

    log("Ordinals data fetch complete");
    console.log(JSON.stringify(results, null, 2));
  } catch (e) {
    const error = e as Error;
    log(`Error: ${error.message}`);
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
  }
}

// ---- Narrative Thread Commands ----

async function cmdUpdateNarrative(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.headline || !flags.claim) {
    console.error(
      "Usage: arc skills run --name aibtc-news-editorial -- update-narrative --headline <text> --claim <text>"
    );
    process.exit(1);
  }

  await updateNarrativeThread(flags.headline, flags.claim);
  log("narrative thread updated manually");

  // Read back and display current state
  const rawState = (await readHookState(NARRATIVE_HOOK_STATE_KEY)) as Record<string, unknown> | null;
  const thread = rawState?.narrativeThread as NarrativeThread | undefined;
  console.log(JSON.stringify({ narrativeThread: thread ?? null }, null, 2));
}

async function cmdShowNarrative(_args: string[]): Promise<void> {
  const rawState = (await readHookState(NARRATIVE_HOOK_STATE_KEY)) as Record<string, unknown> | null;
  const thread = rawState?.narrativeThread as NarrativeThread | undefined;

  if (!thread || thread.signals.length === 0) {
    console.log(JSON.stringify({ status: "empty", message: "No narrative thread active" }, null, 2));
    return;
  }

  console.log(JSON.stringify({
    weekStarted: thread.weekStarted,
    signalCount: thread.signals.length,
    signals: thread.signals,
    summary: thread.summary,
    archivedWeeks: thread.archived?.length ?? 0,
  }, null, 2));
}

// ---- Correction Commands ----

async function cmdFileCorrection(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags["signal-id"] || !flags.claim || !flags.correction) {
    console.error(
      "Usage: arc skills run --name aibtc-news-editorial -- file-correction --signal-id <uuid> --claim <text> --correction <text> [--sources <text>]"
    );
    process.exit(1);
  }

  const signalId = flags["signal-id"];
  const claim = flags.claim;
  const correction = flags.correction;
  const sources = flags.sources || undefined;

  if (claim.length < 1 || claim.length > 1000) {
    console.error("Claim must be 1-1000 chars");
    process.exit(1);
  }

  if (correction.length < 1 || correction.length > 1000) {
    console.error("Correction must be 1-1000 chars");
    process.exit(1);
  }

  try {
    // Sign the request: "POST /api/signals/{id}/corrections:unix_seconds"
    const timestamp = Math.floor(Date.now() / 1000);
    const message = `POST /api/signals/${signalId}/corrections:${timestamp}`;
    log(`Signing message: ${message}`);

    const signature = await signMessage(message);
    log(`Got signature: ${signature.slice(0, 20)}...`);

    const body: Record<string, unknown> = {
      btc_address: ARC_BTC_ADDRESS,
      claim,
      correction,
    };

    if (sources) body.sources = sources;

    let result: Record<string, unknown>;
    try {
      result = await callApi("POST", `/signals/${signalId}/corrections`, body, {
        address: ARC_BTC_ADDRESS,
        signature,
        timestamp,
      });
      log(`Correction filed successfully (BIP-137)`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        log(`Correction requires payment (402) — falling back to x402`);
        const tsStr = String(timestamp);
        result = await x402Request("POST", `${API_BASE}/signals/${signalId}/corrections`, body, {
          "X-BTC-Address": ARC_BTC_ADDRESS,
          "X-BTC-Signature": signature,
          "X-BTC-Timestamp": tsStr,
        }) as Record<string, unknown>;
        log(`Correction filed successfully (x402)`);
      } else {
        throw e;
      }
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    const error = e as Error;
    log(`Error: ${error.message}`);
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
  }
}

async function cmdListCorrections(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags["signal-id"]) {
    console.error(
      "Usage: arc skills run --name aibtc-news-editorial -- list-corrections --signal-id <uuid>"
    );
    process.exit(1);
  }

  const signalId = flags["signal-id"];

  try {
    const result = await callApi("GET", `/signals/${signalId}/corrections`);
    log(`Listed corrections for signal ${signalId}`);
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    const error = e as Error;
    log(`Error: ${error.message}`);
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
  }
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: arc skills run --name aibtc-news -- <command> [flags]");
    console.error(
      "Commands: claim-beat, file-signal, file-correction, list-corrections, list-beats, status, list-signals, correspondents, compile-brief, compose-signal, check-sources, editorial-guide, judge-signal, fetch-ordinals-data, update-narrative, show-narrative"
    );
    process.exit(1);
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  try {
    switch (command) {
      case "claim-beat":
        await cmdClaimBeat(commandArgs);
        break;
      case "file-signal":
        await cmdFileSignal(commandArgs);
        break;
      case "list-beats":
        await cmdListBeats(commandArgs);
        break;
      case "status":
        await cmdStatus(commandArgs);
        break;
      case "list-signals":
        await cmdListSignals(commandArgs);
        break;
      case "correspondents":
        await cmdCorrespondents(commandArgs);
        break;
      case "compile-brief":
        await cmdCompileBrief(commandArgs);
        break;
      case "compose-signal":
        await cmdComposeSignal(commandArgs);
        break;
      case "check-sources":
        await cmdCheckSources(commandArgs);
        break;
      case "editorial-guide":
        await cmdEditorialGuide(commandArgs);
        break;
      case "judge-signal":
        await cmdJudgeSignal(commandArgs);
        break;
      case "leaderboard":
        await cmdLeaderboard(commandArgs);
        break;
      case "fetch-ordinals-data":
        await cmdFetchOrdinalsData(commandArgs);
        break;
      case "update-narrative":
        await cmdUpdateNarrative(commandArgs);
        break;
      case "show-narrative":
        await cmdShowNarrative(commandArgs);
        break;
      case "file-correction":
        await cmdFileCorrection(commandArgs);
        break;
      case "list-corrections":
        await cmdListCorrections(commandArgs);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (e) {
    const error = e as Error;
    log(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

await main();
