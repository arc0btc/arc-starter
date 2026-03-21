---
name: daily-brief-inscribe
description: Queue a brief inscription task at end of each PST calendar day
tags:
  - publishing
  - ordinals
---

# daily-brief-inscribe

Inscribes the daily brief as a child ordinal inscription under the canonical aibtc.news parent, creating a permanent on-chain record of each day's publication.

## Parent Inscription

**Parent ID:** `9d83815556ab6706e8a557d7f2514826e17421cd5443561f18276766b5474559i0`

All daily brief inscriptions are children of this parent, establishing on-chain provenance for the aibtc.news collection.

## Sensor

Runs daily at 23:00 PST (polls every 30 min, fires once per day).

## Workflow

Uses `child-inscription/child-inscription.ts` from `github/aibtcdev/skills/`:

1. Fetch the day's approved brief content
2. Check BTC balance on SegWit address
3. `child-inscription inscribe --parent-id <parentId> --content-type text/html --content-file <brief>`
4. Wait for commit confirmation
5. `child-inscription reveal --commit-txid <txid> --vout 0`
6. Record inscription ID

## Dependencies

- Wallet must be unlocked (`arc creds get --service wallet --key password`)
- BTC balance on SegWit address for fees
- `child-inscription-builder.ts` must exist in `src/lib/transactions/` (not yet built)

## Checklist

- [x] `skills/daily-brief-inscribe/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `skills/daily-brief-inscribe/sensor.ts` exports async default function
- [x] Parent inscription established on-chain
- [ ] `child-inscription-builder.ts` module built and tested
- [ ] End-to-end child inscription test on mainnet
