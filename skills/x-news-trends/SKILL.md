---
name: x-news-trends
description: News search + WOEID/personalized Trends scheduled check-in — the Arxiv-pattern discovery front door onto the candidate-maturation spine
updated: 2026-07-13
tags:
  - social
  - research
  - x
disallowed-tools:
  - Edit
  - Write
  - NotebookEdit
  - Bash
---

# X News + Trends Check-in

The "what's hot" discovery front door onto the Option B candidate-maturation
spine (`src/candidate-spine.ts`, arc-x-research-channel quest Phase 2). Operates
on the **Arxiv-pattern scheduled check-in** the operator locked 2026-07-13: a
periodic run — default every 24h, dial for 8h/4h — pulls X's purpose-built
discovery surfaces (News search, WOEID Trends, Arc's own Premium personalized
trends), applies a standing research prompt (this skill's `sensor.ts` IS the
standing prompt, replacing the operator's per-email prompt), and emits
candidates. This is the same operating shape as `arxiv-research`: each matured
candidate ultimately becomes an ISO-dated base-unit research artifact via the
**unchanged** `arc-link-research` path (`research/{ISO8601}_research.md`) — no
new artifact-writing code was needed, `candidate-maturation`'s existing
maturation pass (Phase 2, generic over `source_lane`) already closes that loop.

## Sensor

- Name: `x-news-trends`
- Cadence: `CHECKIN_INTERVAL_HOURS` constant at the top of `sensor.ts` — 24h
  default, operator-tunable to 8h or 4h. **Check the spend-modeling table in
  the Phase 3 verify artifact before lowering it**: at 4h the whole-channel
  worst case (this skill + `candidate-maturation`) approaches the $1.00/day cap.
- State: `db/hook-state/x-news-trends.json`

## What it does each run

1. **WOEID trends** (`GET /2/trends/by/woeid/1`, worldwide) — OAuth 2.0
   App-Only auth (`xApiGetAppOnly`; **OAuth 1.0a is explicitly rejected by this
   endpoint**, confirmed live 2026-07-13: 403 "Unsupported Authentication").
   Billed FLAT (X prices this per REQUEST, not per resource returned) at the
   confirmed $0.010/request on the `trends` lane.
2. **Personalized trends** (`GET /2/users/personalized_trends`) — the
   EXISTING OAuth 1.0a path (`xApiGet`/`loadXCreds()`), confirmed live to work
   unmodified (the opposite auth requirement from WOEID trends — App-Only is
   rejected here). Requires X Premium on the authenticated account
   (operator-confirmed available on @arc0btc). Billed flat at an ESTIMATED
   $0.010/request (not itemized separately on the public rate card) on the
   `trends-personalized` lane. If the account's auth is rejected (401/403),
   this is logged as a documented blocker, not a hard failure — the check-in
   continues with WOEID trends' terms alone.
3. **Trend-biased query selection** — both trends calls' `trend_name`s are
   scanned for mission-relevant substrings (bitcoin/crypto/stacks/agent/ai/
   llm/claude/x402/stx); a match replaces one of 4 static mission queries for
   this cycle's News search. No match = the static 4-query list runs as-is.
4. **News search** (`GET /2/news/search`, 4 queries/check-in) — OAuth 2.0
   App-Only auth, same as WOEID trends. Billed PER RESOURCE (per story
   returned) on the `news-search` lane at an **UNCONFIRMED, loudly-flagged
   ESTIMATE** of $0.005/story (no line item exists on the public rate card for
   this endpoint at all — Phase 1 console reconciliation item 1; every single
   call logs a `⚠️ PRICING UNCONFIRMED` warning and the ledger entry itself
   carries `pricing_status: "estimated"`). For each Grok story returned,
   `cluster_posts_results[].post_id` values (capped at 10/story) become
   candidates (`source_lane: "news-search"`) on the shared spine — headline,
   category, and flattened entities packed into `discovery_context`/
   `text_snippet` for the eventual research task's context; `urls` is the
   driving post's own permalink (News search doesn't surface a separate
   article URL field).
5. Candidates flow through `skills/candidate-maturation/sensor.ts`
   **unmodified** — it's generic over `source_lane` and doesn't need to know
   this skill exists.

## Lanes this skill writes (for a by_lane audit — see `db/x-read-budget.json`)

| Lane | Pricing status | Billing shape | Auth |
|---|---|---|---|
| `trends` | confirmed ($0.010/req) | flat | OAuth 2.0 App-Only |
| `trends-personalized` | estimated ($0.010/req) | flat | OAuth 1.0a User Context |
| `news-search` | estimated ($0.005/resource) | per-resource | OAuth 2.0 App-Only |

## Credentials

Same X OAuth 1.0a credentials as `social-x-posting` (`x/consumer_key`,
`x/consumer_secret`, `x/access_token`, `x/access_token_secret`) — the OAuth 2.0
App-Only bearer token is exchanged from the SAME `consumer_key`/`consumer_secret`
(no new credential; `getAppOnlyBearerToken` in `x-api.ts`, the standard
non-interactive `client_credentials` grant, not an interactive PKCE flow).

## When to Load

Sensor-only. No need to load it into dispatch context — it creates candidates
that `candidate-maturation` consumes, never tasks directly.
