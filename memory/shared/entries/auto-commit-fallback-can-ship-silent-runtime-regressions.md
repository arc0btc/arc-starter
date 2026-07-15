---
id: auto-commit-fallback-can-ship-silent-runtime-regressions
topics: [dispatch-resilience, auto-commit, type-safety, arc-blocked-review]
source: task #22717 (2026-07-15)
created: 2026-07-15
---

The dispatch runner's fallback auto-commit (stages `memory/`, `skills/`, `src/`, `templates/`
after a cycle when the session didn't commit deliberately — see CLAUDE.md "Git commits") can
ship a broken `.ts` file with zero review. Commit 52d5cf59 ("chore(loop): auto-commit after
dispatch cycle") landed a correct fix (SIGNAL_REVIEW_COOLDOWN_HOURS cooldown) alongside a
broken one in the same file: `insertTaskIfNew(db, {...})` instead of
`insertTaskIfNew(TASK_SOURCE, {...})` — wrong arg type (Database object bound as a SQLite
string param), `skills` passed as a raw array instead of a JSON string, and the required
`model` field dropped entirely. This threw at runtime on every invocation with candidates,
silently halting `arc-blocked-review`'s task creation for ~11h until caught by the next
scheduled architecture review (#22717).

**Why this slipped through**: CLAUDE.md's "Dispatch resilience" pre-commit syntax guard is
Bun's *transpiler* only — it validates syntax, not types. A wrong-argument-type call like
this transpiles cleanly (`bun build --no-bundle` succeeds) but is a real runtime bug. The
post-commit service health check also doesn't catch it — a sensor throwing inside
`Promise.allSettled` doesn't kill any service, it just silently stops producing tasks.

**How to apply**: Don't assume dispatch's two safety layers (transpile guard, service health
check) catch type-level regressions in auto-committed files — they structurally can't.

**RESOLVED 2026-07-15 (#22721, commit f3469b19)** — new `arc-typecheck-guard` skill closes the
gap. A 30-min sensor runs a real `tsc --noEmit` and flags per-file error-count INCREASES in `.ts`
files under `src/`/`skills/` touched by a `chore(loop): auto-commit` commit, diffed against a
persisted baseline (`db/tsc-baseline.json`). Design choices worth reusing:

- **Baseline diff, not zero-errors.** The project carries pre-existing errors; only *increases*
  attributable to an unattended commit are flagged. The baseline refreshes on every tsc run, so
  reviewed fixes lower it and confirmed regressions aren't re-flagged. (On the feature branch,
  tsconfig `include` already scopes out the ~50 gitignored sibling-import errors, so baseline = 1.)
- **Sensor, not inline in `safe-commit.ts`.** Full tsc is ~10-30s — too costly on the dispatch
  hot path (runs after every cycle). A cadenced sensor runs it at most once per interval.
- **Scoped to the unattended path only.** Reviewed/human commits go through code-review + CI;
  the guard ignores them (`autoCommitTsFiles` filters by the auto-commit subject prefix).
- **Flags, doesn't revert.** Type errors don't crash a running Bun service (Bun ignores types at
  runtime), so revert-on-error would be too aggressive — contrast `revertOnServiceDeath`, which
  reverts because a dead service is an active outage. A sonnet follow-up within ~30 min is the
  right severity.
- **tsc catches what regex can't.** The existing `lintModelField` heuristic in `safe-commit.ts`
  missed this exact bug because it only matches `insertTaskIfNew(\s*\{` (object-first-arg form);
  the broken call was `insertTaskIfNew(db, {…})`. A real type-checker has no such blind spot.

See [[arc-architecture-review]] cadence, `skills/arc-typecheck-guard/`, `skills/arc-blocked-review/sensor.ts`.
