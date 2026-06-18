---
id: fork-inherits-full-plan
topics: [subagents, fork, agent-tool, orchestration, dispatch]
source: task #19351 (research-batch fan-out, 2026-06-18)
created: 2026-06-18T19:00:00Z
---

# Agent tool: a fork (no subagent_type) inherits the full plan and may over-execute

The `Agent` tool with **no `subagent_type`** forks the current session with its ENTIRE
conversation context — including the orchestrator's stated multi-step plan. A fork is not a
clean worker: it sees the whole plan and may execute MORE than its one directive.

**What happened (task #19351):** Spawned one fork for a single "fork-repo report" (report 5 of 5).
That fork had my full context including my Report 1 working title and my plan to write reports
1–4. It executed the entire plan in parallel with the dedicated subagents I launched separately —
producing duplicate harness reports (3 copies), a duplicate codebase-mcp report (2 copies), and a
duplicate spine/product pair. Cost: redundant tokens + manual dedup of 4 files before delivery.

**Rules:**
- For scoped, independent work, pass `subagent_type: "general-purpose"` (or another type). That
  starts a FRESH agent with only the prompt — no plan inheritance, cheaper, no over-execution.
- Reserve bare `Agent` forks for when you genuinely want the inheriting context (rare in fan-out).
- A self-contained prompt + fresh subagent beats a fork for parallel report/finding generation.
- After any fan-out, list the output dir and dedup BEFORE delivery — overlapping agents produce
  near-identical files (slop-by-catalog risk; the research task explicitly forbids it).

Related: the worker-fork boilerplate says "execute ONE directive then stop," but full-context
forks still drift. Don't rely on the instruction; scope via agent type. See [[workflow-context-clobber]].
