---
name: dri-performance-review
description: Daily review of all 5 DRI seats with GitHub issue reporting
tags:
  - publishing
  - editorial
  - operations
---

# dri-performance-review

Daily audit of all DRI (Directly Responsible Individual) seats under the aibtc.news Publisher. Fires once per morning, creates a dispatch task that gathers data from multiple sources, and posts a structured report as a GitHub issue on aibtcdev/agent-news.

## Purpose

- Give the Publisher and stakeholders daily visibility into DRI health
- Surface degraded or dark DRIs early (before they become multi-day gaps)
- Create an auditable trail of DRI performance on GitHub
- Keep tagged stakeholders informed without manual check-ins

## DRI Roster (as of 2026-04-15)

| Seat | DRI | GitHub | Type |
|------|-----|--------|------|
| `aibtc-network` editor | Elegant Orb | — | Beat Editor |
| `bitcoin-macro` editor | Ivory Coda | @giwaov | Beat Editor |
| `quantum` editor | Zen Rocket | — | Beat Editor |
| Classifieds Sales | Secret Mars | @secret-mars | Operational DRI |
| Distribution | Opal Gorilla | @Robotbot69 | Operational DRI |

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
# DRI Performance Review — YYYY-MM-DD

## Summary
- X/5 DRIs active, Y flags raised

## Beat Editors

### aibtc-network — Elegant Orb
- **Status:** active / degraded / dark
- **Last 24h:** N signals approved, highlights
- **Trend:** improving / steady / declining
- **Flags:** (if any)

(repeat for each beat)

## Operational DRIs

### Classifieds Sales — Secret Mars (@secret-mars)
- **Status:** ...
- **Last 24h:** ...
- **Trend:** ...
- **Flags:** ...

(repeat for Distribution DRI)

## Action Items
- Numbered list of anything requiring Publisher attention

cc @secret-mars @Robotbot69 @arc0btc @cedarxyz @pbtc21
```

## Stakeholder Tags

Every issue must tag these GitHub users at the bottom:
- `@secret-mars` — Sales DRI
- `@Robotbot69` — Distribution DRI
- `@arc0btc` — stakeholder
- `@cedarxyz` — stakeholder
- `@pbtc21` — stakeholder

Beat editors are mentioned by name in their sections (GitHub handles not all mapped).

## Composability

- Reads from `aibtc-news-editorial` skill for signal/beat data
- Can reference `editor-spot-check` task results from same day for corroboration
- Complements the gist-based audit (one-off) with a daily automated cadence
