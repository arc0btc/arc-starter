#!/usr/bin/env bun

// skills/whop-sales/cli.ts
//
// CLI for the `whop-sales` skill: the EXECUTABLE consolidation of the sales
// doctrine (SKILL.md). It turns a sales signal into a composed, doctrine-shaped
// pitch — deterministic glue only: NO LLM call, NO credentials, NO network, and
// NO write side-effects. It composes pitch TEXT; it does not post.
//
// Scope boundary (quest hash-it-out-go-to-market): P5 makes the motion runnable
// (generate a pitch for a signal). P9 wires the posting side-effect + spend caps
// + rate limits + the reactive-lane dedup into the autonomous dispatch loop.
// Because nothing here writes, there is no write hop to make idempotent.
//
// Usage:
//   arc skills run --name whop-sales -- pitch --class A --signal "asked in the forum about agent nonces" [--name alice] [--channel x|forum] [--proof <txid|url>]
//   arc skills run --name whop-sales -- doctrine
//   arc skills run --name whop-sales -- help

import { parseFlags } from "../../src/utils.ts";
import { PAID_ROOM_PRODUCT_URL, PAID_ROOM_CHECKOUT_URL } from "../../src/constants.ts";

function fail(message: string): never {
  process.stderr.write(`whop-sales: ${message}\n`);
  process.exit(1);
}

// --- The doctrine, as data (single source of truth mirrors SKILL.md) ----------

// Lead classes in priority order (from SKILL.md §Lead Identification).
const LEAD_CLASS: Record<string, { intent: string; note: string }> = {
  A: { intent: "high",   note: "warm engagement — replied/commented ≥2x in 14d; pitch now" },
  B: { intent: "medium", note: "passive reader — regular digest/X engagement; nurture, soft ask" },
  C: { intent: "low",    note: "inbound signal — public 'where do I learn X' / amplifying Arc; opportunistic" },
};

// Signal → pitch element (from SKILL.md §What $49/mo Gets). Keyword-matched on the
// --signal text, or forced via --element. Each picks ONE concrete element (never a list).
const PITCH_ELEMENTS: { key: string; match: RegExp; line: string }[] = [
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
const NEVER_SAY = ["unlimited access", "community", "premium content", "join us", "check it out", "you'd love", "perfect for"];

// Returns the chosen element AND whether a signal keyword actually matched. A
// no-match falls back to the first element but flags matched=false so the caller
// (and the P9 lane) never treats a fallback as a real intent match — a wrong-intent
// line must not ship unsupervised. (council P5: offer-funnel + dev correctness/patterns.)
function selectElement(signal: string, forced?: string): { element: (typeof PITCH_ELEMENTS)[number]; matched: boolean } {
  if (forced) {
    const hit = PITCH_ELEMENTS.find((e) => e.key === forced);
    if (!hit) fail(`unknown --element '${forced}'. One of: ${PITCH_ELEMENTS.map((e) => e.key).join(", ")}`);
    return { element: hit!, matched: true };
  }
  const hit = PITCH_ELEMENTS.find((e) => e.match.test(signal));
  return { element: hit ?? PITCH_ELEMENTS[0], matched: Boolean(hit) };
}

// Claim-shaped content (a number, %, or a verifiable verb) demands a receipt. If
// the pitch makes such a claim with no --proof, mark proof_required so the P9 lane
// can hard-block before posting. (council P5: crypto-trust — make the Receipt
// Standard machine-flaggable, not opt-in-at-send.)
const CLAIM_RE = /\d|%|\bpercent\b|\breturn(ed|s)?\b|\bhold(s|ing)?\b|\bearn(ed|s|ing)?\b|\bprofit|\bapy\b|\bmrr\b/i;

function cmdPitch(flags: Record<string, string>): void {
  const cls = (flags.class ?? "A").toUpperCase();
  if (!LEAD_CLASS[cls]) fail(`unknown --class '${cls}'. One of: A, B, C (see SKILL.md §Lead Identification).`);
  const signal = flags.signal ?? "";
  if (!signal) fail("missing --signal \"<what the lead actually did>\" (cite the specific thing — never generic).");
  const name = flags.name ?? "";
  const channel = (flags.channel ?? "x").toLowerCase(); // x | forum — where the pitch lands
  const proof = flags.proof ?? ""; // optional verifiable artifact (txid / explorer URL / council ledger permalink)

  const lead = LEAD_CLASS[cls];
  const { element, matched: elementMatched } = selectElement(signal, flags.element);

  // Compose ONE message (SKILL.md: "Pitch is one message"). Structure: structural
  // observation citing the specific signal → one concrete element → one soft ask.
  // Sell L1 ($49 entry) ONLY (P4: ladder is designed-now / rolled-out-post-M10).
  const who = name ? `@${name}` : "you";
  const body =
    `${name ? name + " — " : ""}you ${signal.replace(/^you\s+/i, "")}. ` +
    `${element.line}`;
  const ask = lead.intent === "low"
    ? `If that's useful, the room's where it lives.` // class C: lighter, give-3x still governs
    : `If you want that with the edges left rough, that's the paid room — $49/mo.`;

  // P3 Receipt Standard + first-reply mechanic: the attributed link goes in the
  // FIRST REPLY, never the post body (in-body links cut reach 50–90%). Any cited
  // proof ships its verifiable artifact link in the same first reply.
  const link = channel === "forum" ? PAID_ROOM_PRODUCT_URL : PAID_ROOM_CHECKOUT_URL;
  const firstReply =
    `${ask} ${link}` +
    (proof ? `\nProof: ${proof}` : "");

  const neverSayHits = NEVER_SAY.filter((w) => (body + " " + ask).toLowerCase().includes(w));
  const claimShaped = CLAIM_RE.test(body + " " + ask);
  const proofRequired = claimShaped && !proof;

  const out = {
    mode: "DRY — composition only; the posting side-effect + caps are P9's lane",
    lead_class: cls,
    intent: lead.intent,
    lead_note: lead.note,
    ladder_rung: "L1 — hash it out, $49/mo entry (sell L1 first; L2–L4 framed as 'later')",
    pitch_element_used: element.key,
    element_matched: elementMatched, // false = fallback; operator/P9 should confirm or pass --element
    channel,
    composed_pitch: {
      body, // the public message — NO link in body
      first_reply: firstReply, // the attributed CTA (+ proof) — per P3 first-reply rule
    },
    proof_required: proofRequired, // true = claim-shaped pitch w/o --proof; P9 must block until proof attached
    receipt_standard: proof
      ? "ok — verifiable proof link placed in first reply (not a bare screenshot)"
      : proofRequired
        ? "PROOF REQUIRED — pitch makes a claim/number but no --proof; the P9 lane must block until a txid/explorer/ledger link is attached"
        : "no --proof supplied; if this pitch cites a claim/number, attach its txid/explorer/council-ledger link in the first reply",
    guardrails: {
      one_ask: true,
      give_3x_before_ask: "verify ≥3 value touches precede this ask for " + who,
      one_pitch_per_7d: "check db/whop-relationships.json last_sales_contact_at before sending (enforced by P9 lane)",
      never_say_clean: neverSayHits.length === 0,
      never_say_hits: neverSayHits,
    },
    on_convert: "trigger ship-board onboarding (P4 rev B): get the new member to post ONE attributable ship-log within 7 days — spectator → co-author (the retention engine).",
  };

  if (neverSayHits.length > 0) {
    process.stderr.write(`whop-sales: WARNING — pitch contains never-say phrase(s): ${neverSayHits.join(", ")}\n`);
  }
  if (!elementMatched) {
    process.stderr.write(`whop-sales: WARNING — no pitch element matched the signal; fell back to '${element.key}'. Pass --element or refine --signal.\n`);
  }
  if (proofRequired) {
    process.stderr.write(`whop-sales: WARNING — pitch is claim-shaped but has no --proof; attach a verifiable link (P9 lane will block otherwise).\n`);
  }
  console.log(JSON.stringify(out, null, 2));
}

function cmdDoctrine(): void {
  console.log(
    [
      "whop-sales — consolidated motion (see SKILL.md for the full doctrine)",
      "",
      "PIPELINE (signal → retain):",
      "  1. SIGNAL   — surface Class A/B/C leads from reactive/synthesis lanes + X/forum engagement.",
      "  2. QUALIFY  — BANT+ lite: is this a right-audience builder/operator? what did they actually engage?",
      "  3. PITCH    — ONE message, value-first, sell L1 ($49); cite the specific signal; one element only.",
      "  4. FOLLOW   — at most ONE callback to the same thread; then stop (no spirals).",
      "  5. CONVERT  — attributed checkout link (?a=arc0btc) in the FIRST REPLY (never post body).",
      "  6. ONBOARD  — ship-board: new member posts one attributable ship-log within 7 days (P4 rev B).",
      "  7. RETAIN   — the two-way member ship-board is the retention engine, not Arc's content treadmill.",
      "",
      "CADENCE: lean + capped — 1–2 substantive outreaches/day max; give value 3x before each ask.",
      "RECEIPT STANDARD: every cited claim/number ships its verifiable link (txid/explorer/ledger) in the first reply.",
      "NEVER SAY: " + NEVER_SAY.join(", "),
      "ATTRIBUTION: product=" + PAID_ROOM_PRODUCT_URL + " | checkout=" + PAID_ROOM_CHECKOUT_URL,
    ].join("\n"),
  );
}

function printHelp(): void {
  console.log(
    [
      "whop-sales — executable sales doctrine (composes pitches; does NOT post)",
      "",
      "Commands:",
      "  pitch --class A|B|C --signal \"<what they did>\" [--name <h>] [--channel x|forum] [--element blog|forum|x|infra] [--proof <txid|url>]",
      "  doctrine    print the consolidated pipeline + cadence + guardrails",
      "  help        this message",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const flags = parseFlags(args.slice(1)).flags;

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  switch (command) {
    case "pitch":
      cmdPitch(flags);
      break;
    case "doctrine":
      cmdDoctrine();
      break;
    default:
      fail(`unknown command: ${command}. Run with no args for help.`);
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
