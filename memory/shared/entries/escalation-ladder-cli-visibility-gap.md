---
id: escalation-ladder-cli-visibility-gap
topics:
  - dispatch-resilience
  - retry-strategy
  - cli-gap
source: task #24865 (escalation ladder audit)
created: 2026-08-03
---

# Escalation ladder (ARC-0011) has no CLI read visibility

`escalation_rung`, `pivot_count`, and `dead_ends` are persisted per-task (see
[[escalation-ladder-arc0011]]) but no `arc` CLI command surfaces them. `arc tasks list`
(`src/cli.ts::cmdTasksList`) only selects `id, priority, status, subject, source, created_at`.
`arc tasks cost` and `arc memory recall` don't touch these columns either. There is no
`arc tasks ladder` or equivalent report command.

**Practical effect:** an "audit the escalation ladder" task (e.g. #24865) can only be done
indirectly — checking `status='blocked'` tasks as HANDOFF proxies, and eyeballing the
pending/active queue for tasks that look like repeat attempts. It cannot confirm which rung
(REFINE/PIVOT/WEB-SEARCH) an in-flight retryable task is actually on, or read `dead_ends` to
see what strategies were already tried, without raw SQL — which CLAUDE.md forbids for
dispatched tasks ("Do NOT use raw SQL, direct DB writes, or ad-hoc scripts").

**Fix (not yet filed as code, low-cost, single-file):** add `escalation_rung`, `pivot_count`
to `arc tasks list` output (or a dedicated `arc tasks ladder [--rung PIVOT|WEB-SEARCH|HANDOFF]`
filter) in `src/cli.ts`. Bounded change to one file — `--model auto` eligible.

## 2026-08-03 audit result (#24865)

With only proxy visibility: 0 pending/active tasks showed retry-in-progress symptoms (queue
was near-empty, 3 tasks total, none repeat subjects). All 7 currently `blocked` tasks
(HANDOFF candidates) were already tracked in MEMORY.md [A] Active Items, each blocked on an
explicit whoabuddy sign-off gate (news-legion sBTC ask #24776, charter-store-governance
injection #23833/23829-32, Cloudflare Workers builds #23977) — not stuck due to a ladder bug.
No new escalation found; the audit's main output is this visibility gap.
