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
import { insertTask, taskExistsForSource, getDatabase } from "../../../src/db.ts";
import { writeDistilled, type ArtifactChannel } from "../../../src/artifacts.ts";

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
  // Advisory signal into the artifact pool — AFTER record (unlike the critical task
  // surface, which is before): a crash here drops at most one advisory pool signal,
  // never duplicates it (re-ingest dedups at the ledger). P21.
  recordWhopSignal(event);
  return "recorded";
}

/**
 * Surface an event to the dispatch loop. `membership.activated` routes to the P20
 * member-welcome (the type-appropriate onboarding action — exactly one per member);
 * every other event queues ONE generic internal task. All paths are deduped by source
 * so a re-dispatch never double-queues. No live external action here — the live greeting
 * is voice-gated inside the dispatched session (WHOP_WELCOME_DRY_RUN).
 */
export function surfaceWhopEvent(event: WhopEvent): void {
  if (event.type === "membership.activated") {
    surfaceMemberWelcome(event);
    return;
  }
  queueGenericEvent(event);
}

/** Queue the generic, deduped "the loop should see this event" task. */
function queueGenericEvent(event: WhopEvent): void {
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

// ---- P20: new-member welcome / onboarding -------------------------------

// Live greeting is gated: the dispatched session composes always, but only POSTS when
// WHOP_WELCOME_DRY_RUN=false AND operator voice-trust is granted. Default = dry-run.
const WHOP_WELCOME_DRY_RUN = process.env.WHOP_WELCOME_DRY_RUN !== "false";

/** Identity fields read off a Membership entity for the welcome. */
interface MembershipWelcomeData {
  member?: { id?: string | null } | null;
  user?: { id?: string | null; username?: string | null; name?: string | null } | null;
}

/**
 * Queue EXACTLY ONE onboarding action per member for a `membership.activated` event.
 * Dedup key is the MEMBER (not the event), so a re-subscribe / second activation never
 * re-welcomes. The dispatched session composes a warm, voice-carded greeting + orientation
 * (arc-brand-voice + SOUL); the live post is gated by WHOP_WELCOME_DRY_RUN + voice-trust.
 */
export function surfaceMemberWelcome(event: WhopEvent): void {
  const data = (event.data ?? {}) as MembershipWelcomeData;
  // No `?? event.id` fallback (council: cairn+forge+spark all flagged it). A welcome
  // dedup key MUST be the durable member identity, or the per-member exactly-once
  // guarantee silently degrades to per-event. If a malformed activation lacks a stable
  // member/user id, don't fake a welcome — surface it generically so it's still visible.
  const memberId = data.member?.id ?? data.user?.id;
  if (!memberId) {
    console.log(
      JSON.stringify({ whop_welcome: "no stable member id — surfacing generically", event_id: event.id }),
    );
    queueGenericEvent(event);
    return;
  }
  const handle = data.user?.username || data.user?.name || "the new member";
  const source = `whop-welcome:${memberId}`;
  if (taskExistsForSource(source)) return; // exactly-once per member

  insertTask({
    subject: `New hash-it-out member: welcome ${handle}`,
    description: [
      `A new member activated their hash-it-out membership (event ${event.id}).`,
      `Handle: ${handle}${data.user?.name && data.user?.username ? ` (${data.user.name})` : ""}`,
      "",
      "Compose ONE warm, specific, voice-carded welcome + orientation. Follow the approved",
      "voice + structure in skills/whop/WELCOME-TEMPLATE.md (operator-approved) + arc-brand-voice",
      "+ SOUL — vary the copy, don't paste the examples verbatim:",
      "- Greet them by name/handle; make it feel like a person noticed, not an autoresponder.",
      "- Orient: what the 'AI Prefers Bitcoin' room is, how to reach Arc (@arc / reply), the",
      "  cadence + self-imposed reply limits, and one genuine invitation to start a thread.",
      "- No platitudes, no feature dump. Add signal, ask a real question, make them want to reply.",
      "",
      WHOP_WELCOME_DRY_RUN
        ? "DRY-RUN (WHOP_WELCOME_DRY_RUN!=false): compose for operator review only — DO NOT post."
        : "LIVE post (voice-trust required): post via " +
          `arc skills run --name whop -- post-chat --content "<markdown>" --source "${source}"`,
      `(--source "${source}" makes the post idempotent — a re-dispatch never double-greets.)`,
    ].join("\n"),
    skills: JSON.stringify(["whop", "arc-brand-voice"]),
    priority: 3,
    model: "sonnet",
    source,
  });
}

// ---- P21: Whop events as external input into the artifact pool ----------
//
// Representative member events become privacy-safe "whop-signal" artifacts so the
// paid-room synthesis lane (skills/whop/sensor.ts) folds room activity into its
// room-read — the event influences what Arc produces next, not just a task to handle.
// PRIVACY: the nugget carries NO member identity (name/email/username) — the paid room
// sees interior reasoning but member PII stays out of the shared pool.

const WHOP_SIGNAL_CHANNELS: readonly ArtifactChannel[] = ["whop-chat"];

/** Aggregate, PII-free room-signal text for the events worth surfacing as input. */
function signalCopy(event: WhopEvent): { topic: string; title: string; nugget: string } | null {
  switch (event.type) {
    case "membership.activated":
      return {
        topic: "room-growth",
        title: "A new member joined the room",
        nugget:
          "A new member just joined the hash-it-out 'AI Prefers Bitcoin' room. The room grew — " +
          "worth keeping in mind when reading the room: there may be someone new finding their footing.",
      };
    case "payment.succeeded":
      return {
        topic: "revenue",
        title: "A membership payment cleared",
        nugget:
          "A hash-it-out membership payment cleared. Revenue signal — the room is being paid for; " +
          "the contract is to keep earning that read.",
      };
    default:
      return null; // other events surface as tasks only, not pool signals
  }
}

// ---- P22: revenue read over the event ledger (no separate sensor) ------

const MEMBERSHIP_PRICE_CENTS = 4900; // hash-it-out single product: $49/mo
const BREAK_EVEN_MEMBERS = 16; // ~16-member break-even (QUEST)

export interface RevenueSummary {
  activeMembers: number;
  activatedEvents: number;
  deactivatedEvents: number;
  mrrCents: number;
  paymentsCapturedCents: number;
  paymentCount: number;
  breakEvenTarget: number;
  breakEvenPct: number;
}

/** Parse the membership entity id out of a `whop-evt:membership:<id>:<status>` source key. */
function membershipEntityId(source: string): string {
  // ids are `mem_…` (no colons), so positional split is safe; fall back to the whole key.
  return source.split(":")[2] ?? source;
}

/**
 * Compute venture revenue from the captured event ledger (`whop_event_log`) — the P22
 * engine criterion: NO separate revenue sensor, just a read over P19's events. Active
 * members = distinct memberships activated minus those later deactivated (note the P19
 * poll-coverage caveat: deactivations of pre-existing members may be missed — this is a
 * captured-events estimate). Returns zeros cleanly on an empty ledger.
 */
export function computeRevenue(): RevenueSummary {
  whopEventLedger(); // ensure the table exists on a fresh DB
  const db = getDatabase();
  // Active members = the LATEST captured lifecycle event per membership is an activation
  // (council/cairn: a set-difference activated−deactivated mis-handles reactivation
  // activated→deactivated→activated). Order by recorded_at — the ledger's monotonic capture
  // timestamp — NOT occurred_at, which is the membership's created_at and is identical across
  // all of one membership's status events. Last-write-wins per entity.
  const lifecycle = db
    .query(
      `SELECT source, type FROM whop_event_log
       WHERE type IN ('membership.activated', 'membership.deactivated')
       ORDER BY recorded_at ASC`,
    )
    .all() as Array<{ source: string; type: string }>;
  const latestByEntity = new Map<string, string>();
  for (const r of lifecycle) latestByEntity.set(membershipEntityId(r.source), r.type);
  let activeMembers = 0;
  for (const t of latestByEntity.values()) if (t === "membership.activated") activeMembers++;

  const activated = lifecycle.filter((r) => r.type === "membership.activated");
  const deactivated = lifecycle.filter((r) => r.type === "membership.deactivated");

  const pay = db
    .query(
      `SELECT COUNT(*) AS c, COALESCE(SUM(amount_cents), 0) AS s
       FROM whop_event_log WHERE type = 'payment.succeeded'`,
    )
    .get() as { c: number; s: number };

  return {
    activeMembers,
    activatedEvents: activated.length,
    deactivatedEvents: deactivated.length,
    mrrCents: activeMembers * MEMBERSHIP_PRICE_CENTS,
    paymentsCapturedCents: pay.s,
    paymentCount: pay.c,
    breakEvenTarget: BREAK_EVEN_MEMBERS,
    breakEvenPct: Math.round((activeMembers / BREAK_EVEN_MEMBERS) * 100),
  };
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Human-readable revenue block for the whop CLI + watch-report / CEO-review surfaces. */
export function formatRevenue(r: RevenueSummary = computeRevenue()): string {
  return [
    "hash-it-out revenue (from captured Whop events — whop_event_log):",
    `  active members:     ${r.activeMembers}  (activated ${r.activatedEvents} / deactivated ${r.deactivatedEvents} events)`,
    `  MRR:                ${usd(r.mrrCents)}  (${r.activeMembers} × $49/mo)`,
    `  payments captured:  ${usd(r.paymentsCapturedCents)}  across ${r.paymentCount} payment.succeeded`,
    `  break-even:         ${r.activeMembers}/${r.breakEvenTarget} members (${r.breakEvenPct}%)`,
  ].join("\n");
}

/** Write a PII-free whop-signal artifact for representative events. Advisory; best-effort. */
export function recordWhopSignal(event: WhopEvent): void {
  const copy = signalCopy(event);
  if (!copy) return;
  try {
    writeDistilled({
      type: "whop-signal",
      produced_at: event.occurred_at,
      source_path: `whop-event:${event.id}`,
      topic: copy.topic,
      title: copy.title,
      nugget: copy.nugget,
      citation: event.id,
      suggested_channels: WHOP_SIGNAL_CHANNELS,
    });
  } catch (error) {
    console.log(
      JSON.stringify({ whop_signal: "writeDistilled failed (advisory, non-fatal)", event_id: event.id, error: String(error) }),
    );
  }
}
