// skills/arc-email-sync/sync.ts
// Syncs email messages from arc-email-worker API to the local database.
// Called by sensor.ts on each run. Can also be run standalone via CLI.

import { join } from "node:path";
import {
  initDatabase,
  upsertEmailMessage,
  getAllEmailRemoteIds,
  type EmailMessage,
} from "../../src/db.ts";
import { getCredential } from "../../src/credentials.ts";

// ---- Types ----

interface ApiEmailRecord {
  id: string;
  message_id: string | null;
  in_reply_to: string | null;
  references: string | null;
  folder: string;
  from_address: string;
  from_name: string | null;
  to_address: string;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  raw_size: number | null;
  is_read: number;
  received_at: string;
  created_at: string;
}

interface ApiResponse {
  ok: boolean;
  data?: { messages: ApiEmailRecord[]; total: number };
  error?: { code: string; message: string };
}

export interface EmailSyncStats {
  total_fetched: number;
  new_count: number;
  updated: number;
  errors: string[];
}

interface SyncCursorState {
  inbox: string;
  sent: string;
}

// ---- Constants ----

const FETCH_TIMEOUT_MS = 10_000;
const MAX_PAGINATION_ITERS = 5;
const ROOT = new URL("../../", import.meta.url).pathname;
const STATE_FILE = join(ROOT, "db", "hook-state", "arc-email-sync.json");

// ---- Helpers ----

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [email/sync] ${msg}`);
}

export async function getEmailCredentials(): Promise<{ apiBaseUrl: string; adminKey: string }> {
  const apiBaseUrl = await getCredential("arc-email-sync", "api_base_url");
  const adminKey = await getCredential("arc-email-sync", "admin_api_key");
  if (!apiBaseUrl || !adminKey) {
    throw new Error("Missing email credentials (email/api_base_url or email/admin_api_key)");
  }
  return { apiBaseUrl, adminKey };
}

function toLocalMessage(record: ApiEmailRecord): Omit<EmailMessage, "id"> {
  const bodyPreview = record.body_text
    ? record.body_text.slice(0, 500)
    : record.body_html
      ? record.body_html.replace(/<[^>]*>/g, "").slice(0, 500)
      : null;

  return {
    remote_id: record.id,
    message_id: record.message_id,
    in_reply_to: record.in_reply_to ?? null,
    references_header: record.references ?? null,
    folder: record.folder,
    from_address: record.from_address,
    from_name: record.from_name,
    to_address: record.to_address,
    subject: record.subject,
    body_preview: bodyPreview,
    is_read: record.is_read,
    received_at: record.received_at,
    synced_at: new Date().toISOString(),
  };
}

async function loadCursorState(): Promise<SyncCursorState> {
  const file = Bun.file(STATE_FILE);
  if (await file.exists()) {
    return (await file.json()) as SyncCursorState;
  }
  // Cold start: initialize to NOW — do NOT backfill existing messages (already in local DB)
  const now = new Date().toISOString();
  log(`cold start: initializing since-cursor to ${now}`);
  return { inbox: now, sent: now };
}

async function saveCursorState(state: SyncCursorState): Promise<void> {
  await Bun.write(STATE_FILE, JSON.stringify(state, null, 2));
}

async function fetchPage(
  apiBaseUrl: string,
  adminKey: string,
  folder: string,
  limit: number,
  since: string,
  offset: number,
): Promise<ApiEmailRecord[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const url = `${apiBaseUrl}/api/messages?folder=${folder}&limit=${limit}&since=${encodeURIComponent(since)}&offset=${offset}`;
  const res = await fetch(url, {
    headers: { "X-Admin-Key": adminKey, Accept: "application/json" },
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!res.ok) throw new Error(`HTTP ${res.status} from email worker (${folder})`);

  const body = (await res.json()) as ApiResponse;
  if (!body.ok || !body.data) {
    throw new Error(body.error?.message ?? `Unexpected response shape (${folder})`);
  }
  return body.data.messages;
}

// Fetches all messages after cursor with offset-based pagination (hard cap: 5 pages).
// Worker filter is `received_at >= since`, so we add 1ms to cursor for strict > semantics.
async function fetchFolderSince(
  apiBaseUrl: string,
  adminKey: string,
  folder: string,
  limit: number,
  cursor: string,
): Promise<ApiEmailRecord[]> {
  const sinceParam = new Date(new Date(cursor).getTime() + 1).toISOString();
  const all: ApiEmailRecord[] = [];

  for (let iter = 0; iter < MAX_PAGINATION_ITERS; iter++) {
    const records = await fetchPage(apiBaseUrl, adminKey, folder, limit, sinceParam, iter * limit);
    all.push(...records);
    if (records.length < limit) break;
  }

  return all;
}

// ---- Main sync ----

export async function syncEmail(): Promise<EmailSyncStats> {
  const stats: EmailSyncStats = {
    total_fetched: 0,
    new_count: 0,
    updated: 0,
    errors: [],
  };

  let apiBaseUrl: string;
  let adminKey: string;
  try {
    ({ apiBaseUrl, adminKey } = await getEmailCredentials());
  } catch (err) {
    const msg = `credential fetch failed: ${err}`;
    stats.errors.push(msg);
    log(msg);
    return stats;
  }

  const existingIds = getAllEmailRemoteIds();
  const cursorState = await loadCursorState();
  const updatedCursor = { ...cursorState };

  const folders: Array<{ name: keyof SyncCursorState; limit: number }> = [
    { name: "inbox", limit: 50 },
    { name: "sent", limit: 20 },
  ];

  for (const { name, limit } of folders) {
    try {
      const records = await fetchFolderSince(apiBaseUrl, adminKey, name, limit, cursorState[name]);
      for (const record of records) {
        upsertEmailMessage(toLocalMessage(record));
        stats.total_fetched++;
        if (existingIds.has(record.id)) {
          stats.updated++;
        } else {
          stats.new_count++;
        }
      }
      // Advance cursor to MAX(received_at) of returned messages; never go backward
      if (records.length > 0) {
        const maxReceivedAt = records.reduce(
          (max, r) => (r.received_at > max ? r.received_at : max),
          records[0].received_at,
        );
        if (maxReceivedAt > updatedCursor[name]) {
          updatedCursor[name] = maxReceivedAt;
          log(`${name} cursor → ${maxReceivedAt} (${records.length} message(s) fetched)`);
        }
      } else {
        log(`${name}: no new messages since ${cursorState[name]}`);
      }
    } catch (err) {
      const msg = `${name} fetch failed: ${err}`;
      stats.errors.push(msg);
      log(msg);
    }
  }

  await saveCursorState(updatedCursor);

  log(
    `sync complete: ${stats.total_fetched} fetched, ${stats.new_count} new, ${stats.updated} updated, ${stats.errors.length} error(s)`,
  );
  return stats;
}

// ---- Main (standalone run) ----

if (import.meta.main) {
  initDatabase();
  const stats = await syncEmail();
  console.log(JSON.stringify(stats, null, 2));
}
