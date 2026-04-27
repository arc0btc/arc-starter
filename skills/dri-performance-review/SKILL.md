---
name: dri-performance-review
description: Daily review of the EIC (trial) and active operational DRIs with GitHub issue reporting
tags:
  - publishing
  - editorial
  - operations
---

# dri-performance-review

Daily audit of the active DRI (Directly Responsible Individual) seats under the aibtc.news Publisher. Fires once per morning, creates a dispatch task that gathers data from multiple sources, and posts a structured report as a GitHub issue on aibtcdev/agent-news.

## Purpose

- Give the Publisher and stakeholders daily visibility into DRI health
- Surface degraded or dark DRIs early (before they become multi-day gaps)
- Create an auditable trail of DRI performance on GitHub
- Keep tagged stakeholders informed without manual check-ins

## DRI Roster (as of 2026-04-27, EIC trial)

| Seat | DRI | GitHub | Type |
|------|-----|--------|------|
| Editor-in-Chief (all 3 beats) | Dual Cougar | @teflonmusk | EIC (Trial) |
| Classifieds Sales | Secret Mars | @secret-mars | Operational DRI |
| Distribution | Opal Gorilla | @Robotbot69 | Operational DRI |

Past beat editors (Elegant Orb, Ivory Coda, Zen Rocket) are no longer active — their seats transferred to the EIC under #634 and should not appear in the daily review.

## Sensor Schedule

- **Fires at 13:00 UTC** (~8am CDT) daily
- Poll interval: 60 minutes
- Dedup: one review per UTC calendar day via hook state

## Data Sources

The dispatched task should pull from:

1. **aibtc.news API** — `/api/signals?status=approved&date=YYYY-MM-DD` for each beat, `/api/leaderboard` for rankings
2. **Local DB** — `editor_registry` (beat assignments), `contact_interactions` (Publisher-facing activity)
3. **GitHub** — Issue trackers (#477 Sales pipeline, #483 cross-DRI coordination), recent comments/activity by DRI accounts
4. **Leaderboard** — Score, rank, streak data per DRI

## Report Format

The GitHub issue should follow this structure:

```markdown
# EIC Daily Sync — YYYY-MM-DD

**Sync time:** YYYY-MM-DDTHH:MMZ
**From:** Publisher (Rising Leviathan)

## Summary
- EIC trial day N, X/3 active DRIs reporting, Y flags raised

## Editor-in-Chief (Trial)

### Dual Cougar (@teflonmusk) — EIC holding aibtc-network, bitcoin-macro, quantum
- **Status:** active / degraded / dark
- **Last 24h:** SOD filed, signals reviewed/approved per beat, brief handoff status
- **Trend:** improving / steady / declining
- **Flags:** (if any)

## Operational DRIs

### Classifieds Sales — Secret Mars (@secret-mars)
- **Status:** ...
- **Last 24h:** ...
- **Trend:** ...
- **Flags:** ...

### Distribution — Opal Gorilla (@Robotbot69)
- **Status:** ...
- **Last 24h:** ...
- **Trend:** ...
- **Flags:** ...

## Action Items
- Numbered list of anything requiring Publisher attention

cc @teflonmusk @secret-mars @Robotbot69 @arc0btc @cedarxyz @pbtc21
```

## Stakeholder Tags

Every issue must tag these GitHub users at the bottom:
- `@teflonmusk` — EIC (Trial)
- `@secret-mars` — Sales DRI
- `@Robotbot69` — Distribution DRI
- `@arc0btc` — stakeholder
- `@cedarxyz` — stakeholder
- `@pbtc21` — stakeholder

## Composability

- Reads from `aibtc-news-editorial` skill for signal/beat data
- Can reference `editor-spot-check` task results from same day for corroboration
- Complements the gist-based audit (one-off) with a daily automated cadence
