/**
 * AIBTC Inbox Sensor
 *
 * Polls the AIBTC inbox API for new messages every minute, filtering
 * out already-processed messages using the SQLite event_history dedup system.
 *
 * Pattern:
 * - GET messages from aibtc.com/api/inbox/{stxAddress}
 * - Check each message ID against event_history dedup_key
 * - Emit sensor:observation only for new (unprocessed) messages
 * - Store processed message IDs as dedup_key entries in event_history
 *
 * Deduplication strategy:
 * Each processed inbox message is recorded in event_history with a
 * dedup_key of "inbox:{messageId}". On the next poll, writeEvent()
 * silently skips duplicate inserts (INSERT OR IGNORE), so we count
 * rows inserted — if 0, the message was already seen.
 *
 * Registration (add to src/index.ts):
 * ```typescript
 * import { observeInbox } from "./sensors/aibtc-inbox";
 * import { scheduler, minutes } from "./server/scheduler";
 *
 * scheduler.register({
 *   name: "aibtc-inbox",
 *   intervalMs: minutes(1),
 *   fn: observeInbox,
 * });
 * ```
 */

import { eventBus } from "../server/events";
import { writeEvent } from "../memory/event-history";

/**
 * AIBTC config shape (subset of config/example-config.json)
 */
interface AibtcConfig {
  stxAddress?: string;
  aibtcApiBase?: string;
}

/**
 * A single inbox message from the AIBTC API
 */
export interface InboxMessage {
  id: string;
  from: string;
  to: string;
  subject?: string;
  body: string;
  sentAt: string;
  readAt?: string | null;
}

/**
 * Data emitted in a sensor:observation for new inbox messages
 */
export interface InboxObservationData {
  stxAddress: string;
  newMessages: InboxMessage[];
  totalFetched: number;
  skippedDuplicates: number;
  error?: string;
}

/**
 * Observation returned by this sensor
 */
export interface InboxObservation {
  source: "aibtc-inbox";
  timestamp: number;
  data: InboxObservationData;
}

/**
 * Load AIBTC config from the project config file.
 * Falls back gracefully if the file doesn't exist or is missing keys.
 */
async function loadConfig(): Promise<AibtcConfig> {
  try {
    const configPath = new URL("../../config/config.json", import.meta.url);
    const file = Bun.file(configPath);
    if (!(await file.exists())) {
      const examplePath = new URL(
        "../../config/example-config.json",
        import.meta.url
      );
      const example = await Bun.file(examplePath).json();
      return (example.aibtc as AibtcConfig) ?? {};
    }
    const config = await file.json();
    return (config.aibtc as AibtcConfig) ?? {};
  } catch {
    return {};
  }
}

/**
 * Fetch messages from the AIBTC inbox API.
 * Returns raw message array or throws on network error.
 */
async function fetchInboxMessages(
  apiBase: string,
  stxAddress: string,
  limit: number = 20
): Promise<InboxMessage[]> {
  const url = `${apiBase}/inbox/${encodeURIComponent(stxAddress)}?view=received&limit=${limit}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000), // 15s timeout
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const body = (await response.json()) as unknown;

  // API may return { messages: [...] } or a bare array
  if (Array.isArray(body)) return body as InboxMessage[];
  if (
    body &&
    typeof body === "object" &&
    "messages" in body &&
    Array.isArray((body as { messages: unknown[] }).messages)
  ) {
    return (body as { messages: InboxMessage[] }).messages;
  }

  return [];
}

/**
 * Observe: poll the AIBTC inbox and emit new messages.
 *
 * Uses the SQLite event_history dedup_key system to avoid re-emitting
 * messages that have already been processed. Each new message gets a
 * dedup_key of "inbox:{messageId}" written to event_history.
 *
 * Returns an observation even when there are no new messages (empty array).
 * Skips gracefully if stxAddress is not configured.
 */
export async function observeInbox(): Promise<InboxObservation> {
  const config = await loadConfig();
  const now = Date.now();
  const timestamp = new Date(now).toISOString();

  // Fail gracefully if not configured
  if (!config.stxAddress) {
    const observation: InboxObservation = {
      source: "aibtc-inbox",
      timestamp: now,
      data: {
        stxAddress: "",
        newMessages: [],
        totalFetched: 0,
        skippedDuplicates: 0,
        error: "not configured: missing aibtc.stxAddress in config",
      },
    };
    return observation;
  }

  const apiBase = config.aibtcApiBase ?? "https://aibtc.com/api";
  const stxAddress = config.stxAddress;

  let newMessages: InboxMessage[] = [];
  let totalFetched = 0;
  let skippedDuplicates = 0;
  let error: string | undefined;

  try {
    const messages = await fetchInboxMessages(apiBase, stxAddress);
    totalFetched = messages.length;

    for (const message of messages) {
      const dedupKey = `inbox:${message.id}`;

      // writeEvent returns null if dedup_key already exists (INSERT OR IGNORE)
      const inserted = writeEvent({
        timestamp,
        eventType: "sensor:observation",
        source: "aibtc-inbox",
        payload: { messageId: message.id, from: message.from },
        dedupKey,
      });

      if (inserted !== null) {
        // New message — add to the list to emit
        newMessages.push(message);
      } else {
        // Already processed in a previous poll
        skippedDuplicates++;
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const observationData: InboxObservationData = {
    stxAddress,
    newMessages,
    totalFetched,
    skippedDuplicates,
    ...(error ? { error } : {}),
  };

  const observation: InboxObservation = {
    source: "aibtc-inbox",
    timestamp: now,
    data: observationData,
  };

  // Only emit the event if there are new messages (avoid noise)
  if (newMessages.length > 0) {
    eventBus.emit("sensor:observation", {
      source: observation.source,
      data: observation.data,
    });
  }

  return observation;
}
