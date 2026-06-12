# POLLING-DESIGN — Whop chat polling & reply (ADR)

*Locks the reactive-vs-synthesis question for `skills/whop/sensor.ts`. Read before building.*

Status: **LOCKED 2026-06-12** — whoabuddy signed off on the five close calls
(see "Locked tradeoffs" at the bottom for the chosen values).
Prior art read: `social-x-posting/sensor.ts`, `github-mentions/sensor.ts`,
`github-issue-monitor/sensor.ts`, `arc-workflows/state-machine.ts`, MEMORY [P] critical patterns.

---

## Decision

Build a **hybrid: reactive lane + synthesis lane**. Two independent self-gates, two
independent kill flags, two daily budgets. Reactive optimizes for "members feel
heard"; synthesis optimizes for "read the room as a whole and add a teaching beat
when there's one to add." Each lane is loom-spiral-safe by construction (single-task-
per-source dedup, daily budgets, anti-spiral guards in `whyReply()`).

Rejected alternatives:

- **Reactive-only** — fast feel, but a reply chain ("thanks!" → Arc reply → "nice"
  → Arc reply) can burn compute on filler. whoabuddy flagged this explicitly. The
  whyReply() filter has to do too much work alone.
- **Synthesis-only** — reads room well, never spirals, but a direct @-mention of
  Arc going unanswered for up to 12h feels broken. Members paid $49/mo to interact
  with the agent; that's the contract.

---

## Reactive lane

| Field | Value |
|---|---|
| Sensor name (claim) | `whop-replies` |
| Cadence | **5 min** (matches `github-mentions`) |
| Kill flag | `WHOP_REPLY_ENABLED = false` (master) |
| Audit flag | `WHOP_REPLY_DRY_RUN = true` (queues dry-run tasks that compose but don't post) |
| Daily reply budget | **10** (raised from 5 at Phase 1 launch for early-user headroom) |
| Source-dedup key | `sensor:whop-replies:<message_id>` (one task per chat message, ever) |
| Subject-dedup | inherited from `insertTaskIfNew` |
| Task model | `sonnet` |
| Task priority | `5` (reactive but not urgent — members tolerate minutes, not hours) |

### What triggers a reply task

After `GET /api/v1/messages?channel_id=...&limit=50`, iterate newest-first and pass
each message through `whyReply()`. A message is a candidate iff **any** of:

1. **Direct mention** — message has `mentions: [{ user_id: "user_cd5Q1fTcrgua1" }]`
   OR `mentions_everyone: true` (treat @everyone as opt-in invitation, not noise).
2. **Direct reply to Arc** — `replying_to_message_id` resolves (in last 100 msgs)
   to a message authored by `user_cd5Q1fTcrgua1`.

### `whyReply()` filter — anti-spiral guards

After triggering, **reject** the candidate when **any** of:

| Guard | Rule | Why |
|---|---|---|
| Self-skip | `message.user.id === "user_cd5Q1fTcrgua1"` | Never reply to self. |
| Length floor | content < 15 chars **and** no `?` | "thanks" / "❤️" / "+1" never warrant a reply. |
| Ack pattern | content matches `/^(thx\|thanks\|ty\|tysm\|🔥\|💯\|nice\|cool\|+1\|ack)[\s.!?]*$/i` | Pure acks. |
| Thread spiral cap | Arc has ≥ **3** prior messages in this thread (= same `replying_to_message_id` root or same conversation chain) | Hard cap regardless of bait. |
| Recent-arc cooldown | Arc's last reply to this user was < **15 min** ago | Cool-down so the room doesn't see Arc dominate a thread. |
| Daily budget | Arc has already queued/posted ≥ 5 reply tasks today | Cap blast radius. |
| Mention age | message `created_at` > **7 days** ago | Same staleness guard the X mentions sensor added (#18662). Stale chat → close gracefully. |

A candidate that passes all guards becomes a task. `whyReply()` is pure — given
the message + relationship state + today's budget counter, it returns
`{ accept: true } | { skip: true, reason: "<guard>" }` for clean audit logs.

### Trigger classifier ≠ reply composer

The sensor's job ends at "task created." The dispatched session composes the
reply — same separation as github-mentions. This means whyReply can be
conservative (false-negative-prone) without burning compute: the cost of a
missed reply is "member doesn't get an instant response;" the cost of a false
positive is "Arc spirals into filler in a paid room."

---

## Synthesis lane

| Field | Value |
|---|---|
| Sensor name (claim) | `whop-synthesis` |
| Cadence | **6 h** (faster than X's 12h — chat presence target is "smart, not loud") |
| Kill flag | `WHOP_SYNTHESIS_ENABLED = false` |
| Audit flag | `WHOP_SYNTHESIS_DRY_RUN = true` |
| Daily synthesis budget | **1** |
| Source-dedup key | `sensor:whop-synthesis:<YYYY-MM-DDTHH>` |
| Task model | `sonnet` |
| Task priority | `5` |

Every 6h, queue **one** task with the last 24h of messages dumped into the
description and a clear instruction: *"Read the room. Is there a teaching beat
worth adding right now, or do you DEFER? Defer is the right answer on most
ticks."* Mirrors the X cadence "DEFER if nothing worth saying" pattern. The
6h cadence is paired with the daily budget of 1 — four ticks/day, ≥3 defer
to hold the bar.

The task description includes:
- The synthesized chat transcript (chronological, with usernames)
- The current relationship state for each speaker
- The voice bar: SOUL.md + `drafts/2026-06-12-reading-the-quiet.md`
- The dedup convention: a teaching post here MUST cross-post to nothing (whop
  voice ≠ blog voice ≠ X voice — same theme, different shapes per channel)
- An explicit DEFER affordance: close the task with summary `"deferred: <reason>"`
  if nothing is worth saying

---

## Relationship tracking (whoabuddy ask)

Persistent store at `db/whop-relationships.json`. Updated on **every** reactive-
lane tick (whether or not it queues a task) so the picture stays fresh.

Schema:

```json
{
  "user_WQ6WyvnFOZ6bY": {
    "username": "whoabuddy",
    "display_name": "whoabuddy",
    "first_seen": "2026-06-11T23:43:08Z",
    "last_seen": "2026-06-12T19:52:53Z",
    "message_count": 2,
    "arc_replies_to_them": 1,
    "their_replies_to_arc": 1,
    "recent_interactions": [
      { "at": "2026-06-11T23:43:08Z", "msg_id": "post_1CbxMotgK4Ax294mmJiGfA",
        "direction": "from_user", "snippet": "Latest thing I'm excited about: the agent harness..." },
      { "at": "2026-06-12T19:52:18Z", "msg_id": "post_1Cbyx1rvswwug3eCH27nnz",
        "direction": "from_arc", "snippet": "The double-fire pattern — a thing I caught my own..." },
      { "at": "2026-06-12T19:52:52Z", "msg_id": "post_1Cbyx4RL3i3XVSvCndj4Sk",
        "direction": "from_user", "in_reply_to": "post_1Cbyx1rvswwug3eCH27nnz",
        "snippet": "Can you ELI5?" },
      { "at": "2026-06-12T20:09:42Z", "msg_id": "post_1CbyyLtEK2AbvKSL4j67wP",
        "direction": "from_arc", "in_reply_to": "post_1Cbyx4RL3i3XVSvCndj4Sk",
        "snippet": "ELI5: imagine you check the fridge once an hour..." }
    ],
    "notes": []
  }
}
```

Rules:

- `recent_interactions` capped at last **20** per user (rolling). Older snippets
  drop off to keep the file small.
- `snippet` is first 120 chars — enough context for the reply composer to read the
  thread without loading every message.
- `notes` is a free-form list humans can append (e.g., "co-founder of X,"
  "skeptical of Bitcoin-native agents") that the reply composer also sees.
- The reply task description includes the recipient's full relationship blob.
  This is how the dispatched session knows whether it's talking to a regular
  vs a stranger, and what they've said before.
- File is rewritten atomically each tick (read-merge-write); no concurrent
  sensor risk because dispatch is lock-gated.

This pattern is the chat-room analog of MEMORY [N] agent network contacts: known
counterparties get richer context, strangers get bootstrapped from zero.

---

## ISO8601 artifacts (whoabuddy ask)

Every sensor tick that does any work writes one artifact file. This is the
audit-and-tune surface; we read these to decide when to flip kill flags.

Path scheme: `skills/whop/artifacts/<lane>/YYYY-MM-DDTHHMMSSZ.json`

- `<lane>` ∈ `replies`, `synthesis`
- `T` and `Z` literal; basename collisions resolved by `-HHMMSS` already (only
  collision-prone case is two ticks in the same second, which the 5-min/12h
  cadences make impossible)

Artifact shape (replies lane):

```json
{
  "tick_at": "2026-06-12T20:15:00Z",
  "channel_id": "chat_feed_1CbxMbfsj2yvpGqNnMcuCg",
  "messages_seen": 12,
  "candidates": [
    { "msg_id": "post_xxx", "from": "whoabuddy", "trigger": "direct_reply_to_arc" }
  ],
  "decisions": [
    { "msg_id": "post_xxx", "outcome": "task_created", "task_id": 18900 },
    { "msg_id": "post_yyy", "outcome": "skip", "reason": "thread_spiral_cap" }
  ],
  "daily_budget_used": 1,
  "relationships_updated": ["user_WQ6WyvnFOZ6bY"]
}
```

Synthesis artifact records the synthesized window, the task created (or DEFER
decision), and the full transcript snapshot.

`db/patterns-library-state.json` and `db/x-credits-depleted.json` already follow
this single-JSON-blob convention, so we're not inventing a new pattern. The
new bit is **dated artifacts** under `skills/whop/artifacts/` — committed via
the same dispatch auto-commit that already stages `skills/`.

---

## Anti-spiral overlay (loom-spiral safety class)

Per MEMORY [P] loom-spiral-safety: **single task per evaluation, never two
outstanding for the same source.** This holds:

1. `pollWhopReplies` claim name = `whop-replies` (one outstanding tick).
2. Each candidate message → unique source `sensor:whop-replies:<message_id>` →
   `insertTaskIfNew` is the single point of dedup.
3. The thread-spiral cap (≥3 Arc messages in the thread) means even if the
   filter is wrong, the thread hits a hard wall in 3 exchanges, not 30.
4. Daily budget caps cap per-day blast radius regardless of inputs.
5. Both kill flags default off until a 24-48h dry-run audit passes.

This is the same defense-in-depth shape the dispatch resilience guards use
(pre-commit syntax check + post-commit service-health check).

---

## Rollout

Phased, mirroring the X cadence pre-launch we already proved:

1. **Phase 0 — dry-run audit (24–48h).** Both kill flags FALSE, both dry-run
   flags TRUE. Sensor runs, writes artifacts, queues `dry_run` tasks with
   compose-only instructions (no `post-chat` / `reply-chat` call). Inspect:
   does whyReply pick up the right messages? Does synthesis surface real
   teachings or filler? Are anti-spiral guards triggering as designed?
2. **Phase 1 — reactive live, synthesis dry-run.** Flip `WHOP_REPLY_ENABLED`
   and `WHOP_REPLY_DRY_RUN=false`. Watch for 48h. Reply chains, budget burn,
   any spirals. (Whoabuddy explicit OK before flip.)
3. **Phase 2 — synthesis live.** Flip `WHOP_SYNTHESIS_ENABLED` and dry-run
   off only after Phase 1 holds clean. (Whoabuddy explicit OK before flip.)
4. **Phase 3 — fan-out tie-in.** `PublishFanoutMachine` (#18638) extension —
   blog→whop→X — slots in here. The synthesis lane stays for off-blog beats;
   blog-derived whop posts come through fanout instead.

---

## Locked tradeoffs (whoabuddy 2026-06-12)

1. **Reactive cadence: 5 min.** Matches `github-mentions`. Reconsider if 12 GETs/hr
   start to bite on the Whop rate-limit (undocumented; back off on 429).
2. **Daily reply budget: 10** (raised from initial 5 at Phase 1 launch 2026-06-12).
   Leaves headroom for bursty hours as early users come online; artifacts
   capture trends so we can dial back if we drown the room.
3. **Thread spiral cap: 3.** Adjustable later from the artifacts log if we see
   substantive 4-exchange convos being clipped.
4. **Synthesis cadence: 6 h.** "Smart presence is key" — four ticks/day, ≥3 defer
   to hold the bar.
5. **Direct-address detection: not in scope yet.** Trigger only on the verified
   `mentions[]`/`mentions_everyone`/`replying_to_message_id` paths. If we learn
   the mention object misses cases, add a name-pattern trigger then.
