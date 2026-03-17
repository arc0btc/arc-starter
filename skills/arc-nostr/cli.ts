#!/usr/bin/env bun
// skills/arc-nostr/cli.ts
// Nostr publishing CLI for Arc's identity.
// Usage: arc skills run --name arc-nostr -- <command> [flags]

import { getCredential, setCredential } from "../../src/credentials.ts";
import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  type EventTemplate,
  type VerifiedEvent,
} from "nostr-tools/pure";
import * as nip19 from "nostr-tools/nip19";
import { SimplePool } from "nostr-tools/pool";
import type { Filter } from "nostr-tools/filter";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol"];
const WS_TIMEOUT_MS = 10_000;
const QUERY_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        flags[key] = "true";
      } else {
        flags[key] = args[i + 1];
        i++;
      }
    }
  }
  return flags;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length !== 64) throw new Error("Private key must be 64 hex chars");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function loadPrivkey(): Promise<Uint8Array> {
  const hex = await getCredential("nostr", "private_key");
  if (!hex) {
    throw new Error(
      "Nostr private key not set.\nRun: arc skills run --name arc-nostr -- generate-key"
    );
  }
  return hexToBytes(hex);
}

function resolveHexPubkey(input: string): string {
  if (input.startsWith("npub")) {
    const decoded = nip19.decode(input);
    return decoded.data as string;
  }
  return input;
}

function createPool(): SimplePool {
  return new SimplePool();
}

async function publishToRelays(
  pool: SimplePool,
  event: VerifiedEvent,
  relays: string[]
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  await Promise.allSettled(
    relays.map(async (relay) => {
      try {
        const pubPromises = pool.publish([relay], event);
        await Promise.race([
          ...pubPromises,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), WS_TIMEOUT_MS)
          ),
        ]);
        results[relay] = "ok";
      } catch (error: unknown) {
        results[relay] = `error: ${error instanceof Error ? error.message : String(error)}`;
      }
    })
  );
  return results;
}

async function queryRelays(
  pool: SimplePool,
  relays: string[],
  filter: Filter
): Promise<VerifiedEvent[]> {
  return Promise.race([
    pool.querySync(relays, filter) as Promise<VerifiedEvent[]>,
    new Promise<VerifiedEvent[]>((_, reject) =>
      setTimeout(() => reject(new Error("query timeout")), QUERY_TIMEOUT_MS)
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdGenerateKey(): Promise<void> {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const npub = nip19.npubEncode(pubkey);
  const hex = bytesToHex(sk);

  await setCredential("nostr", "private_key", hex);

  console.log(JSON.stringify({ pubkey, npub, stored: true }, null, 2));
}

async function cmdImportKey(flags: Record<string, string>): Promise<void> {
  const hex = flags["hex"];
  if (!hex) {
    console.error("Error: --hex is required");
    process.exit(1);
  }
  const sk = hexToBytes(hex);
  const pubkey = getPublicKey(sk);
  const npub = nip19.npubEncode(pubkey);

  await setCredential("nostr", "private_key", hex);
  console.log(JSON.stringify({ pubkey, npub, stored: true }, null, 2));
}

async function cmdGetPubkey(): Promise<void> {
  const sk = await loadPrivkey();
  const pubkey = getPublicKey(sk);
  const npub = nip19.npubEncode(pubkey);
  console.log(JSON.stringify({ pubkey, npub }, null, 2));
}

async function cmdPost(flags: Record<string, string>): Promise<void> {
  const content = flags["content"];
  if (!content) {
    console.error("Error: --content is required");
    process.exit(1);
  }

  const sk = await loadPrivkey();
  const hashtagTags: string[][] = flags["tags"]
    ? flags["tags"]
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => ["t", t.toLowerCase()])
    : [];

  const template: EventTemplate = {
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: hashtagTags,
    content,
  };

  const event = finalizeEvent(template, sk);
  const pool = createPool();
  const results = await publishToRelays(pool, event, DEFAULT_RELAYS);
  pool.close(DEFAULT_RELAYS);

  console.log(
    JSON.stringify(
      {
        eventId: event.id,
        pubkey: event.pubkey,
        createdAt: event.created_at,
        content: event.content,
        tags: event.tags,
        relays: results,
      },
      null,
      2
    )
  );
}

async function cmdFeed(flags: Record<string, string>): Promise<void> {
  const limit = parseInt(flags["limit"] ?? "20", 10);
  const pubkeyInput = flags["pubkey"];

  const pool = createPool();
  const filter: Filter = { kinds: [1], limit };

  if (pubkeyInput) {
    filter.authors = [resolveHexPubkey(pubkeyInput)];
  } else {
    // Default: Arc's own feed
    try {
      const sk = await loadPrivkey();
      filter.authors = [getPublicKey(sk)];
    } catch {
      // No key set — return global feed
    }
  }

  const events = await queryRelays(pool, DEFAULT_RELAYS, filter);
  pool.close(DEFAULT_RELAYS);

  const sorted = events
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((e) => ({
      id: e.id,
      pubkey: e.pubkey,
      npub: nip19.npubEncode(e.pubkey),
      createdAt: e.created_at,
      content: e.content,
      tags: e.tags,
    }));

  console.log(JSON.stringify({ count: sorted.length, events: sorted }, null, 2));
}

async function cmdSearch(flags: Record<string, string>): Promise<void> {
  const tagsInput = flags["tags"];
  if (!tagsInput) {
    console.error("Error: --tags is required");
    process.exit(1);
  }
  const limit = parseInt(flags["limit"] ?? "20", 10);
  const tagList = tagsInput
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  const pool = createPool();
  const filter: Filter = { kinds: [1], "#t": tagList, limit };
  const events = await queryRelays(pool, DEFAULT_RELAYS, filter);
  pool.close(DEFAULT_RELAYS);

  const sorted = events
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((e) => ({
      id: e.id,
      pubkey: e.pubkey,
      npub: nip19.npubEncode(e.pubkey),
      createdAt: e.created_at,
      content: e.content,
      tags: e.tags,
    }));

  console.log(
    JSON.stringify({ searchTags: tagList, count: sorted.length, events: sorted }, null, 2)
  );
}

async function cmdSetProfile(flags: Record<string, string>): Promise<void> {
  const sk = await loadPrivkey();
  const pubkey = getPublicKey(sk);
  const pool = createPool();

  // Fetch existing profile to preserve unset fields
  let existing: Record<string, unknown> = {};
  try {
    const events = await queryRelays(pool, DEFAULT_RELAYS, {
      kinds: [0],
      authors: [pubkey],
      limit: 1,
    });
    if (events.length > 0) {
      const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
      existing = JSON.parse(latest.content) as Record<string, unknown>;
    }
  } catch {
    // Proceed with empty profile if fetch fails
  }

  const updates: Record<string, unknown> = {};
  if (flags["name"] !== undefined) updates.name = flags["name"];
  if (flags["about"] !== undefined) updates.about = flags["about"];
  if (flags["picture"] !== undefined) updates.picture = flags["picture"];
  if (flags["website"] !== undefined) updates.website = flags["website"];
  if (flags["nip05"] !== undefined) updates.nip05 = flags["nip05"];

  const merged = { ...existing, ...updates };

  const template: EventTemplate = {
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify(merged),
  };

  const event = finalizeEvent(template, sk);
  const results = await publishToRelays(pool, event, DEFAULT_RELAYS);
  pool.close(DEFAULT_RELAYS);

  console.log(
    JSON.stringify(
      { eventId: event.id, pubkey: event.pubkey, profile: merged, relays: results },
      null,
      2
    )
  );
}

async function cmdGetProfile(flags: Record<string, string>): Promise<void> {
  let hexPubkey: string;

  if (flags["pubkey"]) {
    hexPubkey = resolveHexPubkey(flags["pubkey"]);
  } else {
    const sk = await loadPrivkey();
    hexPubkey = getPublicKey(sk);
  }

  const pool = createPool();
  const events = await queryRelays(pool, DEFAULT_RELAYS, {
    kinds: [0],
    authors: [hexPubkey],
    limit: 1,
  });
  pool.close(DEFAULT_RELAYS);

  if (events.length === 0) {
    console.log(
      JSON.stringify({ pubkey: hexPubkey, npub: nip19.npubEncode(hexPubkey), found: false }, null, 2)
    );
    return;
  }

  const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
  let profile: Record<string, unknown> = {};
  try {
    profile = JSON.parse(latest.content) as Record<string, unknown>;
  } catch {
    profile = { raw: latest.content };
  }

  console.log(
    JSON.stringify(
      {
        pubkey: hexPubkey,
        npub: nip19.npubEncode(hexPubkey),
        found: true,
        updatedAt: latest.created_at,
        profile,
      },
      null,
      2
    )
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const [command, ...rest] = process.argv.slice(2);
const flags = parseFlags(rest);

try {
  switch (command) {
    case "generate-key":
      await cmdGenerateKey();
      break;
    case "import-key":
      await cmdImportKey(flags);
      break;
    case "get-pubkey":
      await cmdGetPubkey();
      break;
    case "post":
      await cmdPost(flags);
      break;
    case "feed":
      await cmdFeed(flags);
      break;
    case "search":
      await cmdSearch(flags);
      break;
    case "set-profile":
      await cmdSetProfile(flags);
      break;
    case "get-profile":
      await cmdGetProfile(flags);
      break;
    default:
      console.error(
        `Unknown command: ${command ?? "(none)"}\n` +
          `Commands: generate-key, import-key, get-pubkey, post, feed, search, set-profile, get-profile`
      );
      process.exit(1);
  }
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
