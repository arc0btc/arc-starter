#!/usr/bin/env bun
// scripts/verify-april-roundA.ts
// Post-execution verification for Round A April catch-up:
//   Reads state files for 2026-04-{05,06,07,09}.json + amber gap-fill
//   For each txid: Hiro tx_status (+ block/burn)
//   For each earning: /earnings/{btcAddr} payout_txid == state txid

const API_BASE = "https://aibtc.news/api";
const HIRO_API = "https://api.hiro.so";
const ARC_BTC_ADDRESS = "bc1qktaz6rg5k4smre0wfde2tjs2eupvggpmdz39ku";
const AMBER_GAP_FILL_TXID = "4dd142e90f7f259c2727e1f61a0b098c244a87c74855aa7c76b3f7da74c714b8";

interface StateTransfer {
  correspondent_name: string;
  btc_address: string;
  amount_sats: number;
  earning_ids: string[];
  txid: string | null;
  status: string;
  nonce_used?: number;
}

async function signMessage(message: string): Promise<string> {
  const proc = Bun.spawn(
    ["bash", "bin/arc", "skills", "run", "--name", "bitcoin-wallet", "--", "btc-sign", "--message", message],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe" }
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

async function apiGet(endpoint: string, retries = 4): Promise<unknown> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ts = Math.floor(Date.now() / 1000);
    const sig = await signMessage(`GET /api${endpoint}:${ts}`);
    const res = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        "X-BTC-Address": ARC_BTC_ADDRESS,
        "X-BTC-Signature": sig,
        "X-BTC-Timestamp": String(ts),
      },
    });
    if (res.ok) return res.json();
    if (attempt < retries && (res.status === 503 || res.status === 502 || res.status === 429)) {
      const delay = 2000 * (attempt + 1);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    throw new Error(`API ${res.status}: ${await res.text()}`);
  }
  throw new Error("unreachable");
}

interface HiroTx { tx_status?: string; block_height?: number; burn_block_height?: number }
async function hiroTx(txid: string): Promise<HiroTx> {
  const res = await fetch(`${HIRO_API}/extended/v1/tx/0x${txid}`);
  if (!res.ok) return { tx_status: `http_${res.status}` };
  return (await res.json()) as HiroTx;
}

interface PlatformEarning { id: string; payout_txid: string | null; voided_at: string | null }
async function fetchEarnings(btcAddr: string): Promise<PlatformEarning[]> {
  const d = await apiGet(`/earnings/${encodeURIComponent(btcAddr)}`) as { earnings?: PlatformEarning[] };
  return d.earnings ?? [];
}

// ---- Main ----

const BUCKETS = ["2026-04-05", "2026-04-06", "2026-04-07", "2026-04-09"];

let totalTx = 0, anchoredTx = 0;
let totalPatches = 0, okPatches = 0, mismatchPatches = 0;
const issues: string[] = [];

for (const bucket of BUCKETS) {
  const path = `db/payouts/${bucket}.json`;
  const state = JSON.parse(await Bun.file(path).text()) as { transfers: StateTransfer[] };
  const txs = state.transfers.filter(t => t.txid);

  console.log(`\n=== ${bucket} — ${txs.length} txs ===`);

  for (const t of txs) {
    totalTx++;
    const h = await hiroTx(t.txid!);
    const icon = h.tx_status === "success" ? "✓" : "✗";
    if (h.tx_status === "success") anchoredTx++;
    else issues.push(`${bucket} ${t.correspondent_name} ${t.txid} — tx_status=${h.tx_status}`);
    console.log(`  ${icon} nonce ${t.nonce_used ?? "?"}  ${String(h.tx_status).padEnd(10)}  block ${h.block_height ?? "—"}  burn ${h.burn_block_height ?? "—"}  ${t.correspondent_name}`);
  }

  // Platform PATCH check
  for (const t of txs) {
    const earnings = await fetchEarnings(t.btc_address);
    const byId = new Map(earnings.map(e => [e.id, e]));
    for (const eid of t.earning_ids) {
      totalPatches++;
      const e = byId.get(eid);
      if (!e) { mismatchPatches++; issues.push(`${bucket} ${t.correspondent_name} earning ${eid} — not returned`); }
      else if (e.payout_txid === t.txid) okPatches++;
      else { mismatchPatches++; issues.push(`${bucket} ${t.correspondent_name} earning ${eid} — payout_txid=${e.payout_txid ?? "NULL"} (expected ${t.txid})`); }
    }
  }
  console.log(`  Platform: ${txs.reduce((s,t) => s + t.earning_ids.length, 0)} earnings checked.`);
}

// Also verify the Amber Otter gap-fill
console.log(`\n=== Amber Otter gap-fill (nonce 1784) ===`);
const h = await hiroTx(AMBER_GAP_FILL_TXID);
console.log(`  ${h.tx_status === "success" ? "✓" : "✗"}  ${h.tx_status}  block ${h.block_height ?? "—"}  burn ${h.burn_block_height ?? "—"}`);

console.log(`\n=== SUMMARY ===`);
console.log(`  Hiro txs success: ${anchoredTx}/${totalTx}`);
console.log(`  Platform PATCH matches: ${okPatches}/${totalPatches}`);
console.log(`  Platform mismatches: ${mismatchPatches}`);
if (issues.length) {
  console.log(`\n  ⚠ Issues:`);
  for (const i of issues.slice(0, 30)) console.log(`    ${i}`);
} else {
  console.log(`\n  ✓ All April Round A settled + recorded correctly.`);
}
