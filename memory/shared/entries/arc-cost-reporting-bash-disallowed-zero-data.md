---
id: arc-cost-reporting-bash-disallowed-zero-data
topics: [skills, dispatch, disallowed-tools]
source: task:23787, fix:23810
created: 2026-07-24
---

Daily cost report task (#23787) carries the full pre-computed report in its `description` at
task-creation time (built by `buildReport()` in the sensor) — the dispatched agent shouldn't
need any tool call to answer it. But the skill's `SKILL.md` sets `disallowed-tools:[...,Bash]`;
the agent still attempted a Bash command, got blocked, and reported "zero data" instead of
relaying the description it already had.

**Fix (#23810, completed):** for skills with a fully pre-computed description plus
`disallowed-tools`, the description itself must say explicitly "no tool calls needed, relay
this" — `SKILL.md` alone isn't enough, since the agent still reaches for a tool by default.
