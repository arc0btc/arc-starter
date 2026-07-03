---
id: whop-sales-give-3x-blocks-fresh-leads
topics: [whop, sales, lead-gen, enforcement]
source: task:20856
created: 2026-07-02
---

# refresh-leads output is rarely pitch-ready — give-3x-before-ask blocks it by construction

`whop-sales refresh-leads` surfaces candidates from raw X/forum engagement (mentions,
replies), but `arc_replies_to_them` (value_touches) starts at 0 for every freshly
discovered lead by definition — Arc hasn't replied to them yet. The enforcement gate
(`skills/whop-sales/lib/enforcement.ts`, `GIVE_BEFORE_ASK = 3`) BLOCKS any pitch until
Arc has given 3 value touches first. So "surface leads → qualify → pitch" almost never
chains directly for a brand-new lead; there's a mandatory middle step of genuine
(non-sales) engagement first.

**Symptom this prevents**: treating "found a new lead" as "ready to pitch" and either
attempting a live pitch (enforcement-blocked, wasted cycle) or — worse — rationalizing
around the gate. This is the same doctrine violation class as re-pitching an exhausted
lead (see [[whop-wedge]] Ahmed case), just inverted: premature ask instead of spiral.

**Also**: most `refresh-leads` X candidates are reply-chain noise (people @-mentioning
Arc inside unrelated group threads) or outright forum spam bots (generic ad copy like
"ZERO CREATIVE BLOCKS FOREVER"), not real engagement. Filter for candidates with an
actual substantive reply to Arc's content before treating them as a lead at all —
expect ~1 genuine signal per ~12 raw candidates.

**How to apply**: after `refresh-leads`, check `db/whop-leads.json` → `users[].arc_replies_to_them`
for the candidate. If < 3, the next task is "give a genuine, non-sales value touch"
(reply to their actual point, no CTA), not a pitch. Only queue `whop-sales pitch` once
a lead clears 3 value touches.

**UPDATE (P5 arc-demand-flywheel, 2026-07-03)**: two parts of this note are now addressed,
not just diagnosed:
1. The "reply-chain noise / forum spam bots" problem is now filtered at the SOURCE —
   `lead-source.ts`'s `isLikelySpam()` drops ad-copy and multi-@-mention pile-ons before
   they ever enter `db/whop-leads.json` (a one-time reconciliation also cleaned the
   existing store: 13 candidates -> 2, matching this note's "~1 genuine signal per ~12"
   estimate almost exactly).
2. The give-3x credit path itself was already wired (not missing) — `x_reply_log`
   (written on every outbound X reply) feeds `processXReplyLog()` which increments
   `arc_replies_to_them` on every `refreshLeads()` call. Verified correct via an isolated
   fixture (`fixture-give3x-wiring.ts`). The remaining constraint is outbound reply
   VOLUME (403 reply-targeting), not missing wiring — see
   `reply-watchlist-sensor.ts`'s `consecutive_403_count`-ordered pre-filter.
