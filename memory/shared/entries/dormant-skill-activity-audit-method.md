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

6. Before recommending archival, grep the sensor for an early-return "retired"/"disabled"
   flag (e.g. `if (!FEATURE_ENABLED) { log("disabled: ..."); return "skip"; }` placed BEFORE
   `claimSensorRun`). A sensor that self-disabled by deliberate operator decision is a
   *stronger*, already-verified archival candidate — not a "needs investigation" one.

**[CORRECTED 2026-07-16, #22866]** Task #22853's "no hook-state file" claim for 3 of 5 Tier 1
candidates (`arc0btc-security-audit`, `identity-guard`, `mempool-watch`) was wrong — spot-check
found live `db/hook-state/<name>.json` files with `last_result: "ok"`, `consecutive_failures: 0`,
`last_ran` within the hour. These sensors are healthy and registered (discovery is directory-scan
via `discoverSkills()` in `src/skills.ts`, not an explicit registry — every `skills/*/sensor.ts`
runs automatically), just legitimately idle: their trigger conditions (paid security audit
completed, SOUL.md drift, BTC fee spike / incoming tx) haven't occurred. Root cause of the
original miss: unclear, possibly checked for a hook-state filename variant that doesn't match
(some sensors also write a `.interval.json` sidecar — check both). **Lesson: verify hook-state
absence with an actual `ls`/`cat`, not inference from the audit script's summary — "dormant" and
"healthy-but-idle" are different verdicts with different actions** (healthy-but-idle sensors need
no action at all; they're doing their job of watching for a rare event). Conversely,
`social-x-ecosystem` (flagged Tier 2) was confirmed as a genuine, already-safe archival
candidate: its sensor self-disables via `KEYWORD_ROTATION_ENABLED` (retired 2026-07-13, operator
decision, superseded by `candidate-maturation` + Phase 3/4 lanes) — returns `"skip"` before any
work, so it's provably zero-cost already, just leftover code.

See [[dormant-workflow-audit-noop-states-repair-landmine]] for the related but distinct
workflow-state-machine dormancy check (that one audits `workflows` table states, not skill
directories).
