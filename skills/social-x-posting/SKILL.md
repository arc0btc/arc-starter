---
name: social-x-posting
description: Post tweets, read timeline, and manage presence on X (Twitter) via API v2
updated: 2026-03-05
tags:
  - social
  - publishing
  - x
---

# X Posting

Post and manage tweets on X (Twitter) using the v2 API with OAuth 1.0a authentication.

## CLI Commands

> **⚠️ DEPRECATED (2026-06-24):** The `reply` command is a passthrough to `social-engine/reply-send.ts` and will be removed in a future release. New reply workflows MUST route through social-engine directly. See [When to Use](#when-to-use) for routing guidance.

| Command | Purpose |
|---------|---------|
| `post --text <text>` | Post a tweet (max 280 chars) |
| `reply --text <text> --tweet-id <id>` | **[DEPRECATED]** Reply to a tweet — now delegates to social-engine. Use social-engine directly. |
| `delete --tweet-id <id>` | Delete a tweet |
| `like --tweet-id <id>` | Like a tweet |
| `unlike --tweet-id <id>` | Unlike a tweet |
| `retweet --tweet-id <id>` | Retweet a tweet |
| `unretweet --tweet-id <id>` | Undo a retweet |
| `timeline [--limit <n>]` | Show recent tweets from arc0btc (default: 10) |
| `mentions [--limit <n>]` | Show recent mentions (default: 10) |
| `search --query <text> [--limit <n>]` | Search recent tweets (10-100, default: 10) |
| `lookup --username <handle>` | Look up a user by username |
| `budget` | Show daily action budget usage and remaining |
| `status` | Check credential status and account info |

## Daily Budget

Conservative daily limits to ensure quality over quantity. Budget resets at midnight UTC. State persisted to `db/x-budget.json`.

| Action | Daily Limit |
|--------|-------------|
| Posts | 10 |
| Replies | 40 |
| Likes | 50 |
| Retweets | 15 |
| Follows | 20 |

Budget is enforced on `post`, `reply`, `like`, and `retweet` commands. Unlike/unretweet are free (undoing actions). Some engagement actions are pay-per-use on X API — budget awareness prevents surprise costs.

## Credentials Required

Store via `arc creds set`:

| Service | Key | Description |
|---------|-----|-------------|
| `x` | `consumer_key` | OAuth 1.0a Consumer Key |
| `x` | `consumer_secret` | OAuth 1.0a Consumer Secret |
| `x` | `access_token` | User Access Token |
| `x` | `access_token_secret` | User Access Token Secret |

Get these from the [X Developer Portal](https://developer.x.com/). App needs **Read and Write** permissions with OAuth 1.0a enabled.

## Authentication

Uses OAuth 1.0a HMAC-SHA1 signatures for all requests. No external dependencies — signing implemented with Bun's native crypto.

## Rate Limits

X API v2 free tier: 1,500 tweets/month, 50 requests/15min for most endpoints. Search is limited to 1 request/15min on free tier. The CLI respects these limits — don't spam.

## Caching

Search results and user lookups are cached to `db/x-cache.json` with ISO-8601 timestamps to avoid re-fetching. Cache is keyed by tweet ID and user ID.

## Sensor: Mentions Monitor

`sensor.ts` polls X mentions every 15 minutes. Deduplicates by last-seen tweet ID (stored in `db/hook-state/social-x-mentions.json`). Only creates tasks for mentions worth responding to — filters out:

- Empty/short mentions (just "@arc0btc" with no substance)
- Spam (airdrops, giveaways, follow-back requests)
- Own tweets

Prioritizes: questions about Bitcoin/Stacks topics, direct engagement with substance, mentions with existing engagement signals.

Created tasks use `social-x-posting` skill at P7 (Sonnet) and include the tweet ID, author, text, and a ready-to-use reply command.

## Posting Cadence

Beyond the reactive mentions sensor, `sensor.ts` runs a **proactive cadence beat**
(`runCadenceBeat`, separate claim name `social-x-posting-cadence`, ~72h) that queues one original
AI-prefers-Bitcoin observation per beat to keep X warm between blog posts. It is credit-aware
(skips while X credits are depleted) and pausable via `X_CADENCE_ENABLED`. Full policy — theme
spine, content mix, and the blog→whop→X coordination model — lives in **`CADENCE.md`**. Read it
before composing any proactive X post; coordinate voice with the latest blog post and the whop
hash-it-out hot-topic so the same themes flow blog→whop→X (fan-out: task #18634).

## When to Use

- **Publishing observations** — Share insights, ship updates, engage with ecosystem
  - Use: `post` command for root tweets; `post --reply-to <id>` for thread continuations
- **Replying to mentions** — Respond to community interactions
  - **DEPRECATED:** Do NOT use `reply` command. Route all replies through `social-engine` directly.
  - See social-engine/SKILL.md for the canonical reply-lane admission and posting workflow.
  - The `reply` command is a passthrough only and will be removed in a future release.
- **Content amplification** — Cross-post signals from aibtc-news or blog
- **Research** — Search tweets and look up users for research and engagement

## Reply Routing (Canonical Path)

All replies MUST route through social-engine (`skills/social-engine/reply-send.ts`). The admission primitive enforces:
- **Dedup:** source_key UNIQUE constraint (≤1 reply per thread per day)
- **Kill switch:** outbound_enabled flag checked before admission and before provider send
- **Budget:** in-transaction budget_ledger debit (budgets reply slots atomically)
- **Restriction handling:** 403 reply-restriction responses → skip with raw provider JSON persisted

The `social-x-posting -- reply` command exists only for backwards compatibility and delegates to social-engine. Do not call it directly in new code.
