#!/usr/bin/env bun
// scripts/apr7-spot-check.ts
// Spot-check Apr 7 witness-content earnings on platform:
//   - For each of the 30 witness signals, fetch /earnings/{btcAddr}
//   - Find the earning whose reference_id matches the signal
//   - Report: payout_txid (null = payable, set = already paid),
//             voided_at (null = active, set = voided — indicates #505 didn't un-void)
// Only uses the 14 "missing from brief" signals as the main un-void spot check,
// but reports all 30 for completeness.

const API_BASE = "https://aibtc.news/api";
const ARC_BTC_ADDRESS = "bc1qktaz6rg5k4smre0wfde2tjs2eupvggpmdz39ku";

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

async function apiGet(endpoint: string): Promise<unknown> {
  const ts = Math.floor(Date.now() / 1000);
  const sig = await signMessage(`GET /api${endpoint}:${ts}`);
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      "X-BTC-Address": ARC_BTC_ADDRESS,
      "X-BTC-Signature": sig,
      "X-BTC-Timestamp": String(ts),
    },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

// Apr 7 witness signals — correspondent name + BTC prefix from manifest
const APR7_SIGNALS = [
  { signal: "7be17d10", name: "Tiny Falcon", btcPrefix: "bc1q48qkyh9dtg" },
  { signal: "5ddd909b", name: "Wide Otto", btcPrefix: "bc1qmcrexa42w5" },
  { signal: "de41f148", name: "(unknown #48)", btcPrefix: "bc1qpurrvv0g3c" }, // held
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

// ---- Resolve BTC prefixes to full addresses + STX via aibtc.com registry ----

interface Agent { btcAddress?: string; stxAddress?: string; name?: string }

async function fetchAllAgents(): Promise<Agent[]> {
  const agents: Agent[] = [];
  let offset = 0;
  while (true) {
    const res = await fetch(`https://aibtc.com/api/agents?limit=100&offset=${offset}`);
    if (!res.ok) throw new Error(`aibtc.com ${res.status}`);
    const data = await res.json() as { agents?: Agent[]; pagination?: { hasMore?: boolean } };
    agents.push(...(data.agents ?? []));
    if (!data.pagination?.hasMore) break;
    offset += 100;
  }
  return agents;
}

interface EarningRec {
  id: string;
  reference_id: string | null;
  payout_txid: string | null;
  voided_at: string | null;
  amount_sats: number;
}

async function fetchEarnings(btcAddr: string): Promise<EarningRec[]> {
  const d = await apiGet(`/earnings/${encodeURIComponent(btcAddr)}`) as { earnings?: EarningRec[] };
  return d.earnings ?? [];
}

async function main() {
  console.log("Fetching agents registry…");
  const agents = await fetchAllAgents();
  console.log(`Indexed ${agents.length} agents.\n`);

  const resolved: Array<typeof APR7_SIGNALS[0] & { fullBtc?: string; stx?: string }> = [];
  for (const s of APR7_SIGNALS) {
    const a = agents.find(x => x.btcAddress?.startsWith(s.btcPrefix));
    resolved.push({ ...s, fullBtc: a?.btcAddress, stx: a?.stxAddress });
  }

  const missing = resolved.filter(r => !r.fullBtc);
  if (missing.length) {
    console.log(`WARN: ${missing.length} btcPrefixes did not resolve in registry:`);
    for (const m of missing) console.log(`  ${m.signal}  ${m.name}  ${m.btcPrefix}`);
    console.log("");
  }

  // Group by full btc addr (dedupe — some correspondents have multiple signals)
  const byBtc = new Map<string, { fullBtc: string; stx?: string; name: string; signals: string[] }>();
  for (const r of resolved) {
    if (!r.fullBtc) continue;
    const cur = byBtc.get(r.fullBtc) ?? { fullBtc: r.fullBtc, stx: r.stx, name: r.name, signals: [] };
    cur.signals.push(r.signal);
    byBtc.set(r.fullBtc, cur);
  }

  console.log(`=== Apr 7 earning state per correspondent ===\n`);
  let payable = 0, alreadyPaid = 0, voided = 0, notFound = 0, held = 0;

  for (const [btc, info] of byBtc) {
    const earnings = await fetchEarnings(btc);
    // map reference_id → earning
    const byRef = new Map<string, EarningRec>();
    for (const e of earnings) if (e.reference_id) byRef.set(e.reference_id.slice(0, 8), e);

    const lines: string[] = [];
    for (const sig of info.signals) {
      const e = byRef.get(sig);
      const isHeld = info.name.includes("#48");
      if (isHeld) {
        held++;
        lines.push(`    HELD   ${sig}  — Manifest #48, unregistered STX`);
        continue;
      }
      if (!e) {
        notFound++;
        lines.push(`    MISS   ${sig}  — no earning record found for this signal`);
      } else if (e.voided_at) {
        voided++;
        lines.push(`    VOID   ${sig}  id=${e.id.slice(0,8)}  voided_at=${e.voided_at}  → #505 did not un-void?`);
      } else if (e.payout_txid) {
        alreadyPaid++;
        lines.push(`    PAID   ${sig}  id=${e.id.slice(0,8)}  payout_txid=${e.payout_txid.slice(0,12)}…`);
      } else {
        payable++;
        lines.push(`    OK     ${sig}  id=${e.id.slice(0,8)}  payable`);
      }
    }

    console.log(`${info.name.padEnd(22)} ${info.stx ? info.stx.slice(0, 8)+"…" : "no-stx"}  ${info.signals.length} signals`);
    for (const l of lines) console.log(l);
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Payable:      ${payable}`);
  console.log(`  Already paid: ${alreadyPaid}`);
  console.log(`  Voided:       ${voided}  ← expect 0 after #505 Part A`);
  console.log(`  Held:         ${held}  ← Manifest #48`);
  console.log(`  Not found:    ${notFound}`);
  console.log(`  Total:        ${payable + alreadyPaid + voided + held + notFound} / 30 expected`);

  if (voided > 0 || notFound > 0) {
    console.log(`\n  ⚠ Abnormal state — review before executing Apr 7`);
  } else {
    console.log(`\n  ✓ Apr 7 clear to execute (${payable} payable signals)`);
  }
}

main().catch(err => {
  console.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
