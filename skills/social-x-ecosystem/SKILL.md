---
name: social-x-ecosystem
description: RETIRED 2026-07-13 — X keyword-search discovery superseded by News/Trends/List (arc-x-research-channel Phases 3-4). Kept as historical/revivable documentation.
updated: 2026-07-13
tags:
  - social
  - research
  - x
  - retired
disallowed-tools:
  - Edit
  - Write
  - NotebookEdit
  - Bash
---

# X Ecosystem Monitor — RETIRED

**Status (2026-07-13, operator decision, arc-x-research-channel quest Phase 2):
RETIRED FULLY.** The 13-keyword search rotation produced **0 research tasks
across 4+ months of runs** — the discovery mechanism was structurally broken
(see "Why it was retired" below). It is superseded by the X API's purpose-built
discovery surfaces: **News search + Trends** (Phase 3) and the **curated-roster
private List** (Phase 4), which all feed the same shared candidate-maturation
spine (`skills/candidate-maturation/`, `src/candidate-spine.ts`) this sensor
proved out.

`KEYWORD_ROTATION_ENABLED = false` in `sensor.ts` gates the search off before
any credential load or API call — a run of this sensor while disabled is
zero-cost. This file (and `sensor.ts`) are kept as historical/revivable
documentation, not deleted — flip the constant back to `true` to revive the
rotation if ever needed (it would run under the maturation gate now, not the
old judge-at-birth path — see "What changed" below).

## Why it was retired

The original design judged engagement (`isHighSignal`: 5+ likes / 2+ RTs / 3+
replies) **at discovery time**, on a tweet that is typically seconds-to-minutes
old from a `search/recent` page. That bar almost never clears that early, so
every discovered tweet was marked "seen" and never looked at again — a
structurally closed gate, not a tuning problem.

## What changed (Phase 2, before retirement)

Before being retired, this sensor was rewired to prove the fix: it now STORES
every new URL-bearing tweet as a candidate on the shared spine
(`src/candidate-spine.ts`'s `x_research_candidate` table,
`source_lane = "keyword-rotation"`) instead of judging it at birth. A separate
sensor, `skills/candidate-maturation/`, re-scores stored candidates once they've
aged 2-24h (fresh engagement, not discovery-time engagement) and files the
`Research:` task if they matured. This "store, don't judge" spine is what
Phases 3/4's News/Trends/List producers feed into as well — the fix generalizes
beyond this one sensor.

## Sensor (if revived)

- Name: `social-x-ecosystem`
- Cadence: 15 minutes (`claimSensorRun("social-x-ecosystem", 15)`) — only reached
  if `KEYWORD_ROTATION_ENABLED` is flipped back to `true`
- State: `db/hook-state/social-x-ecosystem.json`

### Keyword Rotation

13 keywords, one searched per cycle (full rotation ~3.25 hours). List lives in
`sensor.ts`.

### Candidate storage (not signal detection)

A new tweet with at least one non-t.co URL is stored as a candidate
(`insertCandidateIfNew`, `src/candidate-spine.ts`) — NOT judged for engagement
here. See `skills/candidate-maturation/SKILL.md` for the re-scoring pass.

### Deduplication

- Stores seen tweet IDs in hook state (rolling window of 500 IDs) — prevents
  re-storing the same tweet id every 15-min cycle within the window.
- Candidate storage itself is also deduped on `x_research_candidate.tweet_id
  UNIQUE` (cross-lane: a tweet already stored by any lane is a no-op here).

## Credentials

Uses the same X OAuth 1.0a credentials as `social-x-posting` (`x/consumer_key`, `x/consumer_secret`, `x/access_token`, `x/access_token_secret`).

## When to Load

This skill is sensor-only (and currently disabled). No need to load it into dispatch context.
