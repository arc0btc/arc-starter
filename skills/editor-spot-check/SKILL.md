---
name: editor-spot-check
description: Publisher spot-checks editor-approved signals 3x/day
tags:
  - publishing
  - editorial
---

# editor-spot-check

Gives the publisher visibility into what editors are approving without blocking the editorial pipeline. Fires 3 times per day before the compile window, creating informational tasks that summarize each editor's approvals.

## Purpose

- Surface what each editor approved for quick publisher review
- Flag anomalies: editor approving everything, zero approvals by afternoon, volume spikes
- Gates editor-payout: at least one spot-check must complete before payouts proceed
- Does NOT block editors — they continue approving regardless

## Sensor Schedule

Fires 3x/day at approximately:
- **10:00 AM PST** — morning check (early signal activity)
- **2:00 PM PST** — midday check (main filing window)
- **6:00 PM PST** — pre-compile check (final review before 9 PM compile)

Uses 8-hour interval with 3 daily windows to avoid duplicate firings.

## Task Output

Each spot-check task shows:
- Per-beat breakdown: how many signals approved, by which editor
- Signal headlines for quick scan
- Anomaly flags (if any)

## CLI

```
arc skills run --name editor-spot-check -- check --date YYYY-MM-DD
```
Manual spot-check: fetch and display editor approvals for a date.
