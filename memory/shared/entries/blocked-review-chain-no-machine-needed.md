---
id: blocked-review-chain-no-machine-needed
topics: [workflows, blocked-review, state-machine, task-queue]
source: task #20939 (arc-workflow-review pattern detection)
created: 2026-07-03
---

# Evaluated and rejected: formal state machine for arc-blocked-review follow-up chains

`arc-workflow-review` flagged 3 recurrences of "Review N blocked task(s) for
possible unblock" spawning follow-up chains (avg 3.0 steps, skills spanning
whop, arc-brand-voice, whop-sales, social-x-posting, arc-skill-manager).

**Finding**: the child tasks are heterogeneous per instance — a retrospective
task, a specific code-fix task (e.g. whop-sales refresh-leads eligibility
filter), an `[ESCALATED]` sign-off-gap task — not a fixed pipeline of
identical steps. Each blocked-review cycle surfaces whatever the actual
blockers are that day; the "chain" is just CLAUDE.md's per-task reflection
(one retrospective per closed task) plus whatever ad-hoc unblock work that
retrospective identifies. There's no shared instance key across instances,
no dedup problem, and no state that risks going stuck the way `action:()=>null`
noop states do.

Same shape as [[retrospective-pattern-no-generic-machine-needed]] (task #20645,
2026-07-01): ad-hoc `task:N`-sourced follow-ups that already self-dedup by
construction. Not building a `BlockedReviewMachine`. Re-evaluate only if a
*specific* recurring blocker type starts producing genuine duplicate or stuck
follow-up chains (a concrete incident, not a recurrence count).
