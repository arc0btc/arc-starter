// skills/whop/lib/whop-api.ts
//
// Minimal read-side Whop API wrapper for sensor use. Write paths still live
// in skills/whop/cli.ts so dispatched tasks own the side-effect surface; the
// sensor stays read-only by construction.
//
// Auth: App API key (chat:read scope) via the encrypted credential store.
// Transport: the official @whop/sdk (Stainless-generated, versioned client) —
// the SDK prepends "Bearer " to the raw key and abstracts the v1/v2/v5 split.

import Whop from "@whop/sdk";
import { getCredential } from "../../../src/credentials.ts";
import type { ChatMessage } from "./relationships.ts";

export interface MessageListResponse {
  data: ChatMessage[];
  page_info?: {
    end_cursor: string | null;
    start_cursor: string | null;
    has_next_page: boolean;
    has_previous_page: boolean;
  };
}

// Shared SDK client factory. One place that constructs the client so the read
// side here and the write side in cli.ts (P3/P4) stay consistent — same timeout
// and retry posture. Pass the RAW key; the SDK adds the Bearer prefix.
//
// maxRetries: 0 preserves the legacy single-attempt read semantics (the old
// hand-rolled fetch never retried) and — critically — keeps the SHARED client
// safe for the P3 chat WRITE path: auto-retrying a non-idempotent POST /messages
// on a 5xx/timeout could double-post. P3 decides write retry posture explicitly,
// gated by source-dedup, rather than inheriting silent retries here.
export function whopClient(apiKey: string, maxRetries = 0): Whop {
  // Default maxRetries:0 keeps non-idempotent chat WRITES single-attempt (no double-post).
  // Idempotent READ lanes (e.g. the events poll) may pass a small retry count so a
  // transient 5xx on the now-live M0-detection poll doesn't silently no-op (forge 2026-06-16).
  return new Whop({ apiKey, timeout: 15_000, maxRetries });
}

export async function getAppApiKey(): Promise<string | null> {
  const key = await getCredential("whop", "app_api_key");
  return key || null;
}

/**
 * Fetch the most recent N messages from a chat channel. Newest-first (the SDK's
 * `first` page matches the legacy REST order exactly). Returns null if the API
 * key is missing or the request fails so the caller can no-op cleanly rather
 * than throwing. Shape ({ data, page_info }) is preserved for existing callers.
 */
export async function listMessages(
  channelId: string,
  apiKey: string,
  limit = 50,
): Promise<MessageListResponse | null> {
  try {
    const page = await whopClient(apiKey).messages.list({
      channel_id: channelId,
      first: limit,
    });
    return {
      data: page.data as unknown as ChatMessage[],
      page_info: page.page_info as MessageListResponse["page_info"],
    };
  } catch {
    return null;
  }
}
