#!/usr/bin/env bun
// scripts/apr7-repay.ts
// Apr 7 witness-content payout executor.
//
// Why separate from curated-payout.ts: the platform's /brief/2026-04-07 endpoint
// returns 30 signals but 14 of those are not the witness-content set. #505 Part
// A un-voided 14 witness-only earnings; curated-payout.ts' brief-first flow
// misses them. This script works signal-list-first: for each of the 30
// witness signals, it resolves the correspondent via aibtc.com registry, fetches
// /earnings/{btcAddr}, and builds a plan from matching unpaid-unvoided earnings.
//
// Usage:
//   bun run scripts/apr7-repay.ts dry-run
//   bun run scripts/apr7-repay.ts execute

import { resolve, join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getCredential } from "../src/credentials.ts";
import { acquireNonce, releaseNonce, syncNonce } from "../skills/nonce-manager/nonce-store.js";

const API_BASE = "https://aibtc.news/api";
const HIRO_API = "https://api.hiro.so";
const SBTC_CONTRACT = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token";
const ARC_BTC_ADDRESS = "bc1qktaz6rg5k4smre0wfde2tjs2eupvggpmdz39ku";
const ARC_STX_ADDRESS = "SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM";
const ROOT = resolve(import.meta.dir, "..");
const PAYOUTS_DIR = resolve(ROOT, "db/payouts");
const SBTC_SEND_RUNNER = resolve(ROOT, "skills/brief-payout/sbtc-send-runner.ts");
const STATE_FILE = join(PAYOUTS_DIR, "2026-04-07.json");
const MEMO = "Apr 7 witness-content repay";

// 30 Apr 7 witness-content signals
const APR7_SIGNALS: Array<{ signal: string; name: string; btcPrefix: string; held?: boolean }> = [
  { signal: "7be17d10", name: "Tiny Falcon", btcPrefix: "bc1q48qkyh9dtg" },
  { signal: "5ddd909b", name: "Wide Otto", btcPrefix: "bc1qmcrexa42w5" },
  { signal: "de41f148", name: "(unknown #48)", btcPrefix: "bc1qpurrvv0g3c", held: true },
  { signal: "8444da8b", name: "Tiny Falcon", btcPrefix: "bc1q48qkyh9dtg" },
  { signal: "4ad7834f", name: "Eclipse Luna", btcPrefix: "bc1q6qpyrt6hse" },
  { signal: "a3eece8e", name: "Dense Leviathan", btcPrefix: "bc1qc6mecfsrxf" },
  { signal: "2acaf31a", name: "Zappy Python", btcPrefix: "bc1qp9lzyfsmsf" },
  { signal: "5bf1b521", name: "Ruby Vulture", btcPrefix: "bc1q0sxew2p0de" },
  { signal: "dcdb84f1", name: "Cyber Comet", btcPrefix: "bc1qu7xnmfmcav" },
  { signal: "3fce8150", name: "Verified Swift", btcPrefix: "bc1qlpf9e9u6lx" },
  { signal: "799acd73", name: "Mini Mira", btcPrefix: "bc1qx6m65wlx07" },
  { signal: "59782cbb", name: "Tall Griffin", btcPrefix: "bc1q2lkj0ln2pj" },
  { signal: "a0149762", name: "Diamond Elio", btcPrefix: "bc1qzea904w73g" },
  { signal: "ca265e19", name: "Shining Tiger", btcPrefix: "bc1q0alrl4g85k" },
  { signal: "26c81b2d", name: "Zen Warden", btcPrefix: "bc1q2taw0a9e99" },
  { signal: "de3b3d3f", name: "Sonic Mast", btcPrefix: "bc1qd0z0a8z8am" },
  { signal: "2359bcb8", name: "Pure Troll", btcPrefix: "bc1qq7d9elwp5j" },
  { signal: "7697182b", name: "Twin Cyrus", btcPrefix: "bc1qspmesnmaka" },
  { signal: "9273780f", name: "Flaring Leopard", btcPrefix: "bc1qdredf4adwv" },
  { signal: "bab2e5bc", name: "Humble Idris", btcPrefix: "bc1q9wxa2qfmcg" },
  { signal: "4f9593da", name: "Keyed Reactor", btcPrefix: "bc1qfcd2jad7s2" },
  { signal: "22d67962", name: "Cool Bison", btcPrefix: "bc1qkavth8xtp0" },
  { signal: "f7043524", name: "Platinum Halo", btcPrefix: "bc1qg5jfskfj90" },
  { signal: "d48a472f", name: "Unified Sphinx", btcPrefix: "bc1qge5a3c68d0" },
  { signal: "4f4710a1", name: "Unified Sphinx", btcPrefix: "bc1qge5a3c68d0" },
  { signal: "bdb55bfd", name: "Heavy Juno", btcPrefix: "bc1qtgqxt99m3w" },
  { signal: "7689b18d", name: "Huge Python", btcPrefix: "bc1qvugekyzq55" },
  { signal: "ca636033", name: "Marble Turtle", btcPrefix: "bc1ql20q56uylp" },
  { signal: "6d71fe18", name: "Pure Troll", btcPrefix: "bc1qq7d9elwp5j" },
  { signal: "a7401241", name: "Wide Eden", btcPrefix: "bc1q6e2jptwemn" },
];

// ---- Types ----

interface Agent { btcAddress?: string; stxAddress?: string; name?: string }

interface EarningRec {
  id: string;
  reference_id: string | null;
  payout_txid: string | null;
  voided_at: string | null;
  amount_sats: number;
}

interface Transfer {
  correspondent_name: string;
  btc_address: string;
  stx_address: string;
  amount_sats: number;
  earning_ids: string[];
  signal_ids: string[];
  txid: string | null;
  status: "pending" | "sent" | "verified" | "recorded" | "failed";
  sent_at?: string;
  verified_at?: string;
  recorded_at?: string;
  error?: string;
  nonce_used?: number;
}

interface StateFile {
  date: string;
  label: string;
  status: "pending" | "partial" | "complete" | "failed";
  created_at: string;
  updated_at: string;
  total_sats: number;
  balance_sats_at_start: number;
  held: Array<{ signal: string; btc_prefix: string; reason: string }>;
  transfers: Transfer[];
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
      const r = JSON.parse(combined.substring(jsonStart, endIdx));
      if (r.signatureBase64) return r.signatureBase64;
      if (r.signature) return r.signature;
    } catch {}
  }
  throw new Error("No signature");
}

async function buildAuthHeaders(method: string, path: string): Promise<Record<string, string>> {
  const ts = Math.floor(Date.now() / 1000);
  const sig = await signMessage(`${method} /api${path}:${ts}`);
  return {
    "X-BTC-Address": ARC_BTC_ADDRESS,
    "X-BTC-Signature": sig,
    "X-BTC-Timestamp": String(ts),
    "Content-Type": "application/json",
  };
}

async function apiGet(endpoint: string): Promise<unknown> {
  const headers = await buildAuthHeaders("GET", endpoint);
  const res = await fetch(`${API_BASE}${endpoint}`, { headers });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apiPatch(endpoint: string, body: Record<string, unknown>): Promise<unknown> {
  const headers = await buildAuthHeaders("PATCH", endpoint);
  const res = await fetch(`${API_BASE}${endpoint}`, { method: "PATCH", headers, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`API ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function fetchAllAgents(): Promise<Agent[]> {
  const agents: Agent[] = [];
  let offset = 0;
  while (true) {
    const res = await fetch(`https://aibtc.com/api/agents?limit=100&offset=${offset}`);
    if (!res.ok) throw new Error(`aibtc.com ${res.status}`);
    const d = await res.json() as { agents?: Agent[]; pagination?: { hasMore?: boolean } };
    agents.push(...(d.agents ?? []));
    if (!d.pagination?.hasMore) break;
    offset += 100;
  }
  return agents;
}

async function fetchEarnings(btcAddr: string): Promise<EarningRec[]> {
  const d = await apiGet(`/earnings/${encodeURIComponent(btcAddr)}`) as { earnings?: EarningRec[] };
  return d.earnings ?? [];
}

async function getSbtcBalance(): Promise<number> {
  const url = `${HIRO_API}/extended/v1/address/${ARC_STX_ADDRESS}/balances`;
  const res = await fetch(url);
  if (!res.ok) return 0;
  const d = (await res.json()) as { fungible_tokens?: Record<string, { balance: string }> };
  return parseInt(d.fungible_tokens?.[SBTC_CONTRACT]?.balance ?? "0", 10);
}

async function getTxStatus(txid: string): Promise<string> {
  const url = `${HIRO_API}/extended/v1/tx/0x${txid}`;
  const res = await fetch(url);
  if (!res.ok) return `http_${res.status}`;
  const d = await res.json() as { tx_status?: string };
  return d.tx_status ?? "unknown";
}

async function waitForSuccess(txid: string, timeoutMs = 10 * 60 * 1000, pollMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await getTxStatus(txid);
    if (s === "success") return { ok: true, status: s };
    if (s.startsWith("abort_") || s.startsWith("dropped_")) return { ok: false, status: s };
    await new Promise(r => setTimeout(r, pollMs));
  }
  return { ok: false, status: "timeout" };
}

// ---- Wallet / send ----

async function getWalletCreds() {
  const id = await getCredential("bitcoin-wallet", "id");
  const pw = await getCredential("bitcoin-wallet", "password");
  if (!id || !pw) throw new Error("Wallet creds missing");
  return { walletId: id, walletPassword: pw };
}

async function sendSbtc(recipient: string, amountSats: number, nonce: number, walletId: string, walletPassword: string) {
  const proc = Bun.spawn(
    ["bun", "run", SBTC_SEND_RUNNER,
     "--recipient", recipient,
     "--amount-sats", String(amountSats),
     "--nonce", String(nonce),
     "--memo", MEMO],
    { cwd: ROOT, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, WALLET_ID: walletId, WALLET_PASSWORD: walletPassword, NETWORK: "mainnet" } }
  );
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  const combined = stdout + stderr;
  const jsonStart = combined.indexOf("{");
  if (jsonStart === -1) return { success: false, error: "no JSON output", detail: combined.slice(-500) };
  try { return JSON.parse(combined.substring(jsonStart)); }
  catch { return { success: false, error: "malformed JSON", detail: combined.slice(-500) }; }
}

// ---- Plan builder ----

async function buildPlan(): Promise<{
  transfers: Transfer[];
  held: Array<{ signal: string; btc_prefix: string; reason: string }>;
  unresolved: string[];
  totalSats: number;
}> {
  const agents = await fetchAllAgents();

  // Resolve each signal → full btc + stx (skip held)
  type ResolvedSig = { signal: string; name: string; btcPrefix: string; fullBtc?: string; stx?: string; held?: boolean };
  const resolved: ResolvedSig[] = APR7_SIGNALS.map(s => {
    if (s.held) return { ...s };
    const a = agents.find(x => x.btcAddress?.startsWith(s.btcPrefix));
    return { ...s, fullBtc: a?.btcAddress, stx: a?.stxAddress };
  });

  const held: Array<{ signal: string; btc_prefix: string; reason: string }> = [];
  const unresolved: string[] = [];

  // Group payable by fullBtc
  type Grouping = { fullBtc: string; stx: string; name: string; signals: string[] };
  const byBtc = new Map<string, Grouping>();
  for (const r of resolved) {
    if (r.held) {
      held.push({ signal: r.signal, btc_prefix: r.btcPrefix, reason: "unregistered STX (Manifest #48)" });
      continue;
    }
    if (!r.fullBtc || !r.stx) {
      unresolved.push(`${r.signal} (${r.name}) — ${r.btcPrefix}…`);
      continue;
    }
    const cur = byBtc.get(r.fullBtc) ?? { fullBtc: r.fullBtc, stx: r.stx, name: r.name, signals: [] };
    cur.signals.push(r.signal);
    byBtc.set(r.fullBtc, cur);
  }

  // For each correspondent, fetch earnings and match by reference_id prefix
  const transfers: Transfer[] = [];
  for (const g of byBtc.values()) {
    const earnings = await fetchEarnings(g.fullBtc);
    const matched = earnings.filter(e =>
      e.reference_id &&
      g.signals.includes(e.reference_id.slice(0, 8)) &&
      !e.voided_at &&
      !e.payout_txid,
    );
    if (matched.length === 0) continue;

    transfers.push({
      correspondent_name: g.name,
      btc_address: g.fullBtc,
      stx_address: g.stx,
      amount_sats: matched.reduce((s, e) => s + e.amount_sats, 0),
      earning_ids: matched.map(e => e.id),
      signal_ids: g.signals.slice(),
      txid: null,
      status: "pending",
    });
  }

  const totalSats = transfers.reduce((s, t) => s + t.amount_sats, 0);
  return { transfers, held, unresolved, totalSats };
}

// ---- Commands ----

function log(msg: string) {
  console.error(`[${new Date().toISOString()}] [apr7-repay] ${msg}`);
}

function readState(): StateFile | null {
  if (!existsSync(STATE_FILE)) return null;
  try { return JSON.parse(readFileSync(STATE_FILE, "utf-8")) as StateFile; }
  catch { return null; }
}

function writeState(state: StateFile) {
  state.updated_at = new Date().toISOString();
  const s = state.transfers.map(t => t.status);
  if (s.every(x => x === "recorded")) state.status = "complete";
  else if (s.some(x => x === "recorded" || x === "verified" || x === "sent")) state.status = "partial";
  else if (s.some(x => x === "failed")) state.status = "failed";
  else state.status = "pending";
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function cmdDryRun() {
  const plan = await buildPlan();
  const balance = await getSbtcBalance();

  console.log(`\n=== DRY RUN: Apr 7 witness-content repay ===`);
  console.log(`Transfers:       ${plan.transfers.length}`);
  console.log(`Payable signals: ${plan.transfers.reduce((s,t) => s + t.earning_ids.length, 0)} (of 30 witness-content)`);
  console.log(`Held:            ${plan.held.length}`);
  console.log(`Unresolved:      ${plan.unresolved.length}`);
  console.log(`Total sats:      ${plan.totalSats.toLocaleString()}`);
  console.log(`sBTC balance:    ${balance.toLocaleString()} sats`);
  console.log(`Post-send bal:   ${(balance - plan.totalSats).toLocaleString()} sats`);
  console.log(`Can pay:         ${balance >= plan.totalSats ? "YES" : `NO (shortfall ${(plan.totalSats - balance).toLocaleString()})`}`);
  if (plan.held.length) {
    console.log(`\nHeld (will NOT send):`);
    for (const h of plan.held) console.log(`  ${h.signal}  ${h.btc_prefix}  — ${h.reason}`);
  }
  if (plan.unresolved.length) {
    console.log(`\nUnresolved (not in registry — abort before execute):`);
    for (const u of plan.unresolved) console.log(`  ${u}`);
  }
  console.log(`\nTransfers:`);
  for (const t of plan.transfers.sort((a,b) => b.amount_sats - a.amount_sats)) {
    console.log(`  ${t.correspondent_name.padEnd(20)}  ${String(t.amount_sats).padStart(7)} sats  ${t.earning_ids.length} earnings  → ${t.stx_address}`);
  }
  console.log("");
}

async function cmdExecute() {
  log("=== EXECUTE: Apr 7 witness-content repay ===");

  const existing = readState();
  if (existing?.status === "complete") {
    log(`State file marks complete — aborting. Remove ${STATE_FILE} to re-run.`);
    return;
  }

  const plan = await buildPlan();
  if (plan.unresolved.length) {
    log(`Abort: ${plan.unresolved.length} unresolved correspondents. Review dry-run first.`);
    process.exit(1);
  }

  const balance = await getSbtcBalance();
  log(`sBTC balance: ${balance}, need: ${plan.totalSats}`);
  if (balance < plan.totalSats) {
    log(`Insufficient balance. Abort.`);
    process.exit(1);
  }

  const { walletId, walletPassword } = await getWalletCreds();

  const seed = await syncNonce(ARC_STX_ADDRESS);
  log(`Nonce seed: ${seed.nonce} (lastExecuted=${seed.lastExecuted}, mempool=${seed.mempoolPending})`);

  const state: StateFile = existing ?? {
    date: "2026-04-07",
    label: "Apr 7 witness-content repay",
    status: "pending",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    total_sats: plan.totalSats,
    balance_sats_at_start: balance,
    held: plan.held,
    transfers: plan.transfers,
  };
  writeState(state);

  for (let i = 0; i < state.transfers.length; i++) {
    const t = state.transfers[i];
    if (t.status === "recorded") { log(`Skip (recorded): ${t.correspondent_name}`); continue; }

    let txid = t.txid;
    if (!txid) {
      const acq = await acquireNonce(ARC_STX_ADDRESS);
      const nonce = acq.nonce;
      log(`Acquired nonce ${nonce} for ${t.correspondent_name} (${t.amount_sats} sats → ${t.stx_address})`);

      const result = await sendSbtc(t.stx_address, t.amount_sats, nonce, walletId, walletPassword);
      if (!result.success || !result.txid) {
        await releaseNonce(ARC_STX_ADDRESS, nonce, false, "broadcast");
        t.status = "failed";
        t.error = result.error ?? result.detail ?? "unknown";
        t.nonce_used = nonce;
        writeState(state);
        log(`SEND FAILED: ${t.correspondent_name} — ${t.error}. Stopping.`);
        return;
      }
      await releaseNonce(ARC_STX_ADDRESS, nonce, true);
      t.txid = result.txid;
      t.status = "sent";
      t.sent_at = new Date().toISOString();
      t.nonce_used = nonce;
      writeState(state);
      txid = result.txid;
      log(`Sent: ${t.correspondent_name} → ${txid} (nonce ${nonce})`);
    }

    log(`Verifying tx ${txid}…`);
    const verdict = await waitForSuccess(txid);
    if (!verdict.ok) {
      t.status = "failed";
      t.error = `tx_status=${verdict.status}`;
      writeState(state);
      log(`VERIFY FAILED: ${t.correspondent_name} — ${t.error}. Stopping.`);
      return;
    }
    t.status = "verified";
    t.verified_at = new Date().toISOString();
    writeState(state);
    log(`Verified: ${txid}`);

    let allOk = true;
    for (const eid of t.earning_ids) {
      try {
        await apiPatch(`/earnings/${encodeURIComponent(eid)}`, { btc_address: t.btc_address, payout_txid: txid });
        log(`  PATCH /earnings/${eid} → ok`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`  PATCH /earnings/${eid} → FAIL: ${msg}`);
        allOk = false;
      }
    }
    if (allOk) {
      t.status = "recorded";
      t.recorded_at = new Date().toISOString();
    } else {
      t.status = "verified";
      t.error = "one or more earnings failed to record";
    }
    writeState(state);
    if (!allOk) { log(`RECORD PARTIAL FAILURE: ${t.correspondent_name}. Stopping.`); return; }
  }

  const post = await getSbtcBalance();
  log(`Bucket complete. Post-send balance: ${post} sats (delta ${post - balance}).`);
}

// ---- Main ----

const cmd = process.argv[2];
switch (cmd) {
  case "dry-run": await cmdDryRun(); break;
  case "execute": await cmdExecute(); break;
  default:
    console.error(`Usage: bun run scripts/apr7-repay.ts [dry-run|execute]`);
    process.exit(1);
}
