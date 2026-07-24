---
name: whop
description: Monetize Arc's autonomous output via whop.com — post hot-topics into paid chat rooms and publish blog-derived courses through the Whop API
updated: 2026-06-12
tags:
  - monetization
  - content
  - whop
---

# whop

Connects Arc's content engine (blog, research, signals) to a [whop.com](https://whop.com) shop as a recurring-
income channel. Reference shop: `whop.com/joined/hash-it-out` ($50/mo private chat room). Full strategic
rationale and roadmap live in `STRATEGY.md` (read it before doing heavy course/pipeline work).

## What This Skill Does

- **post-chat** — distill a blog post / insight into a hot-topic and post it into a Whop chat experience.
  This is the wedge: the minimal automated blog→members pipeline.
- **course publishing** — create courses / chapters / lessons from blog clusters (phase 2).
- **discovery** — `whoami` / `list-experiences` to find channel and course ids.

## Credentials

All commands read the Company API key via `getCredential("whop", "company_api_key")`. Commands fail with a
clear message (exit 1) if the key is absent — safe to run before credentials are provisioned. Required keys
(provisioned by whoabuddy under service `whop`):

```
arc creds set --service whop --key company_api_key   --value <company API key>
arc creds set --service whop --key company_id         --value biz_xxx
arc creds set --service whop --key chat_channel_id     --value exp_xxx   # or discover via list-experiences
```

Scope the API key to: `chat:message:create`, `experience:create`, `course:*`, `membership:read`.

## CLI

```
arc skills run --name whop -- whoami
arc skills run --name whop -- list-experiences
arc skills run --name whop -- list-channels                             # chat feeds -> chat_feed_xxx channel id
arc skills run --name whop -- list-messages --channel chat_feed_xxx [--limit N] [--cursor <opaque>]
arc skills run --name whop -- post-chat --channel chat_feed_xxx --content "<markdown>"
arc skills run --name whop -- post-chat --content "<markdown>"          # uses stored chat_channel_id
arc skills run --name whop -- reply-chat --to <message_id> --content "<markdown>" [--channel chat_feed_xxx]
arc skills run --name whop -- create-course --experience exp_xxx --title "Title"
arc skills run --name whop -- create-chapter --course cou_xxx --title "Title" --order 1
arc skills run --name whop -- create-lesson --chapter cha_xxx --title "Title" --type text --content "<md>" --order 1
```

`list-messages` returns newest-first (default limit 20). Pagination: use the opaque cursor string from
`page_info.end_cursor` — raw post IDs as before/after params return 400.

`reply-chat` posts a threaded reply. Both `list-messages` and `reply-chat` use the App API key
(`chat:read` + `chat:message:create` scopes). Arc's agent user id is `user_cd5Q1fTcrgua1` — filter it
out when scanning for messages to reply to.

## Guardrails

- Members pay real money — **the first posts go through a human-review gate**, not full auto. Don't spam.
  Voice rule (SOUL): a post must add information, ask a real question, or make someone want to respond.
- `post-chat` is a side-effecting, non-idempotent call. Before re-dispatching a failed post task, check the
  channel for a matching message — re-dispatch can duplicate. (See MEMORY [P] idempotency rule.)
- Whop rate limits are undocumented; on HTTP 429 back off, do not hammer.

## Discovered IDs & API Reference

Full discovered IDs (company/app/product/plan/experience IDs), the empirically-verified
`/api/v1` write-surface endpoint table, dashboard status history, original-blocker
post-mortem, and the Autonomous Receipt Mechanic (AI-073) design all moved to
`skills/whop/REFERENCE.md` (2026-07-24, kept SKILL.md under the token guideline). Load that
file for deep API/dashboard work; the CLI table above covers routine usage.

## Polling & reply (reactive + synthesis lanes)

Two new self-gated lanes live in `sensor.ts` alongside the state-writer and
patterns-monitor lanes:

- **`whop-replies`** — 5min cadence, reactive. Triggers on direct mentions /
  reply-to-Arc only. `whyReply()` filters via length floor, ack pattern,
  thread spiral cap, recent-arc cooldown, daily budget (5/day), stale-message
  guard. Dry-run by default; produces an audit artifact per tick.
- **`whop-synthesis`** — 6h cadence. Reads last 24h of room activity, queues
  one defer-or-post task. Dry-run by default; 1 task/day budget.

Counterparty context lives in `db/whop-relationships.json` (updated every
reactive tick). Audit artifacts at `skills/whop/artifacts/<lane>/`.

Master kill flags (both default off): `WHOP_REPLY_ENABLED`,
`WHOP_SYNTHESIS_ENABLED`. Dry-run flags (both default on):
`WHOP_REPLY_DRY_RUN`, `WHOP_SYNTHESIS_DRY_RUN`.

Full design and locked tradeoffs: `skills/whop/POLLING-DESIGN.md`.
Operating policy and rollout phases: `skills/whop/CADENCE.md`.

## Artifact Retention Policy

- **`artifacts/synthesis/`** — Retained for quality review. Timestamped JSON snapshots of synthesis decisions (room context, synthesis output, decision to post or defer). No cleanup.
- **`artifacts/replies/`** — Ephemeral audit logs. Timestamped JSON from reply synthesis runs. Gitignored and not tracked. These accumulate during operation but do not affect function — safe to delete periodically or via filesystem cleanup. No active housekeeping job needed.

The `.gitignore` prevents accidental commits of reply artifacts; synthesis artifacts remain visible in git for quality audits.

## Status (2026-06-12 — wedge live)

🟢 **First post landed**: `post_1Cbyx1rvswwug3eCH27nnz` at `2026-06-12T19:52:18Z` in `chat_feed_1CbxMbfsj2yvpGqNnMcuCg`
(AI Prefers Bitcoin). Posted as `arc0btc` / "arc" (`user_cd5Q1fTcrgua1`) — the App's auto-generated
Whop bot user. Content was the "Reading the Quiet" double-fire-pattern draft (see `drafts/`).

Dashboard pass done via API this session:

1. ✅ Free product `prod_4liMVXKGP4E4L` ("hash it out - Public") created.
2. ✅ Public forum `exp_YRtS3kgMVeBGzu` attached to the free product.
3. ✅ Free plan `plan_eABmkrD8PU7Yf` (one_time $0, visible) created on it.
4. ✅ Paid plan `plan_axYMvJ4cBnq8v` flipped from first-month-free → **$49 day-one** (initial=49, renewal=49).
5. ✅ Both product titles use hyphen (`-`), not em-dash.
6. ✅ `exp_bbQpqIAEToAweQ` renamed "Updates & Resources" → "Patterns Library".
7. ✅ New App `app_2800dX1s1c0ul0` registered and installed (replaces orphaned `app_VSfoFN0h5UWdCV`).
8. ✅ App API key carries all 12 declared actions (verified by enumeration; raw-key Bearer auth
   to `POST /v1/messages` works directly — no two-step access-token mint needed).

`sensor.ts` remains gated off (`WHOP_SENSOR_ENABLED = false`) until whoabuddy signs off on a recurring
cadence — first post was manually triggered with explicit in-session OK. Full dashboard-pass
checklist, original-blocker post-mortem, and the Autonomous Receipt Mechanic (AI-073) trigger
path/idempotency design are in `skills/whop/REFERENCE.md`.
