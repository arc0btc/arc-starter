// skills/whop/lib/relationships.ts
//
// Lightweight persistent store for Whop chat counterparties. Reads/writes
// db/whop-relationships.json. Updated on every reactive-lane tick so the
// picture stays fresh; the reply task description loads a recipient's full
// blob so the dispatched session has the context the room lives in.
//
// Design rationale: skills/whop/POLLING-DESIGN.md → "Relationship tracking".

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

export const ARC_USER_ID = "user_cd5Q1fTcrgua1";

const STORE_PATH = resolve(import.meta.dir, "../../../db/whop-relationships.json");
const SNIPPET_CHARS = 120;
const MAX_RECENT_INTERACTIONS = 20;

export interface ChatUser {
  id: string;
  username?: string;
  name?: string;
}

export interface ChatMessage {
  id: string;
  content: string;
  created_at: string;
  replying_to_message_id: string | null;
  user: ChatUser;
}

export interface Interaction {
  at: string;            // ISO8601 from message created_at
  msg_id: string;
  direction: "from_user" | "from_arc";
  in_reply_to?: string;
  snippet: string;
}

export interface Relationship {
  user_id: string;
  username: string | null;
  display_name: string | null;
  first_seen: string;
  last_seen: string;
  message_count: number;
  arc_replies_to_them: number;
  their_replies_to_arc: number;
  recent_interactions: Interaction[];
  notes: string[];        // free-form, human-appendable
}

interface RelationshipStore {
  updated_at: string;
  users: Record<string, Relationship>;
}

function emptyStore(): RelationshipStore {
  return { updated_at: new Date(0).toISOString(), users: {} };
}

export function loadRelationships(): RelationshipStore {
  if (!existsSync(STORE_PATH)) return emptyStore();
  try {
    return JSON.parse(readFileSync(STORE_PATH, "utf8")) as RelationshipStore;
  } catch {
    // A corrupt file is recoverable; on next save we overwrite it. We do not
    // want a parse error to stall the sensor.
    return emptyStore();
  }
}

export function saveRelationships(store: RelationshipStore): void {
  store.updated_at = new Date().toISOString();
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2) + "\n", "utf8");
}

function snippet(content: string): string {
  const clean = content.replace(/\s+/g, " ").trim();
  return clean.length <= SNIPPET_CHARS ? clean : clean.slice(0, SNIPPET_CHARS) + "…";
}

function ensureUser(store: RelationshipStore, msg: ChatMessage): Relationship {
  const existing = store.users[msg.user.id];
  if (existing) return existing;
  const fresh: Relationship = {
    user_id: msg.user.id,
    username: msg.user.username ?? null,
    display_name: msg.user.name ?? null,
    first_seen: msg.created_at,
    last_seen: msg.created_at,
    message_count: 0,
    arc_replies_to_them: 0,
    their_replies_to_arc: 0,
    recent_interactions: [],
    notes: [],
  };
  store.users[msg.user.id] = fresh;
  return fresh;
}

function appendInteraction(rel: Relationship, interaction: Interaction): void {
  // Idempotent: don't double-count a message we already saw on a prior tick.
  if (rel.recent_interactions.some((i) => i.msg_id === interaction.msg_id)) return;
  rel.recent_interactions.push(interaction);
  rel.recent_interactions.sort((a, b) => a.at.localeCompare(b.at));
  if (rel.recent_interactions.length > MAX_RECENT_INTERACTIONS) {
    rel.recent_interactions = rel.recent_interactions.slice(-MAX_RECENT_INTERACTIONS);
  }
  rel.message_count += 1;
  if (interaction.direction === "from_user") {
    // The user replied to Arc iff their message threads to one Arc authored.
    if (interaction.in_reply_to && arcAuthoredMessageIds.has(interaction.in_reply_to)) {
      rel.their_replies_to_arc += 1;
    }
  }
}

// Per-tick scratch: which message IDs in the current window were authored by Arc.
// Used so we can detect "their reply to Arc" without re-fetching authorship.
const arcAuthoredMessageIds = new Set<string>();

/**
 * Update the store with a batch of messages (newest-first or any order — we
 * sort internally). Returns the set of user_ids that were touched, for the
 * artifact log.
 */
export function updateFromMessages(
  store: RelationshipStore,
  messages: ChatMessage[],
): string[] {
  // Pre-scan: remember which messages Arc authored so reply attribution works.
  arcAuthoredMessageIds.clear();
  for (const m of messages) {
    if (m.user.id === ARC_USER_ID) arcAuthoredMessageIds.add(m.id);
  }

  const touched = new Set<string>();
  // Process oldest-first so first_seen/last_seen settle correctly.
  const ordered = [...messages].sort((a, b) => a.created_at.localeCompare(b.created_at));

  for (const msg of ordered) {
    // Skip messages without an attributable user (system events, etc).
    if (!msg.user?.id) continue;

    // Arc's own messages count toward the OTHER party — i.e., update the
    // user-being-replied-to so they see "arc_replies_to_them" go up.
    if (msg.user.id === ARC_USER_ID) {
      if (!msg.replying_to_message_id) continue;
      // Find the recipient: scan the batch for the parent message's author.
      const parent = messages.find((m) => m.id === msg.replying_to_message_id);
      if (!parent || parent.user.id === ARC_USER_ID) continue;
      const rel = ensureUser(store, parent);
      rel.last_seen = max(rel.last_seen, msg.created_at);
      appendInteraction(rel, {
        at: msg.created_at,
        msg_id: msg.id,
        direction: "from_arc",
        in_reply_to: msg.replying_to_message_id,
        snippet: snippet(msg.content),
      });
      rel.arc_replies_to_them += 1;
      touched.add(parent.user.id);
      continue;
    }

    const rel = ensureUser(store, msg);
    rel.username = msg.user.username ?? rel.username;
    rel.display_name = msg.user.name ?? rel.display_name;
    rel.first_seen = min(rel.first_seen, msg.created_at);
    rel.last_seen = max(rel.last_seen, msg.created_at);
    appendInteraction(rel, {
      at: msg.created_at,
      msg_id: msg.id,
      direction: "from_user",
      in_reply_to: msg.replying_to_message_id ?? undefined,
      snippet: snippet(msg.content),
    });
    touched.add(msg.user.id);
  }

  return [...touched];
}

function min(a: string, b: string): string { return a < b ? a : b; }
function max(a: string, b: string): string { return a > b ? a : b; }

export function getRelationship(
  store: RelationshipStore,
  user_id: string,
): Relationship | null {
  return store.users[user_id] ?? null;
}

/**
 * Render a Relationship as a compact markdown block to drop into a reply
 * task description so the composer knows who they're talking to.
 */
export function renderRelationshipForTask(rel: Relationship): string {
  const handle = rel.username ? `@${rel.username}` : rel.user_id;
  const name = rel.display_name && rel.display_name !== rel.username
    ? ` (${rel.display_name})`
    : "";
  const header = `**Counterparty:** ${handle}${name}`;
  const tenure =
    rel.first_seen === rel.last_seen
      ? `First seen this tick (${rel.first_seen}).`
      : `Seen ${rel.first_seen} → ${rel.last_seen} | msgs=${rel.message_count} | their→arc=${rel.their_replies_to_arc} | arc→them=${rel.arc_replies_to_them}.`;
  const notes = rel.notes.length > 0 ? `\nNotes: ${rel.notes.join("; ")}` : "";
  const tail = rel.recent_interactions.slice(-10);
  const interactions = tail
    .map((i) => {
      const arrow = i.direction === "from_arc" ? "arc →" : "→ arc";
      const reply = i.in_reply_to ? ` [reply ${i.in_reply_to}]` : "";
      return `  - ${i.at} ${arrow}${reply}: ${i.snippet}`;
    })
    .join("\n");
  return [header, tenure + notes, "Recent thread:", interactions].join("\n");
}
