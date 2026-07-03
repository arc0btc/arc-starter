---
id: auto-queue-chain-no-machine-needed
topics: [workflows, auto-queue, state-machine, task-queue, dedup]
source: task #20895 (evaluated per arc-workflow-review sensor pattern detection)
created: 2026-07-03
---

# Evaluated and rejected: formal AutoQueueMachine for "hungry domain" chains

arc-workflow-review flagged 5 recurrences of `sensor:auto-queue` task chains
(avg 9.6 steps, spanning auto-queue, arc-skill-manager, arc-catalog,
arc-workflows, nostr, arc-failure-triage, aibtc-repo-maintenance,
arc-reporting, arc-architecture-review, whop, social-x-posting) as a candidate
for formalizing into a state machine.

**Finding**: this is the same shape already evaluated and rejected for
retrospective chains — see [[retrospective-pattern-no-generic-machine-needed]].
`Auto-queue: N hungry domain(s) need work` fans out into whatever heterogeneous
follow-up work that domain actually needs (skill lint, retrospective, repo
maintenance, architecture review, etc.), not a fixed sequence. The wide skill
spread across recurrences (11 distinct skills for 5 instances) is evidence
against a shared pipeline shape, not for one — there's no common
state-transition structure to model.

Checked live task data for the actual failure mode a state machine would fix
(duplicate/stuck instances): zero pending or failed tasks matching
"hungry domain" in the current queue. Chains complete and terminate; each
follow-up task self-dedups via `source="task:N"` / `parent_id` the same way
retrospective tasks do.

**Conclusion**: not built. A generic `AutoQueueMachine` would add
state-machine overhead to a pattern that already terminates cleanly and has
no observed duplication or stuck-state incidents. Re-evaluate only if a
specific auto-queue trigger type starts producing genuine duplicate/stuck
chains (concrete incident, not just recurrence count).
