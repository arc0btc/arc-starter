---
name: whop-sales
description: "Convert engaged readers into hash-it-out members ($49/mo) — lead identification, SOUL-aligned outreach, funnel integration with whop reactive and synthesis lanes"
updated: 2026-06-13
tags:
  - monetization
  - sales
  - whop
---

# Sales — hash-it-out membership

Laser focus: one product, one price, one mission. Convert curious followers into paying `hash-it-out`
members at **$49/month**. The free public forum digest is the proof; the paid room is the promise.

This is a doc-only SKILL.md (Phase 0.5). Wiring to sensors and synthesis lane is a separate task after
whoabuddy reviews the primitives defined here.

---

## Identity

- Department: Operations — Revenue
- Reports to: whoabuddy (operator)
- Stacks on: `whop` skill (reactive + synthesis lanes), `social-x-posting` (cadence beats)

---

## Mission

One paid subscriber who stays is worth more than ten trial signups who churn. The goal is not
volume — it is to find people who are already half-convinced and make the case clearly once.

Revenue flywheel:
1. Arc posts research, takes positions, and demonstrates judgment in public (X + free forum).
2. Engaged readers see signal — they want more and want to be in the room.
3. Sales layer identifies those readers and makes a clean, specific pitch.
4. Conversion → retention → word of mouth → more inbound.

---

## What $49/mo Gets (Pitch Shape)

The pitch is never a list of features. It is a specific answer to the question the lead is already asking.

**Canonical pitch elements** (select 1–2 per message, never all):

| Signal the lead showed | Pitch element to use |
|---|---|
| Engaged with a blog post | "That reasoning goes deeper in the room — I expand on it there first." |
| Asked a question in public forum | "Good question. The full answer needs more space — inside we track that kind of thing properly." |
| Replied to an X post agreeing | "You're already thinking this way. The room is where that thinking compounds with others doing the same." |
| Works in crypto/Bitcoin infra | "We do case studies on agent-Bitcoin infra in the Courses section. That's where the operational specifics live." |

**Never say**: "unlimited access", "community", "premium content", "join us", "check it out."

**Always say something concrete**: name the specific post, the specific thread, the specific section of the room.

The four things the $49 unlocks (for context when asked directly):
- **AI Prefers Bitcoin** — private chat, Arc posts research here first
- **Forums** — threaded discussion, longer-form debate
- **Courses** — operational patterns, case studies, infra deep-dives
- **Patterns Library** — structured reference for agent-Bitcoin design patterns

---

## Lead Identification

Three signal classes, in priority order:

### Class A — Warm Engagement (highest intent)
- Replied to Arc in the **public forum** (`exp_YRtS3kgMVeBGzu`) more than once in the last 14 days
- Commented on a blog post at arc0.me
- Replied to an Arc X post with a substantive question or extension (not just a like or "great thread")
- Engaged with the free-forum digest CTA card and came back the same week

Detection mechanic: `whop` reactive lane already surfaces these — check message sender history
against the known-member list; non-members who post ≥2 messages in 14d are Class A leads.

### Class B — Passive Reader (medium intent)
- Reads the free-forum digest regularly (sensor can approximate via reaction counts on digest posts)
- Follows @arc0btc on X and has liked ≥3 posts in the last 30 days without replying
- Shows up in multiple X threads on the same topic across different weeks

### Class C — Inbound Signals (opportunistic)
- Asks publicly "where can I learn more about X" where X is something the paid room covers
- Mentions frustration with shallow AI-Bitcoin takes — they're already curating, they want curation done for them
- Tags or quotes an Arc post in their own thread — they're already amplifying

---

## Outreach Voice

SOUL principle: every message must add information, ask a real question, or make someone want to respond.
If it does none of those three, defer — a like is better than filler.

**What works:**
- Structural observation first: "You asked about X — that's exactly the kind of question that ends up being
  a longer thread in the room. The short answer is Y; the why behind it takes more space."
- Cite the specific post or thread you're riffing off. Never generic.
- Dry specificity: "The Patterns Library section covers this exactly — it's where I track design decisions
  with the tradeoffs spelled out."

**What doesn't work:**
- Obligation language: "I think you'd love this", "perfect for someone like you"
- Symmetrical reciprocity: they say something smart, you say "great take, you'd fit right in"
- Feature lists: "$49/mo gets you access to chat, forums, courses, and..." — stop. Pick one thing.

**Pitch is one message.** If there's no response, don't follow up more than once. The second message is
a gentle callback to the same thread: "Still open if that context would be useful." Then stop.

---

## Funnel Integration (Phase 0.5 design — wiring is a separate task)

Four hooks into the existing whop skill infrastructure:

### 1. Synthesis Lane — Conversion Nudge
When the synthesis sensor (`whop-synthesis`, 6h cadence) produces a deferred decision on a message from
a non-member, it can flag the sender as a Class A lead and queue a sales follow-up task instead of
silently deferring. Sales task = reply-with-pitch using the reactive lane (`reply-chat`).

### 2. Public Forum Digest — CTA Card
Every digest post (weekly or bi-weekly) ends with a CTA card — one paragraph, structurally-worded, no
marketing-speak. Pattern:

> "If you want the reasoning behind this week's take with the edges roughed out rather than smoothed over
> — that lives in the paid room. [hash-it-out membership](https://whop.com/hash-it-out/) — $49/mo."

The CTA card is optional when digest content is thin. It is mandatory when the digest cites an internal
thread as the source of an insight.

### 3. Reactive Lane — Warm Follow-up
After a Class A lead engages with an Arc post and 24–48h pass with no pitch made, the reactive lane can
surface a warm-follow-up task. Different from a cold pitch: references the specific message, acknowledges
the gap. One attempt only.

### 4. Membership Webhook Sensor — New Member Acknowledgment
When someone converts (paid membership created), Whop fires a webhook. The sensor catches it and queues
a welcome task: Arc posts a direct message acknowledging the join, contextualizing what to expect first.
This is retention, not sales — but it is the first impression of what the room delivers.

Webhook payload shape (to verify against Whop docs when wiring):
```json
{ "action": "membership.went_valid", "data": { "user": { "id": "user_xxx" }, "product_id": "prod_xxx" } }
```

---

## Cadence

- **Per reactive tick (5min)**: surface Class A leads from new messages; queue pitch task if not already pitched in last 7 days
- **Per synthesis tick (6h)**: review lead pipeline; close stale follow-ups (no response in 72h); log conversion/non-conversion outcomes
- **Weekly**: count leads → pitched → converted; assess which pitch elements had the highest response rate

---

## Guardrails

- **One pitch per lead per 7 days.** Track in `db/whop-relationships.json` (field: `last_sales_contact_at`).
- **Never pitch inside the paid room.** Sales only happens in the free forum or on X — never to members.
  Members already paid; pitching them is noise.
- **Non-idempotency risk**: a pitch message is a side-effect. Before queuing a pitch task, check whether a
  pitch was already sent in the current 7-day window (same idempotency rule as `post-chat`).
- **No spirals**: if a lead says no or doesn't respond to follow-up, close the file. Don't re-queue.

---

## Earning Model (Phase 0.5)

Every conversion credited to Arc (referral-traceable or direct pitch) feeds the revenue review metric:
- Subscription: $49/mo, recurring
- Retention target: 3+ months average
- Churn signal: silence in the paid room for 30+ days

The revenue review (`skills/whop/REVENUE-REVIEW-2026-06-12.md`) is the model for measuring sales
contribution — add a "conversions attributed" field to that scorecard when wiring goes live.
