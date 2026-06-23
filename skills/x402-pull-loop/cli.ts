/**
 * x402-pull-loop.ts — Single writer: KV honored entries → arc.sqlite x402_sale
 *
 * Newman council finding applied: reads honored entries via Worker /api/x402/honored
 * endpoint (or accepts a --entry JSON argument for control-plane injection).
 *
 * This script is the SOLE WRITER to x402_sale. The upsert uses ON CONFLICT DO UPDATE
 * with a CAS state guard (Kleppmann council fix).
 *
 * Usage (control-plane inject a specific entry):
 *   bun x402-pull-loop.ts --entry '{"chain":"stacks","txid":"0x...","payment_id":"pay_...","buyer_address":"SP...","product_slug":"research-daily","asset":"STX","amount_base_units":49627665,"provenance":"self_funded_test","confirmed_at":"2026-06-22T17:00:00Z"}'
 *
 * Usage (pull from Worker honored endpoint — requires WORKER_URL env):
 *   WORKER_URL=https://arc0btc-worker.arc0.workers.dev bun x402-pull-loop.ts
 */

import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

const LIVE_DB_PATH = "/home/dev/arc-starter/db/arc.sqlite";
const UTC = new Date().toISOString();

interface HonoredEntry {
  chain: string;
  txid: string;
  payment_id: string;
  buyer_address: string | null;
  product_slug: string;
  asset: string;
  amount_base_units: number;
  provenance: string;
  confirmed_at: string | null;
}

/**
 * Upsert a confirmed honored entry into x402_sale.
 * CAS guard: only transitions pending→confirmed, never downgrades a terminal state.
 * Returns: "inserted" | "updated" | "noop"
 */
function upsertHonoredEntry(db: Database, entry: HonoredEntry): "inserted" | "updated" | "noop" {
  const before = db.query("SELECT payment_status FROM x402_sale WHERE chain=? AND txid=?")
    .get(entry.chain, entry.txid) as { payment_status: string } | null;

  db.run(`
    INSERT INTO x402_sale
      (chain, txid, payment_id, buyer_address, product_slug, asset, amount_base_units,
       payment_status, provenance, confirmed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)
    ON CONFLICT(chain, txid) DO UPDATE SET
      payment_status = CASE WHEN x402_sale.payment_status = 'pending'
                            THEN 'confirmed' ELSE x402_sale.payment_status END,
      confirmed_at   = CASE WHEN x402_sale.payment_status = 'pending'
                            THEN excluded.confirmed_at ELSE x402_sale.confirmed_at END,
      buyer_address  = CASE WHEN x402_sale.buyer_address IS NULL
                            THEN excluded.buyer_address ELSE x402_sale.buyer_address END
  `, [
    entry.chain, entry.txid, entry.payment_id, entry.buyer_address ?? null,
    entry.product_slug, entry.asset, entry.amount_base_units,
    entry.provenance ?? "organic", entry.confirmed_at ?? UTC,
  ]);

  const after = db.query("SELECT payment_status FROM x402_sale WHERE chain=? AND txid=?")
    .get(entry.chain, entry.txid) as { payment_status: string };

  if (!before) return "inserted";
  if (before.payment_status !== after.payment_status) return "updated";
  return "noop";
}

// ── Main ───────────────────────────────────────────────────────────────────────

const db = new Database(LIVE_DB_PATH);
db.run("PRAGMA journal_mode=WAL");

let entries: HonoredEntry[] = [];

const entryIdx = process.argv.indexOf("--entry");
if (entryIdx !== -1 && process.argv[entryIdx + 1]) {
  // Control-plane inject mode: single entry from CLI
  const raw = JSON.parse(process.argv[entryIdx + 1]) as HonoredEntry;
  entries = [raw];
  console.log(`[pull-loop] inject mode: 1 entry (txid=${raw.txid.slice(0, 16)}...)`);
} else {
  // Worker pull mode
  const workerUrl = process.env.WORKER_URL ?? "https://arc0btc-worker.arc0.workers.dev";
  console.log(`[pull-loop] pulling from ${workerUrl}/api/x402/honored`);
  try {
    const res = await fetch(`${workerUrl}/api/x402/honored`);
    if (!res.ok) {
      console.error(`[pull-loop] Worker /api/x402/honored returned ${res.status} — no entries to pull`);
      console.log("[pull-loop] This is expected if the honored-list endpoint is not yet implemented on the Worker.");
      console.log("[pull-loop] Use --entry mode for control-plane injection.");
      db.close();
      process.exit(0);
    }
    const body = (await res.json()) as { honored: HonoredEntry[] };
    entries = body.honored ?? [];
    console.log(`[pull-loop] fetched ${entries.length} honored entries`);
  } catch (e) {
    console.error(`[pull-loop] fetch error: ${(e as Error).message}`);
    db.close();
    process.exit(1);
  }
}

let inserted = 0, updated = 0, noops = 0;
for (const entry of entries) {
  const result = upsertHonoredEntry(db, entry);
  if (result === "inserted") inserted++;
  else if (result === "updated") updated++;
  else noops++;
  console.log(`  [${result}] ${entry.chain}:${entry.txid.slice(0, 16)}... product=${entry.product_slug} provenance=${entry.provenance}`);
}

console.log(`\n[pull-loop] done: ${inserted} inserted, ${updated} updated, ${noops} noops`);

// Verify: count of x402_sale rows
const total = (db.query("SELECT COUNT(*) as n FROM x402_sale").get() as { n: number }).n;
console.log(`[pull-loop] x402_sale total rows: ${total}`);

db.close();
