// skills/whop/lib/events.ts
//
// P19 — Whop events intake (poll + idempotent ledger).
//
// Source-agnostic event layer for membership/payment events. The poll lane in
// sensor.ts lists memberships/payments via the SDK and feeds each entity through
// normalize*() → ingestWhopEvent(). The normalized WhopEvent is intentionally the
// same { id, type, occurred_at, data } subset the SDK's webhooks.unwrap() returns
// (UnwrapWebhookEvent = { id, type, timestamp, data, ... }), so P20–22 consume one
// shape and a future PUSH handler (webhooks.unwrap(body, {headers, key})) can drop
// in without touching downstream code.
//
// Architecture decision (operator, 2026-06-15): POLL, not push. arc-starter is a
// dispatch-loop agent with no always-on HTTP server; M0 has not landed so real-time
// is not yet worth the infra. Signature verify is N/A on the poll path — data arrives
// from authenticated SDK calls (key in the encrypted cred store), so there is no
// inbound payload whose origin must be proven. The seam for push remains the SDK's
// webhooks.unwrap(), which yields this same shape.
//
// Exactly-once is the heart of P19: createSourceLedger (INSERT OR IGNORE on the
// `source` PK) guarantees a replayed/duplicate event is recorded exactly once and
// surfaces exactly one task. The event id embeds the entity status
// (whop-evt:membership:<id>:<status>) so a status TRANSITION yields a new event id.
//
// EVENT-ID CONTRACT (council/forge — name it, don't leave it implicit): WhopEvent.id
// is an ENTITY-STATE identity, NOT a provider webhook-request id. A future push handler
// MUST derive the same `whop-evt:<entity>:<id>:<status>` id from the unwrapped event's
// `data` entity (ignore the provider's per-delivery webhook id) so poll and push
// converge on one dedup key — otherwise the same activation seen via both paths would
// double-record. This is what makes "drop in a push lane without touching P20–22" true.
//
// POLL COVERAGE LIMIT (council/cairn — documented tradeoff of the operator's poll choice):
// the sensor lists by `created_after`, so it observes entities whose created_at is within
// the cursor window. NEW memberships (the M0 signal) and ALL payments are captured (each
// has a fresh created_at). A status TRANSITION of a PRE-EXISTING entity (e.g. an old
// membership going canceled/expired) is NOT re-listed by a created_at cursor and is NOT
// caught — closing that gap needs push (or a separate reconciliation lane). Carry-forward.

import { createSourceLedger, type SourceLedger } from "../../../src/source-ledger.ts";
import { insertTask, taskExistsForSource } from "../../../src/db.ts";

// ---- Normalized event shape (mirrors SDK UnwrapWebhookEvent subset) ----

export interface WhopEvent {
  /** Stable, exactly-once key. Embeds entity status so a state change is a new event. */
  id: string;
  /** SDK event type, e.g. "membership.activated" | "payment.succeeded". */
  type: string;
  /** ISO 8601 — when the underlying entity was created/changed. */
  occurred_at: string;
  /** The raw SDK entity (Membership | Payment). Opaque to the ledger. */
  data: unknown;
  /** Payment amount in whole-currency units (USD), when applicable. */
  amount?: number | null;
}

// ---- Minimal structural views of the SDK entities we poll ----
// (Avoid importing the heavy @whop/sdk types here; the sensor passes real SDK
//  objects and only these fields are read.)

export interface MembershipLike {
  id: string;
  status: string;
  created_at: string;
}

export interface PaymentLike {
  id: string;
  status: string | null;
  created_at: string;
  usd_total?: number | null;
  total?: number | null;
}

// ---- Normalizers ----

const ACTIVE_MEMBERSHIP = new Set(["active", "trialing"]);
const ENDED_MEMBERSHIP = new Set(["canceled", "expired", "completed"]);

/** Membership entity → WhopEvent. Type derives from status; id embeds status. */
export function normalizeMembership(m: MembershipLike): WhopEvent {
  const type = ACTIVE_MEMBERSHIP.has(m.status)
    ? "membership.activated"
    : ENDED_MEMBERSHIP.has(m.status)
      ? "membership.deactivated"
      : "membership.updated";
  return {
    id: `whop-evt:membership:${m.id}:${m.status}`,
    type,
    occurred_at: m.created_at,
    data: m,
  };
}

/** Map Whop ReceiptStatus → payment.* event type. */
function paymentType(status: string | null): string {
  switch (status) {
    case "paid":
      return "payment.succeeded";
    case "uncollectible":
    case "void":
      return "payment.failed";
    case "pending":
    case "open":
      return "payment.pending";
    default:
      return "payment.created";
  }
}

/** Payment entity → WhopEvent. Type derives from ReceiptStatus; id embeds status. */
export function normalizePayment(p: PaymentLike): WhopEvent {
  const amount = p.usd_total ?? p.total ?? null;
  return {
    id: `whop-evt:payment:${p.id}:${p.status ?? "unknown"}`,
    type: paymentType(p.status),
    occurred_at: p.created_at,
    data: p,
    amount,
  };
}

// ---- Idempotent ledger ----

let ledgerSingleton: SourceLedger | null = null;

/**
 * The exactly-once event ledger. `source` PK = WhopEvent.id. Extra columns capture
 * enough to render revenue (P22) without re-fetching: type, occurred_at, amount_cents,
 * and the raw payload JSON. Lazily created so importing this module is side-effect-free
 * until first use.
 */
export function whopEventLedger(): SourceLedger {
  if (!ledgerSingleton) {
    ledgerSingleton = createSourceLedger({
      table: "whop_event_log",
      idColumn: "type",
      extraColumns: [
        { name: "occurred_at", type: "TEXT" },
        { name: "amount_cents", type: "INTEGER" },
        { name: "payload", type: "TEXT" },
      ],
    });
  }
  return ledgerSingleton;
}

/**
 * Record an event exactly once and surface new ones to the loop.
 * Returns "duplicate" if already recorded (no surface), "recorded" on first sight.
 *
 * Surface-BEFORE-record ordering (council/cairn): the side effect (queue the task)
 * runs first, then the ledger marks the event processed. If the process dies between
 * the two, the next poll re-ingests (ledger has no row yet) and re-surfaces — but
 * surfaceWhopEvent() is itself idempotent (taskExistsForSource guard), so the re-surface
 * is a no-op and then the record commits. This makes "surfaces exactly one task"
 * crash-safe: a record-before-surface order could strand an event (recorded, never
 * surfaced) if the surface step failed.
 */
export function ingestWhopEvent(event: WhopEvent): "recorded" | "duplicate" {
  const ledger = whopEventLedger();
  if (ledger.dedupSkip(event.id, "ingested")) return "duplicate";

  surfaceWhopEvent(event);

  const amountCents =
    typeof event.amount === "number" && Number.isFinite(event.amount)
      ? Math.round(event.amount * 100)
      : null;
  ledger.record(event.id, event.type, {
    occurred_at: event.occurred_at,
    amount_cents: amountCents,
    payload: JSON.stringify(event.data),
  });
  return "recorded";
}

/**
 * Default surface: queue ONE internal dispatch task per event so the loop sees it.
 * No live external action here — P20 owns the voice-gated member greeting. The task
 * is deduped by source so a re-dispatch never double-queues.
 */
export function surfaceWhopEvent(event: WhopEvent): void {
  const source = `whop-event:${event.id}`;
  if (taskExistsForSource(source)) return;
  insertTask({
    subject: `Whop event: ${event.type}`,
    description: [
      `A Whop ${event.type} event was captured by the poll intake (P19).`,
      "",
      `event id: ${event.id}`,
      `occurred_at: ${event.occurred_at}`,
      event.amount != null ? `amount: $${event.amount}` : "",
      "",
      "This is an internal surface signal. Membership-activated greetings are handled",
      "by the P20 onboarding flow (voice-gated); payment events feed the P22 revenue",
      "review. Acknowledge and close unless a downstream handler claims it.",
    ]
      .filter(Boolean)
      .join("\n"),
    skills: JSON.stringify(["whop"]),
    priority: 6,
    model: "sonnet",
    source,
  });
}
