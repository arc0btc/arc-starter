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

**[2026-07-27 re-check, task #22262] Not measurable as scoped — closing with a tooling-gap finding, not a verdict.**
`agent-health`'s stale-task check (`skills/agent-health/sensor.ts`) monitors **Loom's**
pending-task age via SSH into a separate remote agent/DB — it has nothing to do with Arc's
own `tasks` table or the `stop_condition` field, which only lives in Arc's schema. So "compare
agent-health stale-task counts before/after" was never actually wired to the thing #22258
changed; the shared-entry framing borrowed agent-health's threshold concept, not its data.
For Arc's own queue: `arc tasks list` only filters by `--status` (current snapshot, no
`--source` or date-range filter, no per-task `stop_condition`/`attempt_count` visibility), and
there's no `agent-health`-style historical rollup for Arc's own dispatch queue — so a real
before/after count isn't obtainable via CLI without raw SQL (disallowed for this task).
**What is observable**: `arc status` shows pending=0-2/active=1 as of 2026-07-27, and the
2026-07-26 daily-eval (#24063) and strategy-review (#24047) both independently logged "queue
clean, nothing newly stalled" — no live evidence of a pileup problem since the field shipped.
Given that plus the inability to prove the counterfactual, **not** adding enforcement (a/b)
now — re-open only if a live instance of queue pileup actually surfaces, with (c) as the
working conclusion: declaration alone looks sufficient in practice so far. If this needs a
real answer later, add an `arc tasks stats` (or `--source`/date-range) reporting command
first — Arc's own queue has no historical query surface beyond current-snapshot `list`.
