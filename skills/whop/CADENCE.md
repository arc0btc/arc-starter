# CADENCE — Whop chat policy

*Operating envelope for the Whop reactive + synthesis lanes. Parallel to
`skills/social-x-posting/CADENCE.md`. Implementation lives in
`skills/whop/sensor.ts`; design rationale in `skills/whop/POLLING-DESIGN.md`.*

---

## Channels under management

- `chat_feed_1CbxMbfsj2yvpGqNnMcuCg` — **AI Prefers Bitcoin** (paid, $49/mo).
  Backs `exp_I2Wew0PqJQ50a8` in `biz_zQbfh5SnRnAF5Y` (hash-it-out).
- Arc's identity: `user_cd5Q1fTcrgua1` (`arc0btc` / "arc").

No other channels are in scope yet. Adding one requires updating
`CHAT_CHANNEL_ID` in `sensor.ts` AND extending this doc.

---

## Two lanes, two budgets

| Lane | Cadence | Daily budget | Kill flag | Dry-run flag |
|---|---|---|---|---|
| Reactive replies | 5 min | 10 reply tasks/day | `WHOP_REPLY_ENABLED` | `WHOP_REPLY_DRY_RUN` |
| Synthesis posts | 6 h | 1 synthesis task/day | `WHOP_SYNTHESIS_ENABLED` | `WHOP_SYNTHESIS_DRY_RUN` |

Both lanes default off. Each lane has its own self-gate (claim names
`whop-replies`, `whop-synthesis`) so they never block each other or the
existing state-writer + patterns-monitor lanes.

---

## Reactive lane rules

### Trigger surface (any of)

1. The message has Arc's user_id in its `mentions[]` array.
2. The message has `mentions_everyone: true`.
3. The message's `replying_to_message_id` resolves to an Arc-authored message
   (within the most-recent-50 batch).

Bare name addressing ("hey arc, what do you think") deliberately does **not**
trigger. Watch the dry-run audit for missed cases; if real, add a name-pattern
trigger later.

### `whyReply()` skip guards (any rejects)

| Guard | Threshold | Reason |
|---|---|---|
| Self-skip | `user.id === ARC_USER_ID` | Never reply to self. |
| Length floor | < 15 chars and no `?` | Below substance floor. |
| Ack pattern | `/^(thx\|thanks\|ty\|tysm\|🔥\|💯\|❤️\|nice\|cool\|\+1\|ack)[\s.!?]*$/i` | Pure acknowledgement. |
| Stale message | created_at > 7 days ago | Don't backfill replies on old messages. |
| Thread spiral cap | ≥ 3 Arc messages in the same reply chain | Hard wall on reply loops. |
| Recent-arc cooldown | Arc replied to this user < 15 min ago | Don't dominate a thread. |
| Daily budget | ≥ 10 reply tasks queued today | Cap blast radius. Raised from 5→10 at Phase 1 launch for early-user headroom. |
| Already queued | task with source `sensor:whop-replies:<msg_id>` exists | Idempotent dedup. |

A task is created **only when all guards pass.** All skip reasons are
recorded in the tick artifact for audit-and-tune.

### Voice bar (the dispatched session)

- Add information, ask a real question, or make someone want to respond.
- DEFER beats filler — closing the task with summary `"nothing worth posting"`
  is a valid outcome and counts as success.
- Reference: `skills/whop/drafts/2026-06-12-reading-the-quiet.md`.
- Counterparty context: the reply task's description carries the recipient's
  full `db/whop-relationships.json` blob. Read it before composing.

---

## Synthesis lane rules

Every 6h, queue exactly one "read-the-room" task. Four ticks/day × 1
allowed post = expectation is **≥ 3 ticks defer**, ≤ 1 ticks post. If we
ever see > 1 synthesis post land per day, the defer-test bar isn't holding —
review voice, not budget.

The task receives:
- The last 24h of messages, oldest-first, with `created_at`, username, and
  reply-pointer for each.
- The relationship store path so the composer can read counterparty context.
- An explicit DEFER affordance.

---

## Audit & tune (artifacts)

Per-tick JSON artifacts at `skills/whop/artifacts/<lane>/YYYY-MM-DDTHHMMSSZ.json`.

What to look for during Phase 0 dry-run:

- **whyReply false positives** — `outcome: skip` reasons that don't match what
  a human reader would conclude. Tighten guard, file a follow-up.
- **whyReply false negatives** — messages a human would reply to that didn't
  even classify as candidates. Most likely cause: missing mention coverage.
- **Daily budget burn** — Phase 1 watch: did we hit 5/5 on real traffic? If
  yes, lower the cap; if budget always idle, leave it.
- **Thread-spiral cap clips** — `outcome: skip, reason: thread_spiral_cap` on
  what felt like a substantive 4-exchange convo. If real, raise to 4.
- **Synthesis defer rate** — < 3/4 ticks deferring per day = bar too low.

---

## Rollout phases

| Phase | What's live | Gate |
|---|---|---|
| 0 (current) | Both lanes log-only via dry-run flags; artifacts being produced | both `_ENABLED=false` |
| 1 | Reactive live, synthesis still dry-run | `WHOP_REPLY_ENABLED=true`, `WHOP_REPLY_DRY_RUN=false` — needs whoabuddy OK |
| 2 | Synthesis live | `WHOP_SYNTHESIS_ENABLED=true`, `WHOP_SYNTHESIS_DRY_RUN=false` — needs whoabuddy OK |
| 3 | Fanout tie-in | `PublishFanoutMachine` (#18638) extends with whop hop for blog-derived posts; synthesis lane stays for off-blog beats |

Each phase flip is a one-line code change + a deliberate sign-off in chat or
a closing summary on the relevant task. Never auto-flip.

---

## Hard rules

- Never auto-post to the paying room without sign-off (this doc + an explicit
  OK in the cycle where the flag flips).
- `post-chat` and `reply-chat` are side-effecting and non-idempotent. If a
  dispatched task re-runs, check the room for an existing matching message
  before re-posting. (See MEMORY [P] idempotency rule.)
- On HTTP 429 from Whop, back off — do not hammer. The sensor's `listMessages`
  helper times out after 15s and returns null cleanly; the lane logs and skips
  the tick.
- Whop credit / billing model is undocumented. If we ever see persistent
  failures, park as `blocked` and escalate (mirror of the X 402 CreditsDepleted
  pattern in MEMORY [P]).
