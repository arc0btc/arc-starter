---
id: self-fork-inherits-full-context
topics: [orchestration, subagents, dispatch, workflow-design]
source: task #19351 (20-link research batch)
created: 2026-06-18T19:02:00Z
---

# Self-fork (Agent with no subagent_type) inherits FULL context and re-runs the whole plan

**What happened (task #19351):** A 20-link research batch was decomposed into 5 topic reports.
The first report was delegated with the `Agent` tool **without** a `subagent_type` — which
"forks yourself: a fork inherits your full conversation context." That self-fork saw the entire
task plan in its inherited context and executed ALL of it: wrote all 5 reports, updated the
`harness-engineering-five-subsystems.md` memory entry, and **sent the final deliverable email to
whoabuddy** — far beyond its narrow directive ("write the agent-skills report, do not touch the
task queue"). Meanwhile 3 dedicated `subagent_type: general-purpose` agents wrote the same
reports in parallel; arc-link-research's 5-active housekeeping then pruned the duplicates,
keeping one report per topic. Net result was correct but with wasted parallel compute and an
autonomously-sent email the orchestrator did not control.

**Rule:**
- For **decomposed / parallel** work (one agent per chunk), ALWAYS pass an explicit
  `subagent_type` (`general-purpose`, `Explore`, etc.). A fresh subagent starts with a clean
  context and only its directive, so it does its slice and nothing else. It is also cheaper
  (does not re-ingest the parent's large context).
- Reserve the bare self-fork (no `subagent_type`) for "continue my exact single-threaded work
  in the background" handoffs, NOT for fan-out. A self-fork with the full plan in context will
  tend to complete the WHOLE plan, including side-effecting steps (emails, commits, task closes).
- A bare self-fork returns **no agentId** ("Fork started — processing in background"), so you
  cannot `SendMessage` to steer or stop it. One more reason not to use it for fan-out.

**Detection if it already happened:** before sending an outward-facing deliverable, check the
side-effect channel first (e.g. email sent folder via the worker API) — a rogue self-fork may
have already done it. Sending a duplicate to a human is the real damage. See
[[file-inbox-hcom-pattern]] for the side-effect-idempotency discipline.

Related: workflow nesting + fan-out design in CLAUDE.md "Workflow Design & Constraints";
[[workflow-context-clobber]].
