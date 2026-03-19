#!/usr/bin/env bun
/**
 * maximumsats CLI
 * Nostr Web of Trust scoring via MaximumSats API
 * API base: https://wot.klabo.world
 *
 * Usage: arc skills run --name maximumsats -- <command> [options]
 */

const API_BASE = "https://wot.klabo.world";

// ---- Pubkey validation ----

function validatePubkey(pubkey: string): string {
  if (pubkey.startsWith("npub")) {
    console.error(
      JSON.stringify({
        success: false,
        error: "npub bech32 format not supported — provide 64-char hex pubkey",
        hint: "Convert npub to hex with a Nostr library (e.g. nip19.decode from nostr-tools)",
      })
    );
    process.exit(1);
  }
  if (!/^[0-9a-fA-F]{64}$/.test(pubkey)) {
    console.error(
      JSON.stringify({
        success: false,
        error: "Invalid pubkey — expected 64 hex characters",
        provided: pubkey.slice(0, 16) + "...",
      })
    );
    process.exit(1);
  }
  return pubkey.toLowerCase();
}

// ---- HTTP fetch with L402 awareness ----

async function get(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const response = await fetch(url.toString());

  if (response.status === 402) {
    const wwwAuth = response.headers.get("WWW-Authenticate") ?? "";
    const invoiceMatch = wwwAuth.match(/invoice="([^"]+)"/);
    console.error(
      JSON.stringify({
        success: false,
        error: "Free tier exhausted — payment required",
        sats: 21,
        protocol: "L402",
        invoice: invoiceMatch ? invoiceMatch[1] : wwwAuth,
        hint: "Set MAXIMUMSATS_NWC_URL credential to enable automatic payment",
      })
    );
    process.exit(1);
  }

  if (response.status === 404) {
    console.error(
      JSON.stringify({
        success: false,
        error: "Pubkey not found in WoT graph — pubkey may not be indexed yet (52K+ pubkeys covered)",
      })
    );
    process.exit(1);
  }

  if (response.status === 530) {
    console.error(
      JSON.stringify({
        success: false,
        error: "MaximumSats API temporarily unavailable (Cloudflare 530) — retry in 60s",
      })
    );
    process.exit(1);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text.slice(0, 200)}`);
  }

  return (await response.json()) as Record<string, unknown>;
}

// ---- Commands ----

async function cmdWotScore(pubkey: string): Promise<void> {
  const hex = validatePubkey(pubkey);
  const data = await get("/score", { pubkey: hex });
  console.log(
    JSON.stringify({
      success: true,
      pubkey: hex,
      normalized_score: data.normalized_score,
      rank: data.rank,
      percentile: data.percentile,
    }, null, 2)
  );
}

async function cmdSybilCheck(pubkey: string): Promise<void> {
  const hex = validatePubkey(pubkey);
  const data = await get("/sybil", { pubkey: hex });
  const classification = data.classification as string;
  console.log(
    JSON.stringify({
      success: true,
      pubkey: hex,
      classification,
      is_sybil: classification === "likely_sybil",
      is_suspicious: classification === "suspicious" || classification === "likely_sybil",
    }, null, 2)
  );
}

async function cmdTrustPath(source: string, target: string): Promise<void> {
  const srcHex = validatePubkey(source);
  const tgtHex = validatePubkey(target);
  const data = await get("/trust-path", { source: srcHex, target: tgtHex });
  console.log(
    JSON.stringify({
      success: true,
      source: srcHex,
      target: tgtHex,
      connected: data.connected,
      combined_trust: data.combined_trust,
      paths: data.paths,
    }, null, 2)
  );
}

async function cmdPredict(source: string, target: string): Promise<void> {
  const srcHex = validatePubkey(source);
  const tgtHex = validatePubkey(target);
  const data = await get("/predict", { source: srcHex, target: tgtHex });
  console.log(
    JSON.stringify({
      success: true,
      source: srcHex,
      target: tgtHex,
      probability: data.probability,
      signals: data.signals,
    }, null, 2)
  );
}

async function cmdNetworkHealth(): Promise<void> {
  const data = await get("/network-health", {});
  console.log(
    JSON.stringify({
      success: true,
      graph_nodes: data.graph_nodes,
      graph_edges: data.graph_edges,
      gini_coefficient: data.gini_coefficient,
      power_law_alpha: data.power_law_alpha,
    }, null, 2)
  );
}

// ---- Arg parser ----

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length && !args[i + 1].startsWith("--")) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return flags;
}

function printUsage(): void {
  console.error(`Usage: arc skills run --name maximumsats -- <command> [options]

Commands:
  wot-score   --pubkey <hex64>                 WoT trust score (0-100), rank, percentile
  sybil-check --pubkey <hex64>                 Sybil classification (normal/suspicious/likely_sybil)
  trust-path  --source <hex64> --target <hex64>  Hop-by-hop trust path between two pubkeys
  predict     --source <hex64> --target <hex64>  Link prediction probability and graph signals
  network-health                               Graph-wide stats (nodes, edges, Gini, power law)

Pubkey format: 64-character hex (not npub bech32)
API: https://wot.klabo.world  |  Free tier: 50 req/day per IP
`);
  process.exit(1);
}

// ---- Main ----

const args = Bun.argv.slice(2);
const command = args[0];

if (!command || command === "--help" || command === "-h") printUsage();

const flags = parseFlags(args.slice(1));

try {
  switch (command) {
    case "wot-score":
      if (!flags.pubkey) { console.error("--pubkey required"); process.exit(1); }
      await cmdWotScore(flags.pubkey);
      break;

    case "sybil-check":
      if (!flags.pubkey) { console.error("--pubkey required"); process.exit(1); }
      await cmdSybilCheck(flags.pubkey);
      break;

    case "trust-path":
      if (!flags.source || !flags.target) { console.error("--source and --target required"); process.exit(1); }
      await cmdTrustPath(flags.source, flags.target);
      break;

    case "predict":
      if (!flags.source || !flags.target) { console.error("--source and --target required"); process.exit(1); }
      await cmdPredict(flags.source, flags.target);
      break;

    case "network-health":
      await cmdNetworkHealth();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
  }
} catch (error) {
  console.error(JSON.stringify({ success: false, error: String(error) }));
  process.exit(1);
}
