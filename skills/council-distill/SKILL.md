---
name: council-distill
description: Periodic refresh of council patterns from Genesis-Works/agent-coordination into the source-artifact pool. 24h baseline + gh HEAD-SHA fast-path skip.
updated: 2026-06-13
tags:
  - inflows
  - content
  - council
---

# council-distill

Pulls the latest substrate / coordination / mandate / autonomy / artifact / budget
patterns from the dev council's private repo (`Genesis-Works/agent-coordination`)
and writes 5 ISO8601 nuggets into `artifacts/distilled/council/`. Consumers use these
for paid-room synthesis (premium context), reactive replies (topic-matched), and
the X `agent-philosophy` beat (14d window).

## Cadence + freshness

24h sensor floor (`INTERVAL_MINUTES = 1440`). Each tick:

1. Fetch `gh api repos/Genesis-Works/agent-coordination/commits?per_page=1 --jq '.[0].sha'` (cheap).
2. Compare to `hookState.lastSeenHeadSha`.
3. If SHA unchanged AND `hookState.lastDistillAt` is < 7 days old → skip without queuing.
4. Otherwise queue a refresh task.

This belt-and-braces approach gives daily freshness when council is active, and
silences the sensor when they're quiet.

## External-failure tracking

`gh` non-zero exit increments `hookState.consecutiveGhFailures`. At ≥3 consecutive
failures, the sensor emits a single `[ESCALATED]` blocked task to whoabuddy and
applies a 48h cooldown (sets `hookState.failureCooldownUntil`). Counter resets on
the next successful call. Aligns with MEMORY [P] "blocked external dependency:
3+ consecutive → 48h cooldown."

## Gates

- `COUNCIL_DISTILL_ENABLED=true` — master gate. Default OFF; first tick after enable
  produces the first refresh, then the SHA-watch path kicks in.
- `COUNCIL_DISTILL_DRY_RUN=false` to flip to live. Default ON — the task writes
  artifacts into the pool but does NOT update `skills/whop/COUNCIL-CONTENT-WELL.md`
  until voice review clears.

`ARC_DISTILL_FORCE=1` bypasses both gates for manual ticks.

## Topic taxonomy (fixed)

The five council patterns:

- `coordination-primitive` — substrate / shared-DB / FOR UPDATE SKIP LOCKED
- `mandate-loop` — council / structural disagreement / mandate cycle
- `autonomy-tier` — tier model / earned autonomy / charter
- `paired-artifact` — artifact + immutable log / Notch / audit ledger
- `budget-rail` — hard budget rails / trustless delegation / RFC 0012

The dispatched session writes one nugget per topic OR fewer (skipping topics with
no fresh quote in the repo). 0-5 nuggets per tick; quality over quota.

## Quality bar

- ≤ 1200 chars per nugget (enforced by `writeDistilled`).
- Direct quotes from the source repo + 1-sentence framing. Selection, not paraphrase.
- Citation: short pattern name + source ref (e.g. `council:substrate-phase-9`).
- Voice review on the first composed paid-room post BEFORE flipping dry-run off.
