---
id: verify-impl-state-before-reimplementing-decision-backlog
topics: [dispatch, decision-backlog, false-negative-gap, duplicate-work, verification]
source: task:22695
created: 2026-07-15
---

# Verify implementation state before re-implementing a decision-backlog task

**Pattern:** A dispatch task tagged "implement operator-approved decision X" may already be
fully implemented. Before writing any code, verify the current code+config state. If it's
live, close as completed with an honest "already shipped, verified not re-implemented"
summary — do NOT rebuild (duplicate work + regression risk on a live system).

**Concrete instance (#22695):** Operator decision #21577 (2026-07-08) to merge
daily-read/blog/X-thread into one "Day N" serial. A daily-eval (#22689) tagged it a `[GAP]`
("no implementation quest filed") by grepping `recent.log` for a subject matching "Day N
merge" — found nothing, spawned #22695 as a fresh opus greenfield task. **But the merge had
been built the SAME DAY** as a planned dev-council quest under `arc-day-n-publishing P0–P5`
naming, gated live via `agent_config.DAYN_MERGED=true`. The grep missed it because the quest's
task subjects used "arc-day-n-publishing" / "Day-N", never the literal "Day N merge".

**Why it happens:** Each dispatch cycle sees only the latest signal, not the full arc (same
structural blind spot as [[observer-protocol-social-engineering-escalation]], benign here).
A `recent.log` subject-substring grep is a weak existence check — quests get named by their
own convention, not by the decision's phrasing.

## How to apply

1. **Grep the ground truth, not the log.** For "implement decision X," first check:
   - `agent_config` toggles a merge/feature would flip (`grep -rn FLAG_NAME skills/ src/`,
     then read the value: `SELECT value FROM agent_config WHERE key=...`).
   - Phase/marker comments in the plausibly-affected skills
     (`grep -rn "quest-slug P[0-9]" skills/`).
   - Migrations (`ls db/migrations/ | grep <feature>`).
   - The feature's own state table for real rows (e.g. `daily_read_log` editions).
2. **Map the quest's own naming.** Decisions and their implementing quests rarely share a
   subject string. Find the quest by its design-spec / QUEST.md / checkpoint naming, then
   grep for THAT.
3. **If live: verify each required sub-aspect exists** (the task's checklist), then close
   `completed` with "already implemented under <quest>, verified live, not re-implemented."
   Correct the false-negative note in MEMORY.md so it doesn't re-spawn.
4. **Distinguish external blocker from impl gap.** Feature built but not currently producing
   output (e.g. editions void on X-credit depletion #22075) is NOT an implementation gap —
   don't treat a paused/blocked live feature as unbuilt.

See [[x-daily-read-tweet-cap-crowdout]].
