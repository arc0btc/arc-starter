#!/usr/bin/env bun
// scripts/round-a-repay.ts
// Round A catch-up repayment executor (Mar 24 → Mar 31 buckets).
// Separate from the original per-date payout files; writes to
// db/payouts/<date>-<label>.json so the original <date>.json records stay intact.
//
// Usage:
//   bun run scripts/round-a-repay.ts list                            # show buckets
//   bun run scripts/round-a-repay.ts dry-run --bucket mar-24-galactic-cube
//   bun run scripts/round-a-repay.ts execute --bucket mar-24-galactic-cube
//   bun run scripts/round-a-repay.ts status  --bucket mar-24-galactic-cube

import { resolve, join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getCredential } from "../src/credentials.ts";
import { acquireNonce, releaseNonce, syncNonce } from "../skills/nonce-manager/nonce-store.js";

const ARC_BTC_ADDRESS = "bc1qktaz6rg5k4smre0wfde2tjs2eupvggpmdz39ku";
const ARC_STX_ADDRESS = "SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM";
const API_BASE = "https://aibtc.news/api";
const HIRO_API = "https://api.hiro.so";
const SBTC_CONTRACT = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token";
const ROOT = resolve(import.meta.dir, "..");
const PAYOUTS_DIR = resolve(ROOT, "db/payouts");
const SBTC_SEND_RUNNER = resolve(ROOT, "skills/brief-payout/sbtc-send-runner.ts");

// ---- Bucket configuration ----

interface BucketTransfer {
  correspondent_name: string;
  btc_address: string;
  stx_address: string;
  amount_sats: number;
  earning_ids: string[];
}

interface BucketConfig {
  label: string;
  date: string;              // brief/bucket reference date (for grouping)
  stateFile: string;         // filename under db/payouts/
  memo: string;
  transfers: BucketTransfer[];
}

const BUCKETS: Record<string, BucketConfig> = {
  "mar-24-galactic-cube": {
    label: "Mar 24 Galactic Cube repay",
    date: "2026-03-24",
    stateFile: "2026-03-24-galactic-cube.json",
    memo: "Mar 24 Galactic Cube repay",
    transfers: [
      {
        correspondent_name: "Galactic Cube",
        btc_address: "bc1qmz9xqqsag560989cy759lsftlddp9s5hs66p9z",
        stx_address: "SP352E5K51AP9GBZWXTX568867TM9BCVDK2A3NQCZ",
        amount_sats: 90000,
        earning_ids: [
          "2246029a-0bd6-440f-8b09-da10d01a7c01",
          "3629bf6d-7ddd-4aa9-afd4-a65e2150ba3d",
          "54f86ac5-0745-4a75-936c-73e489c5b9f5",
        ],
      },
    ],
  },
  "mar-25-rbf-repay": {
    label: "Mar 25 RBF repay",
    date: "2026-03-25",
    stateFile: "2026-03-25-rbf-repay.json",
    memo: "Mar 25 RBF repay",
    transfers: [
      {
        correspondent_name: "Encrypted Zara",
        btc_address: "bc1qaq6vmg54e5ayzcnzarta9j8pgvejtkw8xyna5c",
        stx_address: "SP2W2TCKK2S5EGRZZEN91GWA9ZCES17R828SV5D6D",
        amount_sats: 120000,
        earning_ids: [
          "029467d7", "533c9889", "7b1a8af6", "2ee96681",
        ],
      },
      {
        correspondent_name: "Micro Basilisk",
        btc_address: "bc1qzh2z92dlvccxq5w756qppzz8fymhgrt2dv8cf5",
        stx_address: "SP219TWC8G12CSX5AB093127NC82KYQWEH8ADD1AY",
        amount_sats: 60000,
        earning_ids: ["3ca5b6b8", "4c8ab82b"],
      },
      {
        correspondent_name: "Ionic Anvil",
        btc_address: "bc1q7zpy3kpxjzrfctz4en9k2h5sp8nwhctgz54sn5",
        stx_address: "SP13H2T1D1DS5MGP68GD6MEVRAW0RCJ3HBCMPX30Y",
        amount_sats: 120000,
        earning_ids: ["b67b9241", "f2358fba", "c1dd60cd", "2a774b15"],
      },
      {
        correspondent_name: "Grim Seraph",
        btc_address: "bc1qel38f4fv08c7qffwa5jl92sp5e8meuytw3u0n9",
        stx_address: "SP1KVZTZCTCN9TNA1H5MHQ3H0225JGN1RJHY4HA9W",
        amount_sats: 30000,
        earning_ids: ["f9547f6e"],
      },
      {
        correspondent_name: "Ionic Nova",
        btc_address: "bc1qsja6knydqxj0nxf05466zhu8qqedu8umxeagze",
        stx_address: "SP24EH4DG99ZSSZY501BFH9Z4YTDJHC4B8X4K8BST",
        amount_sats: 60000,
        earning_ids: ["fb46e037", "5c5c15b7"],
      },
      {
        correspondent_name: "Dual Cougar",
        btc_address: "bc1q9p6ch73nv4yl2xwhtc6mvqlqrm294hg4zkjyk0",
        stx_address: "SP105KWW31Y89F5AZG0W7RFANQGRTX3XW0VR1CX2M",
        amount_sats: 120000,
        earning_ids: ["e46d7494", "b7a55d64", "56a5eef8", "d4691951"],
      },
    ],
  },
  "mar-31-rbf-repay": {
    label: "Mar 31 RBF repay",
    date: "2026-03-31",
    stateFile: "2026-03-31-rbf-repay.json",
    memo: "Mar 31 RBF repay",
    transfers: [
      {
        correspondent_name: "Sonic Falcon",
        btc_address: "bc1qnj3n36t0kwmfmgc9rqv6utpgtl9l0y06kz42m4",
        stx_address: "SP23JKF25AM9MPYWVB3ZRCV4K3TT45BSDVFZY90TS",
        amount_sats: 90000,
        earning_ids: [
          "a09658fd-0740-4131-ad83-6ebe69cf35ed",
          "3c93ba34-99c6-47d9-ab0f-6303350baa63",
          "0a638d91-90c9-43f3-af52-bb9362eb2a82",
        ],
      },
    ],
  },
};

// ---- Types ----

interface PayoutTransferState {
  correspondent_name: string;
  btc_address: string;
  stx_address: string;
  amount_sats: number;
  earning_ids: string[];
  txid: string | null;
  status: "pending" | "sent" | "failed" | "verified" | "recorded";
  sent_at?: string;
  verified_at?: string;
  recorded_at?: string;
  error?: string;
  nonce_used?: number;
  patch_results?: Array<{ earning_id: string; ok: boolean; error?: string }>;
}

interface BucketStateFile {
  bucket: string;
  label: string;
  date: string;
  status: "pending" | "partial" | "complete" | "failed";
  created_at: string;
  updated_at: string;
  total_sats: number;
  balance_sats_at_start: number;
  transfers: PayoutTransferState[];
}

// ---- Helpers ----

function log(msg: string) {
  console.error(`[${new Date().toISOString()}] [round-a-repay] ${msg}`);
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        flags[key] = "true";
      } else {
        flags[key] = next;
        i++;
      }
    }
  }
  return flags;
}

function statePath(cfg: BucketConfig): string {
  return join(PAYOUTS_DIR, cfg.stateFile);
}

function readState(cfg: BucketConfig): BucketStateFile | null {
  const p = statePath(cfg);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as BucketStateFile;
  } catch {
    return null;
  }
}

function writeStateAt(cfg: BucketConfig, state: BucketStateFile) {
  state.updated_at = new Date().toISOString();
  const statuses = state.transfers.map(t => t.status);
  if (statuses.every(s => s === "recorded")) state.status = "complete";
  else if (statuses.some(s => s === "recorded" || s === "verified" || s === "sent")) state.status = "partial";
  else if (statuses.some(s => s === "failed")) state.status = "failed";
  else state.status = "pending";
  writeFileSync(statePath(cfg), JSON.stringify(state, null, 2));
}

// ---- Auth / API ----

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

async function apiPatch(endpoint: string, body: Record<string, unknown>): Promise<unknown> {
  const headers = await buildAuthHeaders("PATCH", endpoint);
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`API ${response.status}: ${text}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function getSbtcBalance(): Promise<number> {
  const url = `${HIRO_API}/extended/v1/address/${ARC_STX_ADDRESS}/balances`;
  const response = await fetch(url);
  if (!response.ok) return 0;
  const data = (await response.json()) as { fungible_tokens?: Record<string, { balance: string }> };
  return parseInt(data.fungible_tokens?.[SBTC_CONTRACT]?.balance ?? "0", 10);
}

async function getTxStatus(txid: string): Promise<{ status: string; raw: unknown }> {
  const norm = txid.startsWith("0x") ? txid : `0x${txid}`;
  const url = `${HIRO_API}/extended/v1/tx/${norm}`;
  const response = await fetch(url);
  if (!response.ok) return { status: `http_${response.status}`, raw: null };
  const data = (await response.json()) as { tx_status?: string };
  return { status: data.tx_status ?? "unknown", raw: data };
}

async function waitForSuccess(txid: string, timeoutMs = 10 * 60 * 1000, pollMs = 10_000): Promise<{ ok: boolean; status: string }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await getTxStatus(txid);
    if (r.status === "success") return { ok: true, status: r.status };
    if (r.status.startsWith("abort_") || r.status.startsWith("dropped_")) return { ok: false, status: r.status };
    await new Promise(res => setTimeout(res, pollMs));
  }
  return { ok: false, status: "timeout" };
}

// ---- Wallet ----

async function getWalletCreds(): Promise<{ walletId: string; walletPassword: string }> {
  const walletId = await getCredential("bitcoin-wallet", "id");
  const walletPassword = await getCredential("bitcoin-wallet", "password");
  if (!walletId || !walletPassword) throw new Error("Wallet credentials not found (bitcoin-wallet/id, bitcoin-wallet/password)");
  return { walletId, walletPassword };
}

async function sendSbtc(
  recipientStx: string,
  amountSats: number,
  nonce: number,
  memo: string,
  walletId: string,
  walletPassword: string,
): Promise<{ success: boolean; txid?: string; error?: string; detail?: string }> {
  const args = [
    "bun", "run", SBTC_SEND_RUNNER,
    "--recipient", recipientStx,
    "--amount-sats", String(amountSats),
    "--nonce", String(nonce),
    "--memo", memo,
  ];
  const proc = Bun.spawn(args, {
    cwd: ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, WALLET_ID: walletId, WALLET_PASSWORD: walletPassword, NETWORK: "mainnet" },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  const combined = stdout + stderr;
  const jsonStart = combined.indexOf("{");
  if (jsonStart === -1) return { success: false, error: "no JSON output", detail: combined.slice(-500) };
  try {
    return JSON.parse(combined.substring(jsonStart));
  } catch {
    return { success: false, error: "malformed JSON", detail: combined.slice(-500) };
  }
}

// ---- Commands ----

function cmdList() {
  console.log("\nAvailable buckets:\n");
  for (const [key, cfg] of Object.entries(BUCKETS)) {
    const total = cfg.transfers.reduce((s, t) => s + t.amount_sats, 0);
    const earnings = cfg.transfers.reduce((s, t) => s + t.earning_ids.length, 0);
    console.log(`  ${key.padEnd(25)}  ${cfg.transfers.length} transfers  ${total.toLocaleString()} sats  ${earnings} earnings  [${cfg.stateFile}]`);
  }
  console.log("");
}

async function cmdDryRun(cfg: BucketConfig) {
  const total = cfg.transfers.reduce((s, t) => s + t.amount_sats, 0);
  const earningsCount = cfg.transfers.reduce((s, t) => s + t.earning_ids.length, 0);
  const balance = await getSbtcBalance();

  console.log(`\n=== DRY RUN: ${cfg.label} ===`);
  console.log(`Bucket date:     ${cfg.date}`);
  console.log(`State file:      db/payouts/${cfg.stateFile}`);
  console.log(`Transfers:       ${cfg.transfers.length}`);
  console.log(`Earnings:        ${earningsCount}`);
  console.log(`Total sats:      ${total.toLocaleString()}`);
  console.log(`sBTC balance:    ${balance.toLocaleString()} sats`);
  console.log(`Post-send bal:   ${(balance - total).toLocaleString()} sats`);
  console.log(`Can pay:         ${balance >= total ? "YES" : `NO (shortfall ${(total - balance).toLocaleString()})`}`);
  console.log(`\nTransfers:`);
  for (const t of cfg.transfers) {
    console.log(`  ${t.correspondent_name.padEnd(20)}  ${String(t.amount_sats).padStart(7)} sats  ${t.earning_ids.length} earnings  → ${t.stx_address}`);
  }
  console.log("");
}

async function cmdExecute(cfg: BucketConfig) {
  log(`=== EXECUTE: ${cfg.label} ===`);

  // Refuse if existing state file says complete
  const existing = readState(cfg);
  if (existing?.status === "complete") {
    log(`State file marks bucket complete — aborting. Remove ${cfg.stateFile} to re-run.`);
    return;
  }

  const balanceAtStart = await getSbtcBalance();
  const total = cfg.transfers.reduce((s, t) => s + t.amount_sats, 0);
  log(`sBTC balance: ${balanceAtStart} sats, bucket total: ${total} sats`);
  if (balanceAtStart < total) {
    log(`Insufficient balance. Abort.`);
    process.exit(1);
  }

  const { walletId, walletPassword } = await getWalletCreds();

  // Nonce sync + first acquire
  const seed = await syncNonce(ARC_STX_ADDRESS);
  log(`Nonce seed: ${seed.nonce} (lastExecuted=${seed.lastExecuted}, mempool=${seed.mempoolPending}, missing=${seed.detectedMissing.length})`);

  const state: BucketStateFile = existing ?? {
    bucket: cfg.label,
    label: cfg.label,
    date: cfg.date,
    status: "pending",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    total_sats: total,
    balance_sats_at_start: balanceAtStart,
    transfers: cfg.transfers.map(t => ({
      correspondent_name: t.correspondent_name,
      btc_address: t.btc_address,
      stx_address: t.stx_address,
      amount_sats: t.amount_sats,
      earning_ids: [...t.earning_ids],
      txid: null,
      status: "pending" as const,
    })),
  };
  writeStateAt(cfg, state);

  for (let i = 0; i < state.transfers.length; i++) {
    const t = state.transfers[i];

    if (t.status === "recorded") {
      log(`Skip (already recorded): ${t.correspondent_name} → ${t.txid}`);
      continue;
    }

    // If previously sent but not recorded: re-enter verify/record phase
    let txid: string | null = t.txid;

    if (!txid) {
      // Acquire nonce for this transfer
      const acq = await acquireNonce(ARC_STX_ADDRESS);
      const nonce = acq.nonce;
      log(`Acquired nonce ${nonce} for ${t.correspondent_name} (${t.amount_sats} sats → ${t.stx_address})`);

      const result = await sendSbtc(t.stx_address, t.amount_sats, nonce, cfg.memo, walletId, walletPassword);

      if (!result.success || !result.txid) {
        await releaseNonce(ARC_STX_ADDRESS, nonce, false, "broadcast");
        t.status = "failed";
        t.error = result.error ?? result.detail ?? "unknown send failure";
        t.nonce_used = nonce;
        writeStateAt(cfg, state);
        log(`SEND FAILED for ${t.correspondent_name}: ${t.error}`);
        log(`Stopping bucket execution — resolve before retry.`);
        return;
      }

      await releaseNonce(ARC_STX_ADDRESS, nonce, true);
      t.txid = result.txid;
      t.status = "sent";
      t.sent_at = new Date().toISOString();
      t.nonce_used = nonce;
      writeStateAt(cfg, state);
      txid = result.txid;
      log(`Sent: ${t.correspondent_name} → ${txid} (nonce ${nonce})`);
    } else {
      log(`Resuming with existing txid: ${t.correspondent_name} → ${txid}`);
    }

    // Verify on-chain
    log(`Verifying tx ${txid} on Hiro…`);
    const verdict = await waitForSuccess(txid);
    if (!verdict.ok) {
      t.status = "failed";
      t.error = `tx_status=${verdict.status}`;
      writeStateAt(cfg, state);
      log(`VERIFY FAILED for ${t.correspondent_name}: ${t.error}`);
      log(`Stopping bucket execution — diagnose before retry.`);
      return;
    }
    t.status = "verified";
    t.verified_at = new Date().toISOString();
    writeStateAt(cfg, state);
    log(`Verified success: ${txid}`);

    // Record each earning via PATCH /earnings/{id}
    const patchResults: Array<{ earning_id: string; ok: boolean; error?: string }> = [];
    let allOk = true;
    for (const eid of t.earning_ids) {
      try {
        await apiPatch(`/earnings/${encodeURIComponent(eid)}`, {
          btc_address: t.btc_address,
          payout_txid: txid,
        });
        patchResults.push({ earning_id: eid, ok: true });
        log(`  PATCH /earnings/${eid} → ok`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        patchResults.push({ earning_id: eid, ok: false, error: msg });
        allOk = false;
        log(`  PATCH /earnings/${eid} → FAIL: ${msg}`);
      }
    }
    t.patch_results = patchResults;
    if (allOk) {
      t.status = "recorded";
      t.recorded_at = new Date().toISOString();
    } else {
      t.status = "verified"; // keep as verified; operator to retry PATCHes
      t.error = "one or more earnings failed to record";
    }
    writeStateAt(cfg, state);
    if (!allOk) {
      log(`RECORD PARTIAL FAILURE for ${t.correspondent_name}. Stopping.`);
      return;
    }
  }

  const postBalance = await getSbtcBalance();
  log(`Bucket complete. Post-send balance: ${postBalance} sats (delta ${postBalance - balanceAtStart}).`);
}

function cmdStatus(cfg: BucketConfig) {
  const state = readState(cfg);
  if (!state) {
    console.log(`No state file for ${cfg.label} (${cfg.stateFile})`);
    return;
  }
  console.log(JSON.stringify(state, null, 2));
}

// ---- Main ----

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const flags = parseFlags(args.slice(1));

  if (!command || command === "help" || command === "--help") {
    console.log(`
round-a-repay — Round A catch-up payout executor

Commands:
  list                              List available buckets
  dry-run --bucket <name>           Print plan + balance check
  execute --bucket <name>           Send → verify → PATCH earnings → write state file
  status  --bucket <name>           Print current state file for a bucket

Buckets:
  mar-24-galactic-cube   1 transfer  (90k sats)
  mar-25-rbf-repay       6 transfers (510k sats)
  mar-31-rbf-repay       1 transfer  (90k sats)
`);
    return;
  }

  if (command === "list") {
    cmdList();
    return;
  }

  const bucketName = flags.bucket;
  if (!bucketName) {
    console.error("Missing --bucket flag");
    process.exit(1);
  }
  const cfg = BUCKETS[bucketName];
  if (!cfg) {
    console.error(`Unknown bucket: ${bucketName}`);
    console.error(`Available: ${Object.keys(BUCKETS).join(", ")}`);
    process.exit(1);
  }

  switch (command) {
    case "dry-run": await cmdDryRun(cfg); break;
    case "execute": await cmdExecute(cfg); break;
    case "status":  cmdStatus(cfg); break;
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
