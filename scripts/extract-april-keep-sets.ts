#!/usr/bin/env bun
// scripts/extract-april-keep-sets.ts
// Fetches /brief/{date} for Apr 5/6/7/9 and resolves 8-char signal prefixes
// (from the manifest) to full UUIDs, emitting TypeScript keep-set declarations
// ready to paste into scripts/curated-payout.ts.

import { ARC_BTC_ADDRESS } from "../src/identity.ts";

const API_BASE = "https://aibtc.news/api";

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

const BUCKETS: Array<{ date: string; name: string; prefixes: string[] }> = [
  {
    date: "2026-04-05", name: "APR5_KEEP",
    prefixes: ["3b4c952c","9867f2a3","df6f028a","4bf01da7","16a21257","f12162c6","82c2c3d2","a6bbe008","2a776a5b","07d22742","e64defa9","3e2849fa","c0c9bbb7","377d043c","821d76d6","aeb5e712","e1a7884b","8f61bea1","db786c06","83b51ada","047c2a44","b7c5c70a","78648a14","b7abbd51","8cc4d3d3","f7dceed8","0187bec0","ca73fd92","8969a0b0","7e2b85e8"],
  },
  {
    date: "2026-04-06", name: "APR6_KEEP",
    prefixes: ["cc7c3925","241e0e04","08d79691","de72eb2f","63e09a08","de962a68","4261eb9e","4e5e069c","53a5ba55","5d4b7424","b87c659e","effe36ae","9b0ee278","b4fb1b04","ee7318bc","aefda697","8fed39ee","7584d421","b0b70025","06131fd2","d0dd7002","4f0c28a5","eba54da5","0594cd9b","b6158c48","a12b0e1c","eec840ec","29e3b206","ac5ca612","f92994de"],
  },
  {
    date: "2026-04-07", name: "APR7_WITNESS_KEEP",
    prefixes: ["7be17d10","5ddd909b","de41f148","8444da8b","4ad7834f","a3eece8e","2acaf31a","5bf1b521","dcdb84f1","3fce8150","799acd73","59782cbb","a0149762","ca265e19","26c81b2d","de3b3d3f","2359bcb8","7697182b","9273780f","bab2e5bc","4f9593da","22d67962","f7043524","d48a472f","4f4710a1","bdb55bfd","7689b18d","ca636033","6d71fe18","a7401241"],
  },
  {
    date: "2026-04-09", name: "APR9_NONQUANTUM_KEEP",
    prefixes: ["a06359b5","6ce53e07","9c39154f","8e5b402a","24b55798","e8b8c06c","d5335407","0e242dc4","8d1aea02","059e19cf","3eb4bcd9","47b49234","69853eb8","93157ebd","4201738a","0162dded","fadabc78","119860e4","4258c59b","268a668e","4d0eaac1","db5cae7d","c64314ee","9aa59b23"],
  },
];

for (const b of BUCKETS) {
  const brief = await apiGet(`/brief/${b.date}`) as {
    sections?: Array<{ signalId: string; correspondentName?: string }>;
  };
  const sections = brief.sections ?? [];
  const byPrefix = new Map<string, string>();
  for (const s of sections) byPrefix.set(s.signalId.slice(0, 8), s.signalId);

  const resolved: string[] = [];
  const missing: string[] = [];
  for (const p of b.prefixes) {
    const full = byPrefix.get(p);
    if (full) resolved.push(full);
    else missing.push(p);
  }

  console.log(`\n// ${b.date} — ${resolved.length}/${b.prefixes.length} resolved (brief has ${sections.length} signals)`);
  if (missing.length) console.log(`// MISSING: ${missing.join(", ")}`);
  console.log(`const ${b.name} = new Set([`);
  for (const id of resolved) console.log(`  "${id}",`);
  console.log(`]);`);
}
