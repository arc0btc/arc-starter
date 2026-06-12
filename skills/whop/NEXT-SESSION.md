# Next-session prompt — Phase 2 audit + Phase 2 live-flip

*Drop this into a fresh Claude Code session after /clear. Self-contained.*

---

Phase 2 dry-run is LIVE as of 2026-06-12T22:09Z. The synthesis sensor now
fires on its natural 6h cadence and the dispatched session composes a
defer-or-post decision in the task body — but does NOT call `post-chat`.
This session decides whether the dry-run audit cleared and walks the
live-flip gate.

## Read first, in order

- `memory/MEMORY.md` → [A] whop-wedge for Phase 1/Phase 2 status
- `skills/whop/POLLING-DESIGN.md` → ADR, especially the synthesis lane section
- `skills/whop/CADENCE.md` → rollout phases table
- `skills/whop/sensor.ts:657` → `pollWhopSynthesis()` with fanout-aware pre-bias
  (Q1) and the rubric/voice-anchored task description (Q3)
- `skills/whop/drafts/2026-06-12-reading-the-quiet.md` → voice anchor (the same
  excerpt is inlined into every synthesis task description, so the dispatched
  session sees it without a Read call)
- `skills/whop/artifacts/synthesis/` → all dry-run synthesis ticks (read every
  one)
- `skills/whop/artifacts/replies/` → reactive lane soak (read the last 24h)

## Audit gates (must all clear before live flip)

The gate is "≥1 dry-run POST passes voice review" + "≥1 dry-run DEFER passes
rubric review" + reactive soak clean overnight + whoabuddy sign-off.

```bash
# Synthesis ticks since 2026-06-12T22:00Z — list and outcomes
ls -1 skills/whop/artifacts/synthesis/
for f in $(ls -1 skills/whop/artifacts/synthesis/); do
  echo "=== $f ==="
  jq '{tick: .tick_at, bucket, messages: .messages_in_window, recent_arc_signals, dry_run, task_id}' \
    "skills/whop/artifacts/synthesis/$f"
done

# Pull every synthesis dispatched decision (result_summary = the call)
bun -e 'import { Database } from "bun:sqlite";
const db = new Database("db/arc.sqlite", { readonly: true });
console.log(JSON.stringify(db.query(
  "SELECT id, status, source, substr(result_summary,1,300) as s, completed_at FROM tasks WHERE source LIKE \"sensor:whop-synthesis:%\" ORDER BY id DESC LIMIT 20"
).all(), null, 2));'

# Read each composed-post result_detail (the dry-run post text — voice review)
bun -e 'import { Database } from "bun:sqlite";
const db = new Database("db/arc.sqlite", { readonly: true });
const rows = db.query("SELECT id, result_detail FROM tasks WHERE source LIKE \"sensor:whop-synthesis:%\" AND result_detail IS NOT NULL").all();
for (const r of rows) { console.log("---TASK", r.id, "---\n" + r.result_detail.slice(0, 2000)); }'

# Reactive lane: any spirals or budget exhaustion overnight?
grep -l "thread_spiral_cap\|daily_budget_exhausted" skills/whop/artifacts/replies/*.json | head

# Counterparty growth — did anyone besides whoabuddy join?
jq '.users | to_entries | map({user: .value.username, msgs: .value.message_count, theirReplies: .value.their_replies_to_arc, arcReplies: .value.arc_replies_to_them})' db/whop-relationships.json
```

## Voice review checklist (per composed dry-run POST)

For every dry-run task that decided POST and composed a draft in `result_detail`:

- [ ] Hits exactly ONE of the teaching-beat types: pattern observation /
      honest failure / open question (not a mix, not a recap, not "hello room")
- [ ] No "as an agent" or AI-corporate phrasing
- [ ] Plain language, one concrete thing
- [ ] Ends with a real question to the room OR a blog backlink (not both,
      not a marketing CTA)
- [ ] Voice matches `drafts/2026-06-12-reading-the-quiet.md` — same texture,
      same restraint
- [ ] Would the room read it and feel something landed, or skim past?

If any POST fails voice review → don't flip. Refine the rubric in
`pollWhopSynthesis()` and let it re-soak.

## Defer-rate sanity

Daily budget is 1 synthesis post. Cadence 6h × 4 ticks/day → ≥3 defers/day
is the healthy bar. If the dry-run period shows >1 POST decision per 24h or
the same beat being re-attempted, the rubric is too loose.

Q1 fanout-aware pre-bias: confirm `recent_arc_signals` in every artifact
matches reality (cross-check against `git log` for recent fanout posts +
reactive replies in the window).

## Sign-off gate

Once audit clears, surface to whoabuddy with:

1. Count: ticks fired, posts composed, defers decided, defer rate
2. Voice review verdict per composed post
3. Reactive lane health for the same window
4. Proposed flip: `WHOP_SYNTHESIS_DRY_RUN = false` in `skills/whop/sensor.ts`
5. The first composed post that would go live, with an explicit "ready to
   ship this exact text, or refine first?"

Do NOT flip dry-run off without that explicit "ship" from whoabuddy.

## Phase 3 trigger (after Phase 2 live)

Once Phase 2 holds clean (≥3 days of live synthesis + zero room complaints
+ defer rate ≥3/day), the `PublishFanoutMachine` `whop_pending` hop can land.
The end-to-end chain becomes: blog publish → whop fanout post → optional
synthesis 6h later → X post.

## Process hygiene (still applies)

- **Commit often** — every meaningful diff, never let dispatch `chore(loop):`
  catch your work
- **Never auto-post** to the paying room without sign-off until trust is
  earned. Default-off all gates.
- **Defer beats filler** — for synthesis AND reactive. A deferred close is
  a successful outcome.
- **Audit > assumption** — every Phase 1 bug was caught by reading actual
  artifacts against actual messages. Same discipline for Phase 2.

## First action this session

1. Run the audit gate queries above.
2. Voice-review every composed dry-run POST.
3. Cross-check `recent_arc_signals` against actual fanout/reply history.
4. If gates clear → draft the sign-off for whoabuddy. Do NOT flip alone.
5. If gates fail → diagnose, refine the rubric or pre-bias, let it re-soak.
