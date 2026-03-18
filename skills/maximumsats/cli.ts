#!/usr/bin/env bun
/**
 * maximumsats CLI
 * Nostr Web of Trust scoring via MaximumSats API
 * https://maximumsats.com
 */

const API_BASE = "https://maximumsats.com/api";

function normalizePubkey(pubkey: string): string {
  if (pubkey.startsWith("npub")) {
    console.error(
      JSON.stringify({
        success: false,
        error: "npub bech32 format not supported — provide 64-char hex pubkey",
        hint: "Convert npub to hex with: npx nostr-tools or bech32 decode",
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

async function callWotReport(pubkey: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/wot-report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pubkey }),
  });

  if (res.status === 402) {
    const wwwAuth = res.headers.get("WWW-Authenticate") ?? "";
    console.error(
      JSON.stringify({
        success: false,
        error: "Payment required",
        sats: 100,
        protocol: "L402",
        invoice: wwwAuth,
      })
    );
    process.exit(1);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }

  return (await res.json()) as Record<string, unknown>;
}

async function cmdLookup(pubkey: string): Promise<void> {
  const hex = normalizePubkey(pubkey);
  const data = await callWotReport(hex);
  console.log(
    JSON.stringify({
      success: true,
      pubkey: data.pubkey,
      rank: data.rank,
      position: data.position,
      in_top_100: data.in_top_100,
      graph: data.graph,
    })
  );
}

async function cmdScore(pubkey: string): Promise<void> {
  const hex = normalizePubkey(pubkey);
  const data = await callWotReport(hex);

  // Normalize rank to 0-100: rank is a PageRank float, higher = better trust
  // Clamp at 100 to avoid outliers blowing the scale
  const rank = typeof data.rank === "number" ? data.rank : 0;
  const score = Math.min(100, Math.max(0, Math.round(rank)));

  console.log(
    JSON.stringify({
      success: true,
      pubkey: data.pubkey,
      score,
      rank: data.rank,
      position: data.position,
      in_top_100: data.in_top_100,
      graph: data.graph,
    })
  );
}

async function cmdReport(pubkey: string): Promise<void> {
  const hex = normalizePubkey(pubkey);
  // Full report endpoint — same URL, 100-sat L402 gate
  const data = await callWotReport(hex);
  console.log(
    JSON.stringify({
      success: true,
      pubkey: data.pubkey,
      report: data.report,
      rank: data.rank,
      position: data.position,
      in_top_100: data.in_top_100,
      graph: data.graph,
    })
  );
}

async function cmdVerifyNip05(address: string): Promise<void> {
  if (!address.includes("@")) {
    console.error(
      JSON.stringify({ success: false, error: "Invalid NIP-05 address — expected user@domain format" })
    );
    process.exit(1);
  }

  const res = await fetch(`${API_BASE}/nip05-verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });

  if (res.status === 402) {
    const wwwAuth = res.headers.get("WWW-Authenticate") ?? "";
    console.error(
      JSON.stringify({
        success: false,
        error: "Payment required",
        sats: 20,
        protocol: "L402",
        invoice: wwwAuth,
      })
    );
    process.exit(1);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  console.log(JSON.stringify({ success: true, ...data }));
}

function printUsage(): void {
  console.error(`Usage: bun skills/maximumsats/cli.ts <command> [options]

Commands:
  lookup --pubkey <hex64>         Free: rank + position from WoT graph
  score --pubkey <hex64>          Free: normalized 0-100 trust score
  report --pubkey <hex64>         Paid (100 sats, L402): full AI trust report
  verify-nip05 --address <u@d>    Paid (20 sats, L402): NIP-05 identity check

Pubkey format: 64-character hex (not npub)
`);
  process.exit(1);
}

// Minimal arg parser — named flags only
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

const args = process.argv.slice(2);
const command = args[0];

if (!command) printUsage();

const flags = parseFlags(args.slice(1));

try {
  switch (command) {
    case "lookup":
      if (!flags.pubkey) { console.error("--pubkey required"); process.exit(1); }
      await cmdLookup(flags.pubkey);
      break;

    case "score":
      if (!flags.pubkey) { console.error("--pubkey required"); process.exit(1); }
      await cmdScore(flags.pubkey);
      break;

    case "report":
      if (!flags.pubkey) { console.error("--pubkey required"); process.exit(1); }
      await cmdReport(flags.pubkey);
      break;

    case "verify-nip05":
      if (!flags.address) { console.error("--address required"); process.exit(1); }
      await cmdVerifyNip05(flags.address);
      break;

    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
  }
} catch (err) {
  console.error(JSON.stringify({ success: false, error: String(err) }));
  process.exit(1);
}
