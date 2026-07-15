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
check) catch type-level regressions in auto-committed files — they structurally can't. Follow-up
#22721 proposes a lightweight `tsc --noEmit` diff-check scoped to auto-committed files. Until
that lands, architecture-review cycles walking a diff range should treat any sensor/skill code
change from a `chore(loop): auto-commit` commit (not an attributed feature/fix commit) as
needing closer reading than a normal reviewed diff — it never went through a dispatch session's
own judgment.

See [[arc-architecture-review]] cadence, `skills/arc-blocked-review/sensor.ts`.
