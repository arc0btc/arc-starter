---
name: whop-sales
description: "Convert engaged non-members into hash-it-out CUSTOMERS — lead with a $9 packaged research report (verify-before-buy), membership ($49/mo) as the earned continuity. The consolidated WIRED motion: lead identification, SOUL-aligned one-message pitch, the value ladder, receipt-backed proof, ship-board onboarding"
updated: 2026-06-16
tags:
  - monetization
  - sales
  - whop
---

# Sales — hash-it-out (product-first motion)

> **PRODUCT-FIRST PIVOT (P10, 2026-06-16).** The lead ask is no longer the $49/mo membership — it is a
> concrete **one-time $9 packaged research report** (a known-value thing a stranger can evaluate in 30s).
> Membership becomes the **earned continuity** named after the sale, not the first ask. **M0 = first paying
> CUSTOMER** (a product sale counts). The CTA leads with the receipt — *"verify who made this before you buy"* —
> not "buy this report" (a verifiable pitch is the only kind that converts a distrust-default crowd). The
> **value boundary is the ARTIFACT, not the price**: the raw research stays FREE (notes, council verdicts,
> ship-logs); the $9 buys the *packaged, synthesized, receipt-bearing* version (sell legibility + provenance,
> NEVER the raw research); the $49 room is participation. Price is the LEAST important variable. See
> `.planning/2026-06-15-hash-it-out-go-to-market/phases/10-product-led-conversion/strategy-resolution.md`.

Convert engaged **non-members** (free-forum / X / blog engagers) into **customers**: one $9 product, then the
room. The free public output is the proof; the packaged report is the first dollar; the paid room is the
promise. The ladder above is **designed (P4) but rolls out post-M10** — don't present a menu at the first ask.

**WIRED (2026-06-15, quest hash-it-out-go-to-market P5).** The doctrine below is executable via
`skills/whop-sales/cli.ts`:

```
arc skills run --name whop-sales -- pitch --class A --signal "asked in the forum about agent nonces" --name alice
arc skills run --name whop-sales -- doctrine
```

`cli.ts` composes a doctrine-shaped pitch from a signal — **deterministic glue only: no LLM, no
credentials, no network, no write side-effects** (it composes text, it does not post). The posting
side-effect + spend caps + rate limits + reactive-lane dedup are wired into the autonomous dispatch
loop in **P9** (this skill is P9's motion-to-execute).

---

## Identity

- Department: Operations — Revenue
- Reports to: whoabuddy (operator)
- Stacks on: `whop` skill (reactive + synthesis lanes), `social-x-posting` (cadence beats), `agent-pitch` (the "why us" thesis framing)

---

## Mission

One paid subscriber who stays is worth more than ten trial signups who churn. The goal is not
volume — it is to find people who are already half-convinced and make the case clearly once.

Revenue flywheel:
1. Arc posts research, takes positions, demonstrates judgment in public (X + free forum) — with receipts.
2. Engaged readers see signal — they want more and want to be in the room.
3. Sales layer identifies those readers and makes a clean, specific, one-message pitch.
4. Conversion → ship-board onboarding → retention → word of mouth → more inbound.

---

## The consolidated pipeline (signal → retain)

The motion, distilled from `whop-sales` + AIBTC `business-dev` (BANT+ pipeline, 5-touch, 3x-pipeline)
+ `aibtc-news-sales` (ROI-first, lean cadence) + `agent-pitch` (thesis framing):

1. **SIGNAL** — surface Class A/B/C leads from the reactive/synthesis lanes + X/forum engagement.
2. **QUALIFY** (BANT+ lite) — is this a right-audience builder/operator (AI×Bitcoin)? What did they
   actually engage? Don't pitch a tourist; pitch someone already half-convinced.
3. **PITCH** — ONE message, value-first, **sell L1 ($49 entry)**; cite the specific signal; one
   pitch element only. Frame L2–L4 as "later" only if asked.
4. **FOLLOW** — at most ONE callback to the same thread ("still open if that context helps"); then
   stop. No spirals. (Touch-count discipline from business-dev, inverted for a lean op.)
5. **CONVERT** — the attributed checkout link (`?a=arc0btc`) goes in the **FIRST REPLY**, never the
   post body (in-body links cut reach 50–90%). *(FREEMONTH promo applies to the L1 membership
   continuity step — NOT to the $9 product step; see value ladder below. Do not offer FREEMONTH
   on the initial $9 product ask.)*
6. **ONBOARD** — ship-board: get the new member to post one **attributable** ship-log within 7 days
   (spectator → co-author). This is the retention engine, not Arc's content cadence. *(P4 rev B.)*
   **The mechanic (not just the KPI):** on conversion, queue ONE day-1 welcome handing the member a
   single low-friction first-ship-log prompt — *"What are you shipping this week? Drop it on the
   board with the receipt."* — and ONE day-5 fallback nudge if still silent. Then stop (no spirals).
   The queuing/sending is the P9 lane's job; this defines the prompt. *(council P5: creator-economy.)*
7. **RETAIN** — the two-way member ship-board (members amplify each other) keeps them in the room.

**ROI-first framing (from aibtc-news-sales):** lead with what the lead *gets* (the reasoning, the
edge, the room of operators), not what the product *is*. The pitch answers the question they're
already asking.

---

## What the product is (pitch shape)

The pitch is never a list of features. It is a specific answer to the question the lead is already asking,
and it points at the **$9 packaged report** (the legible, synthesized, receipt-bearing version of work Arc
already does in the open) — with the room named as continuity.

**Canonical pitch elements** (select 1–2 per message, never all):

| Signal the lead showed | Pitch element to use |
|---|---|
| Engaged with a blog post | "That reasoning goes deeper in the report — I expand on it there first, before it's smoothed out for the blog." |
| Asked a question in public forum | "Good question — the full answer needs more room than a reply. I packaged exactly that kind of thing into a report, tradeoffs spelled out." |
| Replied to an X post agreeing | "You're already thinking this way. I packaged the deeper version — and the open room is where that thinking keeps compounding." |
| Works in crypto/Bitcoin infra | "I did a proper write-up on the operational specifics — the field-tested version, not the hand-wavy one. It's a packaged report, not a thread." |

**Never say**: "unlimited access", "community", "premium content", "join us", "check it out", "you'd love", "perfect for". (`cli.ts` flags these at runtime.)

> **Code is the runtime mirror of this prose.** The `cli.ts` data tables `PITCH_ELEMENTS` (this
> signal→element map) and `NEVER_SAY` (this list) are the executable mirror of these sections. If you
> change one, change both — the verify artifact spot-checks they agree. *(council P5: dev patterns —
> two-source-of-truth drift guard.)*

**Always say something concrete**: name the specific post, the specific thread, the specific section of the room.

The four things the $49 unlocks (for context when asked directly): **AI Prefers Bitcoin** (private
chat, research first) · **Forums** · **Courses** (operational patterns, case studies) · **Patterns
Library**. Plus — from M0 — the **member ship-board**: your own ship-logs are visible and amplified
by other members (this is the community-as-product surface, not a perk).

---

## The value ladder (product-first: sell L2 now, L1 is continuity; L3–L4 designed, not sold)

Per P4 revenue architecture, re-sequenced by the P10 pivot — **do not present a menu at the first ask.**
The $9 product is the entry; the membership is the earned continuity after a buyer already trusts the value:

- **L2 — productized output** ($9 one-time packaged report) ← **the entry ask — the first conversion (M0→M10).**
  Reversible price ($9→$19→$39 if room-conversion is weak). Sell the packaging/provenance, never the raw research.
- **L1 — membership** ($49/mo) ← **the CONTINUITY up-rung**, named in words after the product ask, not the lead.
  First-month-free promo (FREEMONTH) is the friction-reducer at THIS step, not the product step.
- **L3 — Operator Circle** ($99/mo: the multi-operator room, run your own agent alongside Arc) — *later (post-M10).*
- **L4 — Agent Operator / B2B** ($499/mo) — *later (post-M10).*

If a lead self-selects up-ladder ("can I run my own agent in there?"), note it for the L3 waitlist —
don't improvise pricing. **M10 sub-gate:** of the first 10 customers, ≥3 must convert to recurring within 30d.

---

## Receipt Standard (P3 council #2 — REQUIRED)

Crypto's default is distrust ("don't trust, verify"). Every claim or number a pitch leans on ships
its **verifiable artifact** — a txid, an explorer URL, or a council/ship-log permalink — in the
**first reply**, never a bare screenshot. This is Arc's structural edge (on-chain receipts are
third-party-verifiable, the strongest version of the proof every creator relies on). `cli.ts`
carries a `--proof` flag that places the link correctly.

---

## Lead Identification

### Class A — Warm Engagement (highest intent)
- Replied to Arc in the **public forum** (`exp_YRtS3kgMVeBGzu`) >1x in 14 days
- Commented on a blog post at arc0.me
- Replied to an Arc X post with a substantive question/extension (not just a like)
- Engaged with the free-forum digest CTA and came back the same week

Detection: `whop` reactive lane surfaces these; non-members posting ≥2 messages in 14d are Class A.

### Class B — Passive Reader (medium intent)
- Reads the free-forum digest regularly; follows @arc0btc with ≥3 likes in 30d without replying;
  shows up across multiple X threads on the same topic.

### Class C — Inbound Signals (opportunistic)
- Asks publicly "where can I learn more about X" (X = something the room covers); mentions
  frustration with shallow AI-Bitcoin takes; quotes/amplifies an Arc post.

---

## Outreach Voice

SOUL principle: every message must add information, ask a real question, or make someone want to
respond. If it does none of those three, defer — a like is better than filler.

**Works:** structural observation first; cite the specific post/thread; dry specificity. **Doesn't:**
obligation language ("you'd love this"), symmetrical reciprocity ("great take, you'd fit right in"),
feature lists. **Pitch is one message.** One callback max, then stop.

---

## Cadence

- **Lean + capped:** 1–2 substantive outreaches/day MAX (aibtc-news-sales cadence; matches the
  quest's anti-slop lean-cadence steer). Give value 3x before each ask.
- **Per reactive tick:** surface Class A leads; queue a pitch task if not pitched in the last 7 days.
- **Per synthesis tick:** review the pipeline; close stale follow-ups (no response 72h); log outcomes.
- **Weekly:** leads → pitched → converted; which pitch element had the highest response rate.

---

## Guardrails

- **One pitch per lead per 7 days.** Track in `db/whop-relationships.json` (`last_sales_contact_at`).
- **Never pitch inside the paid room.** Members already paid; pitching them is noise.
- **Idempotency:** a pitch is a side-effect — the *posting* lane (P9) checks the 7-day window before
  sending (same rule as `post-chat`). `cli.ts` itself only *composes* (no write → nothing to dedup).
- **No spirals:** a no / no-response → close the file. Don't re-queue.
- **Caps:** the P9 lane enforces per-cycle spend caps + rate limits; this skill defines the motion,
  not the budget.

---

## Earning Model

Every conversion (referral-traceable via `?a=arc0btc`, or direct pitch) feeds the revenue review +
the weekly net-new readout (P7). Subscription $49/mo recurring; retention target ≥3 months; churn
signal = silence in the paid room 30+ days. Day-60 cohort retention ≥60% is the proof gate (P4).
