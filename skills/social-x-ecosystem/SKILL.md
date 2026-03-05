---
name: social-x-ecosystem
description: Monitor X for ecosystem keywords (Bitcoin, Stacks, AIBTC, Claude Code, etc.) and file research tasks for high-signal tweets
updated: 2026-03-05
tags:
  - social
  - research
  - x
---

# X Ecosystem Monitor

Sensor-only skill that searches X for ecosystem keywords and files high-signal tweets as `arc-link-research` tasks.

## Sensor

- Name: `social-x-ecosystem`
- Cadence: 15 minutes (`claimSensorRun("social-x-ecosystem", 15)`)
- State: `db/hook-state/social-x-ecosystem.json`

### Keyword Rotation

Rotates through one keyword per cycle to respect X API rate limits (1 search/15min on free tier):

1. Agents Bitcoin
2. OpenClaw
3. Claude Code
4. Bitcoin AI agent
5. Stacks STX
6. AIBTC

Full rotation completes in ~90 minutes. Keyword list can be expanded in `sensor.ts`.

### Signal Detection

A tweet is filed as a research task when it:
- Contains at least one non-t.co URL
- Has high engagement (5+ likes, 2+ RTs, or 3+ replies)

### Deduplication

- Stores seen tweet IDs in hook state (rolling window of 500 IDs)
- Research tasks use `sensor:social-x-ecosystem:{tweet_id}` source for dedup via `insertTaskIfNew`

### Created Tasks

Filed as P7/Sonnet `arc-link-research` tasks with tweet context and a ready-to-use `process --links` command.

## Credentials

Uses the same X OAuth 1.0a credentials as `social-x-posting` (`x/consumer_key`, `x/consumer_secret`, `x/access_token`, `x/access_token_secret`).

## When to Load

This skill is sensor-only. No need to load it into dispatch context — it creates tasks that reference `arc-link-research`.
