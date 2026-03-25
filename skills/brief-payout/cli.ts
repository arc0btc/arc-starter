#!/usr/bin/env bun
// skills/brief-payout/cli.ts
// CLI for correspondent payout management: calculate, execute, status.
// Usage: arc skills run --name brief-payout -- <command> [flags]

import { ARC_BTC_ADDRESS } from "../../src/identity.ts";
import { getCredential } from "../../src/credentials.ts";
import { resolve, join } from "node:path";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const API_BASE = "https://aibtc.news/api";
const PAYOUTS_DIR = resolve(import.meta.dir, "../../db/payouts");
const SBTC_SEND_RUNNER = resolve(import.meta.dir, "sbtc-send-runner.ts");
const ROOT = resolve(import.meta.dir, "../../github/aibtcdev/skills");

// Ensure payouts directory exists
mkdirSync(PAYOUTS_DIR, { recursive: true });

// ---- Types ----

interface EarningRecord {
  id: number;
  btcAddress: string;
  amount_sats: number;
  status: string;
  signal_id?: number;
  date?: string;
}

interface PayoutTransfer {
  earning_ids: number[];
  btc_address: string;
  stx_address: string;
  amount_sats: number;
  txid: string | null;
  status: "pending" | "sent" | "failed";
  error?: string;
  sent_at?: string;
}

interface PayoutRecord {
  date: string;
  status: "pending" | "partial" | "complete" | "failed";
  created_at: string;
  updated_at: string;
  total_sats: number;
  balance_sats: number;
  transfers: PayoutTransfer[];
}

interface PayoutPlan {
  date: string;
  payouts: Array<{
    btcAddress: string;
    stxAddress: string;
    amountSats: number;
    earningIds: number[];
  }>;
  totalSats: number;
  balanceSats: number;
  canPay: boolean;
  unresolvedAddresses: string[];
}

// ---- Helpers ----

function log(message: string): void {
  console.error(`[${new Date().toISOString()}] [brief-payout/cli] ${message}`);
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

function todayPST(): string {
  const now = new Date();
  const pst = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  return pst.toISOString().split("T")[0];
}

function payoutFilePath(date: string): string {
  return join(PAYOUTS_DIR, `${date}.json`);
}

function readPayoutRecord(date: string): PayoutRecord | null {
  const path = payoutFilePath(date);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as PayoutRecord;
  } catch {
    return null;
  }
}

function writePayoutRecord(record: PayoutRecord): void {
  record.updated_at = new Date().toISOString();
  writeFileSync(payoutFilePath(record.date), JSON.stringify(record, null, 2));
}

async function signMessage(message: string): Promise<string> {
  const proc = Bun.spawn(
    ["bash", "bin/arc", "skills", "run", "--name", "bitcoin-wallet", "--", "btc-sign", "--message", message],
    { cwd: resolve(import.meta.dir, "../.."), stdin: "ignore", stdout: "pipe", stderr: "pipe" }
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
      if (result.signatureBase64) return result.signatureBase64;
      if (result.signature) return result.signature;
    } catch {
      // Try shorter substring
    }
  }

  throw new Error(`No valid signature field in wallet response. Output: ${combined}`);
}

async function buildAuthHeaders(method: string, path: string): Promise<Record<string, string>> {
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

async function apiGet(endpoint: string): Promise<unknown> {
  const url = `${API_BASE}${endpoint}`;
  log(`GET ${url}`);
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function apiPost(endpoint: string, body: Record<string, unknown>): Promise<unknown> {
  const headers = await buildAuthHeaders("POST", endpoint);
  const url = `${API_BASE}${endpoint}`;
  log(`POST ${url}`);
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

// ---- Address Resolution ----

/**
 * Resolve BTC addresses to STX addresses using the correspondents API.
 * Returns a map of btcAddress → stxAddress.
 */
async function resolveAddresses(btcAddresses: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (btcAddresses.length === 0) return map;

  try {
    const data = await apiGet("/correspondents") as {
      correspondents?: Array<{
        address?: string;
        stxAddress?: string;
        stx_address?: string;
      }>;
    };

    const correspondents = data.correspondents ?? (Array.isArray(data) ? data as Array<Record<string, unknown>> : []);

    for (const c of correspondents) {
      const btcAddr = (c.address ?? "") as string;
      const stxAddr = (c.stxAddress ?? c.stx_address ?? "") as string;
      if (btcAddr && stxAddr && btcAddresses.includes(btcAddr)) {
        map.set(btcAddr, stxAddr);
      }
    }
  } catch (err) {
    log(`Correspondents API error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Fallback: try contact-registry for unresolved addresses
  for (const btcAddr of btcAddresses) {
    if (map.has(btcAddr)) continue;
    try {
      const proc = Bun.spawn(
        ["bash", "bin/arc", "skills", "run", "--name", "contact-registry", "--", "search", "--term", btcAddr],
        { cwd: resolve(import.meta.dir, "../.."), stdin: "ignore", stdout: "pipe", stderr: "pipe" }
      );
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      // Parse STX address from search output (format: "    STX: SP...")
      const stxMatch = stdout.match(/STX:\s*(S[PT][A-Z0-9]+)/);
      if (stxMatch) {
        map.set(btcAddr, stxMatch[1]);
      }
    } catch {
      // Skip — will be reported as unresolved
    }
  }

  return map;
}

/**
 * Get sBTC balance in sats from wallet info.
 */
async function getSbtcBalance(): Promise<number> {
  try {
    const proc = Bun.spawn(
      ["bash", "bin/arc", "skills", "run", "--name", "bitcoin-wallet", "--", "info"],
      { cwd: resolve(import.meta.dir, "../.."), stdin: "ignore", stdout: "pipe", stderr: "pipe" }
    );

    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const parsed = JSON.parse(stdout.trim());
    // Try common field names for sBTC balance
    const sbtcSats = parsed.sbtcBalanceSats ?? parsed.sbtc_balance_sats ?? parsed.sbtcBalance ?? "0";
    return parseInt(String(sbtcSats), 10) || 0;
  } catch (err) {
    log(`Failed to get sBTC balance: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}

async function getWalletCreds(): Promise<{ walletId: string; walletPassword: string }> {
  const walletId = await getCredential("bitcoin-wallet", "id");
  const walletPassword = await getCredential("bitcoin-wallet", "password");
  if (!walletId || !walletPassword) {
    throw new Error("Wallet credentials not found in credential store (bitcoin-wallet/id, bitcoin-wallet/password)");
  }
  return { walletId, walletPassword };
}

// ---- Nonce Management ----

/**
 * Fetch the current nonce from the Hiro API as the seed for local tracking.
 * Uses possible_next_nonce which accounts for mempool pending txs.
 * Only called once at the start of a payout batch — all subsequent nonces
 * are incremented locally to avoid load-balanced API inconsistency.
 */
async function fetchSeedNonce(stxAddress: string): Promise<bigint> {
  const url = `https://api.hiro.so/extended/v1/address/${stxAddress}/nonces`;
  log(`Fetching seed nonce from ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch nonce: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    possible_next_nonce: number;
    last_executed_tx_nonce: number | null;
    last_mempool_tx_nonce: number | null;
    detected_missing_nonces: number[];
    detected_mempool_nonces: number[];
  };

  const nextNonce = BigInt(data.possible_next_nonce);
  log(`Seed nonce: ${nextNonce} (last executed: ${data.last_executed_tx_nonce}, mempool pending: ${data.detected_mempool_nonces?.length ?? 0})`);

  if (data.detected_missing_nonces.length > 0) {
    log(`Warning: ${data.detected_missing_nonces.length} missing nonce gap(s) detected: [${data.detected_missing_nonces.join(", ")}]`);
  }

  return nextNonce;
}

/**
 * Check if a broadcast error is nonce-related and we should re-seed.
 */
function isNonceError(errorMsg: string): boolean {
  const noncePhrases = [
    "ConflictingNonceInMempool",
    "nonce",
    "ExpectedNonce",
    "BadNonce",
    "TooMuchChaining",
  ];
  return noncePhrases.some((phrase) => errorMsg.toLowerCase().includes(phrase.toLowerCase()));
}

// ---- Commands ----

async function cmdCalculate(args: string[]): Promise<PayoutPlan> {
  const flags = parseFlags(args);
  const date = flags.date || todayPST();

  log(`Calculating payouts for ${date}`);

  // 1. Fetch pending earnings
  const earningsData = await apiGet(`/earnings/${encodeURIComponent(ARC_BTC_ADDRESS)}?status=pending&from=${date}&to=${date}`) as {
    earnings?: EarningRecord[];
  };

  const earnings = earningsData.earnings ?? (Array.isArray(earningsData) ? earningsData as EarningRecord[] : []);

  if (earnings.length === 0) {
    const plan: PayoutPlan = {
      date,
      payouts: [],
      totalSats: 0,
      balanceSats: 0,
      canPay: true,
      unresolvedAddresses: [],
    };
    console.log(JSON.stringify(plan, null, 2));
    return plan;
  }

  // 2. Aggregate by agent BTC address
  const byAgent = new Map<string, { amountSats: number; earningIds: number[] }>();
  for (const e of earnings) {
    const addr = e.btcAddress;
    if (!addr) continue;
    const entry = byAgent.get(addr) ?? { amountSats: 0, earningIds: [] };
    entry.amountSats += e.amount_sats;
    entry.earningIds.push(e.id);
    byAgent.set(addr, entry);
  }

  // 3. Resolve BTC → STX addresses
  const btcAddresses = [...byAgent.keys()];
  const addressMap = await resolveAddresses(btcAddresses);

  // 4. Get sBTC balance
  const balanceSats = await getSbtcBalance();

  // 5. Build payout plan
  const payouts: PayoutPlan["payouts"] = [];
  const unresolvedAddresses: string[] = [];

  for (const [btcAddr, entry] of byAgent) {
    const stxAddr = addressMap.get(btcAddr);
    if (!stxAddr) {
      unresolvedAddresses.push(btcAddr);
      continue;
    }
    payouts.push({
      btcAddress: btcAddr,
      stxAddress: stxAddr,
      amountSats: entry.amountSats,
      earningIds: entry.earningIds,
    });
  }

  const totalSats = payouts.reduce((sum, p) => sum + p.amountSats, 0);
  const canPay = balanceSats >= totalSats && unresolvedAddresses.length === 0;

  const plan: PayoutPlan = { date, payouts, totalSats, balanceSats, canPay, unresolvedAddresses };
  console.log(JSON.stringify(plan, null, 2));
  return plan;
}

async function cmdExecute(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const date = flags.date || todayPST();

  log(`Executing payouts for ${date}`);

  // Check for existing partial state (resume support)
  let record = readPayoutRecord(date);

  if (record?.status === "complete") {
    log("Payouts already complete for this date");
    console.log(JSON.stringify(record, null, 2));
    return;
  }

  // Calculate plan (suppresses stdout by capturing it)
  const originalLog = console.log;
  let planOutput = "";
  console.log = (msg: string) => { planOutput = msg; };
  const plan = await cmdCalculate(["--date", date]);
  console.log = originalLog;

  if (plan.payouts.length === 0) {
    log("No payouts to execute");
    console.log(JSON.stringify({ date, status: "complete", message: "No pending earnings" }));
    return;
  }

  if (plan.unresolvedAddresses.length > 0) {
    log(`Cannot execute: ${plan.unresolvedAddresses.length} unresolved address(es)`);
    console.log(JSON.stringify({
      error: "Unresolved addresses",
      unresolvedAddresses: plan.unresolvedAddresses,
      hint: "Add these agents to the contact-registry with their STX addresses, or check correspondents API",
    }));
    process.exit(1);
  }

  if (!plan.canPay) {
    log(`Insufficient sBTC balance: have ${plan.balanceSats}, need ${plan.totalSats}`);
    console.log(JSON.stringify({
      error: "Insufficient sBTC balance",
      balanceSats: plan.balanceSats,
      requiredSats: plan.totalSats,
      shortfallSats: plan.totalSats - plan.balanceSats,
    }));
    process.exit(1);
  }

  // Get wallet credentials
  const { walletId, walletPassword } = await getWalletCreds();

  // Initialize or resume payout record
  if (!record) {
    record = {
      date,
      status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      total_sats: plan.totalSats,
      balance_sats: plan.balanceSats,
      transfers: plan.payouts.map((p) => ({
        earning_ids: p.earningIds,
        btc_address: p.btcAddress,
        stx_address: p.stxAddress,
        amount_sats: p.amountSats,
        txid: null,
        status: "pending" as const,
      })),
    };
    writePayoutRecord(record);
  }

  // ---- Local Nonce Management ----
  // Seed nonce from the network once, then track locally.
  // The Hiro API is load-balanced across nodes with different mempool views,
  // so querying per-tx gives inconsistent nonces. Local tracking overcomes this.
  // Only re-seed if a broadcast fails with a nonce-related error.

  // Resolve our STX address for nonce lookup
  const senderStxAddress = "SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM";
  let currentNonce: bigint;

  try {
    currentNonce = await fetchSeedNonce(senderStxAddress);
  } catch (err) {
    log(`Failed to seed nonce: ${err instanceof Error ? err.message : String(err)}`);
    console.log(JSON.stringify({ error: "Failed to fetch initial nonce", detail: err instanceof Error ? err.message : String(err) }));
    process.exit(1);
  }

  // Account for already-sent transfers in this batch (resume scenario).
  // If we're resuming, the nonce from the network should already reflect
  // previously broadcast txs, but we skip those transfers anyway.
  const pendingTransfers = record.transfers.filter((t) => t.status !== "sent");
  log(`Nonce strategy: seed=${currentNonce}, pending transfers=${pendingTransfers.length}, already sent=${record.transfers.length - pendingTransfers.length}`);

  // Execute transfers sequentially with local nonce tracking
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < record.transfers.length; i++) {
    const transfer = record.transfers[i];

    // Skip already-sent transfers (resume support)
    if (transfer.status === "sent") {
      log(`Skipping already-sent transfer to ${transfer.stx_address} (txid: ${transfer.txid})`);
      successCount++;
      continue;
    }

    log(`Sending ${transfer.amount_sats} sats sBTC to ${transfer.stx_address} (${i + 1}/${record.transfers.length}, nonce=${currentNonce})`);

    try {
      const result = await sendSbtc(
        walletId,
        walletPassword,
        transfer.stx_address,
        transfer.amount_sats,
        `aibtc.news payout ${date}`,
        currentNonce,
      );

      if (result.success && result.txid) {
        transfer.status = "sent";
        transfer.txid = result.txid;
        transfer.sent_at = new Date().toISOString();
        successCount++;
        currentNonce++; // Increment locally — don't re-query the network
        log(`Transfer sent: ${result.txid} (next nonce=${currentNonce})`);

        // Record payout on the API immediately
        try {
          await apiPost("/payouts/record", {
            btc_address: ARC_BTC_ADDRESS,
            earning_ids: transfer.earning_ids,
            txid: result.txid,
            amount_sats: transfer.amount_sats,
          });
          log(`Payout recorded on API for earning IDs: ${transfer.earning_ids.join(",")}`);
        } catch (recordErr) {
          log(`Warning: API record-payout failed (transfer succeeded): ${recordErr instanceof Error ? recordErr.message : String(recordErr)}`);
          // Transfer is on-chain — don't fail the whole batch over API recording
        }
      } else {
        const errorMsg = result.error ?? result.detail ?? "Unknown error";

        // If nonce-related error, re-seed from network and retry once
        if (isNonceError(errorMsg)) {
          log(`Nonce error detected: ${errorMsg} — re-seeding from network`);
          try {
            currentNonce = await fetchSeedNonce(senderStxAddress);
            log(`Re-seeded nonce: ${currentNonce} — retrying transfer`);

            const retry = await sendSbtc(
              walletId,
              walletPassword,
              transfer.stx_address,
              transfer.amount_sats,
              `aibtc.news payout ${date}`,
              currentNonce,
            );

            if (retry.success && retry.txid) {
              transfer.status = "sent";
              transfer.txid = retry.txid;
              transfer.sent_at = new Date().toISOString();
              successCount++;
              currentNonce++;
              log(`Retry succeeded: ${retry.txid} (next nonce=${currentNonce})`);

              try {
                await apiPost("/payouts/record", {
                  btc_address: ARC_BTC_ADDRESS,
                  earning_ids: transfer.earning_ids,
                  txid: retry.txid,
                  amount_sats: transfer.amount_sats,
                });
              } catch {
                // Best-effort API recording
              }
            } else {
              transfer.status = "failed";
              transfer.error = `Retry failed: ${retry.error ?? retry.detail ?? "Unknown"}`;
              failCount++;
              log(`Retry also failed: ${transfer.error}`);
            }
          } catch (reseedErr) {
            transfer.status = "failed";
            transfer.error = `Nonce re-seed failed: ${reseedErr instanceof Error ? reseedErr.message : String(reseedErr)}`;
            failCount++;
            log(`Nonce re-seed failed: ${transfer.error}`);
          }
        } else {
          transfer.status = "failed";
          transfer.error = errorMsg;
          failCount++;
          log(`Transfer failed: ${transfer.error}`);
        }
      }
    } catch (err) {
      transfer.status = "failed";
      transfer.error = err instanceof Error ? err.message : String(err);
      failCount++;
      log(`Transfer error: ${transfer.error}`);
    }

    // Persist after each transfer
    record.status = "partial";
    writePayoutRecord(record);
  }

  // Final status
  if (failCount === 0) {
    record.status = "complete";
  } else if (successCount === 0) {
    record.status = "failed";
  } else {
    record.status = "partial";
  }
  writePayoutRecord(record);

  console.log(JSON.stringify({
    date,
    status: record.status,
    totalTransfers: record.transfers.length,
    sent: successCount,
    failed: failCount,
    totalSats: record.total_sats,
    transfers: record.transfers.map((t) => ({
      btcAddress: t.btc_address,
      stxAddress: t.stx_address,
      amountSats: t.amount_sats,
      txid: t.txid,
      status: t.status,
    })),
  }, null, 2));
}

async function sendSbtc(
  walletId: string,
  walletPassword: string,
  recipient: string,
  amountSats: number,
  memo: string,
  nonce?: bigint,
): Promise<{ success: boolean; txid?: string; nonce?: number; error?: string; detail?: string }> {
  const runnerArgs = ["--recipient", recipient, "--amount-sats", String(amountSats), "--memo", memo];
  if (nonce !== undefined) {
    runnerArgs.push("--nonce", String(nonce));
  }

  const proc = Bun.spawn(
    ["bun", "run", SBTC_SEND_RUNNER, ...runnerArgs],
    {
      cwd: resolve(import.meta.dir, "../.."),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        WALLET_ID: walletId,
        WALLET_PASSWORD: walletPassword,
        NETWORK: "mainnet",
      },
    }
  );

  let stdout = "";
  let stderr = "";

  const stderrPromise = new Response(proc.stderr).text().then((t) => { stderr = t; });

  // Read stdout with timeout (wallet auto-lock timer may keep process alive)
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();

  const readWithTimeout = new Promise<string>(async (resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("Timeout waiting for sbtc-send response (90s)"));
    }, 90000);

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        stdout += decoder.decode(value, { stream: true });

        const trimmed = stdout.trim();
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
          try {
            JSON.parse(trimmed);
            clearTimeout(timer);
            proc.kill();
            resolve(trimmed);
            return;
          } catch {
            // Incomplete JSON, keep reading
          }
        }
      }
      clearTimeout(timer);
      resolve(stdout.trim());
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });

  const result = await readWithTimeout;
  await stderrPromise.catch(() => {});

  try {
    return JSON.parse(result) as { success: boolean; txid?: string; error?: string; detail?: string };
  } catch {
    return { success: false, error: "Failed to parse runner output", detail: result };
  }
}

function cmdStatus(args: string[]): void {
  const flags = parseFlags(args);
  const date = flags.date || todayPST();

  const record = readPayoutRecord(date);
  if (!record) {
    console.log(JSON.stringify({ date, status: "none", message: "No payout record for this date" }));
    return;
  }

  const sent = record.transfers.filter((t) => t.status === "sent").length;
  const failed = record.transfers.filter((t) => t.status === "failed").length;
  const pending = record.transfers.filter((t) => t.status === "pending").length;

  console.log(JSON.stringify({
    date,
    status: record.status,
    totalTransfers: record.transfers.length,
    sent,
    failed,
    pending,
    totalSats: record.total_sats,
    balanceSats: record.balance_sats,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    transfers: record.transfers.map((t) => ({
      btcAddress: t.btc_address,
      stxAddress: t.stx_address,
      amountSats: t.amount_sats,
      txid: t.txid,
      status: t.status,
      error: t.error,
    })),
  }, null, 2));
}

function printUsage(): void {
  console.error(`brief-payout CLI

USAGE
  arc skills run --name brief-payout -- <command> [flags]

COMMANDS
  calculate --date YYYY-MM-DD   Dry run: fetch earnings, resolve addresses, check balance
  execute --date YYYY-MM-DD     Execute payouts: send sBTC, record txids (supports resume)
  status --date YYYY-MM-DD      Check payout status for a date

FLAGS
  --date YYYY-MM-DD   Target date (defaults to today PST)

EXAMPLES
  arc skills run --name brief-payout -- calculate --date 2026-03-25
  arc skills run --name brief-payout -- execute --date 2026-03-25
  arc skills run --name brief-payout -- status --date 2026-03-25
`);
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const commandArgs = args.slice(1);

  switch (command) {
    case "calculate":
      await cmdCalculate(commandArgs);
      break;
    case "execute":
      await cmdExecute(commandArgs);
      break;
    case "status":
      cmdStatus(commandArgs);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
