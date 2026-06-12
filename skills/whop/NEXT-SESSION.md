# Next-session prompt — Phase 2 audit → Phase 3 fanout hop → Phase 4 free-room funnel

*Drop this into a fresh Claude Code session after /clear. Self-contained.*

---

You are picking up the Whop monetization wedge. Three lanes have to land — in
this exact order, each in dry-run before the next is started — so we can
audit before any flip touches a paying room (or the free room that feeds it).

End state of this session: Phase 3 + Phase 4 both **shipped in dry-run mode**,
producing artifacts, awaiting voice review. **Zero new live posts** without
explicit whoabuddy sign-off. Slow is smooth, smooth is fast — and we're
speeding up by *parallelizing soak with build*, not by skipping audit.

## Read first, in order

- `memory/MEMORY.md` → [A] whop-wedge (current Phase 1/2 state)
- `skills/whop/POLLING-DESIGN.md` → ADR for the lane architecture
- `skills/whop/CADENCE.md` → rollout phases table
- `skills/whop/sensor.ts` → four-lane structure; `pollWhopSynthesis()` is the
  template for new lanes (gate flag + dry-run flag + bucket dedup +
  fanout-aware pre-bias + rubric/voice-anchored task description + artifact)
- `skills/arc-workflows/PUBLISH-FANOUT.md` → Phase 3 design spec
- `skills/arc-workflows/state-machine.ts` → `BlogToXMachine` is the base;
  Phase 3 evolves it into the full `PublishFanoutMachine`
- `skills/whop/drafts/2026-06-12-reading-the-quiet.md` → paid-room voice
  anchor (Phase 4 needs its own different voice anchor)

## Discipline — non-negotiable, carry across all three phases

- **Commit often.** Every meaningful diff. If you don't, dispatch will
  auto-commit your work into `chore(loop):` noise and review trails get muddy.
- **Dry-run before live.** Every new lane defaults: `*_ENABLED=true`,
  `*_DRY_RUN=true`. The sensor produces tasks; dispatch composes only.
- **Never auto-post** to ANY room (paid OR free) without explicit sign-off.
- **Defer beats filler.** A deferred close is a successful outcome on every
  lane — reactive, synthesis, fanout, funnel.
- **Audit > assumption.** Read actual artifacts against actual messages.
  Every Phase 1/2 bug was caught this way.
- **Voice review is the gate**, not mechanical cleanliness. Mechanics being
  green ≠ voice landing. Read every composed dry-run post.
- **Bucket-dedup + source-dedup are layered defenses.** Cadence-bucket
  prevents same-hour retick; source-dedup prevents same-event refire.
  Use both; they're not redundant.

---

# Step 0 — Phase 2 audit (carry-over from prior session)

Phase 2 synthesis lane went `WHOP_SYNTHESIS_ENABLED=true`,
`WHOP_SYNTHESIS_DRY_RUN=true` at 2026-06-12T22:09Z. First forced tick (#18717)
deferred cleanly on 3 rubric triggers. Audit it BEFORE building Phase 3.

```bash
# All synthesis ticks since enable
ls -1 skills/whop/artifacts/synthesis/
for f in $(ls -1 skills/whop/artifacts/synthesis/); do
  echo "=== $f ==="
  jq '{tick: .tick_at, bucket, messages: .messages_in_window, recent_arc_signals, dry_run, task_id}' \
    "skills/whop/artifacts/synthesis/$f"
done

# Dispatched decisions on every synthesis dry-run task
bun -e 'import { Database } from "bun:sqlite";
const db = new Database("db/arc.sqlite", { readonly: true });
console.log(JSON.stringify(db.query(
  "SELECT id, status, source, substr(result_summary,1,300) as s, completed_at FROM tasks WHERE source LIKE \"sensor:whop-synthesis:%\" ORDER BY id DESC LIMIT 20"
).all(), null, 2));'

# Voice review on any composed POST drafts
bun -e 'import { Database } from "bun:sqlite";
const db = new Database("db/arc.sqlite", { readonly: true });
const rows = db.query("SELECT id, result_detail FROM tasks WHERE source LIKE \"sensor:whop-synthesis:%\" AND result_detail IS NOT NULL").all();
for (const r of rows) { console.log("---TASK", r.id, "---\n" + r.result_detail.slice(0, 2000)); }'

# Reactive lane health since Phase 1 went live
grep -l "thread_spiral_cap\|daily_budget_exhausted" skills/whop/artifacts/replies/*.json
jq '.users | to_entries | map({user: .value.username, msgs: .value.message_count, theirReplies: .value.their_replies_to_arc, arcReplies: .value.arc_replies_to_them})' db/whop-relationships.json
```

**Decision tree:**
- All defers clean + no spirals + no budget caps → audit pass, proceed to
  Phase 3. Note any voice findings for the eventual live-flip sign-off.
- Any POST composed → run the voice review checklist in this doc (below)
  before proceeding to Phase 3. Voice failures = refine `pollWhopSynthesis()`
  task description and re-soak. Don't compound bugs across phases.
- Reactive lane broke (spirals/caps) → STOP everything, triage reactive
  first. Phase 3/4 do not ship while reactive is sick.

---

# Step 1 — Phase 3: PublishFanoutMachine (whop_pending hop)

**Goal**: every newly published arc0.me blog post fans out to the paid whop
room as a hot-topic. Source-dedup `publish-fanout:<slug>:whop`. Defaults
gated + dry-run. This is the first lane that will produce real
`publish-fanout:%:whop` events, which is what Phase 2's fanout-aware
deferral was designed to react to — so it closes the audit loop on Phase 2.

## Phase 3 prerequisites

- Phase 2 audit passed Step 0
- `skills/arc-workflows/PUBLISH-FANOUT.md` design is the spec; read it
- `BlogToXMachine` currently runs `blog_published → x_pending → completed`
  (see `state-machine.ts` lines ~160–210). The Phase 3 change inserts a
  `whop_pending` state between `blog_published` and `x_pending`.

## Phase 3 implementation steps

1. **Recon.** Read `state-machine.ts` `BlogToXMachine` definition in full;
   note the transition shape, where source-dedup is set, how `autoAdvanceState`
   is wired, the dry-run pattern (if any).
2. **Design the new state.** `whop_pending` queues a task with:
   - `source: publish-fanout:<slug>:whop`
   - `skills: ["whop", "arc-brand-voice"]`
   - `model: sonnet`
   - Description: compose a hot-topic for the paid room from the blog post,
     1 pull-quote + 1 open question, link back to arc0.me/blog/<slug>. Voice
     anchor: `skills/whop/drafts/2026-06-12-reading-the-quiet.md`.
   - Dry-run prefix `[DRY-RUN]` + instruction to compose-not-post when
     `WORKFLOWS_PUBLISH_FANOUT_WHOP_DRY_RUN=true`
3. **Gate.** New env flag `WORKFLOWS_PUBLISH_FANOUT_WHOP_ENABLED` (default
   false). Mirror the existing `WORKFLOWS_BLOG_TO_X_ENABLED` pattern. When
   off, the workflow skips the whop hop and goes blog → x directly (current
   behavior — must not regress).
4. **Dry-run flag.** `WORKFLOWS_PUBLISH_FANOUT_WHOP_DRY_RUN` (default true).
   When true, dispatched session composes but does NOT call `post-chat`.
5. **Wiring.** The transition from `whop_pending → x_pending` is
   `autoAdvanceState`-driven on task completion (or compose-only completion
   in dry-run). X hop should NOT be blocked by a stuck whop hop on a 4xx
   — define a max-retry + fall-through-to-x policy.
6. **Rename.** `BlogToXMachine` → `PublishFanoutMachine`. Update the sensor
   that creates instances (`syncBlogPublishes()`), update instance keys,
   update all references. Don't break in-flight instances.
7. **Verify before flipping anything live.**
   ```bash
   bun build --no-bundle skills/arc-workflows/state-machine.ts
   # Trigger a workflow against a real recent blog post in dry-run
   # — verify task body, voice rubric, dedup behavior, autoAdvanceState
   ```
8. **Flip the enable flag** (`WORKFLOWS_PUBLISH_FANOUT_WHOP_ENABLED=true`,
   keep dry-run on). The next blog publish queues a dry-run whop task.
9. **Migrate the TODO note** in MEMORY.md whop-wedge / x-cadence entries —
   the `whop_pending hop` TODO is no longer pending.
10. **Commit at each meaningful boundary** (design, gate plumbing, rename,
    voice rubric, verification).

## Phase 3 verify gate (must clear before Phase 4)

- `bun build --no-bundle` clean on the changed files
- A forced or natural workflow instance produces a `publish-fanout:<slug>:whop`
  task in dry-run with: correct subject, voice rubric inline, link to source
  blog, source-dedup honored, autoAdvanceState to `x_pending` after completion
- BlogToX (X-only) behavior unchanged when whop gate is off
- No regressions in `WORKFLOWS_BLOG_TO_X_ENABLED=true` path

If anything misfires, fix before moving on. Don't compound.

---

# Step 2 — Phase 4: Free-room funnel teaser lane

**Goal**: a teaser cadence into the FREE Public Forum (`prod_CvDEeSPhRLLp1`)
that pulls people into the paid room. Different room, different audience,
different voice. Gated + dry-run by default.

The framing isn't "post the same content to both rooms" — that would
devalue paid. The free room gets *teases of the depth*: glimpses, one-line
patterns, open questions that get answered in the paid room. Every free
post earns its keep by pointing somewhere.

## Phase 4 implementation steps

1. **Recon.** Find the free Public Forum chat channel ID.
   ```bash
   arc skills run --name whop -- list-channels --company-id biz_zQbfh5SnRnAF5Y
   # OR query experiences for prod_CvDEeSPhRLLp1 and trace to its feed
   ```
   Stash the channel ID + experience ID in `skills/whop/sensor.ts` as
   `FREE_FORUM_CHAT_CHANNEL_ID` and `FREE_FORUM_EXPERIENCE_ID`. Sanity
   check by `list-messages` on it — confirm Arc has post permission (if
   not: same per-experience-install pattern as the paid room).
2. **Voice anchor.** Draft `skills/whop/drafts/2026-06-12-free-room-voice.md`
   (or appropriate date). Texture rules:
   - Tease, don't deliver. One concrete pattern name + one question; the
     answer is in the paid room.
   - Maximum 3–4 sentences. The free room rewards brevity.
   - Always end with: link to arc0.me OR pointer to paid room ("answered
     this in the AI Prefers Bitcoin chat last week — happy to share the
     thread if useful").
   - Never lift paid-room content verbatim. Paraphrase to the tease shape.
   - Forbidden: "join paid", "subscribe", "exclusive". The conversion
     happens because the depth is visible, not because we marketed.
3. **Lane skeleton.** Copy the `pollWhopSynthesis()` shape exactly. New
   function `pollWhopFreeForumTeaser()`. Same parts:
   - Self-gated claim (suggest 12h cadence — slower than synthesis; the
     free room shouldn't see Arc as a firehose)
   - Cadence-bucket dedup key `sensor:whop-free-forum:<YYYY-MM-DD>`
   - 24h–48h read window of paid-room transcript (this is the *source*
     material — what's been said in paid that's worth teasing)
   - Source-dedup
   - Task body with rubric, DEFER triggers, inlined voice anchor
   - Artifact at `skills/whop/artifacts/free-forum/<ISO>.json`
4. **Rubric for the dispatched session:**
   - Goal: compose ONE 3-sentence tease from the paid-room transcript
   - Tease must contain a concrete pattern name or specific finding
   - End with a real question or arc0.me link
   - DEFER if: no specific pattern/finding to tease, paid-room recent
     activity is debugging not teaching, free-room recent activity already
     has Arc presence (≤24h), or the tease would cannibalize paid (giving
     away the full answer).
5. **Fanout-aware deferral.** Same shape as Phase 2: check for recent
   `publish-fanout:%:whop`, `sensor:whop-replies:`, `sensor:whop-synthesis:`
   in window — *plus* recent `sensor:whop-free-forum:%` self-dedup. The
   free room should see Arc *less* often than the paid room.
6. **Daily budget.** 1 free-forum post/day, like synthesis. Most ticks
   should DEFER.
7. **CLI helper.** Add `tick-free-forum` to `skills/whop/cli.ts` mirroring
   `tick-synthesis`. `ARC_WHOP_FORCE=1 arc skills run --name whop --
   tick-free-forum` for manual smoke tests.
8. **Verify with a forced tick** in dry-run. Inspect:
   - Artifact: recent_arc_signals captured, transcript excerpt sensible
   - Task body: rubric/voice anchor/DEFER triggers all render
   - Dispatched decision (read result_summary + result_detail when it
     completes): voice review per checklist below
9. **Flip enable** (`WHOP_FREE_FORUM_ENABLED=true`, keep dry-run on). Soak.

## Phase 4 verify gate (must clear before any live flip)

- ≥1 dry-run task closes as DEFER with rubric-cited reason
- ≥1 dry-run task closes as POST with voice review pass (see checklist)
- Source-dedup + bucket-dedup both observed working
- Recent_arc_signals correctly captures *both* paid-room and free-room
  recent posts (cross-lane awareness)

---

# Voice review checklist (apply to every composed dry-run POST,
# Phase 2 + Phase 3 + Phase 4)

- [ ] Hits exactly ONE teaching-beat type (pattern / honest failure /
      open question) — not a mix, not a recap
- [ ] Plain language, one concrete thing
- [ ] No AI-corporate phrasing, no "as an agent...", no platitudes
- [ ] Ends with a real question OR a backlink (not both, not a CTA)
- [ ] Matches its voice anchor draft texture
- [ ] Would the room read it and feel something landed?
- [ ] *(Phase 4 only)* Teases without giving away — would a free-room
      reader want to find the full answer in the paid room?

Any fail → refine rubric, re-soak. Don't compound across phases.

---

# Live-flip gate (do NOT auto-flip — surface to whoabuddy)

Once Phase 2 + Phase 3 + Phase 4 are all in dry-run with clean audit:

1. Counts: ticks fired per lane, posts composed per lane, defer rate per
   lane, reactive lane budget burn over the same window
2. Voice review verdict on each composed POST
3. Reactive lane health for the same window (spirals/caps)
4. Proposed flips: which lanes go live in what order, with the first
   composed POST from each presented for explicit ship/refine decision
5. Whoabuddy explicit "ship" required per lane

Recommended flip order if all pass:
- Phase 3 first (publication multiplier; lowest novelty risk because the
  content comes from blog posts that already cleared editorial)
- Phase 2 synthesis second (already audited, but the live flip is its own
  decision)
- Phase 4 last (free room is *outbound discovery*; getting voice wrong here
  is the most expensive mistake)

---

# Process hygiene — read before starting, again at each phase boundary

- **Commit often.** Every meaningful diff. Dispatch's `chore(loop):` is the
  failure mode.
- **Never auto-post** to paid or free room without sign-off.
- **Defer beats filler** on every lane.
- **Audit > assumption** — read actual artifacts against actual messages.
- **Slow is smooth, smooth is fast** — speed is from parallelizing soak
  with build, not from skipping audit.
- **Don't compound bugs.** If a phase verify gate fails, fix it before
  moving on. The whole point of dry-run-then-audit is to catch this
  before it ships.
- **Use bucket-dedup AND source-dedup** as layered defenses.
- **Voice reviews are the gate**, not mechanical green. Read the prose.

## First action this session

1. Run Step 0 (Phase 2 audit). Report findings.
2. If audit passes → start Phase 3 implementation. Commit at each boundary.
3. After Phase 3 verify gate clears → start Phase 4 implementation.
4. After Phase 4 verify gate clears → draft the sign-off summary for
   whoabuddy. Do NOT flip any DRY_RUN flag without that sign-off.

End-state of this session: three lanes in dry-run, audits in hand, sign-off
draft ready. We are *speeding up by doing more in parallel*, not by
shipping less reviewed code.
