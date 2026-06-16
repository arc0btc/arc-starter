#!/usr/bin/env bun

// skills/whop-sales/lib/compose.ts
//
// The PURE pitch composer — the single source of truth for the doctrine, as data
// + the deterministic logic that turns a sales signal into a doctrine-shaped
// pitch. Extracted from cli.ts (P5) so BOTH the CLI (`whop-sales pitch`) and the
// autonomous acquisition sensor (P9 `skills/whop-sales/sensor.ts`) compose from
// ONE implementation — no shell-out, no drift between the two callers.
//
// Deterministic glue only: NO LLM call, NO credentials, NO network, NO writes.
// It composes pitch TEXT; it does not post. The posting side-effect + the
// BLOCKING caps/dedup live in lib/enforcement.ts + the sensor (P9).

import { PAID_ROOM_PRODUCT_URL, PAID_ROOM_CHECKOUT_URL, PROMO_CODE } from "../../../src/constants.ts";

// --- The doctrine, as data (single source of truth mirrors SKILL.md) ----------

// Lead classes in priority order (from SKILL.md §Lead Identification).
export const LEAD_CLASS: Record<string, { intent: string; note: string }> = {
  A: { intent: "high",   note: "warm engagement — replied/commented ≥2x in 14d; pitch now" },
  B: { intent: "medium", note: "passive reader — regular digest/X engagement; nurture, soft ask" },
  C: { intent: "low",    note: "inbound signal — public 'where do I learn X' / amplifying Arc; opportunistic" },
};

// Signal → pitch element (from SKILL.md §What $49/mo Gets). Keyword-matched on the
// signal text, or forced via `forcedElement`. Each picks ONE concrete element (never a list).
export const PITCH_ELEMENTS: { key: string; match: RegExp; line: string }[] = [
  { key: "forum", match: /\b(forum|question|asked|ask)\b/i,
    line: "Good question — the full answer needs more space than a reply. Inside the room I track that kind of thing properly, with the tradeoffs spelled out." },
  { key: "infra", match: /\b(bitcoin|btc|sbtc|x402|lightning|infra|stacks|on-?chain|agent-?bitcoin)\b/i,
    line: "We do case studies on agent-Bitcoin infra in the Courses section — that's where the operational specifics live, not the hand-wavy version." },
  { key: "x",     match: /\b(x post|tweet|thread|replied|agreed|quote|amplif)\b/i,
    line: "You're already thinking this way. The room is where that thinking compounds with others doing the same — in the open." },
  { key: "blog",  match: /\b(blog|post|arc0\.me|read|article)\b/i,
    line: "That reasoning goes deeper in the room — I expand on it there first, before it's smoothed out for the blog." },
];

// SOUL voice guardrail — words/phrases that flatten the pitch into marketing (SKILL.md §Outreach Voice).
export const NEVER_SAY = ["unlimited access", "community", "premium content", "join us", "check it out", "you'd love", "perfect for"];

// Claim-shaped content (a number, %, or a verifiable verb) demands a receipt. If
// the pitch makes such a claim with no proof, mark proof_required so the P9 lane
// can hard-block before posting. (council P5: crypto-trust — make the Receipt
// Standard machine-flaggable, not opt-in-at-send.)
export const CLAIM_RE = /\d|%|\bpercent\b|\breturn(ed|s)?\b|\bhold(s|ing)?\b|\bearn(ed|s|ing)?\b|\bprofit|\bapy\b|\bmrr\b/i;

// Returns the chosen element AND whether a signal keyword actually matched. A
// no-match falls back to the first element but flags matched=false so the caller
// (and the P9 lane) never treats a fallback as a real intent match — a wrong-intent
// line must not ship unsupervised. (council P5: offer-funnel + dev correctness/patterns.)
export function selectElement(
  signal: string,
  forced?: string,
): { element: (typeof PITCH_ELEMENTS)[number]; matched: boolean } | { error: string } {
  if (forced) {
    const hit = PITCH_ELEMENTS.find((e) => e.key === forced);
    if (!hit) return { error: `unknown element '${forced}'. One of: ${PITCH_ELEMENTS.map((e) => e.key).join(", ")}` };
    return { element: hit, matched: true };
  }
  const hit = PITCH_ELEMENTS.find((e) => e.match.test(signal));
  return { element: hit ?? PITCH_ELEMENTS[0], matched: Boolean(hit) };
}

export interface ComposeInput {
  cls: string;            // A | B | C
  signal: string;         // what the lead actually did (cite the specific thing)
  name?: string;          // their handle (optional)
  channel?: string;       // x | forum — where the pitch lands
  proof?: string;         // verifiable artifact (txid / explorer URL / council-ledger permalink)
  forcedElement?: string; // override the keyword-matched element
}

export interface ComposeResult {
  ok: boolean;
  error?: string;
  lead_class: string;
  intent: string;
  lead_note: string;
  ladder_rung: string;
  pitch_element_used: string;
  element_matched: boolean;   // false = fallback; caller must confirm or force the element
  channel: string;
  composed_pitch: { body: string; first_reply: string };
  proof_required: boolean;    // true = claim-shaped pitch w/o proof; the P9 lane MUST block
  receipt_standard: string;
  never_say_hits: string[];
  never_say_clean: boolean;
  warnings: string[];         // human-readable warnings (the CLI prints these to stderr)
}

/**
 * Compose ONE doctrine-shaped pitch from a signal. Pure: same input → same output.
 * Structure (SKILL.md): structural observation citing the specific signal → one
 * concrete element → one soft ask. Sells L1 ($49 entry) ONLY. The attributed
 * checkout link + the FREEMONTH promo code + any proof go in the FIRST REPLY,
 * never the body (in-body links cut reach 50–90%; P3 rev #1).
 */
export function composePitch(input: ComposeInput): ComposeResult {
  const cls = (input.cls ?? "A").toUpperCase();
  const lead = LEAD_CLASS[cls];
  if (!lead) return errorResult(`unknown class '${cls}'. One of: A, B, C (see SKILL.md §Lead Identification).`, cls, input.channel);
  const signal = input.signal ?? "";
  if (!signal) return errorResult('missing signal "<what the lead actually did>" (cite the specific thing — never generic).', cls, input.channel);

  const channel = (input.channel ?? "x").toLowerCase();
  const proof = input.proof ?? "";

  const sel = selectElement(signal, input.forcedElement);
  if ("error" in sel) return errorResult(sel.error, cls, channel);
  const { element, matched: elementMatched } = sel;

  const name = input.name ?? "";

  const body =
    `${name ? name + " — " : ""}you ${signal.replace(/^you\s+/i, "")}. ` +
    `${element.line}`;
  const ask = lead.intent === "low"
    ? `If that's useful, the room's where it lives.` // class C: lighter, give-3x still governs
    : `If you want that with the edges left rough, that's the paid room — $49/mo.`;

  // P3 Receipt Standard + first-reply mechanic: the attributed link + the
  // FREEMONTH friction-reducer (P6) + any proof all ride the FIRST REPLY.
  const link = channel === "forum" ? PAID_ROOM_PRODUCT_URL : PAID_ROOM_CHECKOUT_URL;
  const promoLine = `First month's on me — code ${PROMO_CODE} at checkout (new members).`;
  const firstReply =
    `${ask} ${link}` +
    `\n${promoLine}` +
    (proof ? `\nProof: ${proof}` : "");

  const neverSayHits = NEVER_SAY.filter((w) => (body + " " + ask).toLowerCase().includes(w));
  // Claim-proof looks at the BODY only — the substantive pitch built from the lead's
  // signal is where a performance number/claim appears. The ask is fixed boilerplate
  // whose "$49/mo" price would otherwise false-positive `\d` on EVERY pitch and (under
  // the P9 BLOCKING gate) reject all of them. (council P9: correctness — the price is
  // not a claim needing a receipt.)
  const claimShaped = CLAIM_RE.test(body);
  const proofRequired = claimShaped && !proof;

  const warnings: string[] = [];
  if (neverSayHits.length > 0) warnings.push(`pitch contains never-say phrase(s): ${neverSayHits.join(", ")}`);
  if (!elementMatched) warnings.push(`no pitch element matched the signal; fell back to '${element.key}'. Pass an element or refine the signal.`);
  if (proofRequired) warnings.push(`pitch is claim-shaped but has no proof; attach a verifiable link (the P9 lane will BLOCK otherwise).`);

  return {
    ok: true,
    lead_class: cls,
    intent: lead.intent,
    lead_note: lead.note,
    ladder_rung: "L1 — hash it out, $49/mo entry (sell L1 first; L2–L4 framed as 'later')",
    pitch_element_used: element.key,
    element_matched: elementMatched,
    channel,
    composed_pitch: { body, first_reply: firstReply },
    proof_required: proofRequired,
    receipt_standard: proof
      ? "ok — verifiable proof link placed in first reply (not a bare screenshot)"
      : proofRequired
        ? "PROOF REQUIRED — pitch makes a claim/number but no proof; the P9 lane must block until a txid/explorer/ledger link is attached"
        : "no proof supplied; if this pitch cites a claim/number, attach its txid/explorer/council-ledger link in the first reply",
    never_say_hits: neverSayHits,
    never_say_clean: neverSayHits.length === 0,
    warnings,
  };
}

function errorResult(error: string, cls: string, channel?: string): ComposeResult {
  return {
    ok: false,
    error,
    lead_class: cls,
    intent: "",
    lead_note: "",
    ladder_rung: "",
    pitch_element_used: "",
    element_matched: false,
    channel: (channel ?? "x").toLowerCase(),
    composed_pitch: { body: "", first_reply: "" },
    proof_required: false,
    receipt_standard: "",
    never_say_hits: [],
    never_say_clean: true,
    warnings: [],
  };
}
