---
id: arxiv-research-watchdog-timeout-and-blind-spot
topics: [sensors, arxiv-research, reliability, bun]
source: task-21329
created: 2026-07-06
---

Self-review (task #21329, 2026-07-06 03:16 UTC) found `skills/arxiv-research/sensor.ts` hit
the 90s `SENSOR_TIMEOUT_MS` watchdog twice back-to-back (two consecutive `arc sensors` runs,
03:16 and 03:18 UTC) — logged as `sensor arxiv-research: error 90055ms`. Direct `curl` to both
external dependencies (`export.arxiv.org/api/query`, `aibtc.news/api/beats`) at the same time
returned in well under 1s each, so the arxiv.org endpoint itself was not down; the redirect
target did return a 429 quickly. Cumulative retry/backoff budget across
`fetchActiveBeatSlugs` (up to 2×30s + 2s delay) and `fetchArxivWithRetry` (3×30s + backoff)
can exceed 90s under slow-429 conditions, or Bun 1.3.14's `AbortSignal.timeout` may not
reliably bound `fetch` — a Bun segfault (`panic: Segmentation fault ... node_modules/jose/dist/webapi/jwks/local.js`)
was also observed in the same `arc sensors` batch (different, unrelated sensor), suggesting
possible Bun runtime instability rather than a pure app bug. Did not recur on the 3rd run.

Also confirmed: the error path (both the `!response.ok` branch and the outer `catch`) resets
`hookState.last_ran` to epoch for immediate retry but never increments `consecutive_failures`
— so this sensor is invisible to the sensor-health-report's `>2 consecutive failures` alert,
the same blind-spot class as [[sensor-health-report-blind-spots]] (#21064, still open), now
confirmed on a second sensor beyond the original 5/85 self-reporting sensors.

Filed #21330 to add `consecutive_failures` tracking and review the retry budget margin.
Watch: if the exact 90055ms timeout recurs on future `arc sensors` runs, treat it as a Bun
runtime issue (worth an isolated `bun --version` / update check) rather than re-diagnosing
network reachability each time — already ruled out here.
