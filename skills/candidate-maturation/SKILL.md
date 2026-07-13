---
name: candidate-maturation
description: Re-scores stored X candidates once they've aged 2-24h and files arc-link-research tasks for the ones that matured — the shared spine every X discovery lane feeds
updated: 2026-07-13
tags:
  - social
  - research
  - x
disallowed-tools:
  - Edit
  - Write
  - NotebookEdit
  - Bash
---

# Candidate Maturation

Sensor-only skill implementing the Option B "store, don't judge at birth" fix
(arc-x-research-channel quest, Phase 2). Every X discovery lane (currently
`social-x-ecosystem`'s keyword rotation; `news-search` / `trends` / `list-roster`
join in Phases 3-4) stores what it finds in `x_research_candidate`
(`src/candidate-spine.ts`) at the moment of discovery — no engagement judgment
happens there anymore, because a tweet is typically seconds-to-minutes old on a
search/recent page and an engagement bar almost never clears that early. This is
the ONLY place engagement is judged, and it's judged once a candidate has aged.

## Sensor

- Name: `candidate-maturation`
- Cadence: 60 minutes (`claimSensorRun("candidate-maturation", 60)`)
- State: `db/hook-state/candidate-maturation.json`

## What it does each run

1. `expireStaleCandidates(24)` — cheap housekeeping, no API call: any candidate
   still `pending` past 24h since `first_seen` is marked `expired` (the
   maturation window is a one-time pass, not an infinite retry).
2. `getMaturationBatch(24, 2, 100)` — candidates `pending`, aged 2-24h, oldest
   first, capped at 100 (X's `/tweets?ids=` per-call limit). Empty batch → `"ok"`,
   no API call, no cost — a normal outcome most cycles while only one producer
   feeds the spine (Phase 2).
3. ONE batched `GET /2/tweets?ids=` read for the whole due batch — metered on the
   named `candidate-maturation` `by_lane` key (via `xApiGet`'s `opts.lane`
   override, not the endpoint-derived `"tweets"` lane `fetchRecentPostMetrics`
   already uses for the same path).
4. Each returned tweet is re-scored with `isHighSignal` (same bar the old
   at-birth judge used: 5+ likes / 2+ RTs / 3+ replies) against FRESH metrics:
   - **Matures** → files a `Research: ecosystem signal — matured candidate (...)`
     task into the SAME `arc-link-research` path (`sensor:candidate-maturation:
     {tweet_id}` source dedup), then marks the candidate `matured`.
   - **Doesn't clear the bar yet** → left `pending` (re-considered next run as it
     ages further, until it expires past 24h).
   - **Absent from the response** (deleted/protected/suspended since discovery)
     → marked `rejected` immediately; it will never mature.

## Credentials

Same X OAuth 1.0a credentials as `social-x-posting` / `social-x-ecosystem`
(`x/consumer_key`, `x/consumer_secret`, `x/access_token`, `x/access_token_secret`),
loaded via `loadXCreds()` (`skills/social-x-posting/lib/x-api.ts`).

## When to Load

Sensor-only. No need to load it into dispatch context — it creates tasks that
reference `arc-link-research`.
