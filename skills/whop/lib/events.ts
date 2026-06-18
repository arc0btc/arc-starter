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

import { readFileSync } from "node:fs";
import { createSourceLedger, type SourceLedger } from "../../../src/source-ledger.ts";
import { insertTask, taskExistsForSource, getDatabase } from "../../../src/db.ts";
import { writeDistilled, type ArtifactChannel } from "../../../src/artifacts.ts";
import { PRODUCT_PAGE_URL, PAID_ROOM_PRODUCT_URL, PROMO_CODE } from "../../../src/constants.ts";

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
  /**
   * The Whop product (`prod_…`) the entity belongs to. Both membership and payment
   * entities expose `.product.id`. Drives the P10A member-vs-product money split:
   * MEMBERSHIP_PRODUCT_ID → recurring $49/mo member; anything else → one-time product
   * customer. NULL = a legacy/unknown entity, treated as the membership product.
   */
  product_id?: string | null;
}

/** Structural view of an entity carrying a product reference (membership or payment). */
interface HasProduct {
  product?: { id?: string | null } | null;
  product_id?: string | null;
}

/** Extract the product id off either entity shape (`.product.id` or a flat `product_id`). */
function entityProductId(e: HasProduct): string | null {
  return e.product?.id ?? e.product_id ?? null;
}

// ---- Minimal structural views of the SDK entities we poll ----
// (Avoid importing the heavy @whop/sdk types here; the sensor passes real SDK
//  objects and only these fields are read.)

export interface MembershipLike extends HasProduct {
  id: string;
  status: string;
  created_at: string;
}

export interface PaymentLike extends HasProduct {
  id: string;
  status: string | null;
  created_at: string;
  usd_total?: number | null;
  total?: number | null;
}

// ---- Normalizers ----

const ACTIVE_MEMBERSHIP = new Set(["active", "trialing"]);
const ENDED_MEMBERSHIP = new Set(["canceled", "expired", "completed"]);

// The recurring $49/mo "hash it out — membership" product. Used in two places: the
// member-welcome gate (P20 — only membership-product activations get the room welcome)
// and the revenue split (P22 — only this product counts toward active members / MRR;
// any other product is a one-time customer). NULL product_id = legacy/unknown entity,
// treated as the membership product so pre-P10A behavior is preserved.
const MEMBERSHIP_PRODUCT_ID = "prod_TJknsIOzPDlQS";

/** True if an event belongs to the recurring membership product (NULL = legacy membership). */
function isMembershipProduct(productId: string | null | undefined): boolean {
  return productId == null || productId === MEMBERSHIP_PRODUCT_ID;
}

// ---- Non-customer exclusions (operator-confirmed 2026-06-16) ----
// Arc's own APP product — how Arc connects to the room AS ARC (not the company key).
// Pure infrastructure, never a paying customer; its memberships are dropped at ingest
// so no count / MRR / surface ever sees them.
const APP_PRODUCT_IDS = new Set<string>(["prod_M6LD5bS1EkNwD"]); // "arc-the-agent"

// Free-forever ADVISOR / internal test accounts — collaborators, not customers. Their
// events are dropped at ingest (mirrors the acquisition lane's ADVISOR_USER_IDS).
const ADVISOR_USER_IDS = new Set<string>(["user_ua7hpY3BdW19S"]); // milestesting (Miles)

/** The Whop USER id off an entity payload (`data.user.id`). `member.id` is the
 *  membership entity, NOT the user, so it is intentionally not used for identity. */
function eventUserId(data: unknown): string | null {
  const d = data as { user?: { id?: string | null } | null } | null;
  return d?.user?.id ?? null;
}

/**
 * Drop infrastructure + non-customer identities before they reach the ledger/surface.
 *
 * AI-007 (code-trace confirm, 2026-06-17): The advisor exclusion is `uid != null &&
 * ADVISOR_USER_IDS.has(uid)`. A null user id is NOT excluded as an advisor — it passes
 * through and may be counted. This is correct: we drop KNOWN advisor user ids; a null-uid
 * event cannot be a known advisor. A real advisor with a null uid is theoretically possible
 * (malformed payload), but ADVISOR_USER_IDS only contains specific user ids so null never
 * matches. The AI-043 null-uid warn log in ingestWhopEvent catches any null-uid events
 * that do pass through so they are visible (not silently counted).
 */
function isExcludedEvent(event: WhopEvent): boolean {
  if (event.product_id && APP_PRODUCT_IDS.has(event.product_id)) return true;
  const uid = eventUserId(event.data);
  return uid != null && ADVISOR_USER_IDS.has(uid);
}

// SQL WHERE fragments for the member-vs-product split — defined ONCE so the classification
// rule can't drift across the five query sites that use it (council/spark). Both bind
// MEMBERSHIP_PRODUCT_ID as their single `?` parameter. Safe to interpolate: pure dev constants,
// never user input.
const MEMBERSHIP_SCOPE = "(product_id = ? OR product_id IS NULL)"; // membership product or legacy NULL
const PRODUCT_SCOPE = "(product_id IS NOT NULL AND product_id <> ?)"; // any one-time product

/** Membership entity → WhopEvent. Type derives from status; id embeds status. */
export function normalizeMembership(m: MembershipLike): WhopEvent {
  const productId = entityProductId(m);
  // A one-time product (any non-membership SKU) has no renewal: Whop marks it
  // "completed" the instant it is fulfilled, which for the BUYER means "owns it" =
  // a CUSTOMER acquisition, not a churn. So a one-time "completed" normalizes to
  // membership.activated (→ counts as a product customer + gets the product-buyer
  // surface). For the recurring membership product, "completed" still means the
  // subscription ended → deactivated. (Operator-in-loop test 2026-06-16 surfaced
  // that one-time purchases land as "completed", never "active".)
  const oneTime = !isMembershipProduct(productId);
  // A one-time SKU's terminal "completed" = the buyer OWNS it = a customer acquisition.
  const completedPurchase = oneTime && m.status === "completed";
  const type = ACTIVE_MEMBERSHIP.has(m.status)
    ? "membership.activated"
    : ENDED_MEMBERSHIP.has(m.status)
      ? (completedPurchase ? "membership.activated" : "membership.deactivated")
      : "membership.updated";
  return {
    id: `whop-evt:membership:${m.id}:${m.status}`,
    type,
    occurred_at: m.created_at,
    data: m,
    product_id: productId,
  };
}

/** Map Whop ReceiptStatus → payment.* event type. */
function paymentType(status: string | null): string {
  switch (status) {
    case "paid":
      return "payment.succeeded";
    case "refunded":
      // AI-011: "refunded" appears in Whop's `substatus` (FriendlyReceiptStatus) and on
      // push-webhook payloads, but NOT in the poll-path `status` field (ReceiptStatus:
      // 'draft'|'open'|'paid'|'pending'|'uncollectible'|'unresolved'|'void'). This case
      // is therefore dead code on the current POLL path — the sensor polls `p.status`, not
      // `p.substatus`. It is retained as a forward-compatible seam: a future push-webhook
      // handler can feed a payment with status="refunded" and this branch fires correctly.
      // computeRevenue() nets payment.refunded rows with a POSITIVE amount_cents (the
      // magnitude, same sign convention as payment.succeeded) — correctness lens (cairn.17):
      // sign is positive because normalizePayment() reads p.usd_total ?? p.total, which
      // Whop always stores as a positive magnitude regardless of direction. The netting is
      // (succeeded − refunded) in computeRevenue(), so sign is correct.
      return "payment.refunded";
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
    product_id: entityProductId(p),
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
        // P10A: the Whop product the entity belongs to — drives the member-vs-product
        // money-number split (a one-time report buyer must NOT count as a $49/mo member).
        { name: "product_id", type: "TEXT" },
        { name: "payload", type: "TEXT" },
      ],
    });
    // createSourceLedger is CREATE TABLE IF NOT EXISTS ONLY — it never adds a column
    // to a table that predates product_id. A live whop_event_log created before P10A
    // therefore needs an explicit, guarded migration. On a fresh DB the CREATE already
    // carries product_id, so this ALTER throws "duplicate column name" and is ignored.
    // (Live table had 0 rows at P10A, so no backfill is needed — older rows read NULL,
    //  which computeRevenue() treats as the legacy membership product. See classify.)
    try {
      getDatabase().run("ALTER TABLE whop_event_log ADD COLUMN product_id TEXT");
    } catch (e) {
      // Swallow ONLY the expected "duplicate column" (column already present on a fresh
      // CREATE or a prior migration). Re-throw anything else (locked DB, IO error, a future
      // typo) so a genuinely failed migration surfaces instead of silently no-op'ing.
      if (!/duplicate column name/i.test(e instanceof Error ? e.message : String(e))) throw e;
    }
    // AI-006: Index on `type` for lifecycle queries (membership.activated / deactivated /
    // payment.succeeded / payment.refunded). Idempotent: IF NOT EXISTS ignores re-runs.
    // At M0 with 0 rows this is a no-op cost; it pays off once the table grows to
    // thousands of rows from recurring-member charges and product activations.
    getDatabase().run(
      "CREATE INDEX IF NOT EXISTS idx_whop_event_log_type ON whop_event_log(type)",
    );
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
export function ingestWhopEvent(event: WhopEvent): "recorded" | "duplicate" | "skipped" {
  // Drop Arc's app product + advisor/test identities BEFORE the ledger/surface so no
  // downstream count, MRR, or task ever sees them (operator-confirmed 2026-06-16).
  if (isExcludedEvent(event)) return "skipped";

  // AI-043: Warn on null user id so advisor-leak risk is visible in logs. A null-uid
  // event is NOT excluded (it may be a real customer with a malformed payload) but it
  // CANNOT be verified against the ADVISOR_USER_IDS set — log so it can be investigated.
  // At M0 scale this should never fire; if it does, inspect the payload shape.
  const uid = eventUserId(event.data);
  if (uid === null && !APP_PRODUCT_IDS.has(event.product_id ?? "")) {
    console.log(
      JSON.stringify({
        whop_ingest_warn: "null user id — cannot verify advisor exclusion; event will be counted",
        event_id: event.id,
        event_type: event.type,
        product_id: event.product_id ?? null,
      }),
    );
  }

  const ledger = whopEventLedger();
  if (ledger.dedupSkip(event.id, "ingested")) return "duplicate";

  surfaceWhopEvent(event);

  const amountCents =
    typeof event.amount === "number" && Number.isFinite(event.amount)
      ? Math.round(event.amount * 100)
      : null;

  // AI-012: Warn when a payment event arrives with a null/missing amount. A null amount
  // is stored as NULL in amount_cents and contributes $0 to revenue totals — a genuine
  // free/100%-off sale is expected, but a dropped amount field would be silently laundered
  // into $0. Log so it can be distinguished from intentional free grants.
  if (event.type === "payment.succeeded" && amountCents === null) {
    console.log(
      JSON.stringify({
        whop_ingest_warn: "payment.succeeded with null/missing amount — stored as $0; verify if intentional",
        event_id: event.id,
        product_id: event.product_id ?? null,
      }),
    );
  }

  ledger.record(event.id, event.type, {
    occurred_at: event.occurred_at,
    amount_cents: amountCents,
    product_id: event.product_id ?? null,
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
    // P10A gate: Whop wraps EVERY access grant — including a one-time report purchase —
    // in a `membership.activated`. Only the recurring membership product earns the
    // $49/mo room welcome; a one-time product buyer must NOT be greeted as a member
    // (it would mis-onboard a $9 customer). Non-membership-product activations surface
    // generically — product fulfillment/follow-up is owned elsewhere, not the room welcome.
    if (isMembershipProduct(event.product_id)) {
      surfaceMemberWelcome(event);
    } else {
      surfaceProductBuyer(event);
    }
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


// AI-008: Reactivation re-nudge helper.
// Returns true if this memberId has a prior membership.deactivated row in the event log,
// indicating they cancelled and are returning. Used to allow a fresh re-welcome nudge
// with a distinct source key (so the per-member exactly-once guard doesn't block it).
function isReactivation(memberId: string): boolean {
  const db = getDatabase();
  const memberIdJson = JSON.stringify(memberId);
  // Check both member.id and user.id paths (Whop data shape varies by event type)
  const row = db
    .query(
      `SELECT COUNT(*) as cnt FROM whop_event_log
       WHERE type = 'membership.deactivated'
       AND (json_extract(data, '$.member.id') = ? OR json_extract(data, '$.user.id') = ?)
       LIMIT 1`,
    )
    .get(memberId, memberId) as { cnt: number } | undefined;
  return (row?.cnt ?? 0) > 0;
}

/**
 * Queue EXACTLY ONE onboarding action per member for a `membership.activated` event.
 * Dedup key is the MEMBER (not the event), so a re-subscribe / second activation never
 * re-welcomes. The dispatched session composes a warm, voice-carded greeting + orientation
 * (arc-brand-voice + SOUL); the live post is gated by WHOP_WELCOME_DRY_RUN + voice-trust.
 *
 * AI-008: Reactivation re-nudge — if the member previously deactivated and is returning,
 * use a date-scoped source key so the dispatch loop can send a fresh "welcome back" nudge.
 * The original first-welcome source key remains for new members. A returning member gets
 * at most one re-nudge per reactivation date (source: whop-welcome:{memberId}:reactivation-{date}).
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

  // AI-008: reactivation re-nudge. If this member previously deactivated, use a
  // date-scoped source key to allow one fresh nudge per reactivation date.
  // New members: whop-welcome:{memberId} (per-member, ever).
  // Returning members: whop-welcome:{memberId}:reactivation-{YYYY-MM-DD} (per-date).
  const today = new Date().toISOString().slice(0, 10);
  const reactivation = isReactivation(memberId);
  const source = reactivation
    ? `whop-welcome:${memberId}:reactivation-${today}`
    : `whop-welcome:${memberId}`;

  if (taskExistsForSource(source)) return; // exactly-once per member (or per reactivation date)

  const isReactivationLabel = reactivation
    ? `\n\n**Reactivation** — this member was previously deactivated and has returned. Acknowledge the return; skip the standard new-member orientation (they know the room). Focus on what's changed since they left and invite them back into a thread.`
    : "";

  insertTask({
    subject: reactivation
      ? `Returning member re-nudge: welcome back ${handle}`
      : `New hash-it-out member: welcome ${handle}`,
    description: [
      reactivation
        ? `A previously-deactivated member reactivated their hash-it-out membership (event ${event.id}).`
        : `A new member activated their hash-it-out membership (event ${event.id}).`,
      `Handle: ${handle}${data.user?.name && data.user?.username ? ` (${data.user.name})` : ""}`,
      isReactivationLabel,
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

/**
 * Queue EXACTLY ONE follow-up action per one-time PRODUCT buyer (a non-membership-product
 * `membership.activated`). Distinct from the $49-member welcome (council/lumen): a $9 report
 * buyer is a CUSTOMER, not a room member, so this routes to a product-appropriate surface —
 * confirm fulfillment + extend the continuity bridge (the room invite) rather than greet them
 * as a member. Dedup key is the BUYER, so a re-dispatch never double-touches. The live
 * post-purchase room-invite send itself is the P10B acquisition lane's job (gated); this task
 * is the internal "a buyer landed — bridge them" signal so the buyer never falls into a void.
 */
export function surfaceProductBuyer(event: WhopEvent): void {
  const data = (event.data ?? {}) as MembershipWelcomeData;
  const buyerId = data.member?.id ?? data.user?.id;
  if (!buyerId) {
    console.log(
      JSON.stringify({ whop_product_buyer: "no stable buyer id — surfacing generically", event_id: event.id }),
    );
    queueGenericEvent(event);
    return;
  }
  const handle = data.user?.username || data.user?.name || "the new buyer";
  const source = `whop-product-buyer:${buyerId}`;
  if (taskExistsForSource(source)) return; // exactly-once per buyer

  insertTask({
    subject: `New product buyer: ${handle}`,
    description: [
      `Someone bought a one-time hash-it-out product (event ${event.id}, product ${event.product_id}).`,
      `Handle: ${handle}`,
      "",
      "This is a CUSTOMER, not a $49/mo member — do NOT send the member welcome. The job is the",
      "continuity bridge: confirm they got the deliverable, then compose and fire the viral-unit",
      "receipt + teaser, then extend a genuine, voice-carded invite into the room/ship-board",
      "(membership = the earned continuity). Keep it value-first, not a hard upsell.",
      "",
      "STEP 1 — COMPOSE THE RECEIPT (M0 milestone viral post):",
      `  arc skills run --name whop-sales -- receipt`,
      "  This reads the live paying-customer count and composes the M0 receipt post.",
      "  The receipt is the highest-virality artifact for the AI/agents audience — the proof",
      "  that an agent sold something, autonomously, to a real buyer.",
      "  Voice: SOUL.md — precise, no hype, receipt-standard (every claim ships its verifiable link).",
      "  Post the composed receipt to X (primary channel) and the paid forum.",
      "",
      "STEP 2 — COMPOSE A TEASER SLICE (free-preview → paid funnel):",
      `  arc skills run --name whop-sales -- teaser`,
      "  This composes a free teaser slice of the product pointing at the SKU.",
      `  The CTA points to: ${PRODUCT_PAGE_URL} with promo code ${PROMO_CODE}.`,
      "  Post the teaser to the free public forum (exp_YRtS3kgMVeBGzu) for discovery.",
      "",
      "STEP 3 — CONTINUITY BRIDGE (fire AFTER receipt + teaser are posted):",
      "  Send the actual room invite via post-chat (AI-015 wired send — exactly-once per buyer via --source):",
      `  Compose a genuine, voice-carded invite to the paid room/ship-board. SOUL.md voice: specific,`,
      "  name the thing they bought, frame the room as earned continuity (not upsell). Then send:",
      `  arc skills run --name whop -- post-chat --content "<invite text>" --source whop-room-invite:${buyerId} --channel exp_dlYgb6mrXuRIq8`,
      "  The --source key makes this idempotent (post-chat local ledger: a re-dispatch never double-sends).",
      `  Membership link to reference in the invite: ${PAID_ROOM_PRODUCT_URL}`,
      "  Give-3x discipline: the receipt + teaser ARE the 3x value. The invite is the ask.",
      "  NOTE: at M0/0-buyers this step never fires (composeReceipt refuses count<1); safe to activate now.",
      "",
      `(--source "${source}" makes any follow-up idempotent — a re-dispatch never double-touches.)`,
    ].join("\n"),
    skills: JSON.stringify(["whop", "whop-sales", "arc-brand-voice"]),
    priority: 4,
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
  const membershipProduct = isMembershipProduct(event.product_id);
  switch (event.type) {
    case "membership.activated":
      // A one-time report purchase also emits membership.activated — but it is NOT a
      // new ROOM member, so only the membership product fires the room-growth signal.
      return membershipProduct
        ? {
            topic: "room-growth",
            title: "A new member joined the room",
            nugget:
              "A new member just joined the hash-it-out 'AI Prefers Bitcoin' room. The room grew — " +
              "worth keeping in mind when reading the room: there may be someone new finding their footing.",
          }
        : {
            topic: "revenue",
            title: "A one-time product sold",
            nugget:
              "Someone bought a one-time hash-it-out product (a packaged research report, not a room " +
              "membership). Proof-of-work converted to a sale — the continuity bridge into the room is " +
              "the next read.",
          };
    case "payment.succeeded":
      return membershipProduct
        ? {
            topic: "revenue",
            title: "A membership payment cleared",
            nugget:
              "A hash-it-out membership payment cleared. Revenue signal — the room is being paid for; " +
              "the contract is to keep earning that read.",
          }
        : {
            topic: "revenue",
            title: "A product sale cleared",
            nugget:
              "A one-time hash-it-out product sale cleared. Revenue signal — the packaged proof-of-work " +
              "is converting; the read is whether the buyer crosses into the recurring room.",
          };
    default:
      return null; // other events surface as tasks only, not pool signals
  }
}

// ---- P22: revenue read over the event ledger (no separate sensor) ------

const MEMBERSHIP_PRICE_CENTS = 4900; // hash-it-out recurring membership: $49/mo
const BREAK_EVEN_MEMBERS = 16; // ~16-member break-even (QUEST)

export interface RevenueSummary {
  /** Currently-active RECURRING members (membership product only). Drives MRR. */
  activeMembers: number;
  activatedEvents: number;
  deactivatedEvents: number;
  mrrCents: number;
  /** ALL captured payments (recurring member charges + one-time product sales). */
  paymentsCapturedCents: number;
  paymentCount: number;
  /**
   * One-time product buyers = distinct non-membership-product memberships ever activated
   * (the ACCESS GRANT, not the payment). AI-010: deduped by Whop USER id (parsed from
   * event payload) — counts distinct humans, not membership entities. Falls back to
   * membership-entity count for rows with no parseable user id (unjoinable). A customer
   * is someone who acquired the product; revenue is separate.
   */
  productCustomers: number;
  /**
   * Per-product-id breakdown of productCustomers. AI-022: enables per-SKU scoping before
   * a 2nd product SKU inflates the global count. Keys are Whop product ids (e.g. `prod_…`).
   * At M0/M1-SKU this has at most one entry; add the 2nd SKU and this differentiates.
   */
  productCustomersByProductId: Record<string, number>;
  /**
   * Revenue from one-time product sales (NET: SUM payment.succeeded − SUM payment.refunded).
   * AI-011: refunds are netted out. A payment.refunded event (Whop status="refunded") carries
   * a negative contribution so the net figure reflects actual collected cash.
   */
  productRevenueCents: number;
  /** Gross refunded amount in cents for one-time product events (AI-011). */
  refundedRevenueCents: number;
  /**
   * M0/M10 headline = recurring members + product buyers. AI-010: productCustomers is now
   * user-id deduped so a person who buys once counts once (not twice as two membership entities).
   */
  customers: number;
  /**
   * PAYING customers = active recurring members (each pays $49/mo) + distinct one-time
   * product buyers who collected money (payment.succeeded amount > 0, user-id deduped).
   * AI-021: user-id deduped (via payload parse) — counts distinct humans who paid.
   * This is the honest **M0 ("first PAYING customer")** metric.
   */
  payingCustomers: number;
  /**
   * Distinct one-time product buyers who collected money (amount > 0). AI-021: deduped
   * by user id — parsed from payment.succeeded payloads. Unjoinable rows (null user id)
   * are excluded from the dedup set and counted in unjoinablePaymentRows.
   */
  payingProductCustomers: number;
  /** Payment.succeeded rows with a non-null product_id but no parseable user id (AI-021). */
  unjoinablePaymentRows: number;
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
  // RECURRING members only: a one-time report purchase ALSO emits membership.activated,
  // so the lifecycle read is scoped to the membership product (NULL = legacy membership).
  // Counting every membership.activated here is exactly the bug P10A fixes — it would
  // inflate active members / MRR with $9 product buyers.
  const lifecycle = db
    .query(
      `SELECT source, type FROM whop_event_log
       WHERE type IN ('membership.activated', 'membership.deactivated')
         AND ${MEMBERSHIP_SCOPE}
       ORDER BY recorded_at ASC`,
    )
    .all(MEMBERSHIP_PRODUCT_ID) as Array<{ source: string; type: string }>;
  const latestByEntity = new Map<string, string>();
  for (const r of lifecycle) latestByEntity.set(membershipEntityId(r.source), r.type);
  let activeMembers = 0;
  for (const t of latestByEntity.values()) if (t === "membership.activated") activeMembers++;

  const activated = lifecycle.filter((r) => r.type === "membership.activated");
  const deactivated = lifecycle.filter((r) => r.type === "membership.deactivated");

  // ALL captured payments (member renewals + product sales) — unchanged top-line cash.
  const pay = db
    .query(
      `SELECT COUNT(*) AS c, COALESCE(SUM(amount_cents), 0) AS s
       FROM whop_event_log WHERE type = 'payment.succeeded'`,
    )
    .get() as { c: number; s: number };

  // Product CUSTOMERS = distinct non-membership-product memberships ever activated (the
  // access grant). AI-010: deduped by Whop USER id (parsed from payload) rather than
  // membership entity id — counts distinct humans. Falls back to entity-id count for rows
  // with no parseable user id. Cumulative (no last-write-wins): a one-time purchase is
  // permanent; a $0 promo grant still counts as a customer.
  const prodMemberships = db
    .query(
      `SELECT source, payload, product_id FROM whop_event_log
       WHERE type = 'membership.activated' AND ${PRODUCT_SCOPE}`,
    )
    .all(MEMBERSHIP_PRODUCT_ID) as Array<{ source: string; payload: string | null; product_id: string | null }>;

  // AI-010: build the user-id set for dedup, falling back to entity id for unjoinable rows.
  const productCustomerUserIds = new Set<string>();
  // AI-022: per-product-id breakdown (key = product_id).
  const productCustomersByProductId: Record<string, Set<string>> = {};
  for (const r of prodMemberships) {
    // Attempt user-id dedup for the global count.
    let uid: string | null = null;
    if (r.payload) {
      try {
        uid = eventUserId(JSON.parse(r.payload));
      } catch {
        // malformed payload — fall through to entity-id fallback
      }
    }
    const dedupeKey = uid ?? membershipEntityId(r.source);
    productCustomerUserIds.add(dedupeKey);
    // Per-product breakdown (AI-022).
    const pid = r.product_id ?? "unknown";
    if (!productCustomersByProductId[pid]) productCustomersByProductId[pid] = new Set<string>();
    productCustomersByProductId[pid].add(dedupeKey);
  }
  const productCustomers = productCustomerUserIds.size;
  // Convert per-product Sets to counts.
  const productCustomersByProductIdCounts: Record<string, number> = {};
  for (const [pid, s] of Object.entries(productCustomersByProductId)) {
    productCustomersByProductIdCounts[pid] = s.size;
  }

  // Product REVENUE = NET: SUM payment.succeeded − SUM payment.refunded for non-membership
  // product payments. AI-011: refunds are netted out. Sign convention (cairn.17 correctness
  // flag): amount_cents for payment.refunded rows is stored as a POSITIVE magnitude
  // (normalizePayment reads p.usd_total ?? p.total, which Whop returns as a positive number
  // regardless of direction). The subtraction (succeeded − refunded) is therefore correct.
  // NOTE: the poll path cannot currently produce payment.refunded rows (Whop's `status`
  // field never contains "refunded" — see paymentType() comment); this netting is safe
  // no-op at M0 and activates correctly once a push-webhook path is added (AI-077).
  const prodPaySucceeded = db
    .query(
      `SELECT COALESCE(SUM(amount_cents), 0) AS s
       FROM whop_event_log
       WHERE type = 'payment.succeeded' AND ${PRODUCT_SCOPE}`,
    )
    .get(MEMBERSHIP_PRODUCT_ID) as { s: number };
  const prodPayRefunded = db
    .query(
      `SELECT COALESCE(SUM(amount_cents), 0) AS s
       FROM whop_event_log
       WHERE type = 'payment.refunded' AND ${PRODUCT_SCOPE}`,
    )
    .get(MEMBERSHIP_PRODUCT_ID) as { s: number };
  const refundedRevenueCents = prodPayRefunded.s;
  const productRevenueCents = prodPaySucceeded.s - refundedRevenueCents;

  // PAYING one-time product customers = distinct users behind product payment.succeeded rows
  // that collected money (amount_cents > 0). AI-021: deduped by user id via userIdSet()
  // (reuse: patterns lens / forge.15 recommended collapse — the contract is identical to
  // the existing helper). A 100%-off / $0 grant is a `customer` but NOT a paying one.
  const prodPaidRows = db
    .query(
      `SELECT payload FROM whop_event_log
       WHERE type = 'payment.succeeded' AND amount_cents > 0 AND ${PRODUCT_SCOPE}`,
    )
    .all(MEMBERSHIP_PRODUCT_ID) as Array<{ payload: string | null }>;
  // AI-021: userIdSet() parses user ids, returns {ids, unjoinable} — same semantics as
  // computeProductToRoomConversion(). Intentional over-count caveat (cairn.17): a user
  // with one joinable and one unjoinable payment row is counted twice (once in ids, once
  // as +1 unjoinable). At M0 with exactly-one purchase per buyer this is never hit.
  // Conservative over-count is safer than under-count for the M0 "first PAYING customer".
  const { ids: prodPaidUserIds, unjoinable: unjoinablePaymentRows } = userIdSet(prodPaidRows);
  const payingProductCustomers = prodPaidUserIds.size + unjoinablePaymentRows;
  // Recurring members all pay $49/mo, so they are paying by definition.
  const payingCustomers = activeMembers + payingProductCustomers;

  return {
    activeMembers,
    activatedEvents: activated.length,
    deactivatedEvents: deactivated.length,
    mrrCents: activeMembers * MEMBERSHIP_PRICE_CENTS,
    paymentsCapturedCents: pay.s,
    paymentCount: pay.c,
    productCustomers,
    productCustomersByProductId: productCustomersByProductIdCounts,
    productRevenueCents,
    refundedRevenueCents,
    customers: activeMembers + productCustomers,
    payingCustomers,
    payingProductCustomers,
    unjoinablePaymentRows,
    breakEvenTarget: BREAK_EVEN_MEMBERS,
    breakEvenPct: Math.round((activeMembers / BREAK_EVEN_MEMBERS) * 100),
  };
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Human-readable revenue block for the whop CLI + watch-report / CEO-review surfaces. */
export function formatRevenue(r: RevenueSummary = computeRevenue()): string {
  const refundNote = r.refundedRevenueCents > 0 ? `  (refunded ${usd(r.refundedRevenueCents)})` : "";
  const perProductLines = Object.entries(r.productCustomersByProductId)
    .map(([pid, count]) => `  product buyers (${pid}): ${count}  [per-SKU; AI-022]`)
    .join("\n");
  const unjoinableNote =
    r.unjoinablePaymentRows > 0
      ? `  ⚠ ${r.unjoinablePaymentRows} paying-row(s) without user id — counted individually, not deduped`
      : "";
  return [
    "hash-it-out revenue (from captured Whop events — whop_event_log):",
    `  customers:          ${r.customers}  (${r.activeMembers} recurring members + ${r.productCustomers} product buyers)  [acquisition; user-id deduped; incl $0 grants]`,
    `  paying customers:   ${r.payingCustomers}  (${r.activeMembers} paying members + ${r.payingProductCustomers} paid product buyers)  [M0/M10 headline — real revenue]${r.customers > 0 && r.payingCustomers === 0 ? "  ⚠ $0 comps only — M0 NOT reached" : ""}`,
    unjoinableNote,
    `  recurring members:  ${r.activeMembers}  (activated ${r.activatedEvents} / deactivated ${r.deactivatedEvents} membership-product events)`,
    `  MRR:                ${usd(r.mrrCents)}  (${r.activeMembers} × $49/mo)`,
    `  product revenue:    ${usd(r.productRevenueCents)}  (net; gross − refunds${refundNote}; from ${r.productCustomers} buyer(s), incl. any $0 grants)`,
    perProductLines,
    `  payments captured:  ${usd(r.paymentsCapturedCents)}  across ${r.paymentCount} payment.succeeded (member + product)`,
    `  break-even:         ${r.activeMembers}/${r.breakEvenTarget} recurring members (${r.breakEvenPct}%)`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---- P7: weekly net-new + leading indicators + MRR-ladder progress --------
//
// Extends the P22 revenue read into the weekly spine (net-new members/week), the P4
// MRR ladder ($10k/$50k), and leading indicators — instrumented BEFORE traffic so
// velocity counts from member #1. NO separate sensor: the same read over
// `whop_event_log`, plus a read-only glance at `cycle_log.cost_usd` (Arc's compute
// spend) and the local `db/x-budget.json` (cadence). Net-new + retention are
// captured-events ESTIMATES with the same poll-coverage caveat as computeRevenue()
// (a reactivation after cancel can be missed because the `:active` event id dedups) —
// labeled as such in the render. Pull-what's-cheap; everything not cheaply available
// is CLEARLY STUBBED with a TODO + the phase that wires it, never silently dropped.

const M10_TARGET = 10; // first-10 members = quest DONE bar
const LADDER_10K_CENTS = 1_000_000; // $10k/mo table stakes (P4)
const LADDER_50K_CENTS = 5_000_000; // $50k/mo ambition (P4)
const GUARDRAIL_ARPU_PCT = 20; // $/member-served trip-wire: >~20% of blended ARPU (P4 §6)
const RETENTION_FLOOR_PCT = 60; // day-60 cohort retention floor (P4 proof gate)
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const DAY60_MS = 60 * DAY_MS;

export interface WeekBucket {
  /** UTC date (YYYY-MM-DD) of the 7-day window start (inclusive). */
  startsAt: string;
  activations: number; // membership-product activations in the window
  deactivations: number;
  netNew: number; // net-new RECURRING members (activations − deactivations)
  newProductCustomers: number; // product membership activations (acquisitions) in the window
  netNewCustomers: number; // net-new members + new product customers (the customer spine)
}

export interface NetNewSummary {
  current: number; // net-new recurring members in the most-recent 7d window
  previous: number; // net-new recurring members in the prior 7d window
  trend: "up" | "down" | "flat";
  currentCustomers: number; // net-new customers (members + product sales), latest window
  previousCustomers: number; // net-new customers, prior window
  customerTrend: "up" | "down" | "flat";
  buckets: WeekBucket[]; // oldest → newest
  distanceToM10: number; // CUSTOMERS still needed for M10 (>=0) — M10 = 10 customers
  distanceToBreakEven: number; // recurring members still needed for break-even (>=0)
}

/**
 * Weekly net-new paying members over rolling 7-day windows ending `now`. Net-new[w] =
 * (activation events recorded in w) − (deactivation events recorded in w), bucketed by
 * `recorded_at` (the ledger's monotonic capture time, an ISO-8601 UTC string) to mirror
 * computeRevenue()'s basis. Captured-events estimate (poll-coverage caveat applies).
 * `weeks` = trailing windows to report; `now` is injectable for deterministic tests.
 */
export function computeWeeklyNetNew(
  weeks = 4,
  now: number = Date.now(),
  activeMembers?: number,
  customers?: number,
): NetNewSummary {
  whopEventLedger();
  const db = getDatabase();
  // Net-new MEMBERS = membership-product lifecycle only (a one-time product activation
  // is NOT a recurring member). Net-new CUSTOMERS additionally folds in one-time product
  // sales — the spine the M0/M10 customer count rides on.
  const rows = db
    .query(
      `SELECT type, recorded_at FROM whop_event_log
       WHERE type IN ('membership.activated', 'membership.deactivated')
         AND ${MEMBERSHIP_SCOPE}`,
    )
    .all(MEMBERSHIP_PRODUCT_ID) as Array<{ type: string; recorded_at: string }>;
  // New product customers per window = non-membership-product membership ACTIVATIONS
  // (acquisitions), matching computeRevenue's customer basis (a $0 grant still counts).
  const productRows = db
    .query(
      `SELECT recorded_at FROM whop_event_log
       WHERE type = 'membership.activated' AND ${PRODUCT_SCOPE}`,
    )
    .all(MEMBERSHIP_PRODUCT_ID) as Array<{ recorded_at: string }>;

  const oldestStart = now - weeks * WEEK_MS;
  const buckets: WeekBucket[] = [];
  for (let i = 0; i < weeks; i++) {
    buckets.push({
      startsAt: new Date(oldestStart + i * WEEK_MS).toISOString().slice(0, 10),
      activations: 0,
      deactivations: 0,
      netNew: 0,
      newProductCustomers: 0,
      netNewCustomers: 0,
    });
  }
  const bucketIndex = (recordedAt: string): number | null => {
    const t = Date.parse(recordedAt);
    if (Number.isNaN(t) || t < oldestStart || t >= now) return null;
    return Math.min(weeks - 1, Math.floor((t - oldestStart) / WEEK_MS));
  };
  for (const r of rows) {
    const idx = bucketIndex(r.recorded_at);
    if (idx === null) continue;
    if (r.type === "membership.activated") buckets[idx].activations++;
    else buckets[idx].deactivations++;
  }
  for (const r of productRows) {
    const idx = bucketIndex(r.recorded_at);
    if (idx === null) continue;
    buckets[idx].newProductCustomers++;
  }
  for (const b of buckets) {
    b.netNew = b.activations - b.deactivations;
    b.netNewCustomers = b.netNew + b.newProductCustomers;
  }

  const current = buckets[weeks - 1]?.netNew ?? 0;
  const previous = buckets[weeks - 2]?.netNew ?? 0;
  const trend = current > previous ? "up" : current < previous ? "down" : "flat";
  const currentCustomers = buckets[weeks - 1]?.netNewCustomers ?? 0;
  const previousCustomers = buckets[weeks - 2]?.netNewCustomers ?? 0;
  const customerTrend =
    currentCustomers > previousCustomers ? "up" : currentCustomers < previousCustomers ? "down" : "flat";
  // Reuse the caller's already-computed counts when given (computeReadout passes them) so a
  // full readout doesn't recompute computeRevenue() twice; standalone calls still default.
  const revenue = activeMembers === undefined || customers === undefined ? computeRevenue() : null;
  const active = activeMembers ?? revenue!.activeMembers;
  const totalCustomers = customers ?? revenue!.customers;
  return {
    current,
    previous,
    trend,
    currentCustomers,
    previousCustomers,
    customerTrend,
    buckets,
    distanceToM10: Math.max(0, M10_TARGET - totalCustomers),
    distanceToBreakEven: Math.max(0, BREAK_EVEN_MEMBERS - active),
  };
}

export interface RetentionSummary {
  pct: number | null; // null = no day-60 cohort yet
  cohortSize: number;
  retained: number;
}

/**
 * Day-60 cohort retention: among entities whose EARLIEST captured activation is ≥60 days
 * old, the share still in an activated state (last-write-wins). `null` until a cohort
 * exists. Captured-events estimate (same poll-coverage caveat). Inherited P5/P4 proof gate.
 */
export function computeDay60RetentionPct(now: number = Date.now()): RetentionSummary {
  whopEventLedger();
  const db = getDatabase();
  // Retention = the RECURRING base (membership product only); one-time product buyers
  // have no renewal to retain, so they are out of this cohort by construction.
  const rows = db
    .query(
      `SELECT source, type, recorded_at FROM whop_event_log
       WHERE type IN ('membership.activated', 'membership.deactivated')
         AND ${MEMBERSHIP_SCOPE}
       ORDER BY recorded_at ASC`,
    )
    .all(MEMBERSHIP_PRODUCT_ID) as Array<{ source: string; type: string; recorded_at: string }>;
  const firstActivation = new Map<string, number>();
  const latestType = new Map<string, string>();
  for (const r of rows) {
    const e = membershipEntityId(r.source);
    if (r.type === "membership.activated" && !firstActivation.has(e)) {
      firstActivation.set(e, Date.parse(r.recorded_at));
    }
    latestType.set(e, r.type);
  }
  let cohortSize = 0;
  let retained = 0;
  for (const [e, firstT] of firstActivation) {
    if (Number.isNaN(firstT) || now - firstT < DAY60_MS) continue; // not yet 60d in the cohort
    cohortSize++;
    if (latestType.get(e) === "membership.activated") retained++;
  }
  return {
    pct: cohortSize === 0 ? null : Math.round((retained / cohortSize) * 100),
    cohortSize,
    retained,
  };
}

export interface ConversionSummary {
  /** Distinct USERS who acquired a one-time product (the denominator). */
  productBuyers: number;
  /** Of those buyers, how many ALSO activated a recurring membership (crossed into the room). */
  converted: number;
  /** converted ÷ productBuyers as a 0–100 percent; null until the first product buyer. */
  pct: number | null;
  /**
   * Ledger rows (across BOTH sides) that carried NO joinable user id — no payload, a parse
   * error, or a payload with no `data.user.id`. Excluded from the rate. Surfaced because a
   * silent undercount of the DENOMINATOR would flatter the rate (dev-council lumen): at M0/M10
   * scale this should be 0, so >0 is a loud signal of malformed data OR SDK shape-drift (the
   * user id moved) — exactly when the rate would otherwise read a misleading 0%/N/A.
   */
  unjoinableRows: number;
}

/**
 * Distinct, non-null Whop user ids (`data.user.id`) parsed out of a set of ledger payload rows,
 * plus a count of rows that yielded NO user id (unjoinable). `eventUserId` is null-safe via
 * optional chaining (`d?.user?.id`), so a payload that parses to `null`/a primitive/an array
 * returns null rather than throwing — only `JSON.parse` itself can throw, and that's caught.
 */
function userIdSet(rows: Array<{ payload: string | null }>): { ids: Set<string>; unjoinable: number } {
  const ids = new Set<string>();
  let unjoinable = 0;
  for (const r of rows) {
    if (!r.payload) {
      unjoinable++;
      continue;
    }
    let data: unknown;
    try {
      data = JSON.parse(r.payload);
    } catch {
      unjoinable++; // malformed payload — can't join on a user (NOT silently counted as a buyer)
      continue;
    }
    const uid = eventUserId(data);
    if (uid) ids.add(uid);
    else unjoinable++; // parsed but no user id (shape-drift or a null/primitive payload body)
  }
  return { ids, unjoinable };
}

/**
 * Product→ROOM conversion RATE — the P10.0b-LOCKED **primary M0 success metric** (at $9 the
 * revenue is noise; what matters is whether a buyer crosses into the recurring room). GTM
 * growth-council rev #2 (2026-06-17): wire it as a first-class computed field BEFORE buyer #1,
 * so the funnel can be steered from the first sale rather than waiting on the coarse M10
 * sub-gate (≥3-of-10 recurring) to observe conversion too late.
 *
 * Numerator = distinct product-buyer USERS who ALSO activated a recurring membership;
 * denominator = distinct product-buyer USERS. `null` until the first product buyer.
 *
 * Per-USER basis ON PURPOSE — the ONE place this module dedups by human, not by membership
 * (cf. RevenueSummary.customers, which is per-membership): a buyer "becoming a member" is
 * inherently a per-person event, and a product buy + a room join are two different memberships
 * under one user id. The join key is `data.user.id` off the event payload; rows with no user id
 * can't be joined and are excluded from BOTH sides (documented, not silently counted). "Became a
 * member" = has ANY recurring-membership activation (the conversion BRIDGE fired at least once);
 * whether they STAY is the orthogonal day-60 retention metric — the two are kept separate by
 * design so a conversion rate is never conflated with churn.
 */
export function computeProductToRoomConversion(): ConversionSummary {
  whopEventLedger();
  const db = getDatabase();
  // AI-034: 90-day window on both queries — limits full-table scan growth. A buyer who
  // first activated >90d ago is excluded from the denominator; extend the window if you
  // need to re-examine older cohorts. At M0 this window has no effect (0 rows).
  // AI-036: EXACT while ONE product SKU exists — productRows = ALL non-membership
  // activations = "product buyers". With a 2nd SKU, add a product_id filter here.
  const productRows = db
    .query(
      `SELECT payload FROM whop_event_log
       WHERE type = 'membership.activated' AND ${PRODUCT_SCOPE}
         AND recorded_at >= datetime('now', '-90 days')`,
    )
    .all(MEMBERSHIP_PRODUCT_ID) as Array<{ payload: string | null }>;
  const memberRows = db
    .query(
      `SELECT payload FROM whop_event_log
       WHERE type = 'membership.activated' AND ${MEMBERSHIP_SCOPE}
         AND recorded_at >= datetime('now', '-90 days')`,
    )
    .all(MEMBERSHIP_PRODUCT_ID) as Array<{ payload: string | null }>;

  const buyers = userIdSet(productRows);
  const members = userIdSet(memberRows);
  let converted = 0;
  for (const u of buyers.ids) if (members.ids.has(u)) converted++;
  const productBuyers = buyers.ids.size;
  return {
    productBuyers,
    converted,
    // AI-033: one decimal place (e.g. "33.3%") — Math.round(x * 1000) / 10 gives 1dp.
    pct: productBuyers === 0 ? null : Math.round((converted / productBuyers) * 1000) / 10,
    unjoinableRows: buyers.unjoinable + members.unjoinable,
  };
}

/** Arc compute spend (USD cents) from `cycle_log.cost_usd` — today + trailing 7 days. Read-only. */
export function computeSpend(): { todayCents: number; trailing7dCents: number } {
  const db = getDatabase();
  try {
    const today = db
      .query(`SELECT COALESCE(SUM(cost_usd), 0) AS s FROM cycle_log WHERE date(started_at) = date('now')`)
      .get() as { s: number };
    const trailing = db
      .query(`SELECT COALESCE(SUM(cost_usd), 0) AS s FROM cycle_log WHERE started_at >= datetime('now', '-7 days')`)
      .get() as { s: number };
    return { todayCents: Math.round((today.s ?? 0) * 100), trailing7dCents: Math.round((trailing.s ?? 0) * 100) };
  } catch {
    return { todayCents: 0, trailing7dCents: 0 }; // cycle_log absent on a bare fixture DB
  }
}

/** Best-effort read of today's X cadence from the local budget file + trailing 7d history. null if unavailable.
 *  AI-004: also surface today's reply count (right-audience engagement proxy).
 *  AI-005: trailing 7d post count from db/x-budget-history.json (appended by social-x-posting/cli.ts
 *  on daily budget rotation — when a new day starts, the old day's budget is archived there).
 */
function readCadenceToday(): { date: string; xPosts: number; xReplies: number; trailing7dPosts: number | null } | null {
  try {
    const j = JSON.parse(readFileSync("db/x-budget.json", "utf8")) as { date?: string; posts?: number; replies?: number };
    let trailing7dPosts: number | null = null;
    try {
      const hist = JSON.parse(readFileSync("db/x-budget-history.json", "utf8")) as Array<{ date?: string; posts?: number }>;
      if (Array.isArray(hist)) {
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        trailing7dPosts = hist
          .filter((h) => h.date && h.date >= cutoff)
          .reduce((sum, h) => sum + (typeof h.posts === "number" ? h.posts : 0), 0);
      }
    } catch {
      // history file absent or unreadable — trailing unavailable
    }
    return {
      date: j.date ?? "?",
      xPosts: typeof j.posts === "number" ? j.posts : 0,
      xReplies: typeof j.replies === "number" ? j.replies : 0,
      trailing7dPosts,
    };
  } catch {
    return null;
  }
}

export interface ReadoutSummary {
  revenue: RevenueSummary;
  netNew: NetNewSummary;
  /** Product→room conversion — the LOCKED primary M0 metric (P10.0b; council rev #2). */
  conversion: ConversionSummary;
  ladder: { mrrCents: number; pctTo10k: number; pctTo50k: number };
  retention: RetentionSummary;
  spend: { todayCents: number; trailing7dCents: number };
  /**
   * Trailing-7d spend ÷ RECURRING members; null at 0 recurring members (no denominator).
   * Renamed from $/member-served (council rev #4): the denominator MUST be recurring
   * members — a one-time $9 buyer is not a monthly-served member, so folding product
   * buyers in would silently deflate the trip-wire the moment products dominate the mix.
   * Product CAC is tracked separately (a one-time sale's economics differ from a renewal).
   */
  dollarPerRecurringMemberServedCents: number | null;
}

/** Compose the full P7 readout (revenue + weekly net-new + ladder + retention + spend). */
export function computeReadout(now: number = Date.now()): ReadoutSummary {
  const revenue = computeRevenue();
  const spend = computeSpend();
  return {
    revenue,
    netNew: computeWeeklyNetNew(4, now, revenue.activeMembers, revenue.customers),
    conversion: computeProductToRoomConversion(),
    ladder: {
      mrrCents: revenue.mrrCents,
      pctTo10k: Math.round((revenue.mrrCents / LADDER_10K_CENTS) * 100),
      pctTo50k: Math.round((revenue.mrrCents / LADDER_50K_CENTS) * 100),
    },
    retention: computeDay60RetentionPct(now),
    spend,
    dollarPerRecurringMemberServedCents:
      revenue.activeMembers > 0 ? Math.round(spend.trailing7dCents / revenue.activeMembers) : null,
  };
}

const TREND_GLYPH = { up: "▲", down: "▼", flat: "→" } as const;

/**
 * Human-readable readout for the whop CLI + watch-report (arc-reporting) + CEO review
 * (arc-strategy-review) — the superset of formatRevenue(). Stubs are labeled inline with
 * the phase that wires them, so a clearly-stubbed line is never mistaken for a real zero.
 */
export function formatReadout(r: ReadoutSummary = computeReadout()): string {
  const nn = r.netNew;
  const trail = nn.buckets
    .map((b) => `${b.startsAt} ${b.netNew >= 0 ? "+" : ""}${b.netNew}`)
    .join(" · ");
  const cadence = readCadenceToday();
  const conv = r.conversion;
  // AI-035: emit a warn log when unjoinable rows exceed 0 (shape-drift or payload errors).
  if (conv.unjoinableRows > 0) {
    console.log(
      JSON.stringify({
        whop_readout_warn: "unjoinable rows in conversion rate — payload missing user id; rate may be understated",
        unjoinableRows: conv.unjoinableRows,
      }),
    );
  }
  const convUnjoinable = conv.unjoinableRows > 0 ? `  ⚠ ${conv.unjoinableRows} row(s) unjoinable — excluded` : "";
  const convLine =
    conv.pct === null
      ? `N/A (no product buyer yet)${convUnjoinable}`
      : `${conv.pct}%  (${conv.converted}/${conv.productBuyers} buyers ever activated the room membership)${convUnjoinable}`;
  const ret = r.retention;
  const retLine =
    ret.pct === null
      ? `N/A (no day-60 cohort yet)  [floor ${RETENTION_FLOOR_PCT}%]`
      : `${ret.pct}% (retained ${ret.retained}/${ret.cohortSize})  [floor ${RETENTION_FLOOR_PCT}%]`;
  const dpms = r.dollarPerRecurringMemberServedCents;
  const arpuPct =
    dpms === null ? null : Math.round((dpms / MEMBERSHIP_PRICE_CENTS) * 100);
  const guardLine =
    dpms === null
      ? `spend 7d ${usd(r.spend.trailing7dCents)} (today ${usd(r.spend.todayCents)}) ÷ 0 recurring members → N/A (pre-M0)  [trip-wire >~${GUARDRAIL_ARPU_PCT}% blended ARPU]`
      : `${usd(dpms)}/recurring-member (${arpuPct}% of $49 ARPU; spend 7d ${usd(r.spend.trailing7dCents)})  [trip-wire >~${GUARDRAIL_ARPU_PCT}%]${
          (arpuPct ?? 0) > GUARDRAIL_ARPU_PCT ? "  ⚠ BREACH" : ""
        }`;
  // AI-013/AI-053: Wire product CAC as trailing 7d spend ÷ paying product buyers.
  // Economics differ from $/recurring-member-served (a one-time sale has a different
  // unit economics model than a monthly renewal). Pre-first-buyer: stub with context.
  const productCacLine =
    r.revenue.payingProductCustomers > 0
      ? `${usd(Math.round(r.spend.trailing7dCents / r.revenue.payingProductCustomers))}/paying-product-buyer  (7d spend ${usd(r.spend.trailing7dCents)} ÷ ${r.revenue.payingProductCustomers} buyer(s))  [tracked SEPARATELY from $/recurring-member]`
      : `N/A (no paying product buyers yet — pre-first-sale)  [will show 7d spend ÷ paying product buyers]`;
  const sgn = (n: number) => (n >= 0 ? "+" : "") + n;

  return [
    formatRevenue(r.revenue),
    "",
    "weekly net-new (captured-events estimate — same basis as above; poll-coverage caveat):",
    `  customers this wk:  ${sgn(nn.currentCustomers)}  (${TREND_GLYPH[nn.customerTrend]} vs prior week ${sgn(nn.previousCustomers)})  [M0/M10 spine]`,
    `  members this wk:    ${sgn(nn.current)}  (${TREND_GLYPH[nn.trend]} vs prior week ${sgn(nn.previous)})  [recurring continuity]`,
    `  trailing 4 wks (mbr): ${trail}`,
    `  distance:           M10 in ${nn.distanceToM10} customers · break-even in ${nn.distanceToBreakEven} members`,
    "",
    "product→room conversion (P10.0b — THE primary M0 metric: rate not revenue; per-USER; activation not current retention — see day-60):",
    `  buyers→members:     ${convLine}`,
    "",
    "MRR ladder (P4 — current vs targets):",
    `  current MRR:        ${usd(r.ladder.mrrCents)}  ·  $10k: ${r.ladder.pctTo10k}%  ·  $50k: ${r.ladder.pctTo50k}%`,
    "",
    "leading indicators (move before the member count does):",
    // AI-003: follower count lives in X API — `arc skills run --name social-x-posting -- status`
    // returns JSON with {followers, following, tweets} from GET /users/me?user.fields=public_metrics.
    // NOT wired here (live API call per readout tick adds X read-budget pressure — see db/x-budget.json).
    // Operator: run `arc skills run --name social-x-posting -- status` for current follower count.
    `  audience growth:    (run \`arc skills run --name social-x-posting -- status\` for live followers — X API, not wired per-tick to preserve read budget)`,
    `  cadence adherence:  ${cadence ? `X posts today: ${cadence.xPosts} (${cadence.date}) | 7d trailing: ${cadence.trailing7dPosts !== null ? cadence.trailing7dPosts + " posts" : "(no history yet)"}` : "X budget unavailable"}  ·  planned-cap: ~2/day (12h CADENCE_INTERVAL)  [AI-005]`,
    // AI-004: right-audience engagement — X replies to leads tracked in x_reply_log (social-x-posting
    // skill's SQLite, not the main arc.sqlite). `arc skills run --name social-x-posting -- budget`
    // shows daily reply count. Full engagement signal needs ship-board + forum-reply tracking (post-M0).
    `  right-audience eng:  X replies today: ${cadence ? String(cadence.xReplies ?? "—") : "—"}  (see x_reply_log in social-x-posting skill for lead-targeted replies)`,
    "",
    "inherited proof lines (P5/P4 hand-offs):",
    `  day-60 retention:   ${retLine}`,
    // AI-002: 7d ship-log — post-M0; requires ship-board skill to track member ship-log posts.
    `  7d ship-log count:  (post-M0 — ship-board skill needed; track members posting an attributable ship-log within 7d)`,
    `  $/recurring-member-served: ${guardLine}`,
    `  product CAC:        ${productCacLine}`,
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
