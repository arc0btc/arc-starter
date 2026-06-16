#!/usr/bin/env bun

// skills/whop-sales/lib/enforcement.ts
//
// The BLOCKING enforcement gate for the P9 acquisition lane + its persistent
// outreach ledger (db/whop-sales-outreach.json). This is punch-list E from P5,
// made into hard gates: where cli.ts only emitted stderr WARNINGS, the lane here
// REFUSES to queue/post a pitch that violates a cap. Pure + deterministic (clock
// is injected) so the verify can exercise every block on a fixture ledger.
//
// The four blocks (SKILL.md §Cadence + §Guardrails + P3/P4 council):
//   1. daily cap       — ≤ DAILY_PITCH_CAP pitches queued per UTC day
//   2. 7-day dedup     — one pitch per lead per 7 days
//   3. give-3x         — ≥3 value touches (arc_replies_to_them) precede any ask
//   4. claim→proof     — a claim-shaped pitch with no proof is blocked
//
// No LLM, no network, no credentials.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

// Default ledger path is cwd-relative (like skills/whop/lib/events.ts opens
// "db/arc.sqlite") so a fixture run from a throwaway cwd is isolated from the
// live ledger. Callers may pass an explicit path to be unambiguous.
export const DEFAULT_OUTREACH_PATH = "db/whop-sales-outreach.json";

/** ≤2 substantive outreaches/day (SKILL.md §Cadence: "1–2/day MAX"). */
export const DAILY_PITCH_CAP = 2;
/** One pitch per lead per 7 days (SKILL.md §Guardrails). */
export const DEDUP_WINDOW_DAYS = 7;
/** Give value ≥3 times before an ask (quest doctrine; SKILL.md §Cadence). */
export const GIVE_BEFORE_ASK = 3;

export interface OutreachRecord {
  lead_id: string;
  username: string | null;
  pitched_at: string; // ISO8601
  channel: string; // x | forum
  route: "arc-auto" | "operator-manual";
  source: string;
  proof: string | null;
  task_id: number | null; // null when dry-run (composed, not queued)
  dry_run: boolean;
}

export interface NudgeRecord {
  member_id: string;
  day: "d1" | "d5";
  queued_at: string; // ISO8601
  source: string;
  task_id: number | null;
  dry_run: boolean;
}

export interface OutreachLedger {
  updated_at: string;
  records: OutreachRecord[];
  nudges: NudgeRecord[];
}

export function emptyLedger(): OutreachLedger {
  return { updated_at: new Date(0).toISOString(), records: [], nudges: [] };
}

export function loadOutreachLedger(path: string = DEFAULT_OUTREACH_PATH): OutreachLedger {
  if (!existsSync(path)) return emptyLedger();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<OutreachLedger>;
    return {
      updated_at: raw.updated_at ?? new Date(0).toISOString(),
      records: raw.records ?? [],
      nudges: raw.nudges ?? [],
    };
  } catch {
    // A corrupt ledger is recoverable; the next save overwrites it. Never stall
    // the sensor on a parse error.
    return emptyLedger();
  }
}

export function saveOutreachLedger(ledger: OutreachLedger, path: string = DEFAULT_OUTREACH_PATH): void {
  ledger.updated_at = new Date().toISOString();
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, JSON.stringify(ledger, null, 2) + "\n", "utf8");
}

// --- The gate ----------------------------------------------------------------

export interface GateCandidate {
  lead_id: string;
  username: string | null;
  value_touches: number; // arc_replies_to_them — how many times Arc gave value first
  claim_shaped: boolean; // the composed pitch makes a claim/number…
  has_proof: boolean; // …and whether a verifiable artifact is attached
}

export interface GateResult {
  allowed: boolean;
  blocks: string[]; // human-readable reasons; empty iff allowed
}

function dayStr(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Decide whether a candidate pitch may be queued/posted THIS cycle. All four
 * checks are BLOCKING — any failure returns allowed:false with the reason(s).
 * `now` is injected so the verify can drive the daily/dedup windows deterministically.
 */
export function enforceAcquisitionGate(
  candidate: GateCandidate,
  ledger: OutreachLedger,
  now: Date,
): GateResult {
  const blocks: string[] = [];
  const nowMs = now.getTime();
  const today = now.toISOString().slice(0, 10);

  // 1. Daily cap — count pitches already recorded for today (UTC).
  const todayCount = ledger.records.filter((r) => dayStr(r.pitched_at) === today).length;
  if (todayCount >= DAILY_PITCH_CAP) {
    blocks.push(`daily-cap: ${todayCount}/${DAILY_PITCH_CAP} pitches already queued today`);
  }

  // 2. 7-day dedup — has this lead been pitched inside the window?
  const windowMs = DEDUP_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const lastForLead = ledger.records
    .filter((r) => r.lead_id === candidate.lead_id)
    .map((r) => new Date(r.pitched_at).getTime())
    .filter((t) => !Number.isNaN(t)) // a corrupt pitched_at must not silently bypass dedup (cairn #3)
    .sort((a, b) => b - a)[0];
  if (lastForLead !== undefined && nowMs - lastForLead < windowMs) {
    const daysAgo = ((nowMs - lastForLead) / (24 * 60 * 60 * 1000)).toFixed(1);
    blocks.push(`7-day-dedup: lead pitched ${daysAgo}d ago (< ${DEDUP_WINDOW_DAYS}d)`);
  }

  // 3. Give-3x-before-ask.
  if (candidate.value_touches < GIVE_BEFORE_ASK) {
    blocks.push(`give-3x: only ${candidate.value_touches}/${GIVE_BEFORE_ASK} value touches before this ask`);
  }

  // 4. Claim → proof.
  if (candidate.claim_shaped && !candidate.has_proof) {
    blocks.push(`claim-proof: pitch is claim-shaped but carries no verifiable proof (Receipt Standard)`);
  }

  return { allowed: blocks.length === 0, blocks };
}

/** Append a queued (or dry-run composed) pitch to the ledger (mutates + returns). */
export function recordPitch(ledger: OutreachLedger, rec: OutreachRecord): OutreachLedger {
  ledger.records.push(rec);
  return ledger;
}

/** True if a nudge for (member, day) is already on record — dedup for re-runs. */
export function nudgeExists(ledger: OutreachLedger, memberId: string, day: "d1" | "d5"): boolean {
  return ledger.nudges.some((n) => n.member_id === memberId && n.day === day);
}

export function recordNudge(ledger: OutreachLedger, rec: NudgeRecord): OutreachLedger {
  ledger.nudges.push(rec);
  return ledger;
}
