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

## Discovered IDs (hash-it-out, verified 2026-06-12 — API-driven, this session)

- **Company:** `biz_zQbfh5SnRnAF5Y` ("hash it out"). `whoami` hits `/v5/company` (a company key 403s on `/v5/me`).
- **arc0btc App:** `app_VSfoFN0h5UWdCV`, status `hidden`, owned by hash-it-out (creator: whoabuddy).
  App's `requested_permissions` includes `chat:message:create` (verified — UI mislabels it as
  "Read chat messages", that's a Whop dashboard string bug, the underlying `action` is correct).
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

## Status (2026-06-12, this session)

The strategy-level dashboard pass is **done via API**:

1. ✅ Free product `prod_4liMVXKGP4E4L` ("hash it out - Public") created.
2. ✅ Public forum `exp_YRtS3kgMVeBGzu` attached to the free product.
3. ✅ Free plan `plan_eABmkrD8PU7Yf` (one_time $0, visible) created on it.
4. ✅ Paid plan `plan_axYMvJ4cBnq8v` flipped from first-month-free → **$49 day-one** (initial=49, renewal=49).
5. ✅ arc0btc App confirmed `status: hidden` (was already configured).

**Remaining blocker for first whop post — narrowed and locked in:**

The blocker is **NOT the App-level permission** (the App's `requested_permissions` already includes
`chat:message:create`, verified via `GET /v1/apps/app_VSfoFN0h5UWdCV`). The blocker is the **issued App
API key's own action scope**. Exact error path:

```
POST /v1/access_tokens  {company_id, scoped_actions: ["chat:message:create"]}
  → 400 "This API key is not authorized to scope to the following action:
      chat:message:create. Update your API key permissions to include this action."
```

API-key management is **not exposed via the public API** (all probed `/v1/api_keys`, `/v1/apps/:id/api_keys`
paths 404). This must be done in the Whop dashboard:

**Whop dashboard → arc0btc App → API Keys → edit the issued key → add `chat:message:create` (and
`chat:read` for completeness) → save (or rotate if Whop forces it). Then re-run `arc skills run --name whop
-- post-chat ...`.**

(Earlier MEMORY guidance to add the scope at the App-level Permissions tab was inverted — the App tab
already has it; it's the API key's own action set that's deficient.)

`sensor.ts` remains gated off (`WHOP_SENSOR_ENABLED = false`) until the first post lands and whoabuddy
signs off on a recurring cadence.

## How `post-chat` will actually work once the key is re-scoped

`cli.ts` currently passes the raw app key as a Bearer token. With proper scopes, that path may work
directly — but the documented chat-auth flow is a two-step: mint a company-scoped access token via
`POST /v1/access_tokens {company_id}` (with the app key), then post with that token. The probe in this
session confirmed the mint endpoint already works (returns a JWT with `resource_bot_tag = biz_xxx`); only
the embedded `actions: []` is empty because the key lacks scopes. The cli will be updated to use this
two-step flow if the raw-key path still 400s after the key is re-scoped. (Tracked: tasks #6 / #7.)
