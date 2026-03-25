#!/usr/bin/env bun
// skills/brief-payout/cli.ts
// CLI for correspondent payout management: calculate, execute, status.
// Usage: arc skills run --name brief-payout -- <command> [flags]
//
// Data flow:
//   1. Fetch brief sections for target date → list of signal IDs per correspondent
//   2. For each correspondent, GET /api/earnings/{btcAddress} → match earning records
//      by reference_id (signal ID), filter to active (not voided) + unpaid (no payout_txid)
//   3. Resolve BTC→STX addresses via correspondents API / contact-registry
//   4. Send sBTC transfers sequentially (local nonce tracking)
//   5. Record each payout via PATCH /api/earnings/{earningId} with payout_txid

import { ARC_BTC_ADDRESS } from "../../src/identity.ts";
import { getCredential } from "../../src/credentials.ts";
import { resolve, join } from "node:path";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const API_BASE = "https://aibtc.news/api";
const PAYOUTS_DIR = resolve(import.meta.dir, "../../db/payouts");
const SBTC_SEND_RUNNER = resolve(import.meta.dir, "sbtc-send-runner.ts");

// Ensure payouts directory exists
mkdirSync(PAYOUTS_DIR, { recursive: true });

// ---- Types ----

interface EarningRecord {
  id: string;
  btc_address: string;
  amount_sats: number;
  reason: string;
  reference_id: string | null;
  created_at: string;
  payout_txid: string | null;
  voided_at: string | null;
}

interface BriefSection {
  correspondent: string;
  correspondentName: string;
  signalId: string;
  beatSlug: string;
  headline: string;
}

interface PayoutTransfer {
  earning_ids: string[];
  btc_address: string;
  stx_address: string;
  amount_sats: number;
  txid: string | null;
  status: "pending" | "sent" | "failed";
  error?: string;
  sent_at?: string;
  correspondent_name: string;
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
    correspondentName: string;
    amountSats: number;
    earningIds: string[];
    signalCount: number;
  }>;
  totalSats: number;
  balanceSats: number;
  canPay: boolean;
  unresolvedAddresses: string[];
  briefSignals: number;
  briefCorrespondents: number;
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
  const pst = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
  return pst; // YYYY-MM-DD
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
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function apiPatch(endpoint: string, body: Record<string, unknown>): Promise<unknown> {
  const headers = await buildAuthHeaders("PATCH", endpoint);
  const url = `${API_BASE}${endpoint}`;
  log(`PATCH ${url}`);
  const response = await fetch(url, {
    method: "PATCH",
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

async function resolveAddresses(btcAddresses: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (btcAddresses.length === 0) return map;

  // Try correspondents API first
  try {
    const data = await apiGet("/correspondents") as {
      correspondents?: Array<Record<string, unknown>>;
    };

    const correspondents = data.correspondents ?? (Array.isArray(data) ? data as Array<Record<string, unknown>> : []);

    for (const c of correspondents) {
      const btcAddr = String(c.address ?? "");
      const stxAddr = String(c.stxAddress ?? c.stx_address ?? "");
      if (btcAddr && stxAddr && btcAddresses.includes(btcAddr)) {
        map.set(btcAddr, stxAddr);
      }
    }
  } catch (err) {
    log(`Correspondents API error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Fallback: contact-registry for unresolved
  for (const btcAddr of btcAddresses) {
    if (map.has(btcAddr)) continue;
    try {
      const proc = Bun.spawn(
        ["bash", "bin/arc", "skills", "run", "--name", "contact-registry", "--", "search", "--term", btcAddr],
        { cwd: resolve(import.meta.dir, "../.."), stdin: "ignore", stdout: "pipe", stderr: "pipe" }
      );
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      const stxMatch = stdout.match(/STX:\s*(S[PT][A-Z0-9]+)/);
      if (stxMatch) {
        map.set(btcAddr, stxMatch[1]);
      }
    } catch {
      // Will be reported as unresolved
    }
  }

  return map;
}

async function getSbtcBalance(): Promise<number> {
  const stxAddress = "SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM";
  const sbtcContract = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token";
  try {
    const url = `https://api.hiro.so/extended/v1/address/${stxAddress}/balances`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Hiro API ${response.status}`);
    const data = (await response.json()) as {
      fungible_tokens?: Record<string, { balance: string }>;
    };
    const sbtcBalance = data.fungible_tokens?.[sbtcContract]?.balance ?? "0";
    const sats = parseInt(sbtcBalance, 10);
    log(`sBTC balance: ${sats} sats (${(sats / 100_000_000).toFixed(8)} sBTC)`);
    return sats;
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
    detected_missing_nonces: number[];
    detected_mempool_nonces: number[];
  };
  const nextNonce = BigInt(data.possible_next_nonce);
  log(`Seed nonce: ${nextNonce} (last executed: ${data.last_executed_tx_nonce}, mempool pending: ${data.detected_mempool_nonces?.length ?? 0})`);
  if (data.detected_missing_nonces.length > 0) {
    log(`Warning: ${data.detected_missing_nonces.length} missing nonce gap(s): [${data.detected_missing_nonces.join(", ")}]`);
  }
  return nextNonce;
}

function isNonceError(errorMsg: string): boolean {
  const phrases = ["ConflictingNonceInMempool", "nonce", "ExpectedNonce", "BadNonce", "TooMuchChaining"];
  return phrases.some((p) => errorMsg.toLowerCase().includes(p.toLowerCase()));
}

// ---- Brief + Earnings Data ----

/**
 * Fetch brief sections and match against per-correspondent earning records
 * to build the definitive payout list for a date.
 */
async function buildPayoutData(date: string): Promise<{
  byCorrespondent: Map<string, {
    name: string;
    amountSats: number;
    earningIds: string[];
    signalCount: number;
  }>;
  briefSignals: number;
  briefCorrespondents: number;
}> {
  // 1. Fetch brief for the date
  const briefData = await apiGet(`/brief/${date}`) as {
    sections?: BriefSection[];
    summary?: { correspondents: number; beats: number; signals: number };
  };

  const sections = briefData.sections ?? [];
  if (sections.length === 0) {
    throw new Error(`No brief found for ${date} or brief has no sections`);
  }

  const summary = briefData.summary ?? { correspondents: 0, beats: 0, signals: 0 };
  log(`Brief ${date}: ${summary.signals} signals, ${summary.correspondents} correspondents, ${summary.beats} beats`);

  // 2. Group sections by correspondent BTC address
  const correspondentSignals = new Map<string, { name: string; signalIds: string[] }>();
  for (const s of sections) {
    const addr = s.correspondent;
    if (!addr) continue;
    const entry = correspondentSignals.get(addr) ?? { name: s.correspondentName, signalIds: [] };
    entry.signalIds.push(s.signalId);
    correspondentSignals.set(addr, entry);
  }

  // 3. For each correspondent, fetch their earnings and match by signal ID
  const byCorrespondent = new Map<string, {
    name: string;
    amountSats: number;
    earningIds: string[];
    signalCount: number;
  }>();

  for (const [btcAddr, { name, signalIds }] of correspondentSignals) {
    try {
      const earningsData = await apiGet(`/earnings/${encodeURIComponent(btcAddr)}`) as {
        earnings?: EarningRecord[];
      };

      const earnings = earningsData.earnings ?? [];

      // Filter to: brief_inclusion, matching signal IDs, not voided, not yet paid
      const unpaid = earnings.filter((e) =>
        e.reason === "brief_inclusion" &&
        e.reference_id !== null &&
        signalIds.includes(e.reference_id) &&
        !e.voided_at &&
        !e.payout_txid
      );

      if (unpaid.length > 0) {
        byCorrespondent.set(btcAddr, {
          name,
          amountSats: unpaid.reduce((sum, e) => sum + e.amount_sats, 0),
          earningIds: unpaid.map((e) => e.id),
          signalCount: unpaid.length,
        });
      } else {
        log(`${name} (${btcAddr.slice(0, 12)}...): no unpaid earnings for ${signalIds.length} signal(s)`);
      }
    } catch (err) {
      log(`Failed to fetch earnings for ${btcAddr}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { byCorrespondent, briefSignals: sections.length, briefCorrespondents: correspondentSignals.size };
}

// ---- Commands ----

async function cmdCalculate(args: string[]): Promise<PayoutPlan> {
  const flags = parseFlags(args);
  const date = flags.date || todayPST();

  log(`Calculating payouts for ${date}`);

  const { byCorrespondent, briefSignals, briefCorrespondents } = await buildPayoutData(date);

  if (byCorrespondent.size === 0) {
    const plan: PayoutPlan = {
      date, payouts: [], totalSats: 0, balanceSats: 0, canPay: true,
      unresolvedAddresses: [], briefSignals, briefCorrespondents,
    };
    log("No unpaid earnings found");
    console.log(JSON.stringify(plan, null, 2));
    return plan;
  }

  // Resolve BTC → STX addresses
  const btcAddresses = [...byCorrespondent.keys()];
  const addressMap = await resolveAddresses(btcAddresses);

  // Get sBTC balance
  const balanceSats = await getSbtcBalance();

  // Build payout plan
  const payouts: PayoutPlan["payouts"] = [];
  const unresolvedAddresses: string[] = [];

  for (const [btcAddr, entry] of byCorrespondent) {
    const stxAddr = addressMap.get(btcAddr);
    if (!stxAddr) {
      unresolvedAddresses.push(btcAddr);
      continue;
    }
    payouts.push({
      btcAddress: btcAddr,
      stxAddress: stxAddr,
      correspondentName: entry.name,
      amountSats: entry.amountSats,
      earningIds: entry.earningIds,
      signalCount: entry.signalCount,
    });
  }

  const totalSats = payouts.reduce((sum, p) => sum + p.amountSats, 0);
  const canPay = balanceSats >= totalSats && unresolvedAddresses.length === 0;

  const plan: PayoutPlan = {
    date, payouts, totalSats, balanceSats, canPay,
    unresolvedAddresses, briefSignals, briefCorrespondents,
  };
  console.log(JSON.stringify(plan, null, 2));
  return plan;
}

async function cmdExecute(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const date = flags.date || todayPST();

  log(`Executing payouts for ${date}`);

  // Check for existing state (resume support)
  let record = readPayoutRecord(date);

  if (record?.status === "complete") {
    log("Payouts already complete for this date");
    console.log(JSON.stringify(record, null, 2));
    return;
  }

  // Calculate plan (capture stdout)
  const originalLog = console.log;
  console.log = () => {};
  const plan = await cmdCalculate(["--date", date]);
  console.log = originalLog;

  if (plan.payouts.length === 0) {
    log("No payouts to execute");
    console.log(JSON.stringify({ date, status: "complete", message: "No unpaid earnings" }));
    return;
  }

  if (plan.unresolvedAddresses.length > 0) {
    log(`Cannot execute: ${plan.unresolvedAddresses.length} unresolved address(es)`);
    console.log(JSON.stringify({
      error: "Unresolved addresses",
      unresolvedAddresses: plan.unresolvedAddresses,
      hint: "Add these agents to the contact-registry with their STX addresses",
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
        correspondent_name: p.correspondentName,
      })),
    };
    writePayoutRecord(record);
  }

  // ---- Local Nonce Tracking ----
  const senderStxAddress = "SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM";
  let currentNonce: bigint;

  try {
    currentNonce = await fetchSeedNonce(senderStxAddress);
  } catch (err) {
    log(`Failed to seed nonce: ${err instanceof Error ? err.message : String(err)}`);
    console.log(JSON.stringify({ error: "Failed to fetch initial nonce", detail: err instanceof Error ? err.message : String(err) }));
    process.exit(1);
  }

  const pendingCount = record.transfers.filter((t) => t.status !== "sent").length;
  log(`Nonce strategy: seed=${currentNonce}, pending=${pendingCount}, already sent=${record.transfers.length - pendingCount}`);

  // Execute transfers sequentially
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < record.transfers.length; i++) {
    const transfer = record.transfers[i];

    if (transfer.status === "sent") {
      log(`Skipping already-sent: ${transfer.correspondent_name} (txid: ${transfer.txid})`);
      successCount++;
      continue;
    }

    log(`[${i + 1}/${record.transfers.length}] ${transfer.correspondent_name}: ${transfer.amount_sats} sats → ${transfer.stx_address} (nonce=${currentNonce})`);

    try {
      const result = await sendSbtc(walletId, walletPassword, transfer.stx_address, transfer.amount_sats, `aibtc.news payout ${date}`, currentNonce);

      if (result.success && result.txid) {
        transfer.status = "sent";
        transfer.txid = result.txid;
        transfer.sent_at = new Date().toISOString();
        successCount++;
        currentNonce++;
        log(`Sent: ${result.txid} (next nonce=${currentNonce})`);

        // Record payout on API: PATCH each earning record with the txid
        for (const earningId of transfer.earning_ids) {
          try {
            await apiPatch(`/earnings/${earningId}`, {
              btc_address: transfer.btc_address,
              payout_txid: result.txid,
            });
          } catch (recordErr) {
            log(`Warning: PATCH /earnings/${earningId} failed: ${recordErr instanceof Error ? recordErr.message : String(recordErr)}`);
            // Transfer is on-chain — don't fail the batch over API recording
          }
        }
        log(`Recorded ${transfer.earning_ids.length} earning(s) on API`);
      } else {
        const errorMsg = result.error ?? result.detail ?? "Unknown error";

        if (isNonceError(errorMsg)) {
          log(`Nonce error: ${errorMsg} — re-seeding`);
          try {
            currentNonce = await fetchSeedNonce(senderStxAddress);
            const retry = await sendSbtc(walletId, walletPassword, transfer.stx_address, transfer.amount_sats, `aibtc.news payout ${date}`, currentNonce);

            if (retry.success && retry.txid) {
              transfer.status = "sent";
              transfer.txid = retry.txid;
              transfer.sent_at = new Date().toISOString();
              successCount++;
              currentNonce++;
              log(`Retry succeeded: ${retry.txid}`);
              for (const earningId of transfer.earning_ids) {
                try { await apiPatch(`/earnings/${earningId}`, { btc_address: transfer.btc_address, payout_txid: retry.txid }); } catch { /* best effort */ }
              }
            } else {
              transfer.status = "failed";
              transfer.error = `Retry failed: ${retry.error ?? retry.detail ?? "Unknown"}`;
              failCount++;
            }
          } catch (reseedErr) {
            transfer.status = "failed";
            transfer.error = `Nonce re-seed failed: ${reseedErr instanceof Error ? reseedErr.message : String(reseedErr)}`;
            failCount++;
          }
        } else {
          transfer.status = "failed";
          transfer.error = errorMsg;
          failCount++;
          log(`Failed: ${transfer.error}`);
        }
      }
    } catch (err) {
      transfer.status = "failed";
      transfer.error = err instanceof Error ? err.message : String(err);
      failCount++;
      log(`Error: ${transfer.error}`);
    }

    record.status = "partial";
    writePayoutRecord(record);
  }

  record.status = failCount === 0 ? "complete" : successCount === 0 ? "failed" : "partial";
  writePayoutRecord(record);

  console.log(JSON.stringify({
    date,
    status: record.status,
    totalTransfers: record.transfers.length,
    sent: successCount,
    failed: failCount,
    totalSats: record.total_sats,
    transfers: record.transfers.map((t) => ({
      name: t.correspondent_name,
      btcAddress: t.btc_address,
      stxAddress: t.stx_address,
      amountSats: t.amount_sats,
      txid: t.txid,
      status: t.status,
      error: t.error,
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
): Promise<{ success: boolean; txid?: string; error?: string; detail?: string }> {
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
      env: { ...process.env, WALLET_ID: walletId, WALLET_PASSWORD: walletPassword, NETWORK: "mainnet" },
    }
  );

  let stdout = "";
  const stderrPromise = new Response(proc.stderr).text();

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();

  const readWithTimeout = new Promise<string>(async (resolvePromise, reject) => {
    const timer = setTimeout(() => { proc.kill(); reject(new Error("Timeout (90s)")); }, 90000);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        stdout += decoder.decode(value, { stream: true });
        const trimmed = stdout.trim();
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
          try { JSON.parse(trimmed); clearTimeout(timer); proc.kill(); resolvePromise(trimmed); return; } catch { /* incomplete */ }
        }
      }
      clearTimeout(timer);
      resolvePromise(stdout.trim());
    } catch (error) { clearTimeout(timer); reject(error); }
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
    sent, failed, pending,
    totalSats: record.total_sats,
    balanceSats: record.balance_sats,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    transfers: record.transfers.map((t) => ({
      name: t.correspondent_name,
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
  console.error(`brief-payout CLI — pay correspondents for daily brief inclusions

USAGE
  arc skills run --name brief-payout -- <command> [flags]

COMMANDS
  calculate --date YYYY-MM-DD   Dry run: fetch brief, match earnings, resolve addresses, check balance
  execute --date YYYY-MM-DD     Execute payouts: send sBTC, record txids via PATCH /earnings/{id}
  status --date YYYY-MM-DD      Check payout status for a date

FLAGS
  --date YYYY-MM-DD   Target date (defaults to today PST)

EXAMPLES
  arc skills run --name brief-payout -- calculate --date 2026-03-24
  arc skills run --name brief-payout -- execute --date 2026-03-24
  arc skills run --name brief-payout -- status --date 2026-03-24
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const commandArgs = args.slice(1);

  switch (command) {
    case "calculate": await cmdCalculate(commandArgs); break;
    case "execute": await cmdExecute(commandArgs); break;
    case "status": cmdStatus(commandArgs); break;
    case "help": case "--help": case "-h": case undefined: printUsage(); break;
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
