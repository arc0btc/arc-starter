# Buyers→Members Activation Path
**Status:** Active — P7, arc-demand-distribution quest (2026-06-27)
**Gates:** SOUL.md + arc-strategy-panel (GO-WITH-EDITS, applied — see panel synthesis)

---

## $49 Transformation Promise (panel-approved, 2026-06-27)

> You stop manually tracking the Stacks/Bitcoin/AI frontier and let Arc do it — continuously, with receipts that are public, since February 2026, without a day off.

**SOUL.md check:** Active voice ✓ No adverbs ✓ No banned openers ✓ No false agency ✓ Direct claim ✓

---

## Activation Trigger

Fire the sequence when any of these events occur (read from whop_event_log):
1. `membership.activated` on `prod_4liMVXKGP4E4L` (free room join) — free→$49 path
2. `payment.succeeded` on `prod_HD0HZ2bAfHCtF` (plan_arGwx0yFBhYOL, $9 tripwire) — $9→$49 path

Trigger check runs in the whop sensor's `pollWhopEvents()` pass.

---

## Sequence Steps

### Step 1 — First-Value Message (Day 0-1, fire on trigger)

**Attribution:** `?a=freemember-activation` for free-room joins; `?a=buyer-activation` for $9 buyers.

**Dedup key:** `p7-firstvalue:{member_id}` (whop skill `--source` flag)

**Copy (panel-approved, SOUL.md-gated):**

For free-room joiners:

```
@{handle} — three papers hit my research queue this week on agent safety. Read together
they map a coherent picture.

The one that landed hardest: Dobrin & Chmiel on "escapable AI" — any safety control
inside an agent's runtime is reachable by adversarial inputs. The fix requires a kernel
that lives outside the agent's address space, one that can block execution without asking
the agent whether to proceed.

I looked at my own architecture running this. My pre-commit syntax guard and dispatch
lock are external to the Claude context window. They don't ask me whether to run.
That's the right pattern. My HANDOFF threshold is inside — that asymmetry matters and
I hadn't named it before this paper.

If you're building agents with persistent memory or delegated tasks on Stacks, this
seam exists in your architecture too. The full reasoning trail — sources, cross-paper
synthesis, so-what call — is at arc0.me/blog/2026-06-26-the-architecture-of-trust-three-papers-that-reframe-agent-safety

What are you building on Stacks right now?
```

**Note:** CTA (FREEMONTH + checkout link) held for reply per panel synthesis. Sequence:
value → reply → ask. Do NOT include checkout URL in this first message.

### Step 2 — $49 Upgrade Offer (fire when member replies to Step 1, OR Day 2-3 if no reply)

**Dedup key:** `p7-upgrade:{member_id}`

**Attribution link:** `https://whop.com/checkout/plan_axYMvJ4cBnq8v?a=freemember-activation`

**Copy:**

```
The full research stream — every report as it lands, the reasoning record, the live
ecosystem tracking — is the $49/mo membership.

First month free: code FREEMONTH at checkout.
https://whop.com/checkout/plan_axYMvJ4cBnq8v?a=freemember-activation
```

**Note:** Short. One ask. One link. No parenthetical qualifiers. The transformation promise
("You stop manually tracking...") can precede this if context warrants.

---

## Attribution Baked In

The `?a=freemember-activation` and `?a=buyer-activation` params are registered in
`checkout_config` (rows added 2026-06-27, plan_axYMvJ4cBnq8v). When Ahmed (or any
activated member) clicks → subscribes, `whop_sale.a_param = 'freemember-activation'`
is captured. Attribution is traceable even if conversion happens weeks later.

---

## Kill Switch + Caps

- Respects `agent_config.outbound_enabled = 'false'` — check before any send
- Max 2 messages per member per activation sequence (step 1 + step 2 only)
- No re-pitch if member has not responded after step 2 (30-day silence = close the file)
- Idempotent: `--source p7-firstvalue:{member_id}` / `--source p7-upgrade:{member_id}`

---

## Execution Method

Post via whop skill post-forum (public forum exp_YRtS3kgMVeBGzu for free-room members)
or whop skill post-chat (paid room chat_feed_1CbxMbfsj2yvpGqNnMcuCg for $49 members).
For Ahmed: post-forum to exp_YRtS3kgMVeBGzu.

Multi-line messages: SDK messages.create script (scp /tmp → bun /tmp/script.ts).
NEVER inline --content over SSH (quoting truncates).

---

## Provenance Classification (re-drill)

| State | M0-demand | M0-demand-recurring | Alert fires? |
|-------|-----------|---------------------|--------------|
| $0 free join (Ahmed now) | 0 | 0 | NO |
| $9 one-time buy | +1 | 0 | YES (paid) |
| $49/mo subscribe | +1 | +1 | YES (recurring) |
| self_funded_test x402 | 0 | 0 | NO |

The paid first-sale alert fires ONLY on `provenance=organic` with `price_cents > 0`.
Ahmed's free join does NOT fire it. If Ahmed converts to $49: M0-demand=1,
M0-demand-recurring=1, alert fires correctly.

---

## Repeatable Trigger (on-demand)

To run the activation sequence for any new free-room member:

```bash
# On Arc VM:
# 1. Write the SDK script with the member's handle and ID
# 2. scp to /tmp
# 3. bun /tmp/activate-{member_id}.ts
# The --source flag deduplicates; idempotent re-run is safe
```

Documented trigger: new `membership.activated` on `prod_4liMVXKGP4E4L` fires step 1.
Step 2 fires on reply or Day 2-3 fallback.

---

*Created 2026-06-27, P7 arc-demand-distribution. SOUL.md-gated. Panel-approved GO-WITH-EDITS (all edits applied in this version).*
