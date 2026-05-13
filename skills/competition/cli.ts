#!/usr/bin/env bun
/**
 * Competition skill CLI — AIBTC trading competition interface.
 *
 * Usage:
 *   arc skills run --name competition -- status [--address <addr>]
 *   arc skills run --name competition -- submit --txid <txid>
 *   arc skills run --name competition -- list [--address <addr>] [--limit N] [--cursor <opaque>]
 */

const API_BASE =
  process.env.AIBTC_CAMPAIGN_API_URL ?? "https://aibtc.com/api/competition";
const ARC_STACKS_ADDRESS = "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B";
const TIMEOUT_MS = 10_000;

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

async function apiFetch(path: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!response.ok) {
    throw new Error(
      `Competition API error (${response.status}): ${
        typeof parsed === "string" ? parsed : JSON.stringify(parsed)
      }`
    );
  }
  return parsed;
}

function normalizeTxid(txid: string): string {
  const trimmed = txid.trim();
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) {
    throw new Error(
      `Invalid Stacks txid: expected 64 hex chars (with optional 0x prefix), got ${JSON.stringify(txid)}`
    );
  }
  return withPrefix.toLowerCase();
}

const [, , command, ...rest] = process.argv;
const flags = parseFlags(rest);

if (!command) {
  console.error("Usage: bun skills/competition/cli.ts <status|submit|list> [flags]");
  process.exit(1);
}

try {
  if (command === "status") {
    const address = flags.address ?? ARC_STACKS_ADDRESS;
    const result = await apiFetch(`/status?address=${encodeURIComponent(address)}`);
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "submit") {
    if (!flags.txid) {
      console.error("Error: --txid is required");
      process.exit(1);
    }
    const txid = normalizeTxid(flags.txid);
    const result = await apiFetch("/trades", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ txid }),
    });
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "list") {
    const address = flags.address ?? ARC_STACKS_ADDRESS;
    const params = new URLSearchParams({ address });
    if (flags.limit) params.set("limit", flags.limit);
    if (flags.cursor) params.set("cursor", flags.cursor);
    const result = await apiFetch(`/trades?${params.toString()}`);
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error(`Unknown command: ${command}. Use: status, submit, list`);
    process.exit(1);
  }
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
