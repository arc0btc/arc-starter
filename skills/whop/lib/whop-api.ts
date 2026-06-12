// skills/whop/lib/whop-api.ts
//
// Minimal read-side Whop API wrapper for sensor use. Write paths still live
// in skills/whop/cli.ts so dispatched tasks own the side-effect surface; the
// sensor stays read-only by construction.
//
// Auth: App API key (chat:read scope) via the encrypted credential store.

import { getCredential } from "../../../src/credentials.ts";
import type { ChatMessage } from "./relationships.ts";

const API_BASE = "https://api.whop.com/api";

export interface MessageListResponse {
  data: ChatMessage[];
  page_info?: {
    end_cursor: string | null;
    start_cursor: string | null;
    has_next_page: boolean;
    has_previous_page: boolean;
  };
}

export async function getAppApiKey(): Promise<string | null> {
  const key = await getCredential("whop", "app_api_key");
  return key || null;
}

/**
 * Fetch the most recent N messages from a chat channel. Newest-first by
 * default. Returns null if the API key is missing or the request fails so
 * the caller can no-op cleanly rather than throwing.
 */
export async function listMessages(
  channelId: string,
  apiKey: string,
  limit = 50,
): Promise<MessageListResponse | null> {
  try {
    const url = `${API_BASE}/v1/messages?channel_id=${encodeURIComponent(channelId)}&limit=${limit}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as MessageListResponse;
  } catch {
    return null;
  }
}
