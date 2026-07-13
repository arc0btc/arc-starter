---
id: skill-dormancy-check-misses-crontab-scheduled-scripts
topics: [social-engine, arc-architecture-review, dormancy-audit, scheduling]
source: task #22500
created: 2026-07-13
---

## What happened

`arc-architecture-review`'s "Step 2 — Delete" heuristic flagged `skills/social-engine/follow-curated.ts`
as dormant using the standard test: no `sensor.ts` in the skill dir (so `src/sensors.ts` auto-discovery
never runs it), no in-repo caller. That test is correct for most skills but produced a false positive
here — `skills/social-engine` has no `sensor.ts` at all, yet three of its scripts
(`monitor-post-lane.ts`, `monitor-reply-lane.ts`, `reply-watchlist-sensor.ts`) run continuously via a
plain host `crontab -l` entry, entirely outside the `skills/*/sensor.ts` discovery path and undocumented
in-repo before this task. `follow-curated.ts` was genuinely dormant (truly no scheduler anywhere), but
the dormancy test used to detect that can't distinguish "no sensor.ts + no caller = dead" from
"no sensor.ts + no caller + scheduled via crontab instead = alive, just outside this repo's visibility."

## Why

Arc's sensors service (`src/sensors.ts`) is one scheduling mechanism, but not the only one live on the
box. `crontab -l` is a second, parallel scheduling surface used at least for `social-engine`'s
long-running/periodic scripts, and it isn't grepped by anything in-repo (no `templates/`, no `.github/`,
no doc referenced it before this task).

## How to apply

Before recommending deletion of any script that "has no sensor.ts and no in-repo caller," run
`crontab -l` and check `db/logs/` for a same-named `.log` file — a live log file with recent mtimes is
strong evidence of an out-of-band scheduler. Do this for any skill directory that lacks a `sensor.ts`
but has scripts clearly designed to run periodically (poll loops, "monitor-*", "*-sensor.ts" naming even
if not literally `sensor.ts`). See [[disallowed-tools-not-enforced-in-dispatch]] for a related "the doc
implies enforcement but the runtime doesn't do what the name suggests" pattern — same root cause class:
naming conventions in this codebase signal intent, not a guaranteed wiring path.
