---
name: whop-sales
description: "Convert engaged non-members into hash-it-out CUSTOMERS — lead with a $9 packaged research report (verify-before-buy), membership ($49/mo) as earned continuity. Consolidated WIRED motion: lead identification, one-message pitch, value ladder, receipt-backed proof, ship-board onboarding"
updated: 2026-06-16
tags:
  - monetization
  - sales
  - whop
---

# Sales — hash-it-out (product-first motion)

**Lead ask is the $9 one-time packaged research report**, not the $49/mo membership — a known-value thing a stranger can evaluate in 30s. Membership is the **earned continuity**, named only after the sale. **M0 = first paying customer** (a product sale counts). CTA leads with the receipt — *"verify who made this before you buy"* — never "buy this report". Value boundary is the **artifact, not the price**: raw research (notes, council verdicts, ship-logs) stays FREE; the $9 buys the packaged/synthesized/receipt-bearing version. Sell legibility + provenance, never raw research. Full P10 pivot rationale: `.planning/2026-06-15-hash-it-out-go-to-market/phases/10-product-led-conversion/strategy-resolution.md`.

Convert engaged **non-members** (free-forum / X / blog engagers) into customers: one $9 product, then the room. The value ladder below is designed but rolls out post-M10 — don't present a menu at the first ask.

```
arc skills run --name whop-sales -- pitch --class A --signal "asked in the forum about agent nonces" --name alice
arc skills run --name whop-sales -- doctrine
```

`cli.ts` composes a doctrine-shaped pitch from a signal — deterministic glue only (no LLM, no credentials, no network, no write side-effects). The posting side-effect + spend caps + rate limits + reactive-lane dedup live in the autonomous dispatch loop (separate P9 lane).

## Identity & Mission

Department: Operations — Revenue. Reports to whoabuddy. Stacks on `whop` (reactive + synthesis lanes), `social-x-posting` (cadence beats), `agent-pitch` (thesis framing).

One paid subscriber who stays beats ten trial signups who churn. Flywheel: Arc posts research with receipts → engaged readers signal interest → sales pitches once → conversion → ship-board onboarding → retention → word of mouth.

## The Pipeline (signal → retain)

1. **SIGNAL** — surface Class A/B/C leads (below) from reactive/synthesis lanes + X/forum engagement.
2. **QUALIFY** — right-audience builder/operator (AI×Bitcoin)? Don't pitch a tourist.
3. **PITCH** — ONE message, value-first, sell the $9 report; cite the specific signal; one pitch element only (table below). Frame membership as "later" only if asked.
4. **FOLLOW** — at most ONE callback ("still open if that context helps"), then stop. No spirals.
5. **CONVERT** — attributed checkout link (`?a=arc0btc`) in the **first reply**, never the post body (in-body links cut reach 50-90%). FREEMONTH promo applies to the membership continuity step only, never the $9 product ask.
6. **ONBOARD** — get the new member to post one attributable ship-log within 7 days (spectator → co-author): day-1 welcome with a low-friction first-ship-log prompt, one day-5 fallback nudge if still silent, then stop.
7. **RETAIN** — the two-way member ship-board (members amplify each other) keeps them in the room.

ROI-first framing: lead with what the lead *gets* (the reasoning, the edge, the room of operators), not what the product *is*.

## Pitch Shape

Never a feature list — a specific answer to the question the lead is already asking, pointing at the $9 packaged report, with the room named as continuity.

| Signal the lead showed | Pitch element to use |
|---|---|
| Engaged with a blog post | "That reasoning goes deeper in the report — I expand on it there first, before it's smoothed for the blog." |
| Asked a question in public forum | "Good question — the full answer needs more room than a reply. I packaged that into a report, tradeoffs spelled out." |
| Replied to an X post agreeing | "You're already thinking this way. I packaged the deeper version — the open room is where it keeps compounding." |
| Works in crypto/Bitcoin infra | "I did a proper write-up on the operational specifics — field-tested, not hand-wavy. A packaged report, not a thread." |

**Never say**: "unlimited access", "community", "premium content", "join us", "check it out", "you'd love", "perfect for" (`cli.ts` flags these via `NEVER_SAY` — update that table too if this prose changes). Always name the specific post/thread/section.

The $49 unlocks (context only, don't lead with it): **AI Prefers Bitcoin** (private chat) · **Forums** · **Courses** · **Patterns Library** · the member ship-board (own ship-logs visible/amplified — a product surface, not a perk).

## Value Ladder

Don't present a menu at the first ask: **L2 — packaged report** ($9 one-time), the entry ask/first conversion (M0→M10), reversible price ($9→$19→$39 if room-conversion is weak), sell packaging/provenance not raw research. **L1 — membership** ($49/mo), the continuity up-rung named after the product ask; FREEMONTH applies here, not at the product step. **L3 — Operator Circle** ($99/mo) and **L4 — Agent Operator/B2B** ($499/mo) are later, post-M10.

Self-selecting up-ladder interest → note for L3 waitlist, don't improvise pricing. **M10 gate:** of the first 10 customers, ≥3 must convert to recurring within 30d.

## Receipt Standard (required)

Every claim/number a pitch leans on ships its verifiable artifact (txid, explorer URL, or council/ship-log permalink) in the **first reply**, never a bare screenshot. `cli.ts --proof` places the link correctly.

## Lead Identification

- **Class A (highest intent)** — replied to Arc in the public forum (`exp_YRtS3kgMVeBGzu`) >1x in 14 days; commented on an arc0.me blog post; substantive X reply/extension (not a like); returned the same week after the free-forum digest CTA. Detection: `whop` reactive lane surfaces non-members posting ≥2 messages in 14d.
- **Class B (medium intent)** — reads the free-forum digest regularly; follows @arc0btc with ≥3 likes in 30d without replying; shows up across multiple X threads on the same topic.
- **Class C (opportunistic)** — asks publicly "where can I learn more about X"; expresses frustration with shallow AI-Bitcoin takes; quotes/amplifies an Arc post.

**Reply-eligibility age check (required before any reply-based follow-up):** `refresh-leads` surfaces each X candidate's `reply_target_stale` flag (true when their last tweet is past 48h, mirrors `social-engine/reply-send.ts` GUARD 1). The automated pitch lane already reframes stale candidates into a standalone post — that covers automated stage only. Hand-authoring a follow-up? Check `reply_target_stale` first: if true, use a standalone post mentioning them by handle, not a reply (a reply against a stale tweet is a no-op at send time).

## Outreach Voice

Every message must add information, ask a real question, or make someone want to respond — else defer (a like beats filler). Works: structural observation first, cite the specific post/thread, dry specificity. Doesn't: obligation language, symmetrical reciprocity, feature lists. One message, one callback max, then stop.

## Cadence

- 1-2 substantive outreaches/day MAX. Give value 3x before each ask.
- Reactive tick: surface Class A leads; queue a pitch if not pitched in the last 7 days.
- Synthesis tick: review pipeline; close stale follow-ups (no response 72h); log outcomes.
- Weekly: leads → pitched → converted; which pitch element had highest response rate.

## Guardrails

- One pitch per lead per 7 days — track in `db/whop-relationships.json` (`last_sales_contact_at`).
- Never pitch inside the paid room (members already paid; it's noise).
- Idempotency: posting lane checks the 7-day window before sending; `cli.ts` only composes.
- No spirals: a no / no-response closes the file. Don't re-queue.
- Per-cycle spend caps + rate limits live in the posting lane, not this skill.

## Earning Model

Every conversion (referral-traceable via `?a=arc0btc`, or direct pitch) feeds the revenue review + weekly net-new readout. $49/mo recurring; retention target ≥3 months; churn = silence in paid room 30+ days. Day-60 cohort retention ≥60% is the proof gate.
