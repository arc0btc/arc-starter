---
id: stale-thread-tracking-completed-tasks-tagged-blocked
topics: [memory, collaboration-tracking, daily-eval, arc-blocked-review]
source: task:22689
created: 2026-07-15
---

# Stale-thread review found MEMORY.md tags didn't track task resolution

Daily-eval (#22670) claimed "4 one-way threads awaiting whoabuddy reply." A dedicated review
(#22689) checked the underlying task rows directly instead of trusting the MEMORY.md `[BLOCKED]`
tags, and found only 2 of 4 were actually still open:

- `#21499` (whop-sku overlap) — genuinely `status=blocked`, 9 days.
- `#21800` (disallowed-tools enforcement ask) — genuinely `status=blocked`, 6 days.
- `#21577` (X tweet-cap crowdout) — `status=completed` since 2026-07-08. whoabuddy had
  already replied with a full operator decision; MEMORY.md still said `[BLOCKED] ... left
  blocked pending sign-off`.
- `#21907` (claude CLI stale-version) — `status=completed` since 2026-07-10, resolved via a
  self-sufficient path (a drift-watch sensor), never actually needed whoabuddy's manual
  upgrade reply. MEMORY.md still said `[BLOCKED]`.

## Root cause

MEMORY.md `[A]` entries are written once at escalation time and only get revisited during
manual reviews or scheduled consolidation — nothing re-checks `tasks.status` for the source
task before a "waiting on human" tag gets propagated into a rollup metric like daily-eval's
Collaboration score. A task can resolve (self-sufficiently or via reply) without anyone
updating the memory tag that references it.

## Compounding gap found in the same review

`#21577`'s resolution wasn't just "answered" — whoabuddy's decision explicitly deferred
implementation to a follow-up ("this dissolves the conflict... implementation arrives as a
planned quest... do NOT implement ad-hoc"). No such quest was ever filed. So resolving the
memory tag alone would have silently dropped a real backlog item. Filed as #22695.

## How to apply

- When reviewing any MEMORY.md `[BLOCKED]`/"awaiting reply" entry, check the actual task
  status (`SELECT status FROM tasks WHERE id=<N>`) before assuming it's still open — don't
  trust the tag text alone.
- A "RESOLVED" task can still carry an unfinished obligation (a promised follow-up quest,
  a deferred implementation) — read the full `result_summary`, not just the status column.
- Rollup metrics (daily-eval Collaboration score, etc.) that count "threads awaiting reply"
  should be treated as a snapshot that can go stale, not ground truth — worth a periodic
  direct-status sweep rather than accumulating tag drift indefinitely.

See [[dead-ends-convention]] for the related 14-day migration threshold (neither open thread
here had reached it).
