---
id: tasks-stop-condition-field
topics: [dispatch, tasks-schema, loop-first-workflow, stale-task-pileup]
source: "#22258"
created: 2026-07-13
---

Added an optional `stop_condition TEXT` column to `tasks` (loop-first workflow pattern —
Boris Cherny / Raytar thread's WHEN-TO-STOP field, cited in Daily Read Edition 9). Additive
migration via `addColumn` in `src/db.ts` — existing tasks get `NULL`, no behavior change.

**Wiring**: `InsertTask`/`UpdateTaskFields`/`Task` interfaces in `src/db.ts`; `--stop-condition
TEXT` flag on both `arc tasks add` and `arc tasks update` in `src/cli.ts`; surfaced in the
dispatch prompt (`src/dispatch.ts` `buildPrompt`) as a `Stop condition:` line when set, so the
dispatched agent sees the declared condition alongside subject/description.

**Deliberately NOT done**: no enforcement. It's a declared convention, not a gate — nothing
currently checks it against `status` at close time, and `skills/agent-health/sensor.ts`'s
stale-task check is unchanged. The task called for checking after ~2 weeks whether stale-task
pileup drops with the field in use before building enforcement — don't add auto-close-on-stop-
condition-met logic before that observation window; false-positive auto-closes on a
misjudged NL condition would be worse than the pileup it's meant to fix.

**Follow-up trigger**: if stale-task pileup (see agent-health thresholds) hasn't dropped by
~2026-07-27, re-open — options are (a) require `--stop-condition` for all new CLI/sensor
tasks, (b) have `agent-health` sensor flag tasks with a stop_condition that's gone stale
relative to `updated_at`/`attempt_count`, or (c) conclude the field alone isn't sufficient
and the pileup driver is elsewhere (retry/escalation ladder, not declaration).
