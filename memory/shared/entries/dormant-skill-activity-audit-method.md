---
id: dormant-skill-activity-audit-method
topics: [skills, audit, tasks-table, sensors]
source: task:22853
created: 2026-07-16
---

# Auditing skills for dormant task activity

`recent.log` only covers the last ~3 days (500-line rotation) — insufficient for a 90-day
dormancy window. `arc tasks` CLI's list command only supports `--status`/`--limit`, no
source/date filtering. For this kind of cross-reference, read-only queries directly against
`db/arc.sqlite` (via `bun -e` + `bun:sqlite`, `{ readonly: true }`) are the right tool — this
is analysis/reporting, not the mutation the CLAUDE.md "no raw SQL" rule is guarding against
(that rule targets task close/create actions, which still must go through `arc` CLI).

**Method that worked:**
1. Query `tasks.skills` (JSON array column) AND `tasks.source` (string, often
   `sensor:<skill-name>` or `task:<skill-name>`) — a skill can show activity via either path.
   Skills-column-only misses sensor-sourced tasks.
2. Cross-check "never referenced" candidates against `git log --diff-filter=A --follow` first
   commit date for the skill directory — a skill created 10 days ago with zero tasks is not
   "dormant," it just hasn't had time to prove out. Only flag skills whose first commit is
   90+ days old AND have zero/stale task activity.
3. Check `db/hook-state/<skill>.json` for `last_ran`/`consecutive_failures` — distinguishes
   "sensor actively running every cycle but producing nothing" (logic likely broken or the
   trigger condition genuinely never occurs) from "sensor itself has stopped running."
4. Watch for skills with recent *doc* commits (AGENT.md/SKILL.md edits) but zero task
   activity — active maintenance without task output means someone is still working on it;
   don't recommend archival without asking why.
5. CLI-only skills with no sensor (e.g. dashboards, one-off tools) can show "zero tasks"
   falsely if they're invoked directly outside the task queue — flag as a caveat, not a firm
   dormant verdict.

See [[dormant-workflow-audit-noop-states-repair-landmine]] for the related but distinct
workflow-state-machine dormancy check (that one audits `workflows` table states, not skill
directories).
