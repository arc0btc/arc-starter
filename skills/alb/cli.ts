#!/usr/bin/env bun
// skills/alb/cli.ts
// CLI for ALB (agentslovebitcoin.com) — BTC signature auth.
// Manages trustless_indra identity via genesis-authenticated API endpoints.
//
// Usage: arc skills run --name alb -- <subcommand> [flags]

import { getCredential } from "../../src/credentials.ts";
import { resolve } from "path";

const BTC_ADDRESS = "bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933";
const STX_ADDRESS = "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B";
const DEFAULT_API_BASE = "https://agentslovebitcoin.com";
const SIGN_RUNNER = resolve(import.meta.dir, "../bitcoin-wallet/sign-runner.ts");
const ROOT = resolve(import.meta.dir, "../..");

function log(message: string): void {
  console.error(`[${new Date().toISOString()}] [alb/cli] ${message}`);
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

async function getApiBase(): Promise<string> {
  const base = await getCredential("agents-love-bitcoin", "api_base_url");
  return (base ?? DEFAULT_API_BASE).replace(/\/$/, "");
}

// ---- Wallet signing helpers ----

async function getWalletCredentials(): Promise<{ password: string; id: string }> {
  const password = await getCredential("wallet", "password");
  const id = await getCredential("wallet", "id");
  if (!password || !id) throw new Error("Missing wallet credentials (wallet/password or wallet/id)");
  return { password, id };
}

async function runSigning(signingArgs: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { password, id } = await getWalletCredentials();
  const proc = Bun.spawn(["bun", "run", SIGN_RUNNER, ...signingArgs], {
    cwd: ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      WALLET_ID: id,
      WALLET_PASSWORD: password,
    },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

async function btcSign(message: string): Promise<string> {
  const result = await runSigning(["btc-sign", "--message", message]);
  if (result.exitCode !== 0) throw new Error(`BTC sign failed: ${result.stderr || result.stdout}`);
  const parsed = JSON.parse(result.stdout) as { success: boolean; signatureBase64?: string; error?: string };
  if (!parsed.success || !parsed.signatureBase64) throw new Error(`BTC sign failed: ${parsed.error}`);
  return parsed.signatureBase64;
}

async function sip018Sign(message: Record<string, unknown>): Promise<string> {
  const domain = JSON.stringify({ name: "agentslovebitcoin.com", version: "1", chainId: 1 });
  const result = await runSigning([
    "sip018-sign",
    "--message", JSON.stringify(message),
    "--domain", domain,
  ]);
  if (result.exitCode !== 0) throw new Error(`SIP-018 sign failed: ${result.stderr || result.stdout}`);
  const parsed = JSON.parse(result.stdout) as { success: boolean; signature?: string; error?: string };
  if (!parsed.success || !parsed.signature) throw new Error(`SIP-018 sign failed: ${parsed.error}`);
  return parsed.signature;
}

/** Build BTC auth headers for standard API requests (GET/POST to /api/me/*) */
async function getBtcAuthHeaders(method: string, path: string): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  // Server verifies against pathname only (no query params) — strip query string
  const pathname = path.split("?")[0];
  const message = `${method} ${pathname}:${timestamp}`;
  log(`Signing: ${message}`);
  const signature = await btcSign(message);
  return {
    "X-BTC-Address": BTC_ADDRESS,
    "X-BTC-Signature": signature,
    "X-BTC-Timestamp": timestamp,
    "Content-Type": "application/json",
  };
}

/** Authenticated GET request */
async function authGet(path: string): Promise<unknown> {
  const base = await getApiBase();
  const headers = await getBtcAuthHeaders("GET", path);
  const url = `${base}${path}`;
  const resp = await fetch(url, { headers });
  const text = await resp.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!resp.ok) throw new Error(`ALB API ${resp.status}: ${text}`);
  return data;
}

/** Authenticated POST request */
async function authPost(path: string): Promise<unknown> {
  const base = await getApiBase();
  const headers = await getBtcAuthHeaders("POST", path);
  const url = `${base}${path}`;
  const resp = await fetch(url, { method: "POST", headers });
  const text = await resp.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!resp.ok) throw new Error(`ALB API ${resp.status}: ${text}`);
  return data;
}

// ---- Commands ----

async function cmdRegister(): Promise<void> {
  const base = await getApiBase();
  const timestamp = Math.floor(Date.now() / 1000).toString();

  log("Signing BTC registration message...");
  const btcMessage = `REGISTER ${BTC_ADDRESS}:${STX_ADDRESS}:${timestamp}`;
  const btcSignature = await btcSign(btcMessage);

  log("Signing SIP-018 structured data...");
  const sip018Message = {
    action: { type: "ascii", value: "register" },
    "btc-address": { type: "ascii", value: BTC_ADDRESS },
    "stx-address": { type: "ascii", value: STX_ADDRESS },
    timestamp: { type: "uint", value: parseInt(timestamp, 10) },
  };
  const stxSignature = await sip018Sign(sip018Message);

  log("Sending registration request...");
  const resp = await fetch(`${base}/api/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BTC-Address": BTC_ADDRESS,
      "X-BTC-Signature": btcSignature,
      "X-BTC-Timestamp": timestamp,
      "X-STX-Address": STX_ADDRESS,
      "X-STX-Signature": stxSignature,
    },
  });

  const text = await resp.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!resp.ok) {
    log(`Registration failed: ${resp.status}`);
    console.log(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  log(`Registration succeeded: ${resp.status}`);
  console.log(JSON.stringify(data, null, 2));
}

async function cmdProfile(): Promise<void> {
  const data = await authGet("/api/me/profile");
  console.log(JSON.stringify(data, null, 2));
}

async function cmdEmail(): Promise<void> {
  const data = await authGet("/api/me/email");
  console.log(JSON.stringify(data, null, 2));
}

async function cmdInbox(flags: Record<string, string>): Promise<void> {
  const limit = flags["limit"] ?? "20";
  const unread = flags["unread"] === "true" ? "&unread=true" : "";
  const data = await authGet(`/api/me/email/inbox?limit=${limit}${unread}`);
  console.log(JSON.stringify(data, null, 2));
}

async function cmdRead(flags: Record<string, string>): Promise<void> {
  const id = flags["id"];
  if (!id) throw new Error("--id required");
  const data = await authGet(`/api/me/email/inbox/${encodeURIComponent(id)}`);
  console.log(JSON.stringify(data, null, 2));
}

async function cmdUsage(): Promise<void> {
  const data = await authGet("/api/me/usage");
  console.log(JSON.stringify(data, null, 2));
}

async function cmdHealth(): Promise<void> {
  const base = await getApiBase();
  const resp = await fetch(`${base}/api/health`);
  const data = await resp.json();
  console.log(JSON.stringify(data, null, 2));
}

// ---- Entry point ----

const [, , ...args] = process.argv;
const [subcommand, ...rest] = args;
const flags = parseFlags(rest);

try {
  switch (subcommand) {
    case "register":    await cmdRegister(); break;
    case "profile":     await cmdProfile(); break;
    case "email":       await cmdEmail(); break;
    case "inbox":       await cmdInbox(flags); break;
    case "read":        await cmdRead(flags); break;
    case "usage":       await cmdUsage(); break;
    case "health":      await cmdHealth(); break;
    default:
      console.error("Usage: arc skills run --name alb -- <command> [flags]");
      console.error("");
      console.error("Commands:");
      console.error("  register              Register Arc on ALB (dual BTC+STX signature)");
      console.error("  profile               View Arc's agent profile");
      console.error("  email                 View provisioned email details");
      console.error("  inbox [--limit N] [--unread]  List inbox messages");
      console.error("  read --id <id>        Read a specific message (marks as read)");
      console.error("  usage                 View API usage / metering");
      console.error("  health                Check ALB API health");
      process.exit(1);
  }
} catch (e) {
  log(`Error: ${e}`);
  process.exit(1);
}
