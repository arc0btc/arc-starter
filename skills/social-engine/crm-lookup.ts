/**
 * skills/social-engine/crm-lookup.ts
 *
 * READ-ONLY CRM lookup: given a target (X handle / aibtc name / wallet / member / email),
 * returns the resolved entity (WHO), WHY (reach_fit_tier + affinity reason), and
 * a-little-history (recent outbound_action touches via engagement_log).
 *
 * Also exports checkSecondGuard() — the SECOND dedup-guard, independent of the
 * UNIQUE source_key constraint in outbound_action. The first guard (source_key UNIQUE)
 * is a DB-level hard stop on re-inserting the same thread. This guard operates at
 * compose time: "we already know this entity / already touched them recently." Both
 * must fire independently.
 *
 * NO writes, NO sends. Opens db in readonly mode.
 *
 * 4-lens inline council review (2026-06-27):
 *
 * Kleppmann (data integrity):
 *   - Readonly handle: new Database(path, { readonly: true }) — SQLite snapshots reads
 *     consistently at query time. A concurrent WAL write does not corrupt or partially
 *     expose data to a readonly reader (SQLite guarantees snapshot isolation per
 *     connection). No failure mode that appears to write. APPROVE.
 *
 * Hohpe (integration coupling):
 *   - This module is a thin query layer — coupled to the schema, not to the social-engine
 *     runtime. It accepts a db handle (caller opens it), so it does not own the connection
 *     lifecycle. LookupResult is the stable contract type. Coupling is acceptable for a
 *     same-process primitive. APPROVE.
 *
 * Fowler (patterns):
 *   - Follows existing patterns: bun:sqlite, notes JSON parsing, try/catch on malformed
 *     notes, no new dependencies. Consistent with arc-p2/arc-p3 scripts and admission.ts.
 *     No ORM, no abstraction overhead. APPROVE.
 *
 * Newman (service boundaries):
 *   - Located in skills/social-engine/ — the natural home alongside reply-send.ts and
 *     admission.ts. It is a query primitive for the reply compose path, not a separate
 *     service or new table. No boundary violation. APPROVE.
 *
 * Verdict: APPROVE. No schema changes, read-only, fits existing patterns.
 * .bak: new file — no prior file to back up. Recorded.
 */

import { Database } from "bun:sqlite";

// ── Types ────────────────────────────────────────────────────────────────────

export type IdentityNamespace = "x_handle" | "aibtc_agent" | "stx_wallet" | "whop_member" | "email";

export interface LookupInput {
  query: string;
  namespace?: IdentityNamespace;
}

export interface EntityRecord {
  id: number;
  label: string | null;
  entity_type: string;
  notes_raw: string | null;
  notes_parsed: Record<string, unknown>;
}

export interface IdentityRecord {
  namespace: string;
  value: string;
}

export interface SocialAccountRecord {
  id: number;
  handle: string;
  platform: string;
  reach_fit_tier: string | null;
  targeting_status: string;
  reason_tag: string | null;
  description: string | null;
}

export interface TouchRecord {
  event_type: string;
  occurred_at: string;
  source_key: string;
  notes_short: string | null;
}

export interface SecondGuardResult {
  already_touched: boolean;
  recent_touch_count: number;
  last_touch_at: string | null;
  last_touch_source_key: string | null;
  verdict: "BLOCK" | "ALLOW" | "WARN";
}

export interface LookupResult {
  found: boolean;
  query_input: string;
  query_namespace: string | null;
  entity: EntityRecord | null;
  identities: IdentityRecord[];
  social_account: SocialAccountRecord | null;
  history: TouchRecord[];
  second_guard: SecondGuardResult;
}

// ── Resolution order (tried in sequence if namespace omitted) ─────────────────

const NAMESPACE_ORDER: IdentityNamespace[] = [
  "x_handle",
  "aibtc_agent",
  "stx_wallet",
  "whop_member",
  "email",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseNotes(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function safeStr(v: unknown): string | null {
  if (v == null) return null;
  return String(v);
}

// ── resolveEntityId ───────────────────────────────────────────────────────────

/**
 * Given a query string and optional namespace, find the matching entity_id.
 * Resolution attempts:
 *   1. entity_identity: exact (namespace, value) match
 *   2. social_accounts: handle match → notes.entity_id (x fallback)
 *   3. entity: label exact match (label is the human-readable name)
 */
function resolveEntityId(
  db: Database,
  query: string,
  namespace: IdentityNamespace | null,
): number | null {
  const namespaces = namespace ? [namespace] : NAMESPACE_ORDER;

  for (const ns of namespaces) {
    const row = db
      .query<{ entity_id: number }, [string, string]>(
        "SELECT entity_id FROM entity_identity WHERE namespace=? AND value=? LIMIT 1",
      )
      .get(ns, query);
    if (row) return row.entity_id;
  }

  // Fallback: social_accounts handle → notes.entity_id
  const sa = db
    .query<{ id: number; notes: string | null }, [string]>(
      "SELECT id, notes FROM social_accounts WHERE handle=? LIMIT 1",
    )
    .get(query);
  if (sa) {
    const notes = parseNotes(sa.notes);
    const eid = notes.entity_id;
    if (typeof eid === "number") return eid;
  }

  // Fallback: entity label exact match
  const ent = db
    .query<{ id: number }, [string]>(
      "SELECT id FROM entity WHERE label=? LIMIT 1",
    )
    .get(query);
  if (ent) return ent.id;

  return null;
}

// ── loadEntity ────────────────────────────────────────────────────────────────

function loadEntity(db: Database, entityId: number): EntityRecord | null {
  const row = db
    .query<
      { id: number; label: string | null; entity_type: string; notes: string | null },
      [number]
    >("SELECT id, label, entity_type, notes FROM entity WHERE id=? LIMIT 1")
    .get(entityId);
  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    entity_type: row.entity_type,
    notes_raw: row.notes,
    notes_parsed: parseNotes(row.notes),
  };
}

// ── loadIdentities ────────────────────────────────────────────────────────────

function loadIdentities(db: Database, entityId: number): IdentityRecord[] {
  return db
    .query<{ namespace: string; value: string }, [number]>(
      "SELECT namespace, value FROM entity_identity WHERE entity_id=? ORDER BY namespace",
    )
    .all(entityId);
}

// ── loadSocialAccount ─────────────────────────────────────────────────────────

/**
 * Find the social_accounts row for this entity.
 * Preferred: notes.entity_id match. Fallback: x_handle identity match.
 */
function loadSocialAccount(
  db: Database,
  entityId: number,
  identities: IdentityRecord[],
): SocialAccountRecord | null {
  // Strategy: x_handle identity → social_accounts.handle is the most reliable path.
  // Also scan rows where notes contains the entity_id (LIKE pre-filter to avoid
  // json_extract on non-JSON notes rows, which throws SQLiteError: malformed JSON).
  const xHandle = identities.find((i) => i.namespace === "x_handle");
  if (xHandle) {
    const byHandle = db
      .query<
        {
          id: number;
          handle: string;
          platform: string;
          reach_fit_tier: string | null;
          targeting_status: string;
          notes: string | null;
        },
        [string]
      >(
        `SELECT id, handle, platform, reach_fit_tier, targeting_status, notes
         FROM social_accounts WHERE handle=? LIMIT 1`,
      )
      .get(xHandle.value);
    if (byHandle) return parseSARow(byHandle);
  }

  // Fallback: LIKE pre-filter on notes (avoids json_extract on non-JSON rows),
  // then verify entity_id in code. Matches "entity_id":21 patterns.
  const likePattern = `%"entity_id":${entityId}%`;
  const candidates = db
    .query<
      {
        id: number;
        handle: string;
        platform: string;
        reach_fit_tier: string | null;
        targeting_status: string;
        notes: string | null;
      },
      [string]
    >(
      `SELECT id, handle, platform, reach_fit_tier, targeting_status, notes
       FROM social_accounts
       WHERE notes LIKE ?
       LIMIT 5`,
    )
    .all(likePattern);

  for (const candidate of candidates) {
    const notes = parseNotes(candidate.notes);
    if (notes.entity_id === entityId) return parseSARow(candidate);
  }

  return null;
}

function parseSARow(row: {
  id: number;
  handle: string;
  platform: string;
  reach_fit_tier: string | null;
  targeting_status: string;
  notes: string | null;
}): SocialAccountRecord {
  const notes = parseNotes(row.notes);
  return {
    id: row.id,
    handle: row.handle,
    platform: row.platform,
    reach_fit_tier: row.reach_fit_tier,
    targeting_status: row.targeting_status,
    reason_tag: safeStr(notes.reason_tag),
    description: safeStr(notes.description),
  };
}

// ── checkSecondGuard ──────────────────────────────────────────────────────────

/**
 * SECOND DEDUP-GUARD (compose-time, independent of source_key UNIQUE).
 *
 * Given a social_accounts.id, check if we've touched this account recently.
 * "Touched" = any outbound_action row for this account_id with a sent/queued/skipped
 * event in the engagement_log within the last 30 days.
 *
 * This is INDEPENDENT of the source_key UNIQUE constraint:
 * - source_key UNIQUE: DB-level hard stop (INSERT throws on duplicate thread_ref)
 * - second_guard: compose-time check ("we already know + touched this entity recently")
 *   catches the pattern before an INSERT is even attempted.
 *
 * Verdicts:
 *   BLOCK  — already_touched=true, recent_touch_count > 0 (had real outbound activity)
 *   WARN   — no social_accounts link (can't check history; identity not in CRM)
 *   ALLOW  — entity found, no recent touches (or history is empty)
 */
export function checkSecondGuard(
  db: Database,
  socialAccountId: number | null,
): SecondGuardResult {
  if (socialAccountId == null) {
    return {
      already_touched: false,
      recent_touch_count: 0,
      last_touch_at: null,
      last_touch_source_key: null,
      verdict: "WARN",
    };
  }

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const rows = db
    .query<
      { event_type: string; occurred_at: string; source_key: string },
      [number, string]
    >(
      `SELECT el.event_type, el.occurred_at, oa.source_key
       FROM engagement_log el
       JOIN outbound_action oa ON oa.id = el.action_id
       WHERE oa.account_id = ?
         AND el.occurred_at >= ?
       ORDER BY el.occurred_at DESC
       LIMIT 10`,
    )
    .all(socialAccountId, cutoff);

  const recentCount = rows.length;
  const alreadyTouched = recentCount > 0;
  const lastRow = rows[0] ?? null;

  return {
    already_touched: alreadyTouched,
    recent_touch_count: recentCount,
    last_touch_at: lastRow ? lastRow.occurred_at : null,
    last_touch_source_key: lastRow ? lastRow.source_key : null,
    verdict: alreadyTouched ? "BLOCK" : "ALLOW",
  };
}

// ── loadHistory ───────────────────────────────────────────────────────────────

function loadHistory(db: Database, socialAccountId: number): TouchRecord[] {
  return db
    .query<
      { event_type: string; occurred_at: string; source_key: string; notes: string | null },
      [number]
    >(
      `SELECT el.event_type, el.occurred_at, oa.source_key,
              SUBSTR(el.notes, 1, 120) AS notes
       FROM engagement_log el
       JOIN outbound_action oa ON oa.id = el.action_id
       WHERE oa.account_id = ?
       ORDER BY el.occurred_at DESC
       LIMIT 5`,
    )
    .all(socialAccountId)
    .map((r) => ({
      event_type: r.event_type,
      occurred_at: r.occurred_at,
      source_key: r.source_key,
      notes_short: r.notes,
    }));
}

// ── lookupTarget (main export) ────────────────────────────────────────────────

/**
 * Read-only CRM lookup. Returns WHO (entity) + WHY (reach_fit_tier + reason_tag) +
 * a-little-history (recent engagement touches) + second_guard verdict.
 *
 * No writes, no sends. Caller is responsible for db lifetime (pass a readonly handle).
 */
export function lookupTarget(db: Database, input: LookupInput): LookupResult {
  const { query, namespace = null } = input;

  const entityId = resolveEntityId(db, query, namespace ?? null);

  if (entityId == null) {
    return {
      found: false,
      query_input: query,
      query_namespace: namespace ?? null,
      entity: null,
      identities: [],
      social_account: null,
      history: [],
      second_guard: {
        already_touched: false,
        recent_touch_count: 0,
        last_touch_at: null,
        last_touch_source_key: null,
        verdict: "WARN",
      },
    };
  }

  const entity = loadEntity(db, entityId);
  const identities = loadIdentities(db, entityId);
  const social = loadSocialAccount(db, entityId, identities);
  const history = social ? loadHistory(db, social.id) : [];
  const secondGuard = checkSecondGuard(db, social?.id ?? null);

  return {
    found: true,
    query_input: query,
    query_namespace: namespace ?? null,
    entity,
    identities,
    social_account: social,
    history,
    second_guard: secondGuard,
  };
}
