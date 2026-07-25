// skills/nostr/engagement.ts
// Fetches engagement (kind:7 reactions, kind:1 replies via #e tag, kind:9735 zap
// receipts) for every event_id recorded in nostr_post_log and stores it in
// nostr_engagement (db/arc.sqlite). Read-only relay query — no wallet unlock needed
// (unlike post/pubkey in nostr-runner.ts), so this runs in-process from cli.ts.
//
// Usage (via cli.ts): arc skills run --name nostr -- engagement fetch

// @ts-expect-error vendored path has no .d.ts (mirrors nostr-runner.ts)
import { SimplePool } from "../../github/aibtcdev/aibtc-mcp-server/node_modules/nostr-tools/lib/esm/pool.js";

const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol"];
const WS_TIMEOUT_MS = 10_000;
const QUERY_BATCH_SIZE = 50; // relays commonly cap filter "#e" list length

interface RelayEvent {
  id: string;
  kind: number;
  pubkey: string;
  content: string;
  created_at: number;
  tags: string[][];
}

function eTagValues(event: RelayEvent): string[] {
  return event.tags.filter((t) => t[0] === "e").map((t) => t[1]);
}

// Zap receipts (kind 9735) carry the amount in the zap REQUEST embedded as JSON in
// the "description" tag, not on the receipt itself — best-effort extraction, in
// millisats. Returns null if absent/unparseable (still store the raw event).
function extractZapAmountMsats(event: RelayEvent): number | null {
  const description = event.tags.find((t) => t[0] === "description")?.[1];
  if (!description) return null;
  try {
    const zapRequest = JSON.parse(description);
    const amountTag = (zapRequest.tags as string[][] | undefined)?.find((t) => t[0] === "amount")?.[1];
    return amountTag ? Number(amountTag) : null;
  } catch {
    return null;
  }
}

async function ensureEngagementTable(): Promise<void> {
  const { initDatabase, getDatabase } = await import("../../src/db.ts");
  initDatabase();
  const db = getDatabase();
  db.run(
    `CREATE TABLE IF NOT EXISTS nostr_engagement (
       id TEXT PRIMARY KEY,
       post_event_id TEXT NOT NULL,
       kind INTEGER NOT NULL,
       from_pubkey TEXT NOT NULL,
       content TEXT,
       amount_msats INTEGER,
       created_at INTEGER NOT NULL,
       fetched_at TEXT NOT NULL
     )`,
  );
  db.run(`CREATE INDEX IF NOT EXISTS idx_nostr_engagement_post ON nostr_engagement (post_event_id)`);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface EngagementFetchResult {
  postsChecked: number;
  eventsSeen: number;
  eventsStored: number;
  byKind: Record<number, number>;
}

export async function fetchEngagement(): Promise<EngagementFetchResult> {
  await ensureEngagementTable();
  const { getDatabase } = await import("../../src/db.ts");
  const db = getDatabase();

  const posts = db
    .query("SELECT event_id FROM nostr_post_log WHERE event_id IS NOT NULL")
    .all() as { event_id: string }[];
  const eventIds = [...new Set(posts.map((p) => p.event_id))];

  const result: EngagementFetchResult = { postsChecked: eventIds.length, eventsSeen: 0, eventsStored: 0, byKind: {} };
  if (eventIds.length === 0) return result;

  const pool = new SimplePool();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO nostr_engagement
       (id, post_event_id, kind, from_pubkey, content, amount_msats, created_at, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const fetchedAt = new Date().toISOString();
  const knownIds = new Set(eventIds);

  try {
    for (const batch of chunk(eventIds, QUERY_BATCH_SIZE)) {
      const filter = { kinds: [1, 7, 9735], "#e": batch, limit: 500 };
      let events: RelayEvent[] = [];
      try {
        const timeout = new Promise<RelayEvent[]>((_, reject) => {
          setTimeout(() => reject(new Error("timeout")), WS_TIMEOUT_MS);
        });
        events = (await Promise.race([pool.querySync(DEFAULT_RELAYS, filter), timeout])) as RelayEvent[];
      } catch {
        continue; // relay batch unreachable/timed out — best-effort, try next batch
      }

      result.eventsSeen += events.length;
      for (const event of events) {
        // An event can reference multiple posts; attribute to every one of ours it tags.
        const referenced = eTagValues(event).filter((id) => knownIds.has(id));
        for (const postEventId of referenced) {
          const amountMsats = event.kind === 9735 ? extractZapAmountMsats(event) : null;
          const changes = insert.run(
            event.id,
            postEventId,
            event.kind,
            event.pubkey,
            event.content ?? null,
            amountMsats,
            event.created_at,
            fetchedAt,
          ).changes;
          if (changes > 0) {
            result.eventsStored += 1;
            result.byKind[event.kind] = (result.byKind[event.kind] ?? 0) + 1;
          }
        }
      }
    }
  } finally {
    pool.close(DEFAULT_RELAYS);
  }

  return result;
}
