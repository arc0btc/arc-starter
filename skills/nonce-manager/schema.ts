// skills/nonce-manager/schema.ts
// SQLite-backed receipt store for nonces that have been released as "broadcast".
// The reconciler polls these to confirm settlement or detect rejection.

import { Database } from "bun:sqlite";
import { initDatabase } from "../../src/db";

export interface NonceBroadcast {
  id: number;
  address: string;
  nonce: number;
  source: string;             // "x402-relay" | "direct"
  payment_id: string | null;  // x402 sponsor relay payment/receipt id
  txid: string | null;        // chain-side broadcast txid (when known)
  broadcast_at: string;
  last_polled_at: string | null;
  poll_count: number;
  status: string;             // "pending" | "confirmed" | "rejected" | "expired"
  settlement_status: string | null;
  block_height: number | null;
  last_error: string | null;
  context: string | null;     // JSON blob: caller-specified metadata (skill, batch_id, etc.)
}

export interface InsertNonceBroadcast {
  address: string;
  nonce: number;
  source: "x402-relay" | "direct";
  payment_id?: string | null;
  txid?: string | null;
  context?: string | null;
}

let _initialized = false;

export function initNonceManagerSchema(db?: Database): Database {
  const d = db ?? initDatabase();
  if (_initialized) return d;

  d.run(`
    CREATE TABLE IF NOT EXISTS nonce_broadcasts (
      id INTEGER PRIMARY KEY,
      address TEXT NOT NULL,
      nonce INTEGER NOT NULL,
      source TEXT NOT NULL,
      payment_id TEXT,
      txid TEXT,
      broadcast_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_polled_at TEXT,
      poll_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      settlement_status TEXT,
      block_height INTEGER,
      last_error TEXT,
      context TEXT,
      UNIQUE(address, nonce)
    )
  `);

  d.run("CREATE INDEX IF NOT EXISTS idx_nonce_broadcasts_status ON nonce_broadcasts(address, status)");
  d.run("CREATE INDEX IF NOT EXISTS idx_nonce_broadcasts_pending ON nonce_broadcasts(status, last_polled_at) WHERE status = 'pending'");

  _initialized = true;
  return d;
}

export function recordBroadcast(fields: InsertNonceBroadcast): number {
  const db = initNonceManagerSchema();
  const result = db
    .query(
      `INSERT INTO nonce_broadcasts (address, nonce, source, payment_id, txid, context)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(address, nonce) DO UPDATE SET
         source = excluded.source,
         payment_id = COALESCE(excluded.payment_id, nonce_broadcasts.payment_id),
         txid = COALESCE(excluded.txid, nonce_broadcasts.txid),
         context = COALESCE(excluded.context, nonce_broadcasts.context),
         status = 'pending',
         broadcast_at = datetime('now')
       RETURNING id`,
    )
    .get(
      fields.address,
      fields.nonce,
      fields.source,
      fields.payment_id ?? null,
      fields.txid ?? null,
      fields.context ?? null,
    ) as { id: number };
  return result.id;
}

export function getPendingBroadcasts(address?: string): NonceBroadcast[] {
  const db = initNonceManagerSchema();
  if (address) {
    return db
      .query("SELECT * FROM nonce_broadcasts WHERE status = 'pending' AND address = ? ORDER BY broadcast_at ASC")
      .all(address) as NonceBroadcast[];
  }
  return db
    .query("SELECT * FROM nonce_broadcasts WHERE status = 'pending' ORDER BY broadcast_at ASC")
    .all() as NonceBroadcast[];
}

export function getBroadcast(address: string, nonce: number): NonceBroadcast | null {
  const db = initNonceManagerSchema();
  return db
    .query("SELECT * FROM nonce_broadcasts WHERE address = ? AND nonce = ?")
    .get(address, nonce) as NonceBroadcast | null;
}

export interface UpdateBroadcastFields {
  status?: "pending" | "confirmed" | "rejected" | "expired";
  txid?: string | null;
  settlement_status?: string | null;
  block_height?: number | null;
  last_error?: string | null;
  bumpPoll?: boolean;
}

export function updateBroadcast(id: number, fields: UpdateBroadcastFields): void {
  const db = initNonceManagerSchema();
  const cols: string[] = [];
  const values: unknown[] = [];

  if (fields.status !== undefined) {
    cols.push("status = ?");
    values.push(fields.status);
  }
  if (fields.txid !== undefined) {
    cols.push("txid = ?");
    values.push(fields.txid);
  }
  if (fields.settlement_status !== undefined) {
    cols.push("settlement_status = ?");
    values.push(fields.settlement_status);
  }
  if (fields.block_height !== undefined) {
    cols.push("block_height = ?");
    values.push(fields.block_height);
  }
  if (fields.last_error !== undefined) {
    cols.push("last_error = ?");
    values.push(fields.last_error);
  }
  if (fields.bumpPoll) {
    cols.push("last_polled_at = datetime('now')");
    cols.push("poll_count = poll_count + 1");
  }

  if (cols.length === 0) return;

  values.push(id);
  db.query(`UPDATE nonce_broadcasts SET ${cols.join(", ")} WHERE id = ?`).run(...values as never[]);
}
