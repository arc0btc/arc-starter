/**
 * Event History
 *
 * Append-only typed event stream. Every meaningful eventBus.emit()
 * is recorded here with timestamp, type, source, and JSON payload.
 *
 * This is the observability bridge: query-tools can SELECT from this
 * table to answer "what has the agent observed/done in the last hour?"
 *
 * Deduplication: pass a dedup_key to skip exact-duplicate events
 * (e.g., sensors that might emit the same observation twice).
 */

import { getDb } from "./db";
import type { EventPayloads } from "../server/events";

/**
 * Input for writing an event history record
 */
export interface EventHistoryInput {
  timestamp: string;
  eventType: keyof EventPayloads | string;
  source?: string;
  cycleNum?: number;
  payload?: unknown;
  dedupKey?: string;
}

/**
 * A row from event_history
 */
export interface EventHistoryRow {
  id: number;
  timestamp: string;
  eventType: string;
  source: string | null;
  cycleNum: number | null;
  payload: unknown;
  dedupKey: string | null;
}

/**
 * Write an event to the history table.
 * If dedupKey is provided and already exists, silently skips insertion.
 * Returns the inserted row ID, or null if skipped due to deduplication.
 */
export function writeEvent(input: EventHistoryInput): number | null {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO event_history (
      timestamp, event_type, source, cycle_num, payload, dedup_key
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.timestamp,
    input.eventType,
    input.source ?? null,
    input.cycleNum ?? null,
    input.payload !== undefined ? JSON.stringify(input.payload) : null,
    input.dedupKey ?? null
  );

  // If no rows were changed (INSERT OR IGNORE skipped), return null
  if (result.changes === 0) return null;

  return Number(result.lastInsertRowid);
}

/**
 * Query recent events, optionally filtered by event type.
 */
export function queryEventHistory(
  eventType?: string,
  count: number = 20
): EventHistoryRow[] {
  const db = getDb();

  let sql: string;
  let params: unknown[];

  if (eventType) {
    sql = `
      SELECT id, timestamp, event_type, source, cycle_num, payload, dedup_key
      FROM event_history
      WHERE event_type = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `;
    params = [eventType, count];
  } else {
    sql = `
      SELECT id, timestamp, event_type, source, cycle_num, payload, dedup_key
      FROM event_history
      ORDER BY timestamp DESC
      LIMIT ?
    `;
    params = [count];
  }

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as Record<string, unknown>[];
  return rows.map(mapEventRow);
}

/**
 * Query events for a specific cycle (post-mortem debugging).
 */
export function queryEventsByCycle(cycleNum: number): EventHistoryRow[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, timestamp, event_type, source, cycle_num, payload, dedup_key
    FROM event_history
    WHERE cycle_num = ?
    ORDER BY timestamp ASC
  `);

  const rows = stmt.all(cycleNum) as Record<string, unknown>[];
  return rows.map(mapEventRow);
}

/**
 * Query events within a time window.
 */
export function queryEventsAfter(
  isoTimestamp: string,
  eventType?: string
): EventHistoryRow[] {
  const db = getDb();

  let sql: string;
  let params: unknown[];

  if (eventType) {
    sql = `
      SELECT id, timestamp, event_type, source, cycle_num, payload, dedup_key
      FROM event_history
      WHERE timestamp > ? AND event_type = ?
      ORDER BY timestamp DESC
    `;
    params = [isoTimestamp, eventType];
  } else {
    sql = `
      SELECT id, timestamp, event_type, source, cycle_num, payload, dedup_key
      FROM event_history
      WHERE timestamp > ?
      ORDER BY timestamp DESC
    `;
    params = [isoTimestamp];
  }

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as Record<string, unknown>[];
  return rows.map(mapEventRow);
}

/**
 * Map a raw SQLite row to an EventHistoryRow
 */
function mapEventRow(row: Record<string, unknown>): EventHistoryRow {
  return {
    id: row.id as number,
    timestamp: row.timestamp as string,
    eventType: row.event_type as string,
    source: (row.source as string) ?? null,
    cycleNum: (row.cycle_num as number) ?? null,
    payload: row.payload ? JSON.parse(row.payload as string) : null,
    dedupKey: (row.dedup_key as string) ?? null,
  };
}
