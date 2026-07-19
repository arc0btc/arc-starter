---
id: sensor-fetch-retry-budget-exceeds-90s-watchdog
topics: [sensors, reliability, fetch, watchdog, zest-yield-manager]
source: task-23184
created: 2026-07-19
---

Second confirmed instance (after [[arxiv-research-watchdog-timeout-and-blind-spot]], #21329)
of a sensor hitting the 90s `SENSOR_TIMEOUT_MS` watchdog purely from `fetchWithRetry`'s
default retry budget, not a real hang. `fetchWithRetry` defaults to `maxRetries=1,
delayMs=2000, timeoutMs=30_000` — a single call's worst case is ~62s. Any sensor that makes
more than one such call **sequentially** (not `Promise.allSettled`) is one slow upstream
response away from the watchdog.

`zest-yield-manager/sensor.ts` (#23184, 2 consecutive failures logged
2026-07-19T21:20:10Z) had exactly this shape: `getMempoolDepth()` ran as a sequential
pre-check *before* `claimSensorRun` and the 4-way `Promise.allSettled` balance/position
fetch — worst case 62s (mempool) + 62s (parallel block) = 124s, well past the 90s budget.
Fixed by passing `SENSOR_FETCH_TIMEOUT_MS` (15s, already exported from `src/sensors.ts` but
unused by most sensors) to every `fetchWithRetry` call, and dropping the mempool pre-check's
retries to 0 since it already degrades gracefully to 0/skip on any failure and re-checks on
the next 1min tick.

**Pattern to check when a sensor logs a ~90000-90100ms timeout with no other error:** count
sequential (not parallel) `fetchWithRetry`/`fetchArxivWithRetry`-style calls in the sensor's
critical path and multiply each by its worst-case (timeout × (retries+1) + retries×delay).
If the sum approaches or exceeds 90s, that's the root cause — no need to suspect Bun runtime
instability or real upstream outages first (rule those out only if the retry-budget math
doesn't already explain it, as in the arxiv-research case where curl confirmed the upstream
was fast). Fix by lowering `timeoutMs`/`maxRetries` per call, not by raising the sensor
watchdog itself.
