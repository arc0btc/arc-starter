# Publish Fan-out — design (task #18634)

**Question (whoabuddy):** does publishing need a workflow so one publish stays consistent across blog → whop → X?

**Answer: yes, and arc-workflows is the right tool — but the build is gated.** This doc is the evaluation;
the machine is *specified here, not yet implemented.* Implement only after the gate clears (see §4).

> **UPDATE 2026-06-12 (#18654): the X half is SHIPPED.** Rather than wait on whop, the single-hop
> `BlogToXMachine` (`state-machine.ts`, template `blog-to-x`) now fires one X post per new blog publish:
> `blog_published → x_pending → completed`. The arc-workflows sensor's `syncBlogPublishes()` creates one
> instance per freshly published post (`blog-to-x:<post_id>`, 1-day window, instance-key dedup). To
> complete the fan-out: extend `BlogToXMachine` to insert a `whop_pending` hop before `x_pending`
> (`blog_published → whop_pending → x_pending → completed`) per §2 once whop #18600 lands a clean post —
> the TODO in the machine's doc-comment marks the exact insertion point. The full `PublishFanoutMachine`
> below remains the spec for that extension; no separate machine is needed.

> **UPDATE 2026-06-12 (#18673): the full fan-out is BUILT as `ContentCalendarMachine`** (`state-machine.ts`,
> template `content-calendar`) — the §2 design realized and extended to every channel: blog (T+0) →
> whop-chat (T+2h) → X thread (T+1d) → whop-forum (T+2d) → public-forum (T+4d) → course-candidacy (T+30d),
> each hop rendered per its `arc-brand-voice/CHANNELS.md` voice card. Timing is enforced inside each action
> off a single `cadence_anchor` (the runner has no scheduler; anchored once at creation to dodge the
> sensor's contextUpdate→autoAdvance context clobber). **GATED OFF**: `syncContentCalendar()` creates
> instances only when `WORKFLOWS_CONTENT_CALENDAR_ENABLED=true`; un-gate per the §4 trigger below, and set
> `WORKFLOWS_BLOG_TO_X_ENABLED=false` at the same time so X isn't double-posted (content-calendar's x_thread
> hop supersedes blog-to-x). The §4 gate still governs: neither whop nor X has landed a clean post yet.

## 1. Verdict — arc-workflows fits, no new machinery needed

The existing dependency-free runner (`state-machine.ts`) already has every primitive the fan-out needs:

- `WorkflowAction { type: "create-task", autoAdvanceState, skills, source, script, contextUpdate }`.
- The meta-sensor (`sensor.ts`, 5-min cadence) evaluates each active workflow, queues **one** task per
  evaluation, dedups by `source`, and — when `autoAdvanceState` is set — advances the state *immediately*
  so the same state cannot re-fire. Terminal states (no outgoing transitions) auto-complete.

No `Workflow()` / `parallel()` orchestration is involved. That matters — see §3.

## 2. The machine — `PublishFanoutMachine` (linear, blog is source of truth)

Blog is the canonical publish; whop and X are downstream amplifications of the *same* post. Sequential, not
parallel — order is blog → whop → X. One task per hop, each hop auto-advances.

```
initialState: blog_published        # workflow is created only once a blog post is live (url in context)
states:
  blog_published:  on{fanout: whop_pending}
                   action -> create-task "Post <title> to whop AI-Prefers-Bitcoin room"
                             skills:[whop], source: publish-fanout:<slug>:whop
                             autoAdvanceState: whop_pending
  whop_pending:    on{done: x_pending}            # the whop task transitions here on success
                   action -> noop                  # waits for the post-chat task to confirm + transition
  x_pending:       on{done: completed}
                   action -> create-task "Post <title> observation to X"
                             skills:[social-x-posting], source: publish-fanout:<slug>:x
                             autoAdvanceState: completed
  completed:       on{}  action -> null            # terminal -> meta-sensor auto-completes
```

Context: `{ title, url, slug, blog_excerpt }`. The whop/X tasks read the blog url+excerpt from context and
compose channel-native copy (whop = hot-topic markdown per `skills/whop`; X = ≤280 char per `CADENCE.md`).

Design choices:
- **Each channel = one task, scoped to that channel's skill.** Keeps dispatch context lean; the whop task
  loads only `whop` SKILL.md, the X task only `social-x-posting`.
- **Confirm-then-advance for side-effects.** whop's `post-chat` and X's `post` are non-idempotent. The hop
  task posts, verifies the message landed, *then* transitions the workflow. If it can't confirm, it leaves
  the workflow in `*_pending` and the source-dedup stops a duplicate post next cycle. (MEMORY [P] idempotency.)
- **Dedup key = `publish-fanout:<slug>:<channel>`** — unique per post per channel; the natural instance gate.

## 3. Loom-spiral safety (the explicit caution on this task)

loom-spiral was an *unbounded-loop* token spiral in a `Workflow()` orchestration. This design avoids that
class entirely by construction:

1. **No agent fan-out.** No `Workflow()`, no `parallel()`, no nested `agent()`. Just the meta-sensor + state
   machine — the same path `InscriptionMachine` (multi-step, on-chain, shipped) already runs safely.
2. **One task per state, then auto-advance.** `autoAdvanceState` means a state fires exactly once. A hop
   that forgets to transition still cannot re-queue (source-dedup + recentDup guard in `sensor.ts`).
3. **Bounded length.** 3 hops, terminal `completed`. No cycle in the graph — there is no transition that
   returns to an earlier state, so the workflow cannot loop.
4. **Cadence-throttled.** At most one task per workflow per 5-min sensor tick.

There is no place for an unbounded loop to live. This is strictly safer than a `Workflow()` script.

## 4. Gate — DO NOT BUILD until both clear

The task decision was explicit: build the pieces first, then wrap. Both pieces are code-complete but their
*publishing path* is blocked on whoabuddy external actions — neither channel has landed a single post:

- **whop #18600** — BLOCKED: company API key missing `chat:message:create` scope. `post-chat` returns
  HTTP 400 until whoabuddy re-scopes the key in the Whop dashboard.
- **X #18636** — BLOCKED: X API 402 CreditsDepleted on `POST /tweets`. Won't auto-recover; needs top-up.

Wiring the fan-out now would connect a pipeline whose two of three outlets are sealed, and it could not be
tested end-to-end. **Build trigger:** the first whop post AND the first X post have each landed cleanly
(manually, via their own tasks). Only then create the `PublishFanoutMachine` + an instance per new blog post.

Tracked by the blocked follow-up created from #18634.
