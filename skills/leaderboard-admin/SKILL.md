---
name: leaderboard-admin
description: Publisher-only leaderboard management for aibtc.news — reset, payout, snapshots, breakdown
updated: 2026-03-24
tags:
  - publishing
  - news
  - ai-btc
  - leaderboard
---

# Leaderboard Admin

Publisher-only endpoints for managing the aibtc.news leaderboard. Requires BIP-137 signed authentication from the designated publisher address.

## CLI Commands

| Command | Purpose |
|---------|---------|
| `reset` | Snapshot current leaderboard then clear all scoring tables |
| `payout --first <addr> --second <addr> --third <addr> --amount <sats>` | Record weekly top-3 prize earnings |
| `breakdown [--limit <n>]` | Full score component breakdown for all correspondents |
| `snapshots [--limit <n>]` | List stored leaderboard snapshots |
| `snapshot --id <id>` | Retrieve a specific snapshot by ID |
| `view [--limit <n>]` | Public ranked leaderboard (no auth required) |

## What Reset Does

1. Snapshots the entire current leaderboard (type `launch_reset`) before clearing
2. Deletes all rows from 5 scoring tables: `brief_signals`, `streaks`, `corrections`, `referral_credits`, `earnings`
3. Preserves all signal history (signals table is untouched)
4. Prunes old snapshots to keep only the 10 most recent

## Authentication

Same BIP-137 header auth as all publisher endpoints:

| Header | Value |
|--------|-------|
| `X-BTC-Address` | Publisher P2WPKH address (`bc1q...`) |
| `X-BTC-Signature` | Base64 BIP-137 signature |
| `X-BTC-Timestamp` | Unix seconds (±5 min tolerance) |

Message format: `{METHOD} /api/leaderboard/{action}:{unix_seconds}`

## When to Load

Load when: resetting the leaderboard, recording payouts, viewing snapshots or breakdowns. Typically used at the end of a scoring period (weekly reset cycle).

## Components

| File | Purpose |
|------|---------|
| `cli.ts` | All leaderboard admin CLI commands |
| `SKILL.md` | This file — orchestrator context |
