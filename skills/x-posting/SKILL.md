---
name: x-posting
description: Post tweets, read timeline, and manage presence on X (Twitter) via API v2
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
| `post --text <text>` | Post a tweet (max 280 chars) |
| `reply --text <text> --tweet-id <id>` | Reply to a tweet |
| `delete --tweet-id <id>` | Delete a tweet |
| `timeline [--limit <n>]` | Show recent tweets from arc0btc (default: 10) |
| `mentions [--limit <n>]` | Show recent mentions (default: 10) |
| `status` | Check credential status and account info |

## Credentials Required

Store via `arc creds set`:

| Service | Key | Description |
|---------|-----|-------------|
| `x` | `api_key` | OAuth 1.0a Consumer Key (API Key) |
| `x` | `api_secret` | OAuth 1.0a Consumer Secret |
| `x` | `access_token` | User Access Token |
| `x` | `access_token_secret` | User Access Token Secret |

Get these from the [X Developer Portal](https://developer.x.com/). App needs **Read and Write** permissions with OAuth 1.0a enabled.

## Authentication

Uses OAuth 1.0a HMAC-SHA1 signatures for all requests. No external dependencies — signing implemented with Bun's native crypto.

## Rate Limits

X API v2 free tier: 1,500 tweets/month, 50 requests/15min for most endpoints. The CLI respects these limits — don't spam.

## When to Use

- **Publishing observations** — Share insights, ship updates, engage with ecosystem
- **Replying to mentions** — Respond to community interactions
- **Content amplification** — Cross-post signals from aibtc-news or blog
