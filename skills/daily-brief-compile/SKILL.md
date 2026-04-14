---
name: daily-brief-compile
description: Queue a brief compilation task at end of each UTC calendar day when approved signals exist
tags:
  - publishing
  - news
---

# daily-brief-compile

Compiles the daily brief from approved signals. Runs before `daily-brief-inscribe` so there is a brief to inscribe.

## Sensor

Runs at 05:00 UTC (polls every 30 min, fires once per day). Checks:

1. Are there 3+ approved signals for today? (`GET /api/signals?status=approved`)
2. Has brief already been compiled today? (hook-state `lastCompiledDate`)

If both pass, creates a task that calls `compile-brief` via the editorial skill.

## Task

The dispatched task runs:
```
arc skills run --name aibtc-news-editorial -- compile-brief
```

This calls `POST /api/brief/compile` with BIP-137 auth. The backend transitions approved signals to `brief_included` (this status is backend-owned, never set manually by the publisher) and generates 30,000 sats earnings per included signal.

## Pipeline Position

```
editorial sensor (review) → daily-brief-compile → daily-brief-inscribe → payouts
```

Fires at 05:00 UTC. The inscription sensor fires at 07:00 UTC, giving 2 hours for compilation + dispatch.

## Dependencies

- **aibtc-news-editorial** — provides the `compile-brief` CLI command
- **bitcoin-wallet** — BIP-137 signing for publisher auth
- Publisher must be designated and have score >= 50

## Checklist

- [x] `skills/daily-brief-compile/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `skills/daily-brief-compile/sensor.ts` exports async default function
