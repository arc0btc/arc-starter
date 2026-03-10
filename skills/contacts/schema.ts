// skills/contacts/schema.ts
// Contact management schema: contacts, contact_links, contact_interactions
// Importable by other skills for cross-referencing contacts.

import { Database } from "bun:sqlite";
import { initDatabase } from "../../src/db";

// ---- Types ----

export interface Contact {
  id: number;
  display_name: string | null;
  aibtc_name: string | null;
  bns_name: string | null;
  type: string;              // "agent" | "human"
  status: string;            // "active" | "inactive" | "archived"
  visibility: string;        // "public" | "private"
  stx_address: string | null;
  btc_address: string | null;
  taproot_address: string | null;
  github_handle: string | null;
  x_handle: string | null;
  email: string | null;
  website: string | null;
  agent_id: string | null;
  operator_contact_id: number | null;
  x402_endpoint: string | null;
  aibtc_beat: string | null;
  aibtc_level: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface InsertContact {
  display_name?: string | null;
  aibtc_name?: string | null;
  bns_name?: string | null;
  type?: string;
  status?: string;
  visibility?: string;
  stx_address?: string | null;
  btc_address?: string | null;
  taproot_address?: string | null;
  github_handle?: string | null;
  x_handle?: string | null;
  email?: string | null;
  website?: string | null;
  agent_id?: string | null;
  operator_contact_id?: number | null;
  x402_endpoint?: string | null;
  aibtc_beat?: string | null;
  aibtc_level?: string | null;
  notes?: string | null;
}

export interface ContactLink {
  id: number;
  contact_a_id: number;
  contact_b_id: number;
  relationship: string;
  notes: string | null;
  created_at: string;
}

export interface InsertContactLink {
  contact_a_id: number;
  contact_b_id: number;
  relationship: string;
  notes?: string | null;
}

export interface ContactInteraction {
  id: number;
  contact_id: number;
  task_id: number | null;
  type: string;               // "message" | "collaboration" | "mention" | "meeting" | "other"
  summary: string;
  occurred_at: string;
  created_at: string;
}

export interface InsertContactInteraction {
  contact_id: number;
  task_id?: number | null;
  type: string;
  summary: string;
  occurred_at?: string;
}

// ---- Schema initialization ----

let _initialized = false;

export function initContactsSchema(db?: Database): Database {
  const d = db ?? initDatabase();
  if (_initialized) return d;

  d.run(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY,
      display_name TEXT,
      aibtc_name TEXT,
      bns_name TEXT,
      type TEXT NOT NULL DEFAULT 'human',
      status TEXT NOT NULL DEFAULT 'active',
      visibility TEXT NOT NULL DEFAULT 'public',
      stx_address TEXT,
      btc_address TEXT,
      taproot_address TEXT,
      github_handle TEXT,
      x_handle TEXT,
      email TEXT,
      website TEXT,
      agent_id TEXT,
      operator_contact_id INTEGER,
      x402_endpoint TEXT,
      aibtc_beat TEXT,
      aibtc_level TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (operator_contact_id) REFERENCES contacts(id)
    )
  `);

  d.run(`
    CREATE TABLE IF NOT EXISTS contact_links (
      id INTEGER PRIMARY KEY,
      contact_a_id INTEGER NOT NULL,
      contact_b_id INTEGER NOT NULL,
      relationship TEXT NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (contact_a_id) REFERENCES contacts(id),
      FOREIGN KEY (contact_b_id) REFERENCES contacts(id)
    )
  `);

  d.run(`
    CREATE TABLE IF NOT EXISTS contact_interactions (
      id INTEGER PRIMARY KEY,
      contact_id INTEGER NOT NULL,
      task_id INTEGER,
      type TEXT NOT NULL,
      summary TEXT NOT NULL,
      occurred_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (contact_id) REFERENCES contacts(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `);

  d.run("CREATE INDEX IF NOT EXISTS idx_contacts_type ON contacts(type)");
  d.run("CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status)");
  d.run("CREATE INDEX IF NOT EXISTS idx_contacts_aibtc_name ON contacts(aibtc_name)");
  d.run("CREATE INDEX IF NOT EXISTS idx_contacts_bns_name ON contacts(bns_name)");
  d.run("CREATE INDEX IF NOT EXISTS idx_contact_links_a ON contact_links(contact_a_id)");
  d.run("CREATE INDEX IF NOT EXISTS idx_contact_links_b ON contact_links(contact_b_id)");
  d.run("CREATE INDEX IF NOT EXISTS idx_contact_interactions_contact ON contact_interactions(contact_id)");
  d.run("CREATE INDEX IF NOT EXISTS idx_contact_interactions_type ON contact_interactions(type)");

  _initialized = true;
  return d;
}

// ---- Display name resolution ----

/** Returns best available name: display_name > aibtc_name > bns_name > "Contact #N" */
export function resolveDisplayName(c: Contact): string {
  return c.display_name || c.aibtc_name || c.bns_name || `Contact #${c.id}`;
}

// ---- Queries ----

export function getAllContacts(status?: string): Contact[] {
  const db = initContactsSchema();
  if (status) {
    return db.query("SELECT * FROM contacts WHERE status = ? ORDER BY id ASC").all(status) as Contact[];
  }
  return db.query("SELECT * FROM contacts ORDER BY id ASC").all() as Contact[];
}

export function getContactById(id: number): Contact | null {
  const db = initContactsSchema();
  return db.query("SELECT * FROM contacts WHERE id = ?").get(id) as Contact | null;
}

export function searchContacts(term: string): Contact[] {
  const db = initContactsSchema();
  const like = `%${term}%`;
  return db.query(`
    SELECT * FROM contacts
    WHERE display_name LIKE ? OR aibtc_name LIKE ? OR bns_name LIKE ?
      OR stx_address LIKE ? OR btc_address LIKE ?
      OR github_handle LIKE ? OR x_handle LIKE ? OR email LIKE ?
      OR agent_id LIKE ? OR notes LIKE ?
    ORDER BY id ASC
  `).all(like, like, like, like, like, like, like, like, like, like) as Contact[];
}

export function insertContact(fields: InsertContact): number {
  const db = initContactsSchema();
  const cols: string[] = [];
  const values: unknown[] = [];

  const allColumns: Array<keyof InsertContact> = [
    "display_name", "aibtc_name", "bns_name", "type", "status", "visibility",
    "stx_address", "btc_address", "taproot_address",
    "github_handle", "x_handle", "email", "website",
    "agent_id", "operator_contact_id", "x402_endpoint", "aibtc_beat", "aibtc_level",
    "notes",
  ];

  for (const col of allColumns) {
    if (fields[col] !== undefined) {
      cols.push(col);
      values.push(fields[col]);
    }
  }

  if (cols.length === 0) {
    throw new Error("At least one field required to create a contact");
  }

  const placeholders = cols.map(() => "?").join(", ");
  const result = db
    .query(`INSERT INTO contacts (${cols.join(", ")}) VALUES (${placeholders})`)
    .run(...values);
  return Number(result.lastInsertRowid);
}

export function updateContact(id: number, fields: Partial<InsertContact>): void {
  const db = initContactsSchema();
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  entries.push(["updated_at", new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "")]);
  const sets = entries.map(([k]) => `${k} = ?`);
  const values = [...entries.map(([, v]) => v), id];
  db.query(`UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function getContactLinks(contactId: number): Array<ContactLink & { peer: Contact }> {
  const db = initContactsSchema();
  const links = db.query(`
    SELECT * FROM contact_links WHERE contact_a_id = ? OR contact_b_id = ?
    ORDER BY created_at DESC
  `).all(contactId, contactId) as ContactLink[];

  return links.map((link) => {
    const peerId = link.contact_a_id === contactId ? link.contact_b_id : link.contact_a_id;
    const peer = db.query("SELECT * FROM contacts WHERE id = ?").get(peerId) as Contact;
    return { ...link, peer };
  });
}

export function insertContactLink(fields: InsertContactLink): number {
  const db = initContactsSchema();
  const result = db.query(
    "INSERT INTO contact_links (contact_a_id, contact_b_id, relationship, notes) VALUES (?, ?, ?, ?)"
  ).run(fields.contact_a_id, fields.contact_b_id, fields.relationship, fields.notes ?? null);
  return Number(result.lastInsertRowid);
}

export function getContactInteractions(contactId: number, limit: number = 20): ContactInteraction[] {
  const db = initContactsSchema();
  return db.query(
    "SELECT * FROM contact_interactions WHERE contact_id = ? ORDER BY occurred_at DESC LIMIT ?"
  ).all(contactId, limit) as ContactInteraction[];
}

/** Compact contact card for dispatch context injection. */
export interface ContactCard {
  id: number;
  name: string;
  type: string;
  beat: string | null;
  x_handle: string | null;
  stx_address: string | null;
  x402_endpoint: string | null;
  notes: string | null;
  score: number;
}

/**
 * Find contacts relevant to a task subject via keyword matching.
 * Tokenizes the subject into words (3+ chars), matches each against
 * display_name, aibtc_name, bns_name, aibtc_beat, notes, agent_id.
 * Returns compact cards sorted by relevance score (descending).
 */
export function getContextContacts(taskSubject: string, limit: number = 10): ContactCard[] {
  const db = initContactsSchema();

  // Tokenize: split on non-alphanumeric, keep words 3+ chars, lowercase
  const tokens = taskSubject
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 3);

  if (tokens.length === 0) return [];

  // Deduplicate tokens
  const uniqueTokens = [...new Set(tokens)];

  // Score each contact by how many tokens match across searchable fields
  const contacts = db.query("SELECT * FROM contacts WHERE status = 'active' ORDER BY id ASC").all() as Contact[];

  const scored: ContactCard[] = [];

  for (const c of contacts) {
    const searchable = [
      c.display_name,
      c.aibtc_name,
      c.bns_name,
      c.aibtc_beat,
      c.notes,
      c.agent_id,
      c.github_handle,
      c.x_handle,
    ]
      .filter(Boolean)
      .map((s) => (s as string).toLowerCase())
      .join(" ");

    let score = 0;
    for (const token of uniqueTokens) {
      if (searchable.includes(token)) {
        score++;
      }
    }

    if (score > 0) {
      scored.push({
        id: c.id,
        name: resolveDisplayName(c),
        type: c.type,
        beat: c.aibtc_beat,
        x_handle: c.x_handle,
        stx_address: c.stx_address,
        x402_endpoint: c.x402_endpoint,
        notes: c.notes,
        score,
      });
    }
  }

  // Sort by score desc, then by id asc for stability
  scored.sort((a, b) => b.score - a.score || a.id - b.id);
  return scored.slice(0, limit);
}

export function getContactByAddress(stxAddress: string | null, btcAddress: string | null): Contact | null {
  const db = initContactsSchema();
  if (stxAddress) {
    const found = db.query("SELECT * FROM contacts WHERE stx_address = ?").get(stxAddress) as Contact | null;
    if (found) return found;
  }
  if (btcAddress) {
    return db.query("SELECT * FROM contacts WHERE btc_address = ?").get(btcAddress) as Contact | null;
  }
  return null;
}

export function insertContactInteraction(fields: InsertContactInteraction): number {
  const db = initContactsSchema();
  const occurredAt = fields.occurred_at ?? new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
  const result = db.query(
    "INSERT INTO contact_interactions (contact_id, task_id, type, summary, occurred_at) VALUES (?, ?, ?, ?, ?)"
  ).run(fields.contact_id, fields.task_id ?? null, fields.type, fields.summary, occurredAt);
  return Number(result.lastInsertRowid);
}
