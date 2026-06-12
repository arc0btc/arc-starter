# Next-session prompt — Phase 2: flip synthesis lane

*Drop this into a fresh Claude Code session after /clear. Self-contained.*

---

Pick up the Whop synthesis lane (Phase 2). Phase 1 reactive replies have been
live since 2026-06-12T21:28Z; this session decides whether the marination has
held cleanly enough to flip `WHOP_SYNTHESIS_ENABLED=true` (still in dry-run),
and then walks the same audit ladder we used for Phase 1.

## Read first, in order

- `memory/MEMORY.md` → [A] whop-wedge for current room state and phase status
- `skills/whop/POLLING-DESIGN.md` → full ADR, especially the "Synthesis lane"
  section (6h cadence, 1 task/day budget, 24h read window, defer-or-post task)
- `skills/whop/CADENCE.md` → rollout phases table — phase 2 is the synthesis
  flip
- `skills/whop/sensor.ts` → `pollWhopSynthesis()` is already implemented,
  gated by `WHOP_SYNTHESIS_ENABLED` (false) and `WHOP_SYNTHESIS_DRY_RUN` (true)
- `skills/whop/drafts/2026-06-12-reading-the-quiet.md` → voice bar for what a
  synthesis post should look like in practice
- `skills/social-x-posting/CADENCE.md` → analogous 4-beat cadence policy for X
  — synthesis can borrow the "4 beat types, defer test, daily budget 1" frame
- `skills/whop/artifacts/replies/` → Phase 1 reactive lane artifacts; read the
  last 24-48h to confirm reactive marination held clean

## Phase 1 health check (run first, before flipping anything)

```bash
# How many real reply tasks queued in the last 24h?
arc tasks --limit 100 | grep -E "Whop reply|whop-replies" | head -20

# Budget burn — is anyone close to 10/day?
ls -1 skills/whop/artifacts/replies/ | tail -20 | \
  xargs -I{} jq '{tick: .tick_at, used: .daily_budget_used_before_tick, candidates: (.candidates|length)}' skills/whop/artifacts/replies/{}

# Has thread_spiral_cap ever fired? daily_budget_exhausted?
grep -l "thread_spiral_cap\|daily_budget_exhausted" skills/whop/artifacts/replies/*.json | head

# Counterparty growth — how many users in the relationship store?
jq '.users | keys | length' db/whop-relationships.json
jq '.users | to_entries | map({user: .value.username, msgs: .value.message_count, theirReplies: .value.their_replies_to_arc, arcReplies: .value.arc_replies_to_them})' db/whop-relationships.json

# Any Arc posts in the room that didn't go through the reactive lane?
arc skills run --name whop -- list-messages --channel chat_feed_1CbxMbfsj2yvpGqNnMcuCg --limit 50 | jq '[.data[] | select(.user.id == "user_cd5Q1fTcrgua1") | {id, at: .created_at, content: (.content | .[0:80])}]'
```

If reactive lane shows clean traffic, no spirals, no unexpected posts, no
budget exhaustion → ready for the synthesis flip.

If anything looks off (e.g., budget hitting cap, members complaining,
unexpected reply chains) → DO NOT flip. Triage first.

## The synthesis lane recap

`pollWhopSynthesis()` runs every 6h. On each tick it:

1. Fetches the last 100 messages from `chat_feed_1CbxMbfsj2yvpGqNnMcuCg`.
2. Filters to a 24h window.
3. Updates the relationship store (shared with reactive lane).
4. Source-dedups via `sensor:whop-synthesis:<YYYY-MM-DDTHH>` so the same
   cadence bucket can't double-fire.
5. Queues ONE task: "read the room, decide defer vs post."
6. Writes an artifact at `skills/whop/artifacts/synthesis/<ISO>.json`.

The dispatched session decides:
- **POST** → a teaching beat the room hasn't heard yet → calls `post-chat`.
- **DEFER** → no teaching worth adding right now → close `completed` with
  summary `nothing worth posting`. Most ticks should defer.

Daily budget: 1 synthesis post. Cadence 6h × 4 ticks/day → ≥3 defer is the
healthy bar. If we ever ship >1 synthesis post/day, the bar isn't holding.

## Open design questions for Phase 2

These were deferred during Phase 0; now's the time to answer them.

1. **Fanout overlap**. The `BlogToXMachine` fanout posts a whop chat hot-topic
   on every new blog publish. If a blog landed in the last 24h, the room
   already got a teaching beat. Should synthesis auto-defer when a
   `publish-fanout:*:whop` task completed in the window? Likely yes — saves
   the synthesis budget for off-blog beats. Spec it before flipping.

2. **Cross-channel coordination**. The X cadence beat (`runCadenceBeat`) is
   currently disabled (`X_CADENCE_ENABLED=false`). When it comes back on,
   should the whop synthesis check whether X just shipped the same theme?
   Probably overkill for Phase 2 — note it and revisit when X cadence
   resumes.

3. **Synthesis prompt voice**. The current task description tells the
   dispatched session to "read the room, decide defer or post" with a
   transcript dump. That's bare-bones. Worth adding:
   - A short "what makes a teaching beat" rubric (info / question / pattern)
   - Examples of when to DEFER (e.g., recent fanout post on same theme, the
     room is in a debugging-help mode, members are talking to each other)
   - The `drafts/` voice bar explicitly referenced
4. **Beat-type structure**. Should synthesis pick from a small set of beat
   types (e.g., "pattern observation", "honest failure", "open question") to
   keep variety? Or keep it free-form and let voice carry it? Recommendation:
   free-form for Phase 2, observe what dispatched sessions naturally produce,
   add structure only if the same shape keeps showing up.

5. **First-flip safety**. Recommend the same Phase 0 discipline:
   `WHOP_SYNTHESIS_ENABLED=true`, `WHOP_SYNTHESIS_DRY_RUN=true` for the first
   24-48h. Sensor produces tasks; dispatch composes-only, no posts.
   Audit artifacts. Then flip dry-run off only after voice quality + defer
   discipline both clear.

## Rollout sequence (compressed, achievement-gated)

1. **Phase 1 health check** (above) — pass/fail gate before doing anything.
2. **Address open questions 1 and 3** — fanout-aware deferral + prompt
   refinement. Small code change in `pollWhopSynthesis()` task description.
3. **Manual trigger** — `arc skills run --name whop -- tick-synthesis` with
   `ARC_WHOP_FORCE=1`. Inspect artifact + queued task description. Verify the
   transcript dump renders cleanly and the rubric/voice bar comes through.
4. **Flip dry-run audit**: `WHOP_SYNTHESIS_ENABLED=true`,
   `WHOP_SYNTHESIS_DRY_RUN=true`. Let it run 24-48h. Tasks queue dry-run only
   (composed result_summary, no post-chat).
5. **Audit pass**: read every synthesis artifact + every dry-run task's
   result_summary. Count defer vs post decisions. Spot-check voice. Adjust
   the synthesis prompt if anything misfires.
6. **Phase 2 live**: flip `WHOP_SYNTHESIS_DRY_RUN=false`. The next tick may
   produce a real post — surface to whoabuddy before the flip.
7. **Phase 3 trigger** (later): once Phase 2 holds clean, revisit the
   `PublishFanoutMachine` `whop_pending` hop end-to-end on a real blog
   publish. The chain should be: blog publish → whop fanout post → maybe a
   synthesis post 6h later if it adds something new → X post.

## Process hygiene (carry forward from Phase 1)

- **Commit often** (every meaningful diff). If you don't, dispatch will
  auto-commit your work into `chore(loop):` noise.
- **Never auto-post** to the paying room without sign-off until trust is
  earned. Default-off all gates.
- **Slow is smooth, smooth is fast** — one verify loop at a time.
- **Defer beats filler** — this rule applies to synthesis posts AS WELL AS
  reactive replies. A "deferred" task close is a successful outcome.
- **Audit > assumption** — every Phase 1 bug was caught by reading actual
  artifacts against actual messages. Same discipline for Phase 2.

## First action this session

1. Run the Phase 1 health check queries above. Read the artifacts.
2. Report what you find — health gate pass/fail, anything surprising in the
   marination period.
3. Surface answers to open questions 1 and 3 (fanout deferral, prompt voice
   refinement) before any code change.
4. Wait for whoabuddy sign-off on the design refinements before flipping any
   flag.

The trust earned in Phase 1 came from the audit catching bugs early. Honor
that pattern for Phase 2.
