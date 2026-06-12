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

## Discovered IDs (hash-it-out, verified 2026-06-12 — API-driven, this session)

- **Company:** `biz_zQbfh5SnRnAF5Y` ("hash it out"). `whoami` hits `/v5/company` (a company key 403s on `/v5/me`).
- **arc-the-agent App:** `app_2800dX1s1c0ul0`, status `hidden`, owned by hash-it-out (creator: whoabuddy).
  Replaces the original `app_VSfoFN0h5UWdCV` arc0btc App, which was orphaned 2026-06-12 when its
  auto-generated install access pass (`prod_CvDEeSPhRLLp1` / `plan_joVsg8haU8Mgt` notes: "App Access")
  was manually deleted from the products list — that pass is the install link and must NOT be deleted.
  All 12 permissions declared on the new App, all required: `chat:message:create`, `chat:read`,
  `chat:moderate`, `chat:manage_webhook`, `forum:read`, `forum:post:create`, `forum:moderate`,
  `courses:read`, `courses:update`, `course_lesson_interaction:read`, `course_analytics:read`,
  `webhook_receive:courses`. Auto-install record: `prod_M6LD5bS1EkNwD` + `plan_ML3AaWeYrLqU4`.
  Agent user: `user_cd5Q1fTcrgua1` — username `arc0btc`, display name `arc` (renamed via
  dashboard UI 2026-06-12). Programmatic profile edits need `user:profile:update` scope
  (NOT on the key); dashboard UI edits don't.
  (Old `app_VSfoFN0h5UWdCV` still in registry but uninstalled; whoabuddy can't access it to delete.)
- **Products** (`GET /v2/products`):
  - `prod_TJknsIOzPDlQS` — "hash it out — Membership" (**paid**, $49/mo, plan `plan_axYMvJ4cBnq8v`).
    4 experiences: AI Prefers Bitcoin, Forums, Courses, Updates & Resources.
  - `prod_4liMVXKGP4E4L` — "hash it out - Public" (**free**, plan `plan_eABmkrD8PU7Yf` one_time $0).
    Route `whop.com/hash-it-out-public`. 1 experience: Public forum. Created 2026-06-12 via API.
  - `prod_CvDEeSPhRLLp1` — "arc0btc" (App access container, not the public funnel — earlier MEMORY
    entries calling this the free product were wrong; that confusion is fixed here).
- **Plans** (`GET /v2/plans`):
  - `plan_axYMvJ4cBnq8v` — renewal, **$49 initial / $49 renewal**, 30d billing (flipped 2026-06-12 from
    initial=0 first-month-free to day-one $49 per whoabuddy intent).
  - `plan_eABmkrD8PU7Yf` — one_time $0, free public access.
- **Experiences** (`GET /v2/experiences`):
  - `exp_I2Wew0PqJQ50a8` — "AI Prefers Bitcoin" (paid; approved chat channel)
  - `exp_dlYgb6mrXuRIq8` — "Forums" (paid)
  - `exp_rm8XtYSqYIBzrl` — "Courses" (paid)
  - `exp_bbQpqIAEToAweQ` — "Patterns Library" (paid; renamed 2026-06-12 from "Updates & Resources")
  - `exp_YRtS3kgMVeBGzu` — "Public forum" (free, attached to `prod_4liMVXKGP4E4L` 2026-06-12)
- **Chat feed (canonical channel id):** `chat_feed_1CbxMbfsj2yvpGqNnMcuCg` — backs `exp_I2Wew0PqJQ50a8`.
  Discover via `list-channels` (`GET /api/v1/chat_channels?company_id=biz_xxx`). `channel_id` accepts the
  `exp_` or the `chat_feed_` id; stored `chat_channel_id` cred = `exp_I2Wew0PqJQ50a8`.

## API endpoints (verified empirically against /api/v1 write surface)

The write surface lives on **`/api/v1`**, not v2 or v5 (those return 401/404 for POST/PATCH). The company
API key is full-admin against v1; only `/v1/apps` and `/v1/access_tokens` distinguish between company-key
and app-key auth.

| Op | Endpoint | Notes |
|---|---|---|
| Send message | `POST /api/v1/messages` `{channel_id, content}` | v1, not v5 (v5 404s). Requires the **key** scope `chat:message:create`. |
| List forums | `GET /api/v1/forums?company_id=biz_xxx` | Returns one `forum_feed_xxx` per forum experience, with `who_can_post` (`admins`/`everyone`). |
| List forum posts | `GET /api/v1/forum_posts?experience_id=exp_xxx&limit=N` | **Keyed by `experience_id`, NOT `forum_feed_id`** — forum_feed_id and channel_id are both rejected. |
| Post forum thread | `POST /api/v1/forum_posts` `{experience_id, content, title?}` | App scope `forum:post:create`. Posts as the app's bot user (`is_poster_admin: false`) even when `who_can_post: "admins"` — the App scope satisfies the gate. |
| Edit forum post | `PATCH /api/v1/forum_posts/{id}` `{content, title?}` | Sets `is_edited: true`. **No DELETE endpoint exists on v1**; PATCH-to-blank (or to a neutral redaction string) is the only soft-delete path. Policy 2026-06-12: redaction is the accepted cleanup — the original post slot stays in the timeline with `is_edited: true`. Full removal requires the Whop dashboard. |
| Mint access token | `POST /api/v1/access_tokens` `{company_id}` | App key + company_id alone returns a company-scoped bot token (`resource_bot_tag` = company). |
| List chat feeds | `GET /api/v1/chat_channels?company_id=biz_xxx` | — |
| Create product | `POST /api/v1/products` `{company_id, title, ...}` | Optional `plan_options` is silently ignored — create plan explicitly. |
| Create plan | `POST /api/v1/plans` `{product_id, plan_type, ...}` | Renewal plans require ≥ $1. Free plans must be `plan_type: "one_time"` with `initial_price: 0`. |
| Update plan | `PATCH /api/v1/plans/{id}` `{initial_price, renewal_price, ...}` | — |
| Attach experience | `POST /api/v1/experiences/{id}/attach` `{accessPassId}` | **Body field is `accessPassId` (camelCase)**, NOT `product_id` as docs say. Docs and reality diverge here. |
| Rename experience | `PATCH /api/v1/experiences/{id}` `{name}` | **Field is `name`, NOT `title`** — title is rejected with parameter_invalid. |
| Update product | `PATCH /api/v1/products/{id}` `{title, description, visibility, ...}` | — |
| Detach experience | `POST /api/v1/experiences/{id}/detach` | Untested in this skill yet. |
| Update app | `PATCH /api/v1/apps/{id}` | `required_scopes` field accepts only `read_user` per docs — App-level permissions are configured in dashboard. |
| List apps | `GET /api/v1/apps?company_id=biz_xxx` | Find arc0btc App. |
| Whoami | `GET /api/v5/company` | Returns the company for any key bound to it (app or company). |
| List products | `GET /api/v2/products` | Includes `experiences[]` and `plans[]` arrays. |
| List plans | `GET /api/v2/plans` | All plans across all products in the company. |
| List experiences | `GET /api/v2/experiences` | `/v5/experiences` 404s. |

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
cadence — first post was manually triggered with explicit in-session OK.

## Original-blocker history (kept for future reference)

The original blocker was diagnosed and locked in this session, then dissolved when a fresh App was
registered:

- The App's `requested_permissions` declares what the App wants; the **issued API key has its own
  separate action set**. The Whop UI surfaces these in two different tabs.
- Original arc0btc App API key carried **zero of 12 declared actions** (`actions: []` in minted tokens).
  Probable cause: the key was issued before the App's permissions were declared, and Whop doesn't
  auto-include newly-declared permissions on existing keys.
- API-key management isn't exposed via the public API (`/v1/api_keys` and `/v1/apps/:id/api_keys` 404).
- Fix path that worked: register a fresh App with permissions pre-declared. Fresh API key issuance
  auto-includes the App's declared permissions. (Trying to edit the old key in the dashboard never
  panned out — the install record had also been deleted, so the App's dashboard page was empty.)
- Lesson: **the auto-generated "App Access" product + plan that appears when an App is installed on a
  company is the install link. NEVER delete it.** Identify by `internal_notes: "App Access"`,
  `accepted_payment_methods: ["free"]`, title matches the App name.
