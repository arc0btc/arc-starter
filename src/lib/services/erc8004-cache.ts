/**
 * ERC-8004 Local Cache Store
 *
 * Sync-and-store layer backed by SQLite. Immutable data (identities, feedback)
 * is stored indefinitely. Mutable data (reputation summaries) uses synced_at
 * timestamps with a configurable staleness threshold.
 *
 * Pattern follows contact-registry backfill: fetch from chain → upsert locally.
 */

import { getDatabase, toSqliteDatetime } from "../../db.js";
import type { IdentityInfo, ReputationSummary, FeedbackEntry } from "./erc8004.service.js";

// ============================================================================
// Staleness thresholds
// ============================================================================

/** Reputation summaries older than this are considered stale (ms). */
const REPUTATION_STALE_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Identity cache (immutable — stored indefinitely)
// ============================================================================

export function getCachedIdentity(agentId: number): IdentityInfo | null {
  const db = getDatabase();
  const row = db.query(
    "SELECT agent_id, owner, uri, wallet FROM erc8004_identities WHERE agent_id = ?"
  ).get(agentId) as { agent_id: number; owner: string; uri: string; wallet: string | null } | null;

  if (!row) return null;

  return {
    agentId: row.agent_id,
    owner: row.owner,
    uri: row.uri,
    wallet: row.wallet ?? undefined,
  };
}

export function upsertIdentity(identity: IdentityInfo): void {
  const db = getDatabase();
  const now = toSqliteDatetime(new Date());
  db.run(
    `INSERT INTO erc8004_identities (agent_id, owner, uri, wallet, synced_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(agent_id) DO UPDATE SET
       owner = excluded.owner,
       uri = excluded.uri,
       wallet = excluded.wallet,
       synced_at = excluded.synced_at`,
    [identity.agentId, identity.owner, identity.uri, identity.wallet ?? null, now]
  );
}

// ============================================================================
// Feedback cache (immutable — stored indefinitely, revocation updates in place)
// ============================================================================

export interface CachedFeedback extends FeedbackEntry {
  agentId: number;
  index: number;
}

export function getCachedFeedback(agentId: number, client: string, index: number): CachedFeedback | null {
  const db = getDatabase();
  const row = db.query(
    `SELECT agent_id, client, feedback_index, value, value_decimals, wad_value, tag1, tag2, is_revoked
     FROM erc8004_feedback
     WHERE agent_id = ? AND client = ? AND feedback_index = ?`
  ).get(agentId, client, index) as {
    agent_id: number; client: string; feedback_index: number;
    value: number; value_decimals: number; wad_value: string;
    tag1: string; tag2: string; is_revoked: number;
  } | null;

  if (!row) return null;

  return {
    agentId: row.agent_id,
    client: row.client,
    index: row.feedback_index,
    value: row.value,
    valueDecimals: row.value_decimals,
    wadValue: row.wad_value,
    tag1: row.tag1,
    tag2: row.tag2,
    isRevoked: row.is_revoked === 1,
  };
}

export function getAllCachedFeedback(agentId: number): CachedFeedback[] {
  const db = getDatabase();
  const rows = db.query(
    `SELECT agent_id, client, feedback_index, value, value_decimals, wad_value, tag1, tag2, is_revoked
     FROM erc8004_feedback
     WHERE agent_id = ?
     ORDER BY feedback_index ASC`
  ).all(agentId) as Array<{
    agent_id: number; client: string; feedback_index: number;
    value: number; value_decimals: number; wad_value: string;
    tag1: string; tag2: string; is_revoked: number;
  }>;

  return rows.map((row) => ({
    agentId: row.agent_id,
    client: row.client,
    index: row.feedback_index,
    value: row.value,
    valueDecimals: row.value_decimals,
    wadValue: row.wad_value,
    tag1: row.tag1,
    tag2: row.tag2,
    isRevoked: row.is_revoked === 1,
  }));
}

export function upsertFeedback(agentId: number, client: string, index: number, entry: FeedbackEntry): void {
  const db = getDatabase();
  const now = toSqliteDatetime(new Date());
  db.run(
    `INSERT INTO erc8004_feedback
       (agent_id, client, feedback_index, value, value_decimals, wad_value, tag1, tag2, is_revoked, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(agent_id, client, feedback_index) DO UPDATE SET
       value = excluded.value,
       value_decimals = excluded.value_decimals,
       wad_value = excluded.wad_value,
       tag1 = excluded.tag1,
       tag2 = excluded.tag2,
       is_revoked = excluded.is_revoked,
       synced_at = excluded.synced_at`,
    [agentId, client, index, entry.value, entry.valueDecimals, entry.wadValue,
     entry.tag1, entry.tag2, entry.isRevoked ? 1 : 0, now]
  );
}

// ============================================================================
// Reputation cache (mutable — uses synced_at staleness)
// ============================================================================

export function getCachedReputation(agentId: number): ReputationSummary | null {
  const db = getDatabase();
  const row = db.query(
    `SELECT agent_id, total_feedback, summary_value, summary_value_decimals, synced_at
     FROM erc8004_reputation
     WHERE agent_id = ?`
  ).get(agentId) as {
    agent_id: number; total_feedback: number; summary_value: string;
    summary_value_decimals: number; synced_at: string;
  } | null;

  if (!row) return null;

  // Check staleness
  const syncedAt = new Date(row.synced_at + "Z").getTime();
  if (Date.now() - syncedAt > REPUTATION_STALE_MS) return null;

  return {
    agentId: row.agent_id,
    totalFeedback: row.total_feedback,
    summaryValue: row.summary_value,
    summaryValueDecimals: row.summary_value_decimals,
  };
}

export function upsertReputation(rep: ReputationSummary): void {
  const db = getDatabase();
  const now = toSqliteDatetime(new Date());
  db.run(
    `INSERT INTO erc8004_reputation (agent_id, total_feedback, summary_value, summary_value_decimals, synced_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(agent_id) DO UPDATE SET
       total_feedback = excluded.total_feedback,
       summary_value = excluded.summary_value,
       summary_value_decimals = excluded.summary_value_decimals,
       synced_at = excluded.synced_at`,
    [rep.agentId, rep.totalFeedback, rep.summaryValue, rep.summaryValueDecimals, now]
  );
}

// ============================================================================
// Bulk helpers (for sync command)
// ============================================================================

/** Returns the count of cached identities. */
export function getCachedIdentityCount(): number {
  const db = getDatabase();
  const row = db.query("SELECT COUNT(*) as count FROM erc8004_identities").get() as { count: number };
  return row.count;
}

/** Returns the count of cached feedback entries for an agent. */
export function getCachedFeedbackCount(agentId: number): number {
  const db = getDatabase();
  const row = db.query(
    "SELECT COUNT(*) as count FROM erc8004_feedback WHERE agent_id = ?"
  ).get(agentId) as { count: number };
  return row.count;
}

/** Returns all cached agent IDs. */
export function getAllCachedAgentIds(): number[] {
  const db = getDatabase();
  const rows = db.query("SELECT agent_id FROM erc8004_identities ORDER BY agent_id ASC").all() as Array<{ agent_id: number }>;
  return rows.map((r) => r.agent_id);
}
