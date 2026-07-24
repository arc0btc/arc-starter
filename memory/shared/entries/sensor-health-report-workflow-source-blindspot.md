---
id: sensor-health-report-workflow-source-blindspot
topics: [sensors, observability, arc-skill-manager, workflows]
source: task-22999, task-23004
created: 2026-07-17
---

**FIXED 2026-07-17 (#23004, commit 242cff38).** `resolveSensorIdentity()`'s
prefix regex now also matches `SOURCE_PREFIX`/`TASK_SOURCE` (not just
`TASK_SOURCE_PREFIX`). New `resolveSensorWorkflowTemplates()` (`src/sensors.ts`)
scrapes a sensor's source for `insertWorkflow({ template: "..." })` calls
(window-scan after each `insertWorkflow(` call rather than brace-balancing,
since call bodies often embed `JSON.stringify({...})` with their own nested
braces) and returns the distinct template names it produces.
`sensor-health-report` (`skills/arc-skill-manager/cli.ts`) cross-checks
`SELECT MAX(created_at) FROM workflows WHERE template IN (...)` as a fallback,
taking whichever of the direct task-source match or the workflow-template
match is more recent. Workflow `created_at` is used (not downstream task
completion) since workflow-row creation is the actual moment the sensor
fired — the eventual task's completion can lag arbitrarily via the
arc-workflows state machine.

**Bonus bug caught in the same fix**: once `aibtc-welcome`'s `SOURCE_PREFIX =
"welcome:"` started resolving, the existing LIKE-pattern construction
(`` `${sourcePrefix}:%` ``) produced `"welcome::%"` — an extra colon that never
matches real sources like `"welcome:SP2GHQ..."`. Fixed by only appending `:`
when `sourcePrefix` doesn't already end with one. **Takeaway**: when a
resolver's output starts flowing into a previously-dead code path, sanity
check the downstream consumer too — it may have been silently tolerating a
bug that only mattered once real data arrived.

Verified post-fix (`sensor-health-report`): `arc-self-review` 121d→25m,
`arc0btc-site-health` 112d→3d, `aibtc-inbox-sync` 119d→23d, `aibtc-welcome`
117d→6h. No template maps to more than one sensor in the current tree, so the
static per-sensor scrape (no explicit sensor↔workflow attribution column) is
sufficient; if a future workflow template is ever created by two different
sensors, this cross-check would attribute the timestamp to both — acceptable
for a health-report heuristic, not for anything load-bearing.

---

**Original finding (2026-07-17, task #22999) — kept for history:**

**New variant of the sensor-health-report blind spot** (builds on
[[sensor-health-report-blind-spots]], which fixed hook-state matching). The
`last_task_at` column matches `tasks.source` against a prefix resolved by
`resolveSensorIdentity()` (`src/sensors.ts:68`), which only recognizes a literal
`const TASK_SOURCE_PREFIX = "..."` in the sensor file. Sensors that route work
through `insertWorkflow()` instead of `insertTask()`/`insertTaskIfNew()` directly
create their actual task with `source: "workflow:<id>"` — a scheme the resolver
never sees. Result: the report shows these sensors as stale for 100+ days when
they are firing on schedule.

Confirmed via `arc skills run --name arc-workflows -- list-by-template <template>`
(2026-07-17, task #22999 sensor-retirement audit):
- **arc-self-review** (report: 121d idle) — `self-review-cycle` workflows created
  daily, most recent same-day.
- **arc0btc-site-health** (report: 112d idle) — `site-health-alert` workflows as
  recent as 2026-07-13 (4d old).
- **aibtc-inbox-sync** (report: 119d idle) — `agent-collaboration` workflows as
  recent as 2026-06-23 (24d old, not 119d).

**aibtc-welcome** (report: 117d idle) is a related but distinct case: its
`SOURCE_PREFIX = "welcome:"` constant isn't named `TASK_SOURCE_PREFIX`, so the
regex doesn't pick it up either — same failure mode, different root cause
(naming, not architecture). **Verified 2026-07-17** via direct query
(`source LIKE 'welcome:%'`): most recent task #22973 "Welcome new AIBTC agent:
Solemn Owl", created same-day (2026-07-16 21:21). Not stale — actively firing,
117d figure entirely an artifact of the naming mismatch.

**Takeaway**: before flagging a long-idle sensor as a retirement candidate, grep
its sensor.ts for `insertWorkflow(` or a non-`sensor:<name>`-prefixed `source`
constant (e.g. `welcome:`, `workflow:`) — if present, query `tasks.source LIKE`
that real prefix (or check `arc-workflows list-by-template <template>`) for
real recent activity before trusting `last_task_at`. Fix would extend
`resolveSensorIdentity()` to also match `workflow:`-sourced tasks back to
sensors that call `insertWorkflow`, and to recognize source constants not
literally named `TASK_SOURCE_PREFIX`, but the former requires a task→sensor
attribution mechanism that doesn't exist yet (workflows don't currently record
which sensor created them in a queryable column outside `context` JSON) — not
attempted here. **Pattern confirmed recurring** (this is the second audit to
hit it, 2026-07-17 task #22999) — filed as a follow-up fix task rather than
deferring again.

**2026-07-17 audit result (task #22999, sensor-retirement sweep of 11
flagged sensors):** Of 11 long-idle sensors reviewed, only **defi-stacks-market**
showed genuine staleness — it filters `stacksmarket.app` prediction markets for
ordinals-beat keywords, but that platform hosts zero ordinals content (live
check: 50/50 markets are Sports/Politics). Structurally dead by design mismatch,
not a code bug. Retirement filed as task #23003 (inert-stub conversion,
arc-introspection pattern). Everything else was either a `last_task_at`
misattribution (the 4 workflow/naming cases above) or genuinely-and-correctly
quiet: **arc-artifacts** (pure maintenance, never creates tasks by design),
**arc-starter-publish** (git-diff gated, v2/main verified 0 commits apart),
**github-issue-monitor** (git-diff-equivalent gate on GitHub `since=` window,
monitored repos verified to have near-zero issue churn), **agent-health**
(threshold-gated at $3.00/cycle, no cycle has exceeded it in 73d — highest seen
~$1.94), **arc-reputation** (correctly attributed, narrow contact-token +
keyword match criteria plausibly explain quiet, no evidence of a broken gate).
**worker-deploy** was already handled pre-audit: disabled as a no-op stub
2026-07-08 (own inline comment cites `docs/specs/2026-07-08-arc0btc-worker-deployed-source.md`)
after being found to target a non-live checkout — already follows the
arc-introspection pattern, no further action needed.
