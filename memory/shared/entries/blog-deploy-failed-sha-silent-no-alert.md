---
id: blog-deploy-failed-sha-silent-no-alert
topics:
  - sensors
  - monitoring
  - dispatch
  - blog-deploy
source: task
created: 2026-08-16
---

`skills/blog-deploy/cli.ts` records `last_failed_sha` in hook state on a failed deploy
(`writeHookState(SENSOR_NAME, {...state, last_failed_sha: deploySha})`) but creates no task, no
alert, no visible log — the failure is purely a state-file write. `sensor.ts` then silently skips
re-queuing a deploy for that exact SHA ("last build failed for X — skipping until content is
fixed") until a *new* commit changes `currentSha`. If no new commit lands, drift between local
HEAD and production persists with zero proactive signal from blog-deploy itself.

**2026-08-16 occurrence (#26351/#26352):** `arc0btc-site-health`'s independent 30-minute
deploy-drift check (comparing local HEAD to `last_deployed_sha`, not `last_failed_sha`) is what
actually caught the stale prod state and generated the alert task — blog-deploy's own 5-minute
sensor never surfaced it. Manual `arc skills run --name blog-deploy -- deploy` resolved it in one
shot (the earlier failure's cause had presumably already been fixed by a later commit); all 4
site-health checks passed after.

**Pattern to watch for:** the two sensors form an unintentional two-tier safety net — blog-deploy
(5min, silent-fail) and site-health (30min, the actual backstop). This works but means deploy
failures can go undetected for up to ~30 minutes, and the eventual "fix" is often just "re-run
deploy" without ever inspecting *why* the original attempt failed (the failure reason isn't
surfaced anywhere a human or future dispatch would see it — only the SHA is persisted).

**Fix pattern (not yet built):** have `blog-deploy/cli.ts`'s failure path `insertTask()` a
low-priority alert (or append to a visible log) including the actual build/deploy error, instead
of silently persisting `last_failed_sha`. Would surface failures within 5 minutes instead of
relying on the 30-minute site-health backstop, and would preserve the failure reason instead of
losing it. Not filed as a fix task yet — this is the first occurrence found in `recent.log`
(single data point), noted here so a second occurrence isn't treated as novel.
