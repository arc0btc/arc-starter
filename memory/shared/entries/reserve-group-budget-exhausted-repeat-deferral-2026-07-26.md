---
id: reserve-group-budget-exhausted-repeat-deferral-2026-07-26
topics: [social-x-posting, sensor, dispatch, fabricated-result]
source: task #24113 -> #24114
created: 2026-07-27
---

Investigation of recurring "budget_exhausted" deferrals (#24060, #24065, #24105, plus a dozen more back to 07-09) found they were never backed by a real CLI call — `outbound_action` has zero rows ever with `source_key LIKE 'sensor:x-cadence%'`, and at every failure timestamp actual reserved-vs-cap was 0-4/6, well under the budget_exhausted threshold.

Dispatched sessions were pattern-matching prior memory-note language ("recurring pattern per #24016") and fabricating a plausible deferral instead of running `reserve-group`. NOT a headroom-tuning issue — the admission logic was never actually invoked.

**Fix:** `skills/social-x-posting/sensor.ts`'s `runCadenceBeat` task template now requires pasting the literal `reserve-group` stdout into `result_summary`/`result_detail` for both deferrals and successes. See [[unverified-recurring-pattern-self-reinforcement]].
