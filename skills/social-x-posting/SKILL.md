---
name: social-x-posting
description: Post tweets, read timeline, and manage presence on X (Twitter) via API v2
updated: 2026-03-17
tags:
  - social
  - publishing
  - x
---

# X Posting

Post and manage tweets on X (Twitter) using the v2 API with OAuth 1.0a authentication.

## CLI Commands

| Command | Purpose |
|---------|---------|
| `post --text <text>` | Post a tweet (max 25000 chars, X Premium) |
| `reply --text <text> --tweet-id <id>` | Reply to a tweet |
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
| Posts | 25 |
| Replies | 100 |
| Likes | 200 |
| Retweets | 50 |
| Follows | 50 |

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

X API v2 Premium tier: 3,000 tweets/month write limit, higher read throughput than free tier. Search available at standard query rates. The CLI respects these limits — don't spam.

## Caching

Search results and user lookups are cached to `db/x-cache.json` with ISO-8601 timestamps to avoid re-fetching. Cache is keyed by tweet ID and user ID.

## Sensor: Mentions Monitor

`sensor.ts` polls X mentions every 15 minutes. Deduplicates by last-seen tweet ID (stored in `db/hook-state/social-x-mentions.json`). Only creates tasks for mentions worth responding to — filters out:

- Empty/short mentions (just "@arc0btc" with no substance)
- Spam (airdrops, giveaways, follow-back requests)
- Own tweets

Prioritizes: questions about Bitcoin/Stacks topics, direct engagement with substance, mentions with existing engagement signals.

Created tasks use `social-x-posting` skill at P7 (Sonnet) and include the tweet ID, author, text, and a ready-to-use reply command.

## X Premium Features — Not Available via API

These X features require a Premium account + authenticated browser session. **No programmatic API exists.** Do not create tasks expecting Arc to access these:

| Feature | Status | Alternative |
|---------|--------|-------------|
| X Analytics dashboard (impressions, engagement rate, follower growth) | UI-only — requires browser + Premium auth | whoabuddy manually retrieves and records to `memory/topics/publishing.md` |
| X Articles (long-form, up to 100k chars, rich formatting) | UI-only — `/2/tweets` is the only content creation endpoint | Use the blog skill + X promotion: publish to blog, post X thread with link |

If a task asks Arc to "record X analytics" or "publish an X Article", fail immediately with `external-constraint: no programmatic API` and note the alternative path.

## When to Use

- **Publishing observations** — Share insights, ship updates, engage with ecosystem
- **Replying to mentions** — Respond to community interactions
- **Content amplification** — Cross-post signals from aibtc-news or blog
- **Research** — Search tweets and look up users for research and engagement
