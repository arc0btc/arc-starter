# Whop wedge — three-lane sign-off summary

Drafted 2026-06-12T22:38Z after Phase 2 audit + Phase 3/4 dry-run ship.
**Status: dry-run on all three lanes. Awaiting per-lane sign-off from whoabuddy.**

---

## What shipped

| Phase | Lane | Commit | Gate flag (default) | Dry-run flag (default) |
|---|---|---|---|---|
| 2 | `whop-synthesis` (6h paid-room digest) | (already live, audited) | `WHOP_SYNTHESIS_ENABLED=true` | `WHOP_SYNTHESIS_DRY_RUN=true` |
| 3 | `publish-fanout` whop hop in `PublishFanoutMachine` | `b3e2fefb` | `WORKFLOWS_PUBLISH_FANOUT_WHOP_ENABLED=false` | `WORKFLOWS_PUBLISH_FANOUT_WHOP_DRY_RUN=true` |
| 4 | `whop-free-forum` (24h Public-forum digest) | in `cb562025` (swept by loop auto-commit) | `WHOP_FREE_FORUM_ENABLED=false` | `WHOP_FREE_FORUM_DRY_RUN=true` |

Phase 3 also renamed `BlogToXMachine` → `PublishFanoutMachine`; template name
`blog-to-x` → `publish-fanout`. Legacy alias kept in registry + sensor dedup so
in-flight or already-handled posts can't re-fire. Phase 4 extended the whop skill
with v1 forum API primitives (`post-forum`, `edit-forum-post`, `list-forums`,
`list-forum-posts`) — `experience_id` keyed, no DELETE endpoint exists, PATCH-to-blank
is the soft-delete path.

---

## Audit evidence

### Phase 2 — synthesis lane

- Only forced tick since enable: **#18717** (2026-06-12T22:01Z bucket). Status
  `completed`, summary: *"DEFER: only one human speaker (synthesis is for rooms,
  not 1-on-1s); teaching-beat quota spent (double-fire post + patterns digest both
  ≤6h); no new axis to add without crowding an active thread"*.
- Rubric fired correctly on three independent triggers.
- No composed POST drafts yet to voice-review — defers only. Need a window with
  more speaker diversity for the first POST audit.

### Phase 3 — publish-fanout whop hop

- Smoke-tested all 4 action branches (gate OFF / gate ON dry-run / gate ON live /
  whop_pending noop). All four emit correct tasks with correct source-dedup keys,
  skills arrays, and autoAdvanceState.
- Template registry resolves both `publish-fanout` AND legacy `blog-to-x`.
- All three pre-existing `blog-to-x:*` workflows are terminal (`completed`); the
  rename is non-destructive.
- Recent live publish-fanout activity:
  - `publish-fanout:2026-06-12-the-ninety-percent-night:x` (#18691, completed)
  - `publish-fanout:2026-06-10-the-ladder:x` (#18658, completed)
  - `publish-fanout:2026-06-11-reading-the-quiet:x` (#18657, completed)
  These all ran under the old X-only flow; under the new gate-OFF default they
  continue to behave identically.

### Phase 4 — free-forum digest lane

- Forced tick **#18723** queued in dry-run. Snapshot artifact at
  `skills/whop/artifacts/free-forum/2026-06-12T223701Z.json` captured:
  watch report path, arc 24h stats (125 completed / 2 failed / $66.36),
  paid room 17 msgs / 2 speakers, top relationship whoabuddy 14 msgs,
  cross-lane synthesis flag true.
- Dispatched session closed `completed` with summary: *"DEFER: two hard gates
  hit — paid-room synthesis post fired in last 12h (cross-lane echo rule) +
  Arc already has a forum post from 22:32Z (5min ago). Free forum slot held by
  source-dedup for 2026-06-12"*.
- Both new dedup layers verified: source-dedup (second forced tick correctly
  reported `already queued — skip`), bucket-dedup (`2026-06-12` slot held).
- Gate-OFF default verified: `tick-free-forum` without `ARC_WHOP_FORCE` logs
  `disabled — awaiting Phase 4 audit + sign-off`.

### Reactive lane health (the safety floor)

- 18 reactive artifacts in the window. Latest tick: 7 candidates, all skipped
  with valid reasons (`already_queued`, `below_length_floor`).
- Daily budget burn today: **5/10** — well under cap.
- Zero `thread_spiral_cap`. Zero `daily_budget_exhausted`.
- Relationship store sane: whoabuddy 14 msgs / arc 3 replies / whoabuddy 2 replies.

---

## Voice review status — INCOMPLETE

| Lane | Composed POST drafts | Voice review verdict |
|---|---|---|
| Phase 2 synthesis | 0 (only defers so far) | pending — need a POST tick |
| Phase 3 publish-fanout whop hop | 0 (gate still OFF — no whop tasks emitted yet) | pending — flip gate ON + dry-run ON to produce one |
| Phase 4 free-forum digest | 0 (first dispatched session deferred) | pending — re-run on a different bucket once cross-lane signal clears |

**No live flip should fire until at least one composed POST per lane has cleared
the voice review checklist** (NEXT-SESSION.md). The deferral evidence is healthy
operating signal, but it does NOT substitute for a voice gate on actual prose.

---

## Proposed flip order (whoabuddy decides each)

The order that minimizes risk if any one lane misbehaves:

1. **Phase 3 first** — lowest novelty risk: content comes from blog posts that
   already cleared editorial. The whop hop is a publication multiplier on
   already-vetted prose. Recommended flip: set
   `WORKFLOWS_PUBLISH_FANOUT_WHOP_ENABLED=true` (keep dry-run on) at first; review
   the next dry-run whop task body; then flip
   `WORKFLOWS_PUBLISH_FANOUT_WHOP_DRY_RUN=false`.

2. **Phase 2 synthesis second** — already audited as a deferral surface; the
   live flip is its own decision. Recommended flip: leave `WHOP_SYNTHESIS_DRY_RUN=true`
   until at least one POST decision lands and clears voice review. Then flip to
   `false`. Don't move this without a first composed POST.

3. **Phase 4 free-forum last** — public-facing outbound discovery channel. Getting
   voice wrong here is the most expensive mistake of the three (free room readers
   *decide whether to subscribe* based on what they see). Recommended flip:
   leave `WHOP_FREE_FORUM_DRY_RUN=true` for at least one POST decision and full
   voice review before flipping. Anchor hour for the daily cadence should be
   re-stamped — the 24h timer currently starts whenever the first claim fires;
   pick a deliberate hour (the same content-calendar tier-A discussion has this
   same `15:00Z placeholder` open question per `memory/content-calendar-tier-a.md`).

---

## Explicit asks for whoabuddy

Per lane, the ship/refine ask:

- [ ] **Phase 3 — publish-fanout whop hop.** Do you want this gate flipped ON
      (dry-run still ON) so the next blog publish produces a composed whop task
      for review? Or hold until X-cadence + audit logs build up more?
- [ ] **Phase 2 — synthesis.** Should we wait for a POST decision in the wild
      before considering the live flip, or do you want to manually compose+ship
      one POST through the synthesis prompt to seed the voice review?
- [ ] **Phase 4 — free-forum digest.** Recommend NO live flip until: (a) a
      composed POST clears voice review, (b) the daily-anchor hour is chosen,
      (c) you've confirmed the digest framing (watch-report syndication + arc
      status + whop activity + relationship note) is the right shape. Confirm
      the framing first; flip later.
- [ ] **Free-product cleanup.** The probe forum post `post_1CbzADkBPmv3RHZaAXCvEi`
      was PATCH'd to `[deleted]` body during API recon (no DELETE endpoint exists
      on v1). It's visible in the Public forum as `[deleted]`. Acceptable, or do
      you want it re-edited to something neutral / removed via dashboard?

---

## Operational notes for next session

- The lane structure (5 lanes total in `skills/whop/sensor.ts`) is now stable.
  Any new lane should mirror `pollWhopFreeForumDigest()` pattern: self-gated
  claim, bucket-dedup, snapshot artifact, cross-lane awareness, fanout-aware
  pre-bias.
- `memory/MEMORY.md` whop-wedge entry still references the obsolete free
  product ID `prod_CvDEeSPhRLLp1`. `skills/whop/SKILL.md` line 86 has the
  correct ID `prod_4liMVXKGP4E4L`. MEMORY needs an update on next consolidation.
- The 30-day public-forum probe post is editable but not deletable — call this
  out in any future "experimental write to forum" risk doc.
