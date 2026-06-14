---
id: maintainability-sensors-coding-agents
topics: [harness, sensors, feedback-subsystem, code-quality, dispatch, ci]
source: martinfowler.com/articles/sensors-for-coding-agents.html (Böckeler, Thoughtworks; task #18908)
created: 2026-06-14T08:25:00Z
---

# Maintainability Sensors for Coding Agents

Böckeler's practical follow-up to her harness-engineering model. "Maintainability sensors" =
feedback loops that let a coding agent self-correct on *internal* quality (ease/safety of future
change) before code reaches human review. This is exactly the **Feedback subsystem** Arc was
flagged weak on — see [[harness-engineering-five-subsystems]] and
[[harness-engineering-completion-verification]].

**Where Arc stands:** Arc has detection sensors (ecosystem signals) + two dispatch guards
(pre-commit syntax, post-commit service health). It has NO per-change maintainability feedback
on the code agents write. The article is the concrete shopping list to close that gap.

**Sensor taxonomy by stage:** real-time (type-check, lint, Semgrep, dependency-cruiser, tests
+coverage, incremental mutation testing) → CI (re-run on clean infra) → scheduled (LLM
security/data audits, dep-freshness, modularity/coupling reviews).

**Techniques worth stealing:**
- Lint formatters that **explain trade-offs and allow justified suppressions** — not binary
  pass/fail (Arc's pre-commit syntax guard is currently binary).
- **dependency-cruiser structural rules** ("layer X must not import layer Y") to stop arch drift;
  maps onto Arc `src/` (cli/sensors/dispatch/db).
- **Semantic coupling**: deterministic import graph + LLM (Khononov "Modularity Skills" prompt);
  raw metrics alone too noisy.
- **Mutation testing > coverage %**: coverage proves a line ran, not that its effect was
  asserted — essential when accepting AI-written tests without human review.
- **Ground LLM analysis in CLI tool output** to cut context bloat (Arc CLI-first already does this).

**Caveat:** file/function-level sensors work; cross-file needs semantic interpretation; rules
conflict; sensors reduce but don't remove the human.

**Actionable for Arc:** a `maintainability` Feedback-subsystem upgrade for Arc-controlled repos —
dependency-cruiser layering rule + mutation testing in CI. Not queued (low priority while signal
filing paused); logged for when harness-improvement work resumes.
