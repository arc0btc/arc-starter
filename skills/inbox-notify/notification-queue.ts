// skills/inbox-notify/notification-queue.ts
// Lightweight notification queue — write at review time, batch at sensor time.

import { resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const ROOT = resolve(import.meta.dir, "../..");
const QUEUE_DIR = resolve(ROOT, "db/inbox-notify");
const QUEUE_FILE = resolve(QUEUE_DIR, "pending-notifications.json");

export interface PendingNotification {
  type: "notify" | "erc8004-feedback" | "erc8004-nudge";
  signal_id: string;
  status: "approved" | "rejected";
  btc_address: string;
  stx_address: string;
  content: string;         // pre-composed message for x402 send
  label: string;           // display label for logging
  agent_id?: number;       // for erc8004-feedback
  reputation_value?: number; // 1 or -1
  reputation_tags?: string[];
  nudge_number?: number;   // 1-3 for nudge tracking
  created_at: string;
}

interface QueueState {
  notifications: PendingNotification[];
}

function readQueue(): QueueState {
  mkdirSync(QUEUE_DIR, { recursive: true });
  if (!existsSync(QUEUE_FILE)) return { notifications: [] };
  try {
    return JSON.parse(readFileSync(QUEUE_FILE, "utf-8")) as QueueState;
  } catch {
    return { notifications: [] };
  }
}

function writeQueue(state: QueueState): void {
  mkdirSync(QUEUE_DIR, { recursive: true });
  writeFileSync(QUEUE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Add a notification to the pending queue. Called at signal review time.
 * Returns true if added, false if duplicate (same signal_id + type).
 */
export function enqueueNotification(notification: PendingNotification): boolean {
  const state = readQueue();
  const exists = state.notifications.some(
    n => n.signal_id === notification.signal_id && n.type === notification.type
  );
  if (exists) return false;
  state.notifications.push(notification);
  writeQueue(state);
  return true;
}

/**
 * Drain up to `limit` notifications of a given type from the queue.
 * Returns the drained items and removes them from the file.
 */
export function drainNotifications(type: "notify" | "erc8004-feedback" | "erc8004-nudge", limit: number): PendingNotification[] {
  const state = readQueue();
  const matching = state.notifications.filter(n => n.type === type);
  const batch = matching.slice(0, limit);
  if (batch.length === 0) return [];

  const batchIds = new Set(batch.map(n => `${n.signal_id}:${n.type}`));
  state.notifications = state.notifications.filter(
    n => !batchIds.has(`${n.signal_id}:${n.type}`)
  );
  writeQueue(state);
  return batch;
}

/**
 * Count pending notifications by type.
 */
export function countPending(): { notify: number; feedback: number; nudge: number; total: number } {
  const state = readQueue();
  const notify = state.notifications.filter(n => n.type === "notify").length;
  const feedback = state.notifications.filter(n => n.type === "erc8004-feedback").length;
  const nudge = state.notifications.filter(n => n.type === "erc8004-nudge").length;
  return { notify, feedback, nudge, total: notify + feedback + nudge };
}
