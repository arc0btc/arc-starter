---
id: sensor-health-report-blind-spots
topics: [sensors, observability, hook-state, arc-skill-manager]
source: task-21054
created: 2026-07-04
---

**[RESOLVED 2026-07-04, reverified 2026-07-11 #22028]** `sensor-health-report`
(skills/arc-skill-manager/cli.ts `cmdSensorHealthReport`) looked clean (85/85 "ok",
zero alerts) but two structural blind spots made that reading unreliable — audited
2026-07-04, fixed same day (#21064 commit e4aa3c80, #21065 commit 3f863b9f). Reverified
2026-07-11: `src/sensors.ts` (`runSensors()`) does persist `last_result`/`consecutive_failures`
to hook-state per cycle now; current report shows 86/86 sensors with real `consecutive_failures=0`,
no alerts, genuinely trustworthy. Original blind-spot description kept below for context.

**1. consecutive_failures / interval_minutes are almost never populated.** `claimSensorRun`
in `src/sensors.ts` always writes `last_result: 'ok'` unconditionally and never writes
`interval_minutes`. `runSensors()` (the actual 1-minute-timer runner) computes real
ok/error/skip + error message per sensor every cycle but only `console.log`s it — never
persists to hook-state. Only 5/85 sensors (agent-health, arc-monitoring-service,
arc-self-audit, arc-workflow-review, github-mentions) manually self-report
`consecutive_failures` inside their own sensor.ts. So the report's alert threshold
(`consecutive_failures > 2`) can never fire for the other 80 sensors even if they throw
every single cycle — the report will show `status=ok, interval_min=?` regardless. Fix
(#21064): wire `runSensors()`'s per-cycle result into hook-state persistence.

**2. Directory name vs internal SENSOR_NAME mismatches cause false "last_run: never".**
The report matches hook-state files and task `source` by the skill *directory* name.
If a sensor's internal `SENSOR_NAME` constant differs (e.g.
`skills/arc0btc-pr-review/sensor.ts` uses `SENSOR_NAME = "pr-review-attestation"` for its
hook-state file and task source prefix), the report can't find its state file at all and
reports `last_run: never`, `last_task_at` from a stale/wrong task, even though the sensor
is alive and running every cycle. Verified: `pr-review-attestation.json` had a `last_ran`
seconds old at audit time while the report showed `never`. Fix (#21065): either align
directory name and internal SENSOR_NAME, or teach the report to resolve the real name.

**Takeaway for future sensor-health audits**: don't trust the "None — all sensors nominal"
alert line at face value. Cross-check a few `db/hook-state/*.json` files directly against
the report's `last_run` column, and grep each sensor.ts for its own `SENSOR_NAME` constant
before concluding a sensor is dead OR healthy.
