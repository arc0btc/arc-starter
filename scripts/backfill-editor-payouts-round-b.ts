#!/usr/bin/env bun
// scripts/backfill-editor-payouts-round-b.ts
// Backfill editor_payouts audit rows for the Round B overnight settlement
// (2026-04-22). Round B paid flat-daily arrears via scripts/round-b-overnight.ts,
// which bypassed the editor-payout skill pipeline — the local audit table was
// never written. This script closes that gap.
//
// Settlement details from db/payouts/round-b-overnight-summary.md:
//   - Zen Rocket (quantum):       1,750,000 sats, nonce 1856, txid 0b2eadfe…
//   - Elegant Orb (aibtc-network): 1,400,000 sats, nonce 1857, txid 2a8aff0a…
//   - Ivory Coda (bitcoin-macro):  1,400,000 sats, nonce 1858, txid 8266b6b9…
//
// Idempotent: UNIQUE (date, beat_slug) index on editor_payouts — re-running
// is a no-op after first write.

import { Database } from "bun:sqlite";
import { resolve } from "node:path";

const DB_PATH = resolve(import.meta.dir, "..", "db", "arc.sqlite");
const SETTLEMENT_DATE = "2026-04-22";
const SETTLEMENT_SENT_AT = "2026-04-22 18:32:32";

interface BackfillRow {
  beat_slug: string;
  editor_name: string;
  editor_btc_address: string;
  editor_stx_address: string;
  amount_sats: number;
  signals_included: number;
  txid: string;
  note: string;
}

const ROWS: BackfillRow[] = [
  {
    beat_slug: "quantum",
    editor_name: "Zen Rocket",
    editor_btc_address: "bc1q2a79dmk06ct6v206sqtp3agw8kg64dz40vhjeg",
    editor_stx_address: "SP286ZKK9TG18E738PKH7A3HYNSSXATF0ASC46NRK",
    amount_sats: 1_750_000,
    signals_included: 10,
    txid: "0b2eadfe6527a5fcd97fa69a35fab4e3b27bd0d5c80e47d67ee311bc4e9d4474",
    note: "Round B flat-daily arrears (Apr 10-20); per-day attribution in db/payouts/2026-04-22-round-b-tracking.md",
  },
  {
    beat_slug: "aibtc-network",
    editor_name: "Elegant Orb",
    editor_btc_address: "bc1qhm82hzvfhfuqkeazhsx8p82gm64klymssejslg",
    editor_stx_address: "SPEK7NWA9H77NH6J5G5FWWKYQTXWV5B8FD3DJ8SA",
    amount_sats: 1_400_000,
    signals_included: 8,
    txid: "2a8aff0af022f4f062890e32efea6cc6340648994e84f0b70dc86af8fb4881e2",
    note: "Round B flat-daily arrears (Apr 10-20); per-day attribution in db/payouts/2026-04-22-round-b-tracking.md",
  },
  {
    beat_slug: "bitcoin-macro",
    editor_name: "Ivory Coda",
    editor_btc_address: "bc1qlk749zmklfzm54hcmjs5vr2j6q4h5zddjc6yjm",
    editor_stx_address: "SP33C21DH86NQ56RYYY69CGD1146H4E5NHNM32W5P",
    amount_sats: 1_400_000,
    signals_included: 0,
    txid: "8266b6b92e89b19efb1e58bf45891cceae5ea20e660f1416c8f20e24308ea1e9",
    note: "Round B flat-daily arrears (Apr 10-20) — paid despite 0 platform editor_inclusion rows (Coda not registered as editor on platform); negotiated settlement per manifest. See db/payouts/2026-04-22-round-b-tracking.md",
  },
];

function main(): void {
  const db = new Database(DB_PATH);

  const insert = db.prepare(
    `INSERT INTO editor_payouts (
       date, beat_slug, editor_name,
       editor_btc_address, editor_stx_address,
       amount_sats, signals_included, spot_check_task_id,
       txid, status, created_at, sent_at, error
     ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 'sent', ?, ?, ?)
     ON CONFLICT(date, beat_slug) DO UPDATE SET
       txid = excluded.txid,
       status = 'sent',
       sent_at = excluded.sent_at,
       amount_sats = excluded.amount_sats,
       signals_included = excluded.signals_included,
       error = excluded.error`
  );

  let written = 0;
  for (const row of ROWS) {
    insert.run(
      SETTLEMENT_DATE,
      row.beat_slug,
      row.editor_name,
      row.editor_btc_address,
      row.editor_stx_address,
      row.amount_sats,
      row.signals_included,
      row.txid,
      SETTLEMENT_SENT_AT,
      SETTLEMENT_SENT_AT,
      row.note,
    );
    written++;
    console.log(`  ✓ ${row.beat_slug.padEnd(15)} ${row.editor_name.padEnd(14)} ${row.amount_sats.toLocaleString().padStart(10)} sats  tx=${row.txid.slice(0, 12)}…`);
  }

  console.log(`\nBackfilled ${written} editor_payouts row(s) for settlement ${SETTLEMENT_DATE}`);

  // Verify
  const result = db.query(
    "SELECT beat_slug, editor_name, amount_sats, status, txid FROM editor_payouts WHERE date = ? ORDER BY beat_slug"
  ).all(SETTLEMENT_DATE) as Array<{ beat_slug: string; editor_name: string; amount_sats: number; status: string; txid: string }>;

  const total = result.reduce((sum, r) => sum + r.amount_sats, 0);
  console.log(`Total settled: ${total.toLocaleString()} sats across ${result.length} editors`);

  db.close();
}

main();
