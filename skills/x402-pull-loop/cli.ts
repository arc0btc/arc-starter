/**
 * x402-pull-loop.ts — Single writer: KV honored entries → arc.sqlite x402_sale
 *
 * Newman council finding applied: reads honored entries via Worker /api/x402/honored
 * endpoint (or accepts a --entry JSON argument for control-plane injection).
 *
 * This script is the SOLE WRITER to x402_sale. The upsert uses ON CONFLICT DO UPDATE
 * with a CAS state guard (Kleppmann council fix).
 *
 * P6 (arc-demand-distribution): buyer-authenticity classifier added.
 * resolveProvenance() checks buyer_address against tagged_wallets before write:
 * - Caller-supplied non-organic provenance is trusted as-is (self_funded_test from rail).
 * - Tagged wallet (pond/self_funded_test) overrides any incoming 'organic' provenance.
 * - Untagged, unclassified buyer → 'organic' (M0-demand-eligible, fires first-sale alert).
 * Invariant: a wallet in tagged_wallets at write time NEVER produces provenance='organic'.
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
 * Resolve the canonical provenance for an inbound entry.
 *
 * Priority chain (P6 buyer-authenticity classifier):
 * 1. If the caller already supplied a non-organic provenance (e.g. 'self_funded_test'
 *    from a direct control-plane inject), trust it. This covers existing rail tests.
 * 2. If buyer_address is in tagged_wallets, use the stored tag ('self_funded_test' or
 *    'pond'). Overrides any incoming 'organic' value — tagged wallets cannot produce
 *    M0-demand.
 * 3. Untagged buyer with no explicit provenance → 'organic'. This is the only path that
 *    increments M0-demand and fires the first-sale alert in the north-star monitor.
 *
 * Invariant: buyer_address IN tagged_wallets → provenance ≠ 'organic' (always).
 */
function resolveProvenance(db: Database, entry: HonoredEntry): string {
  // Trust caller-supplied non-organic provenance (self_funded_test, pond, etc.)
  if (entry.provenance && entry.provenance !== "organic") return entry.provenance;
  // Check buyer_address against tagged_wallets
  if (entry.buyer_address) {
    const tagged = db.query(
      "SELECT tag FROM tagged_wallets WHERE stacks_address = ?"
    ).get(entry.buyer_address) as { tag: string } | null;
    if (tagged) return tagged.tag;
  }
  // Untagged, unclassified → organic (M0-demand-eligible)
  return "organic";
}

/**
 * Upsert a confirmed honored entry into x402_sale.
 * CAS guard: only transitions pending→confirmed, never downgrades a terminal state.
 * P6: provenance is resolved via resolveProvenance() before write.
 * Returns: "inserted" | "updated" | "noop"
 */
function upsertHonoredEntry(db: Database, entry: HonoredEntry): "inserted" | "updated" | "noop" {
  const before = db.query("SELECT payment_status FROM x402_sale WHERE chain=? AND txid=?")
    .get(entry.chain, entry.txid) as { payment_status: string } | null;

  const resolvedProvenance = resolveProvenance(db, entry);

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
    resolvedProvenance, entry.confirmed_at ?? UTC,
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
    const fetchResponse = await fetch(`${workerUrl}/api/x402/honored`);
    if (!fetchResponse.ok) {
      console.error(`[pull-loop] Worker /api/x402/honored returned ${fetchResponse.status} — no entries to pull`);
      console.log("[pull-loop] This is expected if the honored-list endpoint is not yet implemented on the Worker.");
      console.log("[pull-loop] Use --entry mode for control-plane injection.");
      db.close();
      process.exit(0);
    }
    const body = (await fetchResponse.json()) as { honored: HonoredEntry[] };
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
  const resolved = resolveProvenance(db, entry);
  const result = upsertHonoredEntry(db, entry);
  if (result === "inserted") inserted++;
  else if (result === "updated") updated++;
  else noops++;
  console.log(`  [${result}] ${entry.chain}:${entry.txid.slice(0, 16)}... product=${entry.product_slug} provenance=${entry.provenance}→${resolved}`);
}

console.log(`\n[pull-loop] done: ${inserted} inserted, ${updated} updated, ${noops} noops`);

// Verify: count of x402_sale rows by provenance
const provenanceDist = db.query("SELECT provenance, COUNT(*) as n FROM x402_sale GROUP BY provenance").all();
console.log(`[pull-loop] x402_sale provenance distribution: ${JSON.stringify(provenanceDist)}`);

db.close();
