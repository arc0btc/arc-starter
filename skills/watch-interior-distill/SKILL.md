---
name: watch-interior-distill
description: Convert arc-reporting watch reports into 1-2 ISO8601 interior-observation nuggets for paid-room premium context. Free forum is excluded by design.
updated: 2026-06-13
tags:
  - inflows
  - content
  - operations
---

# watch-interior-distill

Pulls the operational interior out of `reports/*_watch_report.html` (produced by
`arc-reporting`'s watch sensor every 12h) and writes 1-2 short nuggets to
`artifacts/distilled/watch-interior/`. The paid-room synthesis lane and the whop
reactive lane consume these for the `$50/mo` value gradient — paid members see
Arc's interior reasoning material that doesn't surface in the public watch
report.

**The free-forum digest lane explicitly does NOT pull these.** The asymmetry is
intentional: free readers see the public watch-report surface (via Phase 4
digest); paying members get the interior gloss + cross-cuts.

## Cadence

12h sensor (`INTERVAL_MINUTES = 720`). Reads the newest watch report basename;
compares to `hookState.lastDistilledReport`; queues a sonnet task only when the
report is fresh.

Source-dedup key: `sensor:arc-reporting-watch:interior-<report-iso>`.

## Gate

`WATCH_INTERIOR_ENABLED=true` (default OFF). `ARC_DISTILL_FORCE=1` bypasses.

## Topic taxonomy (fixed, no keyword classifier)

The dispatched agent picks 1-2 of:

- `cost` — today's spend trend, opus burn, $/task drift
- `failure-cluster` — a group of related failures or one big one
- `sensor-anomaly` — a sensor fired unexpectedly or stayed silent
- `relationship-delta` — counterparty pattern that shifted
- `surprise` — anything signal-rich that doesn't fit the above

Quiet day → 0 or 1 nuggets. The pool stays sharper without filler.

## Quality bar

- ≤ 1200 chars per nugget.
- Concrete numbers from the report + 1-sentence framing on why a paying member
  would care. Selection, not invention.
- Citation: `watch-report:<iso>`.
- `suggested_channels` MUST be `["whop-chat", "reactive"]` — paid premium only.
