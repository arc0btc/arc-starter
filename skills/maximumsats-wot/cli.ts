#!/usr/bin/env bun
// skills/maximumsats-wot/cli.ts
// MaximumSats Web of Trust trust scoring for Nostr pubkeys.
// Usage: arc skills run --name maximumsats-wot -- check --npub <npub>

import { resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

// ---- Constants ----

const WOT_API_URL = "https://maximumsats.com/api/wot-report";
const CACHE_PATH = resolve(import.meta.dir, "../../db/hook-state/maximumsats-cache.json");
const CONFIG_PATH = resolve(import.meta.dir, "../../db/hook-state/maximumsats-config.json");
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ---- Types ----

interface WotReport {
  pubkey: string;
  rank: number;
  position: number;
  in_top_100: boolean;
  report: string;
  graph: { nodes: number; edges: number };
}

interface CacheEntry {
  data: WotReport;
  fetchedAt: number; // epoch ms
}

interface WotCache {
  [hexPubkey: string]: CacheEntry;
}

interface WotConfig {
  minRank: number;
  requireTop100: boolean;
}

interface ThresholdResult {
  trusted: boolean;
  reason?: string;
  rank: number;
  in_top_100: boolean;
  thresholds: WotConfig;
}

// ---- Helpers ----

function log(message: string): void {
  console.error(`[${new Date().toISOString()}] [maximumsats-wot/cli] ${message}`);
}

function loadConfig(): WotConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as WotConfig;
    }
  } catch {
    // use defaults
  }
  return { minRank: 10000, requireTop100: false };
}

function saveConfig(config: WotConfig): void {
  const dir = resolve(CONFIG_PATH, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function loadCache(): WotCache {
  try {
    if (existsSync(CACHE_PATH)) {
      return JSON.parse(readFileSync(CACHE_PATH, "utf-8")) as WotCache;
    }
  } catch {
    // fresh cache
  }
  return {};
}

function saveCache(cache: WotCache): void {
  const dir = resolve(CACHE_PATH, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

function getCached(hexPubkey: string): WotReport | null {
  const cache = loadCache();
  const entry = cache[hexPubkey];
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null;
  return entry.data;
}

function setCache(hexPubkey: string, data: WotReport): void {
  const cache = loadCache();
  cache[hexPubkey] = { data, fetchedAt: Date.now() };
  // Prune expired entries
  const now = Date.now();
  for (const key of Object.keys(cache)) {
    if (now - cache[key].fetchedAt > CACHE_TTL_MS) {
      delete cache[key];
    }
  }
  saveCache(cache);
}

/**
 * Convert npub (bech32) to hex pubkey.
 * npub is bech32-encoded with HRP "npub" containing a 32-byte pubkey.
 */
function npubToHex(npub: string): string {
  if (!npub.startsWith("npub1")) {
    throw new Error(`Invalid npub: must start with "npub1"`);
  }
  // Decode bech32 manually — npub uses bech32 encoding
  const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const data = npub.slice(5); // remove "npub1"

  // Bech32 decode to 5-bit words
  const words: number[] = [];
  for (const c of data) {
    const idx = CHARSET.indexOf(c);
    if (idx === -1) throw new Error(`Invalid bech32 character: ${c}`);
    words.push(idx);
  }

  // Remove checksum (last 6 words)
  const payload = words.slice(0, -6);

  // Convert from 5-bit to 8-bit
  let acc = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const word of payload) {
    acc = (acc << 5) | word;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }

  if (bytes.length !== 32) {
    throw new Error(`Invalid npub: expected 32 bytes, got ${bytes.length}`);
  }

  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Resolve pubkey input to hex format. Accepts hex or npub.
 */
function resolveHexPubkey(input: string): string {
  if (input.startsWith("npub1")) {
    return npubToHex(input);
  }
  // Validate hex
  if (!/^[0-9a-f]{64}$/i.test(input)) {
    throw new Error(`Invalid pubkey: expected 64-char hex or npub1... bech32`);
  }
  return input.toLowerCase();
}

/**
 * Fetch WoT report from MaximumSats API.
 * Note: This endpoint costs 100 sats via L402 payment.
 * Without L402 payment, the API may return a 402 status.
 */
async function fetchWotReport(hexPubkey: string): Promise<WotReport> {
  const response = await fetch(WOT_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pubkey: hexPubkey }),
  });

  if (response.status === 402) {
    // L402 payment required
    const wwwAuth = response.headers.get("www-authenticate") || "";
    throw new Error(
      `L402 payment required (100 sats). ` +
        `This API requires Lightning payment via L402 protocol. ` +
        `WWW-Authenticate: ${wwwAuth.substring(0, 200)}`
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`API error ${response.status}: ${body.substring(0, 500)}`);
  }

  return (await response.json()) as WotReport;
}

/**
 * Check a pubkey against configured thresholds.
 */
function checkThresholds(report: WotReport, config: WotConfig): ThresholdResult {
  const result: ThresholdResult = {
    trusted: true,
    rank: report.rank,
    in_top_100: report.in_top_100,
    thresholds: config,
  };

  if (config.requireTop100 && !report.in_top_100) {
    result.trusted = false;
    result.reason = `Pubkey is not in top 100 (rank: ${report.rank})`;
    return result;
  }

  if (report.rank > config.minRank) {
    result.trusted = false;
    result.reason = `Rank ${report.rank} exceeds threshold ${config.minRank}`;
    return result;
  }

  return result;
}

// ---- Subcommands ----

async function cmdCheck(args: string[]): Promise<void> {
  let pubkeyInput: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--npub" || args[i] === "--pubkey") && i + 1 < args.length) {
      pubkeyInput = args[i + 1];
      i++;
    }
  }

  if (!pubkeyInput) {
    console.log(JSON.stringify({ error: "--npub or --pubkey is required" }, null, 2));
    process.exit(1);
  }

  let hexPubkey: string;
  try {
    hexPubkey = resolveHexPubkey(pubkeyInput);
  } catch (err) {
    console.log(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2)
    );
    process.exit(1);
  }

  // Check cache first
  const cached = getCached(hexPubkey);
  if (cached) {
    log("Using cached WoT report (< 1h old)");
    const config = loadConfig();
    const threshold = checkThresholds(cached, config);
    console.log(
      JSON.stringify(
        {
          success: true,
          cached: true,
          pubkey: hexPubkey,
          ...threshold,
          report: cached.report,
          graph: cached.graph,
        },
        null,
        2
      )
    );
    return;
  }

  // Fetch from API
  try {
    const report = await fetchWotReport(hexPubkey);
    setCache(hexPubkey, report);
    const config = loadConfig();
    const threshold = checkThresholds(report, config);
    console.log(
      JSON.stringify(
        {
          success: true,
          cached: false,
          pubkey: hexPubkey,
          ...threshold,
          report: report.report,
          graph: report.graph,
        },
        null,
        2
      )
    );
  } catch (err) {
    console.log(
      JSON.stringify(
        {
          success: false,
          pubkey: hexPubkey,
          error: err instanceof Error ? err.message : String(err),
        },
        null,
        2
      )
    );
    process.exit(1);
  }
}

async function cmdCheckAgent(args: string[]): Promise<void> {
  let stacksAddress: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--stacks-address" && i + 1 < args.length) {
      stacksAddress = args[i + 1];
      i++;
    }
  }

  if (!stacksAddress) {
    console.log(JSON.stringify({ error: "--stacks-address is required" }, null, 2));
    process.exit(1);
  }

  // To derive a Nostr pubkey from a Stacks address, we need the mnemonic.
  // This requires the wallet to be unlocked — the derivation goes:
  // mnemonic -> BIP32 seed -> NIP-06 path (m/44'/1237'/0'/0/0) -> Nostr pubkey
  //
  // We can't derive a Nostr pubkey from just a Stacks address without the seed.
  // For the agent's OWN address, we can use the wallet. For external addresses,
  // a mapping must exist (e.g., in contacts or on-chain NIP-05).
  //
  // For now: check if the stacks address matches the agent's own address.
  // If so, derive via NIP-06. Otherwise, explain the limitation.

  console.log(
    JSON.stringify(
      {
        success: false,
        stacksAddress,
        error:
          "Cannot derive Nostr pubkey from an arbitrary Stacks address without the seed phrase. " +
          "Use 'check --npub' or 'check --pubkey' with the counterparty's known Nostr pubkey instead. " +
          "For the agent's own address, wallet unlock + NIP-06 derivation is needed " +
          "(requires integration with wallet-manager).",
        hint: "Look up the counterparty's npub via NIP-05, contacts skill, or on-chain identity.",
      },
      null,
      2
    )
  );
  process.exit(1);
}

function cmdConfig(args: string[]): void {
  const config = loadConfig();
  let changed = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--min-rank" && i + 1 < args.length) {
      config.minRank = parseInt(args[i + 1], 10);
      changed = true;
      i++;
    } else if (args[i] === "--require-top100") {
      config.requireTop100 = true;
      changed = true;
    } else if (args[i] === "--no-require-top100") {
      config.requireTop100 = false;
      changed = true;
    }
  }

  if (changed) {
    saveConfig(config);
    console.log(JSON.stringify({ success: true, message: "Config updated", config }, null, 2));
  } else {
    console.log(JSON.stringify({ success: true, message: "Current config", config }, null, 2));
  }
}

function cmdCacheStatus(): void {
  const cache = loadCache();
  const now = Date.now();
  const entries = Object.entries(cache);
  const valid = entries.filter(([, v]) => now - v.fetchedAt < CACHE_TTL_MS);
  const expired = entries.length - valid.length;

  console.log(
    JSON.stringify(
      {
        totalEntries: entries.length,
        validEntries: valid.length,
        expiredEntries: expired,
        cachePath: CACHE_PATH,
        ttlMinutes: CACHE_TTL_MS / 60000,
        entries: valid.map(([key, v]) => ({
          pubkey: key,
          rank: v.data.rank,
          in_top_100: v.data.in_top_100,
          ageMinutes: Math.round((now - v.fetchedAt) / 60000),
        })),
      },
      null,
      2
    )
  );
}

// ---- Main ----

async function main(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(`MaximumSats Web of Trust

Usage: arc skills run --name maximumsats-wot -- <subcommand> [options]

Subcommands:
  check              Look up WoT trust score for a Nostr pubkey
  check-agent        Look up WoT for an agent by Stacks address (requires NIP-06 bridge)
  config             View or update threshold configuration
  cache-status       Show cache statistics

Options for check:
  --npub <npub>      Nostr npub (bech32)
  --pubkey <hex>     Nostr pubkey (64-char hex)

Options for check-agent:
  --stacks-address <addr>   Stacks address to resolve

Options for config:
  --min-rank <n>            Minimum acceptable rank (lower = more trusted)
  --require-top100          Require pubkey to be in top 100
  --no-require-top100       Remove top-100 requirement

API: POST https://maximumsats.com/api/wot-report (100 sats via L402)
Cache: ${CACHE_PATH} (1h TTL)
`);
    process.exit(0);
  }

  switch (subcommand) {
    case "check":
      await cmdCheck(args.slice(1));
      break;
    case "check-agent":
      await cmdCheckAgent(args.slice(1));
      break;
    case "config":
      cmdConfig(args.slice(1));
      break;
    case "cache-status":
      cmdCacheStatus();
      break;
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error(`Run 'arc skills run --name maximumsats-wot -- --help' for usage.`);
      process.exit(1);
  }
}

await main(Bun.argv.slice(2));
