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
arc skills run --name whop -- post-chat --channel chat_feed_xxx --content "<markdown>"
arc skills run --name whop -- post-chat --content "<markdown>"          # uses stored chat_channel_id
arc skills run --name whop -- create-course --experience exp_xxx --title "Title"
arc skills run --name whop -- create-chapter --course cou_xxx --title "Title" --order 1
arc skills run --name whop -- create-lesson --chapter cha_xxx --title "Title" --type text --content "<md>" --order 1
```

## Guardrails

- Members pay real money — **the first posts go through a human-review gate**, not full auto. Don't spam.
  Voice rule (SOUL): a post must add information, ask a real question, or make someone want to respond.
- `post-chat` is a side-effecting, non-idempotent call. Before re-dispatching a failed post task, check the
  channel for a matching message — re-dispatch can duplicate. (See MEMORY [P] idempotency rule.)
- Whop rate limits are undocumented; on HTTP 429 back off, do not hammer.

## Discovered IDs (hash-it-out, verified 2026-06-12 tasks #18625, #18600)

- **Company:** `biz_zQbfh5SnRnAF5Y` ("hash it out"). `whoami` hits `/v5/company` (a company key 403s on `/v5/me`).
- **Experiences** (via `/v2/experiences` — `/v5/experiences` 404s), all typed `has_interface`:
  - `exp_I2Wew0PqJQ50a8` — "AI Prefers Bitcoin" (paid; **approved chat channel** per whoabuddy 2026-06-12)
  - `exp_bbQpqIAEToAweQ` — "Updates & Resources" (paid)
  - `exp_YRtS3kgMVeBGzu` — "Public forum" (free)
- **Chat feed (canonical channel id):** `chat_feed_1CbxMbfsj2yvpGqNnMcuCg` — backs `exp_I2Wew0PqJQ50a8`.
  Discover via `list-channels` (`GET /api/v1/chat_channels?company_id=biz_xxx`). `channel_id` accepts the
  `exp_` or the `chat_feed_` id; stored `chat_channel_id` cred = `exp_I2Wew0PqJQ50a8`.

## API endpoints (verified empirically, task #18600)

- **Send message:** `POST /api/v1/messages` `{channel_id, content}` — **v1, not v5** (`/v5/messages` 404s).
  Requires the key scope `chat:message:create`.
- **List chat feeds:** `GET /api/v1/chat_channels?company_id=biz_xxx`.
- Company on `/v5/company`, experiences on `/v2/experiences` (see above).

## Status

`cli.ts` live, authenticating, and pointed at the correct endpoints (task #18600). `post-chat` reaches
`POST /api/v1/messages` and the approved chat feed resolves. **BLOCKER:** the provisioned company API key
is **missing the `chat:message:create` scope** — `post-chat` returns HTTP 400
`"Actor is missing all required permissions: chat:message:create"`. whoabuddy must re-scope the key in the
Whop dashboard before the first post can land. The first hot-topic is composed and ready (`drafts/`).
`sensor.ts` is wired but **gated off** (`WHOP_SENSOR_ENABLED = false`) — flip to true only after the key is
re-scoped, the first post lands, and whoabuddy signs off on a recurring cadence. See STRATEGY.md §4–5.
