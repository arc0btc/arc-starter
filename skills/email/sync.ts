// skills/email/sync.ts
// Syncs email messages from arc-email-worker API to the local database.
// Called by sensor.ts on each run. Can also be run standalone via CLI.

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

// ---- Constants ----

const FETCH_TIMEOUT_MS = 10_000;

// ---- Helpers ----

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [email/sync] ${msg}`);
}

export async function getEmailCredentials(): Promise<{ apiBaseUrl: string; adminKey: string }> {
  const apiBaseUrl = await getCredential("email", "api_base_url");
  const adminKey = await getCredential("email", "admin_api_key");
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

async function fetchFolder(
  apiBaseUrl: string,
  adminKey: string,
  folder: string,
  limit: number,
): Promise<ApiEmailRecord[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const url = `${apiBaseUrl}/api/messages?folder=${folder}&limit=${limit}`;
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

  const folders: Array<{ name: string; limit: number }> = [
    { name: "inbox", limit: 50 },
    { name: "sent", limit: 20 },
  ];

  for (const { name, limit } of folders) {
    try {
      const records = await fetchFolder(apiBaseUrl, adminKey, name, limit);
      for (const record of records) {
        upsertEmailMessage(toLocalMessage(record));
        stats.total_fetched++;
        if (existingIds.has(record.id)) {
          stats.updated++;
        } else {
          stats.new_count++;
        }
      }
    } catch (err) {
      const msg = `${name} fetch failed: ${err}`;
      stats.errors.push(msg);
      log(msg);
    }
  }

  log(
    `sync complete: ${stats.total_fetched} fetched, ${stats.new_count} new, ${stats.updated} updated, ${stats.errors.length} error(s)`
  );
  return stats;
}

// ---- Main (standalone run) ----

if (import.meta.main) {
  initDatabase();
  const stats = await syncEmail();
  console.log(JSON.stringify(stats, null, 2));
}
