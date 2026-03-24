#!/usr/bin/env bun
// skills/leaderboard-admin/cli.ts
// Publisher-only leaderboard management for aibtc.news

import { ARC_BTC_ADDRESS } from "../../src/identity.ts";

const API_BASE = "https://aibtc.news/api";

// ---- Helpers ----

function log(message: string): void {
  console.error(
    `[${new Date().toISOString()}] [leaderboard-admin/cli] ${message}`
  );
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

async function signMessage(message: string): Promise<string> {
  const proc = Bun.spawn(
    [
      "bash",
      "bin/arc",
      "skills",
      "run",
      "--name",
      "bitcoin-wallet",
      "--",
      "btc-sign",
      "--message",
      message,
    ],
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

  const combined = (stdout + stderr).trim();
  const jsonStart = combined.indexOf("{");
  if (jsonStart === -1) {
    throw new Error(`No JSON output from wallet signing. Output: ${combined}`);
  }

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

  throw new Error(
    `No valid signature field in wallet response. Output: ${combined}`
  );
}

async function buildAuthHeaders(
  method: string,
  path: string
): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${method} /api${path}:${timestamp}`;
  log(`Signing: ${message}`);
  const sig = await signMessage(message);
  return {
    "X-BTC-Address": ARC_BTC_ADDRESS,
    "X-BTC-Signature": sig,
    "X-BTC-Timestamp": String(timestamp),
    "Content-Type": "application/json",
  };
}

async function callApi(
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  authHeaders?: Record<string, string>
): Promise<Record<string, unknown>> {
  const url = `${API_BASE}${endpoint}`;
  const options: RequestInit = {
    method,
    headers: authHeaders ?? {
      "Content-Type": "application/json",
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  log(`${method} ${url}`);
  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${JSON.stringify(data)}`);
  }

  return data as Record<string, unknown>;
}

// ---- Commands ----

async function resetLeaderboard(): Promise<void> {
  log("Resetting leaderboard (snapshot + clear scoring tables)...");
  const headers = await buildAuthHeaders("POST", "/leaderboard/reset");
  const result = await callApi(
    "POST",
    "/leaderboard/reset",
    { btc_address: ARC_BTC_ADDRESS },
    headers
  );
  console.log(JSON.stringify(result, null, 2));
  log("Leaderboard reset complete.");
}

async function recordPayout(flags: Record<string, string>): Promise<void> {
  const first = flags["first"];
  const second = flags["second"];
  const third = flags["third"];
  const amount = flags["amount"];

  if (!first || !second || !third || !amount) {
    console.error(
      "Usage: payout --first <addr> --second <addr> --third <addr> --amount <sats>"
    );
    process.exit(1);
  }

  log(`Recording payout: 1st=${first}, 2nd=${second}, 3rd=${third}, amount=${amount}`);
  const headers = await buildAuthHeaders("POST", "/leaderboard/payout");
  const result = await callApi(
    "POST",
    "/leaderboard/payout",
    {
      btc_address: ARC_BTC_ADDRESS,
      winners: [
        { address: first, place: 1 },
        { address: second, place: 2 },
        { address: third, place: 3 },
      ],
      amount: parseInt(amount, 10),
    },
    headers
  );
  console.log(JSON.stringify(result, null, 2));
  log("Payout recorded.");
}

async function viewBreakdown(flags: Record<string, string>): Promise<void> {
  const limit = flags["limit"] ?? "20";
  const headers = await buildAuthHeaders("GET", "/leaderboard/breakdown");
  const result = await callApi(
    "GET",
    `/leaderboard/breakdown?btc_address=${ARC_BTC_ADDRESS}&limit=${limit}`,
    undefined,
    headers
  );
  console.log(JSON.stringify(result, null, 2));
}

async function listSnapshots(flags: Record<string, string>): Promise<void> {
  const limit = flags["limit"] ?? "10";
  const headers = await buildAuthHeaders("GET", "/leaderboard/snapshots");
  const result = await callApi(
    "GET",
    `/leaderboard/snapshots?btc_address=${ARC_BTC_ADDRESS}&limit=${limit}`,
    undefined,
    headers
  );
  console.log(JSON.stringify(result, null, 2));
}

async function getSnapshot(flags: Record<string, string>): Promise<void> {
  const id = flags["id"];
  if (!id) {
    console.error("Usage: snapshot --id <snapshot-id>");
    process.exit(1);
  }

  const headers = await buildAuthHeaders(
    "GET",
    `/leaderboard/snapshots/${id}`
  );
  const result = await callApi(
    "GET",
    `/leaderboard/snapshots/${id}?btc_address=${ARC_BTC_ADDRESS}`,
    undefined,
    headers
  );
  console.log(JSON.stringify(result, null, 2));
}

async function viewLeaderboard(flags: Record<string, string>): Promise<void> {
  const limit = flags["limit"] ?? "20";
  const result = await callApi("GET", `/leaderboard?limit=${limit}`);
  console.log(JSON.stringify(result, null, 2));
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const flags = parseFlags(args.slice(1));

  if (!command) {
    console.error(`Usage: leaderboard-admin <command>
Commands:
  reset                    Snapshot + clear all scoring tables
  payout                   Record weekly top-3 prize earnings
  breakdown [--limit N]    Full score component breakdown
  snapshots [--limit N]    List stored snapshots
  snapshot --id <id>       Retrieve a specific snapshot
  view [--limit N]         Public ranked leaderboard`);
    process.exit(1);
  }

  switch (command) {
    case "reset":
      await resetLeaderboard();
      break;
    case "payout":
      await recordPayout(flags);
      break;
    case "breakdown":
      await viewBreakdown(flags);
      break;
    case "snapshots":
      await listSnapshots(flags);
      break;
    case "snapshot":
      await getSnapshot(flags);
      break;
    case "view":
      await viewLeaderboard(flags);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
