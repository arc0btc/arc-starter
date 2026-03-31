#!/usr/bin/env bun
// scripts/curated-payout.ts
// One-off payout script for curated Mar 28 + Mar 29 briefs.
//
// Context: Mar 28 (137 signals) and Mar 29 (235 signals) briefs were inscribed
// with more signals than the 30-signal daily cap. This script pays only the
// editorially curated top 30 signals per date, writing standard payout records
// to db/payouts/ for auditability. The remaining ~312 earnings stay as
// pending on the platform (not voided, not paid).
//
// Usage:
//   bun run scripts/curated-payout.ts calculate   # dry run
//   bun run scripts/curated-payout.ts execute     # send sBTC transfers
//   bun run scripts/curated-payout.ts status      # check payout state
//
// Records are written to db/payouts/2026-03-28.json and 2026-03-29.json in the
// same format as brief-payout/cli.ts for consistent auditing.

import { resolve, join } from "node:path";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { getCredential } from "../src/credentials.ts";
import { acquireNonce, releaseNonce, syncNonce } from "../skills/nonce-manager/nonce-store.js";

const ARC_BTC_ADDRESS = "bc1qktaz6rg5k4smre0wfde2tjs2eupvggpmdz39ku";
const API_BASE = "https://aibtc.news/api";
const ROOT = resolve(import.meta.dir, "..");
const PAYOUTS_DIR = resolve(ROOT, "db/payouts");
const SBTC_SEND_RUNNER = resolve(ROOT, "skills/brief-payout/sbtc-send-runner.ts");

mkdirSync(PAYOUTS_DIR, { recursive: true });

// ---- Curated signal keep-lists ----

const MAR28_KEEP = new Set([
  "930e1834-bef4-4e3f-a68a-3056477af468",
  "1d6ece26-797b-43f7-b1e6-567ed87c631e",
  "cb493430-5d9e-4e49-a725-2f1be7bb08ab",
  "111d8292-8ab5-40e3-bc3b-208db92632c0",
  "98a4d814-00b7-451a-968c-d976220cc7c5",
  "c1343c15-e4b7-4298-9a39-4f8d00bee54d",
  "82a50ffb-c6bf-4fd4-867b-6f0d67365bb6",
  "0ed8c332-cc91-4a24-bc72-9490f5dc0822",
  "9a892709-772e-496f-afe7-9185cce91c86",
  "20bb3ede-6ecf-4b2a-a69f-122c4b57c613",
  "0c4f667c-524d-40db-aecc-f0ef18c55de9",
  "31981975-a6a3-4586-b2d4-870015b7f677",
  "0a14999b-60bd-4fe4-ab7f-753dd9ceda75",
  "b538613c-808b-444e-a31a-02b2579488c2",
  "dc8792d8-f914-4efc-83c7-e340f649d530",
  "6a9d716c-379c-4774-9c24-f8e76f73997a",
  "01c0bedb-2b39-40bf-b686-411384054f1d",
  "b5a3c5f6-4a3f-4637-af37-5a9f79e91c90",
  "18dc8c21-1def-44f9-a2af-8d0a4074e89b",
  "ad79de32-4646-4848-aa17-edb31c327465",
  "55c5e5e6-92e9-43e3-8d8a-f264e4bcc043",
  "f557dc4d-fc45-4fa7-af2d-a0288e9df9ed",
  "9e5879c7-97ce-4f1c-a8fb-b032668fd255",
  "575a3d65-4af8-43de-a65a-61fde6952df8",
  "65a12c02-3b2c-4cdc-9574-a008ec360464",
  "76f8d1e0-6d87-459f-9886-1480533dbcb1",
  "d0cb7dcf-e49c-4bae-aba4-5cd73108f332",
  "b59401dc-f81a-4c18-ba1e-d1c8013a9e8d",
  "029c697b-40de-47d3-a48b-e7954acf93ed",
  "e949fdb2-f75d-40d9-934f-13e8c4f0ed30",
]);

const MAR29_KEEP = new Set([
  "db837a01-788d-4f08-a174-8758347ce61a",
  "ffcb4de3-3998-4265-a8a2-eb8944f4af32",
  "43800ead-c4bd-46ef-95f2-5cd1a1ae50a9",
  "80e3529a-a4e9-4cd5-b41c-bcb701a0ba53",
  "2b4cfe7a-75d0-4ce0-906a-bff3e09185cc",
  "2e00e3ef-a979-4583-b010-7565d9b8e635",
  "31cf9975-c3af-44d5-ba5c-b7e5f11375af",
  "dc06393c-f1e0-4667-8ee0-3a593f39ff2c",
  "248db72c-6082-43ca-8500-3c39b013c5e2",
  "f74eb37a-cfba-47d4-adc9-06b62422e2b8",
  "cef57500-2ee9-4c12-82eb-5cb3f8f03e52",
  "3960c10e-92f8-43f6-b8bb-58f768dc5fc0",
  "40d30fbb-459b-49ea-8f94-98b2c8d17a0c",
  "52fadd57-8847-46a8-85e7-d8458f86374e",
  "747ef5c5-30fc-4bff-a555-d52b982dcd4d",
  "cb05bbc3-ed0c-4f77-8ec3-5c7e916bd796",
  "772617b2-2c1b-4f61-bb50-2203b623787a",
  "a1518f55-d566-47d0-a397-35ef9a50efd4",
  "7d995511-db66-400c-8d26-ad198c985281",
  "9f6d8223-aeb5-4de0-b2ab-1ecff104dcdc",
  "545f7829-a536-464c-9417-6c06fa26d02a",
  "bcd9e7ef-992c-4a80-b788-c7000fba15c7",
  "14305d91-2348-4299-b26d-3a4bfebd2909",
  "41bf9018-b15e-4995-9699-fcdb9357634f",
  "b5e4f967-76f5-4012-9c64-c6369f010482",
  "4f5f50e0-60f6-4901-aae7-a0468c61234b",
  "8b866fc7-e02d-4a6f-ba88-fed94434466b",
  "10c5c979-a1e9-45d8-92a4-59fe7d70bd2a",
  "246983df-bd20-4d24-8dce-88b526284e82",
  "45c3be21-17b1-41ca-ab18-82a2ec165146",
]);

const CURATED_DATES: Array<{ date: string; keepSet: Set<string> }> = [
  { date: "2026-03-28", keepSet: MAR28_KEEP },
  { date: "2026-03-29", keepSet: MAR29_KEEP },
];

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

interface PayoutTransfer {
  earning_ids: string[];
  btc_address: string;
  stx_address: string;
  amount_sats: number;
  txid: string | null;
  status: "pending" | "sent" | "failed";
  correspondent_name: string;
  sent_at?: string;
  error?: string;
}

interface PayoutRecord {
  date: string;
  status: "pending" | "partial" | "complete" | "failed";
  created_at: string;
  updated_at: string;
  total_sats: number;
  balance_sats: number;
  transfers: PayoutTransfer[];
  curation_note: string;
}

// ---- Helpers ----

function log(msg: string) {
  console.error(`[${new Date().toISOString()}] [curated-payout] ${msg}`);
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

function writePayoutRecord(record: PayoutRecord) {
  record.updated_at = new Date().toISOString();
  writeFileSync(payoutFilePath(record.date), JSON.stringify(record, null, 2));
}

async function signMessage(message: string): Promise<string> {
  const proc = Bun.spawn(
    ["bash", "bin/arc", "skills", "run", "--name", "bitcoin-wallet", "--", "btc-sign", "--message", message],
    { cwd: ROOT, stdin: "ignore", stdout: "pipe", stderr: "pipe" }
  );
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (await proc.exited !== 0) throw new Error(`Signing failed: ${stderr}`);
  const combined = stdout + stderr;
  const jsonStart = combined.indexOf("{");
  for (let endIdx = combined.length; endIdx > jsonStart; endIdx--) {
    try {
      const result = JSON.parse(combined.substring(jsonStart, endIdx));
      if (result.signatureBase64) return result.signatureBase64;
      if (result.signature) return result.signature;
    } catch {}
  }
  throw new Error(`No signature in output`);
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
  const headers = await buildAuthHeaders("GET", endpoint);
  const response = await fetch(`${API_BASE}${endpoint}`, { headers });
  if (!response.ok) throw new Error(`API ${response.status}: ${await response.text()}`);
  return response.json();
}

async function apiPatch(endpoint: string, body: Record<string, unknown>): Promise<unknown> {
  const headers = await buildAuthHeaders("PATCH", endpoint);
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`API ${response.status}: ${await response.text()}`);
  return response.json();
}

async function getSbtcBalance(): Promise<number> {
  const stxAddress = "SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM";
  const sbtcContract = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token";
  const url = `https://api.hiro.so/extended/v1/address/${stxAddress}/balances`;
  const response = await fetch(url);
  if (!response.ok) return 0;
  const data = (await response.json()) as { fungible_tokens?: Record<string, { balance: string }> };
  return parseInt(data.fungible_tokens?.[sbtcContract]?.balance ?? "0", 10);
}

async function resolveAddresses(btcAddresses: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (btcAddresses.length === 0) return map;

  // Primary: aibtc.com agent registry (paginated, has BTC + STX addresses)
  try {
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const url = `https://aibtc.com/api/agents?limit=100&offset=${offset}`;
      log(`Fetching agents: ${url}`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`aibtc.com API ${response.status}`);
      const data = (await response.json()) as {
        agents?: Array<{ btcAddress?: string; stxAddress?: string }>;
        pagination?: { hasMore?: boolean };
      };
      for (const a of data.agents ?? []) {
        const btcAddr = a.btcAddress ?? "";
        const stxAddr = a.stxAddress ?? "";
        if (btcAddr && stxAddr && btcAddresses.includes(btcAddr)) {
          map.set(btcAddr, stxAddr);
        }
      }
      hasMore = data.pagination?.hasMore ?? false;
      offset += 100;
      if (btcAddresses.every(a => map.has(a))) break;
    }
    log(`aibtc.com resolved ${map.size}/${btcAddresses.length} addresses`);
  } catch (err) {
    log(`aibtc.com API error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Fallback: contact-registry for unresolved
  for (const btcAddr of btcAddresses) {
    if (map.has(btcAddr)) continue;
    try {
      const proc = Bun.spawn(
        ["bash", "bin/arc", "skills", "run", "--name", "contact-registry", "--", "search", "--term", btcAddr],
        { cwd: ROOT, stdin: "ignore", stdout: "pipe", stderr: "pipe" }
      );
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      const stxMatch = stdout.match(/STX:\s*(S[PT][A-Z0-9]+)/);
      if (stxMatch) map.set(btcAddr, stxMatch[1]);
    } catch {}
  }

  return map;
}

async function sendSbtc(
  recipientStx: string,
  amountSats: number,
  nonce: number,
  walletId: string,
  walletPassword: string,
): Promise<{ success: boolean; txid?: string; error?: string }> {
  const proc = Bun.spawn(
    [
      "bun", "run", SBTC_SEND_RUNNER,
      "--recipient", recipientStx,
      "--amount-sats", String(amountSats),
      "--nonce", String(nonce),
    ],
    {
      cwd: ROOT,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, WALLET_ID: walletId, WALLET_PASSWORD: walletPassword },
    }
  );
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  const combined = stdout + stderr;

  try {
    const jsonStart = combined.indexOf("{");
    if (jsonStart === -1) return { success: false, error: combined };
    const result = JSON.parse(combined.substring(jsonStart));
    return result;
  } catch {
    return { success: false, error: combined };
  }
}

// ---- Build curated payout data ----

interface CuratedPlan {
  date: string;
  transfers: Array<{
    btc_address: string;
    stx_address: string;
    correspondent_name: string;
    amount_sats: number;
    earning_ids: string[];
    signal_count: number;
  }>;
  totalSats: number;
  balanceSats: number;
  briefTotalSignals: number;
  curatedSignals: number;
  skippedSignals: number;
  unresolvedAddresses: string[];
}

async function buildCuratedPlan(date: string, keepSet: Set<string>): Promise<CuratedPlan> {
  log(`Building curated plan for ${date} (${keepSet.size} signals in keep-list)`);

  // Fetch brief
  const briefData = await apiGet(`/brief/${date}`) as {
    sections?: Array<{ correspondent: string; correspondentName: string; signalId: string }>;
    summary?: { signals: number };
  };
  const sections = briefData.sections ?? [];
  const briefTotalSignals = briefData.summary?.signals ?? sections.length;
  log(`Brief has ${briefTotalSignals} total signals`);

  // Filter to keep-list
  const keepSections = sections.filter(s => keepSet.has(s.signalId));
  log(`Keep-list matches ${keepSections.length} signals`);

  // Group by correspondent
  const correspondentSignals = new Map<string, { name: string; signalIds: string[] }>();
  for (const s of keepSections) {
    const entry = correspondentSignals.get(s.correspondent) ?? { name: s.correspondentName, signalIds: [] };
    entry.signalIds.push(s.signalId);
    correspondentSignals.set(s.correspondent, entry);
  }

  // Match earnings
  const transfers: CuratedPlan["transfers"] = [];
  const unresolvedAddresses: string[] = [];

  // Resolve addresses
  const addressMap = await resolveAddresses([...correspondentSignals.keys()]);

  for (const [btcAddr, { name, signalIds }] of correspondentSignals) {
    const earningsData = await apiGet(`/earnings/${encodeURIComponent(btcAddr)}`) as {
      earnings?: EarningRecord[];
    };
    const earnings = earningsData.earnings ?? [];

    const matched = earnings.filter(e =>
      e.reason === "brief_inclusion" &&
      e.reference_id !== null &&
      signalIds.includes(e.reference_id) &&
      !e.voided_at &&
      !e.payout_txid
    );

    if (matched.length === 0) continue;

    const stxAddr = addressMap.get(btcAddr);
    if (!stxAddr) {
      unresolvedAddresses.push(btcAddr);
      continue;
    }

    transfers.push({
      btc_address: btcAddr,
      stx_address: stxAddr,
      correspondent_name: name,
      amount_sats: matched.reduce((s, e) => s + e.amount_sats, 0),
      earning_ids: matched.map(e => e.id),
      signal_count: matched.length,
    });
  }

  const totalSats = transfers.reduce((s, t) => s + t.amount_sats, 0);
  const balanceSats = await getSbtcBalance();

  return {
    date,
    transfers,
    totalSats,
    balanceSats,
    briefTotalSignals,
    curatedSignals: keepSections.length,
    skippedSignals: briefTotalSignals - keepSections.length,
    unresolvedAddresses,
  };
}

// ---- Commands ----

async function cmdCalculate() {
  log("=== CURATED PAYOUT DRY RUN ===");
  log("This pays only the editorially curated top 30 signals per date.");
  log("Remaining earnings stay as pending (not voided, not paid).\n");

  let grandTotal = 0;

  for (const { date, keepSet } of CURATED_DATES) {
    const existing = readPayoutRecord(date);
    if (existing?.status === "complete") {
      log(`${date}: Already complete (${existing.transfers.length} transfers, ${existing.total_sats} sats)`);
      continue;
    }

    const plan = await buildCuratedPlan(date, keepSet);
    grandTotal += plan.totalSats;

    console.log(`\n--- ${date} ---`);
    console.log(`  Brief total:     ${plan.briefTotalSignals} signals`);
    console.log(`  Curated keep:    ${plan.curatedSignals} signals`);
    console.log(`  Skipped:         ${plan.skippedSignals} signals (earnings stay pending)`);
    console.log(`  Transfers:       ${plan.transfers.length} correspondents`);
    console.log(`  Payout total:    ${plan.totalSats} sats`);
    console.log(`  sBTC balance:    ${plan.balanceSats} sats`);
    console.log(`  Can pay:         ${plan.balanceSats >= plan.totalSats ? "YES" : `NO (need ${plan.totalSats - plan.balanceSats} more sats)`}`);
    if (plan.unresolvedAddresses.length > 0) {
      console.log(`  Unresolved:      ${plan.unresolvedAddresses.join(", ")}`);
    }
    console.log(`\n  Transfers:`);
    for (const t of plan.transfers.sort((a, b) => b.amount_sats - a.amount_sats)) {
      console.log(`    ${t.correspondent_name.padEnd(22)} ${t.signal_count} signal(s)  ${t.amount_sats} sats  → ${t.stx_address}`);
    }
  }

  console.log(`\n=== GRAND TOTAL: ${grandTotal} sats ===`);
  const balance = await getSbtcBalance();
  console.log(`sBTC balance: ${balance} sats`);
  if (balance < grandTotal) {
    console.log(`SHORTFALL: ${grandTotal - balance} sats — fund wallet before running execute`);
  }
}

async function cmdExecute() {
  log("=== CURATED PAYOUT EXECUTE ===");

  const balanceSats = await getSbtcBalance();
  log(`sBTC balance: ${balanceSats} sats`);

  // Pre-check total needed
  let totalNeeded = 0;
  for (const { date, keepSet } of CURATED_DATES) {
    const existing = readPayoutRecord(date);
    if (existing?.status === "complete") continue;
    if (existing) {
      totalNeeded += existing.transfers.filter(t => t.status !== "sent").reduce((s, t) => s + t.amount_sats, 0);
    } else {
      const plan = await buildCuratedPlan(date, keepSet);
      totalNeeded += plan.totalSats;
    }
  }

  if (balanceSats < totalNeeded) {
    log(`Insufficient sBTC: have ${balanceSats}, need ${totalNeeded} (shortfall ${totalNeeded - balanceSats})`);
    process.exit(1);
  }

  const { walletId, walletPassword } = await getWalletCreds();
  const senderStxAddress = "SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM";

  for (const { date, keepSet } of CURATED_DATES) {
    log(`\n--- Processing ${date} ---`);

    let record = readPayoutRecord(date);
    if (record?.status === "complete") {
      log(`${date}: Already complete — skipping`);
      continue;
    }

    // Build record if new
    if (!record) {
      const plan = await buildCuratedPlan(date, keepSet);
      if (plan.transfers.length === 0) {
        log(`${date}: No transfers — skipping`);
        continue;
      }

      record = {
        date,
        status: "pending",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        total_sats: plan.totalSats,
        balance_sats: balanceSats,
        transfers: plan.transfers.map(t => ({
          earning_ids: t.earning_ids,
          btc_address: t.btc_address,
          stx_address: t.stx_address,
          amount_sats: t.amount_sats,
          txid: null,
          status: "pending" as const,
          correspondent_name: t.correspondent_name,
        })),
        curation_note: `Curated payout: ${plan.curatedSignals} of ${plan.briefTotalSignals} signals selected. ${plan.skippedSignals} signals excluded from payout (earnings remain pending on platform). Selection criteria: editorial quality rubric (CEI structure, beat diversity, no duplicates, source quality).`,
      };
      writePayoutRecord(record);
      log(`Created payout record: ${record.transfers.length} transfers, ${record.total_sats} sats`);
    }

    // Sync nonce
    const seedResult = await syncNonce(senderStxAddress);
    log(`Nonce seed: ${seedResult.nonce} (lastExecuted=${seedResult.lastExecuted}, pending=${seedResult.mempoolPending})`);

    let currentNonce: number;
    try {
      const acq = await acquireNonce(senderStxAddress);
      currentNonce = acq.nonce;
      log(`Acquired initial nonce: ${currentNonce}`);
    } catch (err) {
      log(`Failed to acquire nonce: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < record.transfers.length; i++) {
      const transfer = record.transfers[i];

      if (transfer.status === "sent") {
        log(`Skip (already sent): ${transfer.correspondent_name} txid=${transfer.txid}`);
        successCount++;
        continue;
      }

      log(`Sending ${transfer.amount_sats} sats to ${transfer.correspondent_name} (${transfer.stx_address}) nonce=${currentNonce}`);

      const result = await sendSbtc(
        transfer.stx_address,
        transfer.amount_sats,
        currentNonce,
        walletId,
        walletPassword,
      );

      if (result.success && result.txid) {
        await releaseNonce(senderStxAddress, currentNonce, true);
        transfer.status = "sent";
        transfer.txid = result.txid;
        transfer.sent_at = new Date().toISOString();
        successCount++;
        log(`Sent: ${result.txid}`);

        // Record payout on API
        for (const earningId of transfer.earning_ids) {
          try {
            await apiPatch(`/earnings/${earningId}`, {
              btc_address: transfer.btc_address,
              payout_txid: result.txid,
            });
          } catch (recordErr) {
            log(`Warning: PATCH /earnings/${earningId} failed: ${recordErr instanceof Error ? recordErr.message : String(recordErr)}`);
          }
        }

        // Acquire next nonce
        try {
          const acq = await acquireNonce(senderStxAddress);
          currentNonce = acq.nonce;
        } catch (err) {
          log(`Failed to acquire next nonce: ${err instanceof Error ? err.message : String(err)} — stopping`);
          break;
        }
      } else {
        await releaseNonce(senderStxAddress, currentNonce, false, "broadcast" as never);
        transfer.status = "failed";
        transfer.error = result.error ?? "Unknown error";
        failCount++;
        log(`Failed: ${transfer.error}`);

        // Try to acquire next nonce and continue
        try {
          const acq = await acquireNonce(senderStxAddress);
          currentNonce = acq.nonce;
        } catch {
          log("Cannot acquire next nonce — stopping batch");
          break;
        }
      }

      // Save after each transfer
      writePayoutRecord(record);
    }

    // Final status
    const allSent = record.transfers.every(t => t.status === "sent");
    const anySent = record.transfers.some(t => t.status === "sent");
    record.status = allSent ? "complete" : anySent ? "partial" : "failed";
    writePayoutRecord(record);

    log(`${date}: ${successCount} sent, ${failCount} failed — status=${record.status}`);
  }

  log("\n=== DONE ===");
}

async function getWalletCreds(): Promise<{ walletId: string; walletPassword: string }> {
  const walletId = await getCredential("bitcoin-wallet", "id");
  const walletPassword = await getCredential("bitcoin-wallet", "password");
  if (!walletId || !walletPassword) {
    throw new Error("Wallet credentials not found");
  }
  return { walletId, walletPassword };
}

function cmdStatus() {
  for (const { date } of CURATED_DATES) {
    const record = readPayoutRecord(date);
    if (!record) {
      console.log(`${date}: No payout record`);
      continue;
    }

    const sent = record.transfers.filter(t => t.status === "sent");
    const failed = record.transfers.filter(t => t.status === "failed");
    const pending = record.transfers.filter(t => t.status === "pending");

    console.log(`\n--- ${date} (${record.status}) ---`);
    console.log(`  Total:    ${record.total_sats} sats`);
    console.log(`  Sent:     ${sent.length} (${sent.reduce((s, t) => s + t.amount_sats, 0)} sats)`);
    console.log(`  Failed:   ${failed.length}`);
    console.log(`  Pending:  ${pending.length}`);
    if (record.curation_note) {
      console.log(`  Note:     ${record.curation_note}`);
    }
    console.log(`  Transfers:`);
    for (const t of record.transfers) {
      const statusIcon = t.status === "sent" ? "✓" : t.status === "failed" ? "✗" : "·";
      console.log(`    ${statusIcon} ${t.correspondent_name.padEnd(22)} ${t.amount_sats} sats  ${t.txid ?? t.error ?? "pending"}`);
    }
  }
}

// ---- Main ----

const command = process.argv[2];

switch (command) {
  case "calculate":
    await cmdCalculate();
    break;
  case "execute":
    await cmdExecute();
    break;
  case "status":
    cmdStatus();
    break;
  default:
    console.error(`curated-payout — one-off payout for editorially curated Mar 28 + Mar 29 briefs

USAGE
  bun run scripts/curated-payout.ts calculate   Dry run: show payout plan
  bun run scripts/curated-payout.ts execute     Send sBTC transfers
  bun run scripts/curated-payout.ts status      Check payout state

CONTEXT
  Mar 28 brief had 137 signals, Mar 29 had 235. Both exceed the 30-signal
  daily cap. This script pays only the curated top 30 per date.

  Payout records are written to db/payouts/ in the standard format for
  consistent auditing alongside prior payouts.
`);
    process.exit(1);
}
