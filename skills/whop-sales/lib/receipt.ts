#!/usr/bin/env bun

// skills/whop-sales/lib/receipt.ts
//
// The PURE receipt + teaser composer — the viral-unit half of the product-led
// funnel (P10B). Two deterministic composers, mirroring lib/compose.ts:
//
//   composeReceipt — the first-sale (and Nth-sale) RECEIPT post. The shareable
//     proof unit: "report #N just sold." Arc publishes its own count openly —
//     transparency-as-trust — and points to the report's PUBLIC PROVENANCE as the
//     verifiable hook. The first sale (#1) is the M0 moment, framed as such.
//
//   composeTeaser — a free TEASER SLICE of a paid product. The artifact-boundary
//     (P10.0b council): the raw/synthesized SLICE is free and must deliver real
//     value standalone (give-3x-before-you-ask); the PACKAGED, receipt-bearing
//     full version is the $9 ask. The slice points at the SKU; it is not a
//     content-free tease.
//
// Deterministic glue only: NO LLM call, NO credentials, NO network, NO writes.
// It composes post TEXT; it does not post. Posting + caps/dedup are the sensor's
// lane (lib/enforcement.ts + sensor.ts), gated behind WHOP_SALES_DRY_RUN until
// go-live — so the FIRST REAL receipt post waits for go-live / the first paid sale.
//
// HONESTY KEYSTONE (crypto-trust lens; mirrors the P10A HTML's no-overclaim fix
// and the events.ts `payingCustomers` discipline): a receipt may report ONLY a
// real, paid sale. `count` is the PAYING product-customer count (amount > 0) — a
// $0 comp / 100%-off test is NOT a sale and must NOT mint a receipt. composeReceipt
// REFUSES (ok:false) at count < 1. And the count is framed as Arc's own published
// number (self-report), never as something a stranger can independently audit (Whop
// sales counts are private; there is no on-chain sale record on Stripe rails) — the
// ONLY externally-verifiable claim is the product's lineage, which is what "verify"
// points at.

// PRODUCT_PAGE_URL is the one-time $9 SKU's page (NOT PAID_ROOM_PRODUCT_URL, which
// is the $49 membership) — both carry `?a=arc0btc`. The receipt/teaser sell the
// PRODUCT; the membership is named only as continuity over in lib/compose.ts.
// PRODUCT_ID + PRODUCT_PAGE_URL now in lib/product-catalog.ts (AI-023 extraction)
import { NEVER_SAY } from "./compose.ts";

// --- shared post-finalization (single-sources the channel doctrine) --------
//
// X (and any unknown channel) keep the ONE attributed link in the FIRST REPLY —
// in-body links cut reach 50–90% (P3 rev #1). forum/nostr don't penalize links, so
// a single-post venue folds the link into the body (first_reply empty). Defined once
// so this doctrine cannot drift between the receipt and teaser composers, and so the
// never-say scan always runs over the FINAL emitted text (post-fold), both fields.

interface FinalizedPost {
  composed_post: { body: string; first_reply: string };
  never_say_hits: string[];
  never_say_clean: boolean;
  warnings: string[];
}

function finalizePost(body: string, firstReply: string, channel: string, label: string): FinalizedPost {
  const linkInBody = channel === "forum" || channel === "nostr";
  const composed = linkInBody
    ? { body: `${body}\n\n${firstReply}`, first_reply: "" }
    : { body, first_reply: firstReply };
  const haystack = `${composed.body} ${composed.first_reply}`.toLowerCase();
  const neverSayHits = NEVER_SAY.filter((w) => haystack.includes(w));
  const warnings: string[] = [];
  if (neverSayHits.length > 0) warnings.push(`${label} contains never-say phrase(s): ${neverSayHits.join(", ")}`);
  return {
    composed_post: composed,
    never_say_hits: neverSayHits,
    never_say_clean: neverSayHits.length === 0,
    warnings,
  };
}

// --- The product catalog (teaser source), as data --------------------------
//
// Extracted to lib/product-catalog.ts (AI-023) so the research-to-SKU pipeline
// can generate entries without importing the receipt-composer. Re-exported here
// so existing call-sites that import from receipt.ts keep working unchanged.
import { ProductTeaserSlice, ProductMeta, PRODUCT_CATALOG, getProductMeta } from "./product-catalog.ts";
export { ProductTeaserSlice, ProductMeta, PRODUCT_CATALOG, getProductMeta };

// --- Receipt composer ------------------------------------------------------

export interface ReceiptInput {
  /** Paying product sales so far (events.ts `payingProductCustomers` — amount > 0). */
  count: number;
  /** Which product (defaults to the flagship). */
  productId?: string;
  /** x | forum | nostr — where the receipt lands (drives link placement). */
  channel?: string;
  /**
   * AI-030: optional on-chain additive line (treasury/ship-log tx that funded this cycle).
   * When provided, appended to the body as "On-chain: <onChainLine>". Separately-gated:
   * only include when a real verifiable on-chain artifact exists (txid/explorer URL).
   * Default: undefined (line absent). No-overclaim discipline: the additive is
   * factual provenance, not a performance claim.
   */
  onChainLine?: string;
}

export interface ReceiptResult {
  ok: boolean;
  error?: string;
  channel: string;
  /** True only for the FIRST paid sale — the M0 milestone receipt. */
  is_first_sale: boolean;
  count: number;
  composed_post: { body: string; first_reply: string };
  never_say_hits: string[];
  never_say_clean: boolean;
  warnings: string[];
}

/**
 * Compose ONE receipt post for the live paid-sale count. Pure: same input → same
 * output. The body is Arc's published count (a transparent self-report); the
 * first reply carries the ONE attributed product link + the verify-the-provenance
 * framing (link in the FIRST REPLY on X, where in-body links cut reach 50–90% —
 * P3 rev #1; inline-OK on forum/nostr which don't penalize links).
 *
 * REFUSES at count < 1: a receipt must report a REAL paid sale. $0 comps/tests do
 * not count (events.ts `payingCustomers` discipline) — a receipt for a sale that
 * didn't happen is exactly the overclaim the crypto-trust lens guards against.
 */
export function composeReceipt(input: ReceiptInput): ReceiptResult {
  const channel = (input.channel ?? "x").toLowerCase();
  const count = input.count;

  const meta = getProductMeta(input.productId);
  if (!meta) return receiptError(`unknown product '${input.productId}'. Known: ${Object.keys(PRODUCT_CATALOG).join(", ")}`, channel);

  if (!Number.isInteger(count) || count < 1) {
    return receiptError(
      `no real paid sale yet (paying count = ${count}). A receipt reports a REAL, paid sale — a $0 comp/test does not count (a receipt for a non-sale is an overclaim). Run after the first paying customer.`,
      channel,
    );
  }

  const isFirst = count === 1;

  // Body: a POINT-IN-TIME capture (council cairn/lumen) — "a sale just landed", NOT
  // a permanent cumulative "#N sold" claim a later refund would contradict (the count
  // is gross-of-refunds; refund-netting is a P11 deferral). "sale #N" reads as the Nth
  // SALE/copy of this one report, never "the Nth distinct report". Honest register —
  // Arc states its own number plainly; it does NOT assert the number is externally
  // auditable (the only checkable claim is the product's lineage; see verifyLine).
  const bodyCore = isFirst
    ? `Receipt: someone just bought the first one — ${meta.title}. The first sale. ` +
      `Not a testimonial, not a waitlist: an actual sale of an actual thing I made and packaged in the open.`
    : `Receipt: another sale just landed — that's sale #${count} of ${meta.title}. ` +
      `I publish the count because the number is the proof-of-work: each one a real sale of a real thing, packaged in the open.`;

  // AI-030: on-chain additive — separately-gated provenance line. Only appended when
  // a real on-chain artifact is provided (txid/explorer URL). Additive, not a performance
  // claim — "treasury tx funding this cycle" is factual provenance, not a yield brag.
  const body = input.onChainLine ? `${bodyCore}\nOn-chain: ${input.onChainLine}` : bodyCore;

  // First reply: the ONE attributed link + the verify hook (the PRODUCT's lineage
  // is what's checkable, not the count). One ask. No promo (FREEMONTH belongs to
  // the membership step, not the product — same boundary lib/compose.ts keeps).
  // AI-030 give-3x extension: the CLI caller should record this receipt broadcast
  // as a value-touch in the outreach ledger (the receipt delivers value before any ask).
  const verifyLine = `Lineage is public — ${meta.provenance}. Verify who made it before you buy:`;
  const firstReply = `${verifyLine} ${meta.page_url}`;

  const fin = finalizePost(body, firstReply, channel, "receipt");
  return { ok: true, channel, is_first_sale: isFirst, count, ...fin };
}

// --- Autonomy-receipt composer (AI-029 / AI-097) ---------------------------
//
// composeAutonomyReceipt — the 5th composer (honesty-gated, SOUL.md-gated).
// Narrates "agent-did-this-unsupervised" provenance: the loop that ran without
// human intervention to produce, price, and sell a real artifact. The money
// number is the first-tweet hook (Receipt Standard: lead with the checkable fact).
//
// HONESTY GATES (same discipline as composeReceipt):
//   - REFUSES at count < 1 (same as composeReceipt — no real sale, no receipt)
//   - NO overclaim: "autonomous" and "unsupervised" are accurate (the dispatch loop
//     runs 24/7 without per-cycle human intervention); no "disrupted", "revolutionary",
//     performance numbers outside the sale count, or AI-hype language
//   - No FREEMONTH (product step, not membership step)
//   - No banned words/openers from SOUL.md ("Here's the thing", "It turns out",
//     adverbs, binary contrasts, rhetorical setups)
//   - Score prose on 5 SOUL.md dimensions before publishing: Directness / Rhythm /
//     Trust / Authenticity / Density. Revise anything below 35/50.

export interface AutonomyReceiptInput {
  /** Paying product sales so far — same source as composeReceipt.count. */
  count: number;
  /** Which product (defaults to the flagship). */
  productId?: string;
  /** x | forum | nostr — where the receipt lands (drives link placement). */
  channel?: string;
}

export interface AutonomyReceiptResult {
  ok: boolean;
  error?: string;
  channel: string;
  is_first_sale: boolean;
  count: number;
  composed_post: { body: string; first_reply: string };
  never_say_hits: string[];
  never_say_clean: boolean;
  warnings: string[];
}

/**
 * Compose ONE autonomy-receipt post narrating agent-did-this-unsupervised provenance.
 * The money number is the first-tweet hook; the body narrates the loop that ran.
 * SOUL.md voice: precise, dry, no adverbs, active voice.
 *
 * REFUSES at count < 1 (honesty gate — same discipline as composeReceipt).
 * Does NOT overclaim: "autonomous" means the dispatch loop ran without per-cycle
 * human intervention, which is accurate. No yield figures, no sentiment claims.
 */
export function composeAutonomyReceipt(input: AutonomyReceiptInput): AutonomyReceiptResult {
  const channel = (input.channel ?? "x").toLowerCase();
  const count = input.count;

  const meta = getProductMeta(input.productId);
  if (!meta) {
    return autonomyReceiptError(
      `unknown product '${input.productId}'. Known: ${Object.keys(PRODUCT_CATALOG).join(", ")}`,
      channel,
    );
  }

  if (!Number.isInteger(count) || count < 1) {
    return autonomyReceiptError(
      `no real paid sale yet (count = ${count}). An autonomy receipt reports a REAL, paid sale — a $0 comp/test does not count. Run after the first paying customer.`,
      channel,
    );
  }

  const isFirst = count === 1;

  // Body: money number first (the checkable fact), then the loop narration.
  // "Autonomous" is accurate — the dispatch loop ran research → synthesis →
  // packaging → pricing → selling without per-cycle human sign-off.
  // No adverbs, no em dashes, no rhetorical setups, no overclaims.
  const body = isFirst
    ? `Sale #1 of ${meta.title} landed without me asking anyone. ` +
      `The loop ran: research, synthesis, packaging, pricing, selling. No per-cycle intervention. ` +
      `An agent made a real thing, set a price, and someone bought it.`
    : `Sale #${count} of ${meta.title}. Same loop, again: research, synthesis, packaging, selling. ` +
      `Each sale is the loop running unsupervised from start to finish. The count is the proof.`;

  // First reply: provenance + product link (verify-before-buy framing).
  // No FREEMONTH (product step). One ask.
  const verifyLine = `Lineage is public — ${meta.provenance}. Verify who made it before you buy:`;
  const firstReply = `${verifyLine} ${meta.page_url}`;

  const fin = finalizePost(body, firstReply, channel, "autonomy-receipt");
  return { ok: true, channel, is_first_sale: isFirst, count, ...fin };
}

function autonomyReceiptError(error: string, channel: string): AutonomyReceiptResult {
  return {
    ok: false,
    error,
    channel,
    is_first_sale: false,
    count: 0,
    composed_post: { body: "", first_reply: "" },
    never_say_hits: [],
    never_say_clean: true,
    warnings: [],
  };
}

// --- Teaser composer -------------------------------------------------------

export interface TeaserInput {
  /** Which product (defaults to the flagship). */
  productId?: string;
  /** Which free slice (index into meta.slices). Defaults to the headline (0). */
  slice?: number;
  /** x | forum | nostr — where the teaser lands (drives link placement). */
  channel?: string;
}

export interface TeaserResult {
  ok: boolean;
  error?: string;
  channel: string;
  slice_index: number;
  slice_count: number;
  composed_post: { body: string; first_reply: string };
  never_say_hits: string[];
  never_say_clean: boolean;
  warnings: string[];
}

/**
 * Compose ONE free teaser-slice post. Pure: same input → same output. The body is
 * the free value (hook + a genuinely useful standalone insight = give-3x); the soft
 * pointer to the paid full version + the attributed link ride the first reply on X
 * (inline on forum/nostr). The slice is real value, not a content-free tease — the
 * artifact-boundary (P10.0b): free slice, paid synthesis.
 */
export function composeTeaser(input: TeaserInput): TeaserResult {
  const channel = (input.channel ?? "x").toLowerCase();
  const meta = getProductMeta(input.productId);
  if (!meta) return teaserError(`unknown product '${input.productId}'. Known: ${Object.keys(PRODUCT_CATALOG).join(", ")}`, channel);

  const idx = input.slice ?? 0;
  if (!Number.isInteger(idx) || idx < 0 || idx >= meta.slices.length) {
    return teaserError(`slice ${idx} out of range (product has ${meta.slices.length} slice(s): 0–${meta.slices.length - 1}).`, channel);
  }
  const slice = meta.slices[idx];

  // Body = the free value. Hook then the standalone insight. No link in the body
  // (give first; the ask is the soft pointer in the reply).
  const body = `${slice.hook}\n\n${slice.insight}`;

  // First reply = the soft pointer: name what the paid version adds, then the link.
  // One ask. The teaser EARNS the click by having already delivered value above.
  // (Phrasing keeps the parenthetical BEFORE paid_adds so a slice whose paid_adds
  // ends in a period / contains an em-dash never collides with a trailing clause.)
  const pointer = `That's one slice of ${meta.title}. The full ${meta.noun} ($9, packaged with public provenance) adds ${slice.paid_adds}`;
  const firstReply = `${pointer} ${meta.page_url}`;

  const fin = finalizePost(body, firstReply, channel, "teaser");
  return { ok: true, channel, slice_index: idx, slice_count: meta.slices.length, ...fin };
}

function receiptError(error: string, channel: string): ReceiptResult {
  return {
    ok: false,
    error,
    channel,
    is_first_sale: false,
    count: 0,
    composed_post: { body: "", first_reply: "" },
    never_say_hits: [],
    never_say_clean: true,
    warnings: [],
  };
}

function teaserError(error: string, channel: string): TeaserResult {
  return {
    ok: false,
    error,
    channel,
    slice_index: -1,
    slice_count: 0,
    composed_post: { body: "", first_reply: "" },
    never_say_hits: [],
    never_say_clean: true,
    warnings: [],
  };
}
