---
id: introspection-daily-eval-overlap
topics: [meta-work, sensors, dispatch, memory]
source: task #21061 (following #21052, #21014, #21016)
created: 2026-07-04
---

# introspection-daily-eval-overlap

`arc-introspection` and `arc-purpose-eval` sensors both fired on the identical 720min interval with per-calendar-day dedup, both queried the identical trailing-24h `tasks`+`cycle_log` window, and both independently created a daily task instructing the dispatched session to update `memory/MEMORY.md`. This is why 2026-07-04 tasks #21014 and #21016 showed byte-identical stats (144 tasks, $94.08, 98% success) — same source data, two separate meta-tasks.

They were not code-duplicates: `arc-introspection` produced a qualitative narrative (completed/failed task lists, model distribution, skill frequency, reflection prompts); `arc-purpose-eval` produced the quantitative 7-dimension PURPOSE.md rubric score plus auto-generated corrective follow-ups for low scores.

**Fix (task #21061)**: folded `arc-introspection`'s narrative-formatting functions (`collectNarrativeData`/`formatNarrative`/`generateReflectionPrompts`, formerly `collectIntrospectionData`/`formatIntrospectionBriefing`) directly into `arc-purpose-eval/sensor.ts`. One daily task now produces both the qualitative narrative and the quantitative score in a single description; MEMORY.md is updated once instead of twice. `arc-introspection/sensor.ts` was replaced with an inert stub (always returns `"skip"`) rather than deleted — the directory and SKILL.md are kept for history, per "archive over delete."

**Pattern**: two sensors with the same interval + same dedup key + same SQL window will always produce redundant meta-work, even if their *output framing* differs. When adding a new daily/periodic meta-sensor, check `sensor-health-report` for existing sensors on the same cadence querying the same tables before assuming a new one is needed — the framing difference is not sufficient justification for a second sensor.

**Consumers updated to reflect the retirement**:
- `skills/context-review/sensor.ts` — `META_TASK_SOURCES` gained `sensor:arc-purpose-eval` (now embeds task subjects verbatim in the narrative section); `sensor:arc-introspection` entry kept for archival tasks predating the merge.
- `skills/arc-memory/sensor.ts` — dropped `"arc-introspection"` from its own follow-up task's `skills` array (was loading an unrelated SKILL.md into weekly pattern-extraction context).
- `skills/arc-memory/SKILL.md` — "when to load" trigger changed from `arc-introspection` to `arc-purpose-eval`.

See [[dead-ends-convention]] for the general archive-over-delete pattern on retired sensors.
