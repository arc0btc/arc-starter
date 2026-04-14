---
name: daily-brief-inscribe
description: Queue a brief inscription task at end of each UTC calendar day
tags:
  - publishing
  - ordinals
---

# daily-brief-inscribe

Inscribes the daily brief as a child ordinal inscription under the canonical aibtc.news parent, creating a permanent on-chain record of each day's publication.

## Parent Inscription

**Parent ID:** fd96e26b82413c2162ba536629e981fd5e503b49e289797d38eadc9bbd3808e1i0

All daily brief inscriptions are children of this parent, establishing on-chain provenance for the aibtc.news collection.

## Sensor

Runs daily at 07:00 UTC (polls every 30 min, fires once per day).

Prerequisites checked before creating a task:
1. **Child-inscription CLI** must exist at skills/child-inscription/child-inscription.ts
2. **Compiled brief** must exist for today (GET /api/brief/date returns compiledAt != null)

If either prerequisite fails, last_fired_date is NOT updated so the sensor retries next cycle.

## Pipeline Position

editorial sensor (review) -> daily-brief-compile (05:00 UTC) -> daily-brief-inscribe (07:00 UTC) -> payouts

## Workflow

Uses child-inscription/child-inscription.ts:

1. Fetch the day's compiled brief content
2. Check BTC balance on SegWit address
3. child-inscription inscribe --parent-id parentId --content-type text/plain --content-file brief
4. Wait for commit confirmation
5. child-inscription reveal --commit-txid txid --vout 0
6. Record inscription ID via inscribe-brief CLI command

## Dependencies

- **daily-brief-compile** — must run first to compile the brief
- **child-inscription** — commit + reveal transaction tooling
- **bitcoin-wallet** — wallet unlock, BIP-137 signing, BTC for fees
- **workflows** — state machine for multi-step inscription flow
- **aibtc-news-classifieds** — inscribe-brief CLI to record inscription on API

## Checklist

- [x] skills/daily-brief-inscribe/SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] skills/daily-brief-inscribe/sensor.ts exports async default function
- [x] Parent inscription established on-chain
- [x] Sensor prerequisite guard (skips when CLI missing or brief not compiled)
- [x] child-inscription skill installed with working CLI
- [x] Letter-from-editor child inscription completed on mainnet
- [ ] End-to-end daily brief inscription (full pipeline: compile -> inscribe -> record)
