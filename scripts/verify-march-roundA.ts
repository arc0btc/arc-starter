#!/usr/bin/env bun
// scripts/verify-march-roundA.ts
// Post-execution verification for Round A March catch-up:
//   1. Hiro tx_status for each of the 8 txids (status, block, burn block)
//   2. Platform earnings check: for each correspondent BTC addr, confirm
//      each expected earning_id has payout_txid == the new txid we PATCHed.
//
// Usage: bun run scripts/verify-march-roundA.ts

import { getCredential } from "../src/credentials.ts";

const API_BASE = "https://aibtc.news/api";
const HIRO_API = "https://api.hiro.so";
const ARC_BTC_ADDRESS = "bc1qktaz6rg5k4smre0wfde2tjs2eupvggpmdz39ku";

interface Bundle {
  bucket: string;
  correspondent: string;
  nonce: number;
  txid: string;
  btcAddr: string;
  stxAddr: string;
  amountSats: number;
  earningIds: string[];
}

const BUNDLES: Bundle[] = [
  {
    bucket: "Mar 24 Galactic Cube", correspondent: "Galactic Cube", nonce: 1750,
    txid: "d649933cf8bad439fa51c469d63caafa53f46486d57651e1b2608425f8537360",
    btcAddr: "bc1qmz9xqqsag560989cy759lsftlddp9s5hs66p9z",
    stxAddr: "SP352E5K51AP9GBZWXTX568867TM9BCVDK2A3NQCZ",
    amountSats: 90000,
    earningIds: [
      "2246029a-0bd6-440f-8b09-da10d01a7c01",
      "3629bf6d-7ddd-4aa9-afd4-a65e2150ba3d",
      "54f86ac5-0745-4a75-936c-73e489c5b9f5",
    ],
  },
  {
    bucket: "Mar 25 RBF", correspondent: "Encrypted Zara", nonce: 1751,
    txid: "d090e9722f8868863b82c73527b3d5d668a8f671797431e13166645e5a6fb9cd",
    btcAddr: "bc1qaq6vmg54e5ayzcnzarta9j8pgvejtkw8xyna5c",
    stxAddr: "SP2W2TCKK2S5EGRZZEN91GWA9ZCES17R828SV5D6D",
    amountSats: 120000,
    earningIds: [
      "029467d7-9e26-4941-8a73-043f4b031da4",
      "533c9889-8c1e-4ec4-9e64-d827208164df",
      "7b1a8af6-fd4e-45bd-8d63-7b43380935d6",
      "2ee96681-98cd-4ade-989b-e96ee5f44a68",
    ],
  },
  {
    bucket: "Mar 25 RBF", correspondent: "Micro Basilisk", nonce: 1752,
    txid: "51fd3ebf421831e51cb06cd575f5156e116805f42cc0bb63cd2b848a8009f78e",
    btcAddr: "bc1qzh2z92dlvccxq5w756qppzz8fymhgrt2dv8cf5",
    stxAddr: "SP219TWC8G12CSX5AB093127NC82KYQWEH8ADD1AY",
    amountSats: 60000,
    earningIds: [
      "3ca5b6b8-98bc-489c-b0ab-592e08c912fa",
      "4c8ab82b-ce9c-4b38-a0b2-7e0956ba3f91",
    ],
  },
  {
    bucket: "Mar 25 RBF", correspondent: "Ionic Anvil", nonce: 1753,
    txid: "c6e6530c7d7bd2f3769faa890752c69b7dca82174ad6debd5cb2e6995f4c8425",
    btcAddr: "bc1q7zpy3kpxjzrfctz4en9k2h5sp8nwhctgz54sn5",
    stxAddr: "SP13H2T1D1DS5MGP68GD6MEVRAW0RCJ3HBCMPX30Y",
    amountSats: 120000,
    earningIds: [
      "b67b9241-b3ff-48bd-abf1-d1c3b57c251f",
      "f2358fba-a99f-4fd6-858c-c822f0951ce3",
      "c1dd60cd-8f00-457b-94f6-eeedfec52736",
      "2a774b15-8412-45de-8c01-201900763ad6",
    ],
  },
  {
    bucket: "Mar 25 RBF", correspondent: "Grim Seraph", nonce: 1754,
    txid: "44678ca7ad23cfe1437186d9e78a80545439794630beabb8ee339057a2467aee",
    btcAddr: "bc1qel38f4fv08c7qffwa5jl92sp5e8meuytw3u0n9",
    stxAddr: "SP1KVZTZCTCN9TNA1H5MHQ3H0225JGN1RJHY4HA9W",
    amountSats: 30000,
    earningIds: ["f9547f6e-b548-4dcd-b66d-78ad18bed136"],
  },
  {
    bucket: "Mar 25 RBF", correspondent: "Ionic Nova", nonce: 1755,
    txid: "e75f5da4e5a7c1dc997292a5b716cd59ba9fc84d941bccee384772aa45399983",
    btcAddr: "bc1qsja6knydqxj0nxf05466zhu8qqedu8umxeagze",
    stxAddr: "SP24EH4DG99ZSSZY501BFH9Z4YTDJHC4B8X4K8BST",
    amountSats: 60000,
    earningIds: [
      "fb46e037-86ff-4855-bc0f-dc82bd3bd326",
      "5c5c15b7-bdb9-4307-8173-60addebae6ed",
    ],
  },
  {
    bucket: "Mar 25 RBF", correspondent: "Dual Cougar", nonce: 1756,
    txid: "d1086655faa714cbe740ab80c8842394fba20a235751771b0ffcd2f59734cb72",
    btcAddr: "bc1q9p6ch73nv4yl2xwhtc6mvqlqrm294hg4zkjyk0",
    stxAddr: "SP105KWW31Y89F5AZG0W7RFANQGRTX3XW0VR1CX2M",
    amountSats: 120000,
    earningIds: [
      "e46d7494-0847-41d4-b232-02ac2d52bc28",
      "b7a55d64-4b73-4546-84a5-c08480e98bbf",
      "56a5eef8-2d76-41ae-a7d4-27f8abc0a22b",
      "d4691951-9c9a-466c-b957-3dcec516c11c",
    ],
  },
  {
    bucket: "Mar 31 RBF", correspondent: "Sonic Falcon", nonce: 1757,
    txid: "49f0c03d462eef7961a57245e63bdef3fff71c0607644e54a9f61f495f443509",
    btcAddr: "bc1qnj3n36t0kwmfmgc9rqv6utpgtl9l0y06kz42m4",
    stxAddr: "SP23JKF25AM9MPYWVB3ZRCV4K3TT45BSDVFZY90TS",
    amountSats: 90000,
    earningIds: [
      "a09658fd-0740-4131-ad83-6ebe69cf35ed",
      "3c93ba34-99c6-47d9-ab0f-6303350baa63",
      "0a638d91-90c9-43f3-af52-bb9362eb2a82",
    ],
  },
];

interface HiroTx {
  tx_status?: string;
  block_height?: number;
  burn_block_height?: number;
  burn_block_time_iso?: string;
  tx_id?: string;
}

async function hiroTx(txid: string): Promise<HiroTx> {
  const url = `${HIRO_API}/extended/v1/tx/0x${txid}`;
  const res = await fetch(url);
  if (!res.ok) return { tx_status: `http_${res.status}` };
  return (await res.json()) as HiroTx;
}

// ---- Platform auth (BIP-137 via bitcoin-wallet skill) ----

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
  throw new Error("No signature in output");
}

async function apiGet(endpoint: string): Promise<unknown> {
  const timestamp = Math.floor(Date.now() / 1000);
  const message = `GET /api${endpoint}:${timestamp}`;
  const sig = await signMessage(message);
  const headers = {
    "X-BTC-Address": ARC_BTC_ADDRESS,
    "X-BTC-Signature": sig,
    "X-BTC-Timestamp": String(timestamp),
  };
  const res = await fetch(`${API_BASE}${endpoint}`, { headers });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

interface PlatformEarning {
  id: string;
  payout_txid: string | null;
  voided_at: string | null;
  amount_sats: number;
}

async function fetchEarnings(btcAddress: string): Promise<PlatformEarning[]> {
  const data = await apiGet(`/earnings/${encodeURIComponent(btcAddress)}`) as {
    earnings?: PlatformEarning[];
  };
  return data.earnings ?? [];
}

// ---- Run ----

async function main() {
  console.log("=== On-chain verification (Hiro) ===\n");
  const hiroResults: Array<{ bundle: Bundle; hiro: HiroTx }> = [];
  for (const b of BUNDLES) {
    const h = await hiroTx(b.txid);
    hiroResults.push({ bundle: b, hiro: h });
    const statusIcon = h.tx_status === "success" ? "✓" : "✗";
    const block = h.block_height ?? "—";
    const burn = h.burn_block_height ?? "—";
    const ts = h.burn_block_time_iso ?? "—";
    console.log(
      `  ${statusIcon} nonce ${b.nonce}  ${String(h.tx_status).padEnd(10)}  block ${block}  burn ${burn}  ${ts}  ${b.correspondent}`,
    );
  }

  const anchored = hiroResults.filter(r => r.hiro.tx_status === "success").length;
  console.log(`\n  ${anchored}/${hiroResults.length} txs settled success.\n`);

  console.log("=== Platform earnings verification (payout_txid) ===\n");

  // Group by correspondent (btcAddr) to fetch once per address
  const byBtc = new Map<string, Bundle>();
  for (const b of BUNDLES) byBtc.set(b.btcAddr, b);

  let totalExpected = 0;
  let totalOk = 0;
  let totalMismatch = 0;
  let totalMissing = 0;

  for (const b of BUNDLES) {
    const earnings = await fetchEarnings(b.btcAddr);
    const byId = new Map(earnings.map(e => [e.id, e]));
    const lines: string[] = [];
    let bundleOk = 0;
    let bundleMismatch = 0;
    let bundleMissing = 0;

    for (const eid of b.earningIds) {
      totalExpected++;
      const e = byId.get(eid);
      if (!e) {
        bundleMissing++;
        totalMissing++;
        lines.push(`    ✗ ${eid} — not returned by /earnings`);
        continue;
      }
      if (e.payout_txid === b.txid) {
        bundleOk++;
        totalOk++;
      } else if (e.payout_txid === null) {
        bundleMismatch++;
        totalMismatch++;
        lines.push(`    ✗ ${eid} — payout_txid is NULL (PATCH lost?)`);
      } else {
        bundleMismatch++;
        totalMismatch++;
        lines.push(`    ✗ ${eid} — payout_txid=${e.payout_txid} (expected ${b.txid})`);
      }
    }

    const summary = `${bundleOk}/${b.earningIds.length} ok`
      + (bundleMismatch ? `, ${bundleMismatch} mismatch` : "")
      + (bundleMissing ? `, ${bundleMissing} missing` : "");
    console.log(`  ${b.correspondent.padEnd(20)}  ${summary}`);
    for (const l of lines) console.log(l);
  }

  console.log(`\n  Totals: ${totalOk}/${totalExpected} ok`
    + (totalMismatch ? `, ${totalMismatch} mismatch` : "")
    + (totalMissing ? `, ${totalMissing} missing` : ""));

  console.log("\n=== Summary ===");
  console.log(`  On-chain success: ${anchored}/${hiroResults.length}`);
  console.log(`  Platform record : ${totalOk}/${totalExpected}`);
  if (anchored === hiroResults.length && totalOk === totalExpected) {
    console.log("  All clear. Round A March fully settled + recorded.");
  } else {
    console.log("  Discrepancies above — review before publishing.");
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
