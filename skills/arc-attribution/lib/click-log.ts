// skills/arc-attribution/lib/click-log.ts
//
// control-plane-remediation Phase 7 (track c): minimal click-attribution instrumentation.
// click_log.ref_code shares the SAME namespace as whop_sale.a_param / x402_sale.a_param /
// checkout_config.a_param -- this module deliberately does NOT invent a second tag vocabulary.
// A ref_code must match either an existing SRC_TAGS tag (the arc-day-n-publishing registry:
// day-n-x, blog, email, moltbook, whop-free, nostr) or an existing checkout_config.a_param
// value, so this table can't silently accumulate typo'd ref codes that no sale row could ever
// match.
//
// Ingestion this phase: the `record-click` CLI subcommand (cli.ts) is the only writer. A real
// public /go/:ref redirect (control-plane-remediation Phase 7, task 3, in the arc0btc-worker
// repo) plus a KV-to-click_log sync step are named follow-ups, NOT built this phase -- see
// SKILL.md's "Follow-ups" section. Until those land, this table only grows from manual/scripted
// record-click calls, not real click traffic.

import { getDatabase, initDatabase } from "../../../src/db.ts";
import { SRC_TAGS } from "./src-tags.ts";

export interface RecordClickInput {
  ref_code: string;
  surface: string;
  target_url: string;
  source_note?: string;
}

export interface ClickLogRow {
  id: number;
  ref_code: string;
  surface: string;
  target_url: string;
  clicked_at: string;
  source_note: string | null;
  created_at: string;
}

const KNOWN_SRC_TAGS: Set<string> = new Set(Object.values(SRC_TAGS).map((entry) => entry.tag as string));

function isKnownRefCode(refCode: string): boolean {
  if (KNOWN_SRC_TAGS.has(refCode)) return true;
  initDatabase();
  const db = getDatabase();
  const row = db
    .query("SELECT 1 FROM checkout_config WHERE a_param = ? LIMIT 1")
    .get(refCode) as { 1: number } | null;
  return row != null;
}

/** Records one observed click. Throws if ref_code matches neither a known SRC_TAGS tag nor an
 *  existing checkout_config.a_param -- a click_log row that can never join to a sale row by
 *  construction is worse than no row at all (it would silently inflate "clicks" totals with no
 *  chance of ever showing a conversion, which is exactly the kind of unfalsifiable metric this
 *  instrumentation exists to avoid). */
export function recordClick(input: RecordClickInput): ClickLogRow {
  const refCode = input.ref_code.trim();
  const surface = input.surface.trim();
  const targetUrl = input.target_url.trim();
  if (!refCode) throw new Error("ref_code is required");
  if (!surface) throw new Error("surface is required");
  if (!targetUrl) throw new Error("target_url is required");
  if (!isKnownRefCode(refCode)) {
    throw new Error(
      `ref_code "${refCode}" matches neither a known SRC_TAGS tag (${[...KNOWN_SRC_TAGS].join(", ")}) ` +
        `nor an existing checkout_config.a_param value -- refusing to record an unjoinable click. ` +
        `Add a checkout_config row or use an existing SRC_TAGS tag.`,
    );
  }

  initDatabase();
  const db = getDatabase();
  const insert = db.query(
    `INSERT INTO click_log (ref_code, surface, target_url, source_note)
     VALUES (?, ?, ?, ?)
     RETURNING id, ref_code, surface, target_url, clicked_at, source_note, created_at`,
  );
  return insert.get(refCode, surface, targetUrl, input.source_note ?? null) as ClickLogRow;
}

export function getClicksForRefCode(refCode: string, sinceIso?: string): ClickLogRow[] {
  initDatabase();
  const db = getDatabase();
  if (sinceIso) {
    return db
      .query(
        `SELECT id, ref_code, surface, target_url, clicked_at, source_note, created_at
         FROM click_log WHERE ref_code = ? AND clicked_at >= ? ORDER BY clicked_at ASC`,
      )
      .all(refCode, sinceIso) as ClickLogRow[];
  }
  return db
    .query(
      `SELECT id, ref_code, surface, target_url, clicked_at, source_note, created_at
       FROM click_log WHERE ref_code = ? ORDER BY clicked_at ASC`,
    )
    .all(refCode) as ClickLogRow[];
}
