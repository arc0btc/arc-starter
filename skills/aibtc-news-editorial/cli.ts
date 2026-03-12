#!/usr/bin/env bun
// skills/aibtc-news-editorial/cli.ts
// CLI for claiming beats, filing signals, listing beats/signals, and checking correspondent status

import { readHookState, writeHookState } from "../../src/sensors.ts";
import { ARC_BTC_ADDRESS } from "../../src/identity.ts";
import { getCredential } from "../../src/credentials.ts";

const API_BASE = "https://aibtc.news/api";
const SENSOR_NAME = "aibtc-news-editorial";

// ---- Helpers ----

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
  body?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const url = `${API_BASE}${endpoint}`;
  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${JSON.stringify(data)}`);
  }

  return data as Record<string, unknown>;
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
    // Format message for signing (Unix ms timestamp, matching upstream format)
    const timestamp = Date.now();
    const message = `SIGNAL|claim-beat|${beat}|${ARC_BTC_ADDRESS}|${timestamp}`;
    log(`Signing message: ${message}`);

    const signature = await signMessage(message);
    log(`Got signature: ${signature.slice(0, 20)}...`);

    // Call API
    const body: Record<string, unknown> = {
      btcAddress: ARC_BTC_ADDRESS,
      beatId: beat,
      name,
      signature,
      timestamp,
    };

    if (description) body.description = description;
    if (color) body.color = color;

    const result = await callApi("POST", "/beats", body);

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
      "Usage: arc skills run --name aibtc-news -- file-signal --beat <slug> --claim <text> --evidence <text> --implication <text> [--headline <text>] [--sources <json>] [--tags <comma-sep>] [--force]"
    );
    process.exit(1);
  }

  const beat = flags.beat.toLowerCase();
  const claim = flags.claim;
  const evidence = flags.evidence;
  const implication = flags.implication;
  const headline = flags.headline || undefined;
  const force = flags.force !== undefined;
  const sourcesJson = flags.sources ? JSON.parse(flags.sources) : undefined;
  const tagsStr = flags.tags || "";

  // Validate inputs
  if (!validateSlug(beat)) {
    console.error(`Invalid beat slug: ${beat}`);
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

    // Format message for signing (Unix ms timestamp, matching upstream format)
    const timestamp = Date.now();
    const message = `SIGNAL|file-signal|${beat}|${ARC_BTC_ADDRESS}|${timestamp}`;
    log(`Signing message: ${message}`);

    const signature = await signMessage(message);
    log(`Got signature: ${signature.slice(0, 20)}...`);

    // Call API
    const body: Record<string, unknown> = {
      btcAddress: ARC_BTC_ADDRESS,
      beatId: beat,
      content,
      signature,
      timestamp,
    };

    if (headline) body.headline = headline;
    if (sourcesJson) body.sources = sourcesJson;
    if (tags.length > 0) body.tags = tags;

    const result = await callApi("POST", "/signals", body);

    log(`Signal filed successfully`);
    console.log(JSON.stringify(result, null, 2));
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

    // Format message for signing (Unix ms timestamp, matching upstream format)
    const timestamp = Date.now();
    const message = `SIGNAL|compile-brief|${today}|${ARC_BTC_ADDRESS}|${timestamp}`;
    log(`Signing message: ${message}`);

    const signature = await signMessage(message);
    log(`Got signature: ${signature.slice(0, 20)}...`);

    // Call API to compile brief
    const body: Record<string, unknown> = {
      btcAddress: ARC_BTC_ADDRESS,
      date: today,
      signature,
      timestamp,
    };

    if (beatSlug) body.beat = beatSlug;

    const result = await callApi("POST", "/brief", body);

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
  const observation = flags.observation;
  const headlineOverride = flags.headline;
  const sourcesJson = flags.sources || "[]";
  const tagsJson = flags.tags || "[]";

  if (!observation || observation.trim().length === 0) {
    console.error(
      "Usage: arc skills run --name aibtc-news -- compose-signal --observation <text> [--headline <text>] [--sources <json>] [--tags <json>]"
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

    // Merge tags (ordinals-business always included)
    const allTags = [...new Set(["ordinals-business", ...additionalTags])];

    // Validate
    const validation = validateSignal(headline, content, sources, allTags);

    const signal = {
      headline,
      content,
      beat: "ordinals-business",
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
  try {
    const guide = {
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
          "Developer tooling (use protocol-infrastructure beat)",
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
          use: [
            "rose",
            "fell",
            "signals",
            "indicates",
            "suggests",
            "notably",
            "meanwhile",
            "held steady",
          ],
          avoid: [
            "moon",
            "pump",
            "dump",
            "amazing",
            "huge",
            "incredible",
          ],
        },
        headlineFormat:
          "[Subject] [Action] — [Implication] (max 120 chars, no period)",
        headlineExamples: [
          "Ordinals Inscriptions Rose 12% — BRC-20 Volume Surge Continues",
          "Yuga Labs Collection Hits New Floor — 0.5 BTC Demand Persists",
          "BRC-20 ORDI Token Supply: 21M — Market Cap Now 2B Sats",
        ],
      },
      sourcesAndMetrics: {
        everyCycle: [
          { source: "Unisat API", metric: "Inscription volumes, holder count" },
          {
            source: "Magic Eden",
            metric: "Ordinals marketplace volume, floor prices",
          },
          { source: "OKX NFT", metric: "Cross-exchange trading activity" },
        ],
        daily: [
          { source: "BRC-20 ledgers", metric: "Token issuance and trading" },
          { source: "Ordinals collection floors", metric: "Price movements" },
        ],
      },
      tags: {
        alwaysInclude: ["ordinals-business"],
        taxonomy: [
          "ordinals-business",
          "inscriptions",
          "brc20",
          "marketplace",
          "collection",
          "floor",
          "volume",
          "trading",
          "issuance",
        ],
      },
      antiPatterns: [
        "Never speculate on price direction without volume or supply data.",
        "Never report unverified floor prices — cite the marketplace.",
        "Never hype rarity — describe with data.",
        "Correct errors publicly — trust compounds.",
      ],
    };

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

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: arc skills run --name aibtc-news -- <command> [flags]");
    console.error(
      "Commands: claim-beat, file-signal, list-beats, status, list-signals, correspondents, compile-brief, compose-signal, check-sources, editorial-guide, judge-signal, fetch-ordinals-data"
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
      case "fetch-ordinals-data":
        await cmdFetchOrdinalsData(commandArgs);
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
