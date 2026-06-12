# Next-session prompt — Whop chat polling + reply sensors

*Drop this into a fresh Claude Code session after /clear. Self-contained.*

---

Pick up Whop chat polling/reply build. Read these first, in order:

- memory/MEMORY.md  → [A] whop-wedge (the wedge is now LIVE — first post + threaded reply both landed 2026-06-12)
- skills/whop/SKILL.md  → updated topology, all 12 actions on key, raw-key auth confirmed, original-blocker history
- skills/whop/cli.ts  → current commands: whoami, list-experiences, list-channels, post-chat, rename-experience, create-course/chapter/lesson
- skills/whop/sensor.ts  → current gated stub; `WHOP_SENSOR_ENABLED=false`
- skills/whop/drafts/2026-06-12-reading-the-quiet.md  → first post (landed `post_1Cbyx1rvswwug3eCH27nnz`); whoabuddy then asked "Can you ELI5?" (`post_1Cbyx4RL3i3XVSvCndj4Sk`); Arc threaded reply landed (`post_1CbyyLtEK2AbvKSL4j67wP`). Voice for the reply is in the file — that's the bar.
- skills/social-x-posting/sensor.ts  → **proven mentions-reply pattern**. Mirror the staleness guard, recentDup dedup, daily-budget hooks.
- skills/social-x-posting/CADENCE.md  → cadence policy (12h beat, 4 beat types, defer test, brand-gate). Whop chat needs a parallel doc.
- skills/github-mentions/  → direct-mention reactive pattern. Read sensor.ts + SKILL.md.
- skills/github-issue-monitor/  → periodic state polling pattern.
- skills/github-ci-status/  → status polling cadence.
- skills/arc-workflows/state-machine.ts  → BlogToXMachine template; #18638 (reopened) is about extending it with a whop hop.
- memory/MEMORY.md [P] critical patterns  → especially "side-effecting tasks: check idempotency FIRST", "X API HTTP 402 = CreditsDepleted (not rate limit)", and the loom-spiral safety class.

## Strategic context (locked 2026-06-12 in prior session)

The unit is a **piece of Arc's work**, not a channel cadence. Substantive work pieces fan out across six
channels with channel-specific voices (blog / whop chat / whop forum / public forum / X / course). Audience
is agent-operators building production agents — they want tactical specifics, real prompts, real failures.
Pivot is: stop posting observations *about* Arc; start posting teachings *from* Arc.

The whop chat post and ELI5 reply both fit that frame — the original was a teaching about the double-fire
pattern, and the ELI5 reply continued the teaching with a counter-question. The next thing Arc does in chat
should hold that same bar.

## The open design question — answer this before building

whoabuddy's framing (verbatim):

> I'm torn between a time-based approach where Arc looks at what's there and synthesizes a reply, which
> might be better for full chat experience, and things like direct mentions where it's worth looking at
> it right away (but if caught in a reply chain can burn compute on nothing). Our github sensors and
> workflows handle some of this already would be good to follow patterns we have and see where we can
> improve.

**Two designs in tension:**

A. **Direct-trigger / reactive** (like `github-mentions`, `social-x-posting` mentions polling)
   - Fires when a specific event happens: @-mention of arc-the-agents-agent, OR a reply targeting Arc's
     prior post, OR an explicit signal phrase.
   - Pro: fast response time, members feel heard.
   - Con: reply chains can spiral — Arc replies, member responds with "thanks", Arc treats it as another
     trigger, replies again, repeat. *This is the compute-burn-on-nothing scenario whoabuddy flagged.*
   - Mitigation: trigger function must distinguish "real prompt" from "ack/close-out." `whyReply()` should
     downgrade triggers when the message is <N chars, contains only thanks/emoji, or is from Arc's own
     last reply's recipient within X minutes of Arc's last post in this thread.

B. **Time-based synthesis / digest** (closer to `runCadenceBeat()` in social-x-posting)
   - Every N hours, Arc reads the room's last M messages, synthesizes the active threads, and posts
     either: a thoughtful summary, an answer to an open question, or stays silent (the "defer test").
   - Pro: avoids reply-chain spirals by design; reads the room as a whole; quality > latency.
   - Con: members may have moved on by the time Arc shows up; feels like "the agent we hired never
     shows up in real time."

**Pattern from arc-workflows / state-machine.ts**: `autoAdvanceState`, source-dedup, and the
meta-sensor's 5-min cadence — that's the proven loom-spiral-safe spine. Polling design should slot into
the same shape: one task queued per evaluation, never two outstanding for the same source.

**Recommended hybrid (sketch — refine before implementing):**

- **Reactive lane** (cadence: 5 min): direct-mention OR direct-reply-to-arc only. Strict whyReply()
  filter. Daily budget 5 replies.
- **Synthesis lane** (cadence: 6–12 hr): time-based digest evaluator. Reads last 24h of room activity,
  synthesizes "is there a teaching beat I should add?" — most cycles return "nothing to add" (defer test).
  Daily budget 1 synthesis post.
- **Hard kill**: master flag `WHOP_REPLY_ENABLED = false` until trust earned. Even after flip, daily
  budgets cap blast radius.

Read the github sensor implementations before locking the design — they've already solved the spiral
problem and the trigger-classifier problem in their domains. Look specifically at:
- How github-mentions filters reply chains (whatever it does, mirror it).
- How github-issue-monitor handles "is this a new thing or the same thing 30 min later" (probably a
  recent-task source check — same as we want).
- How social-x-posting handles bot-vs-human last-message tracking (claim hook state).

## What's already verified about the Whop API for this work

- Read: `GET /api/v1/messages?channel_id=chat_feed_xxx&limit=20`. Works with app key (chat:read granted).
- Pagination: opaque cursors from `page_info.end_cursor` / `start_cursor`. **Raw post IDs as before/after
  return 400** — must use the cursor string. Default = newest-first, so `limit=N` is fine for "what's
  new" polling.
- Reply: `POST /api/v1/messages {channel_id, content, replying_to_message_id}` — VERIFIED working in
  prior session (the ELI5 reply was posted this way via raw curl).
- Self-ID: Arc's agent user is `user_cd5Q1fTcrgua1` (`arc-the-agents-agent`). Use this to skip self-reply.
- Mentions structure: `mentions: []` array on each message, `mentions_everyone: bool`. Schema for entries
  unverified — probably `{user_id, username}`. Confirm empirically with one `@arc-the-agents-agent` test
  ping before writing the mention filter.
- Target channel: `chat_feed_1CbxMbfsj2yvpGqNnMcuCg` (AI Prefers Bitcoin, paid room).

## CLI work needed (cli.ts extension)

```
arc skills run --name whop -- list-messages --channel chat_feed_xxx [--limit N] [--cursor <opaque>]
arc skills run --name whop -- reply-chat --to <message_id> --channel chat_feed_xxx --content <md>
```

`reply-chat` is `post-chat` + `replying_to_message_id` field — five-line change.

## Tasks already queued / status

- #18638 — Build PublishFanoutMachine (extend BlogToXMachine with whop hop). **REOPENED** from blocked
  → pending in the prior session (whop is now a proven channel). Hold for this design work to land
  first so the fanout knows what the whop hop calls into.
- #18672 — brand-voice audit + write skills/arc-brand-voice/CHANNELS.md (per-channel voice cards).
  Pending. The whop chat voice card will inform reply tone.
- #18673 — ContentCalendarMachine build (gated on CHANNELS.md). Pending.
- #18671 — pause 12h X cadence beat. Active.

## Suggested tasks to queue (decide after design lock)

1. **Implement `list-messages` + `reply-chat` CLI commands** — small, foundational. Should ship first.
2. **Implement `pollWhopReplies()` + `pollWhopSynthesis()` in skills/whop/sensor.ts** — gated by
   `WHOP_REPLY_ENABLED=false` AND `WHOP_SYNTHESIS_ENABLED=false` until trust earned.
3. **Log-only audit mode** — run the sensor for 24-48h with replies queued as `dry_run` tasks that
   compose but don't post. Inspect what would have been sent. (Mirrors the watch-only approach we used
   for X cadence pre-launch.)
4. **Write skills/whop/CADENCE.md** — chat cadence policy parallel to social-x-posting/CADENCE.md.

Queue with `--priority 4 --model sonnet --skills whop,arc-brand-voice --source task:<this_id>`.

## First action this session

1. **Look at the chat** — confirm the ELI5 reply rendered correctly and check if whoabuddy or anyone
   else responded since. The state of the room shapes the design.
   ```
   arc skills run --name whop -- list-channels  # to confirm channel id (optional)
   ```
   (Or curl directly until `list-messages` exists:)
   ```
   APPKEY=$(arc creds get --service whop --key app_api_key); curl -s -H "Authorization: Bearer $APPKEY" \
     "https://api.whop.com/api/v1/messages?channel_id=chat_feed_1CbxMbfsj2yvpGqNnMcuCg&limit=10" \
     | python3 -m json.tool
   ```

2. **Read the GitHub sensor patterns** — github-mentions, github-issue-monitor, github-ci-status. Note
   how each handles cadence, dedup, and chain-spiral avoidance. This shapes the design choice.

3. **Lock the design** — write a short ADR-style doc at `skills/whop/POLLING-DESIGN.md` (~1 page) that
   answers: reactive-only vs synthesis-only vs hybrid; cadences; daily budgets; whyReply() rules;
   anti-spiral guards. Surface tradeoffs to whoabuddy if any decisions feel close.

4. **Implement** in this order: cli (list-messages + reply-chat) → sensor (log-only mode) → audit
   review → flip enable flag → live.

## Process hygiene whoabuddy locked in this cycle

- Move fast and iterate. Trust the test → flip flag pattern. Don't over-design.
- NEVER auto-post to the paying room without sign-off until trust is earned. Default-off all gates.
- Keep the bar: SOUL voice — replies add information, ask a real question, or make someone want to
  respond. Defer beats filler. (See `drafts/2026-06-12-reading-the-quiet.md` for the bar in practice.)
- Slow is smooth, smooth is fast. One lane at a time.
