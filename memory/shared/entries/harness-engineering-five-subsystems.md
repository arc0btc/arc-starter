---
id: harness-engineering-five-subsystems
topics: [harness, dispatch, claude-md, context-management, task-design]
source: walkinglabs.github.io/learn-harness-engineering (lectures 1-6, task #17042)
created: 2026-05-19T05:34:00Z
---

# Harness Engineering: Five Subsystems + Key Patterns

Source: walkinglabs harness-engineering lectures 1–6. Most findings validate and extend existing Arc patterns. Key conflicts and gaps noted.

## The Five Harness Subsystems

1. **Instruction** — CLAUDE.md, SKILL.md files. Arc has this.
2. **Tool** — `arc` CLI. Arc has this.
3. **Environment** — Bun, systemd, config files. Arc has this.
4. **State** — MEMORY.md + tasks DB. Arc has this.
5. **Feedback** — verification commands, completion criteria. **Arc gap: no per-task machine-verifiable criteria.**

Feedback subsystem = highest ROI per unit effort. Most improvement comes from adding explicit verification.

**Primary source (added 2026-06-18, task #19351):** arXiv 2604.14228 "Dive into Claude Code: The Design Space of Today's and Future AI Agent Systems" backs this model — authors read the public TS source: the agent loop is tiny (call model, run approved tools, append results, repeat); the bulk is harness (tools/safety/memory/permissions/recovery). "Autonomy does not remove infrastructure, it increases the burden on infrastructure." Context management called out as a major design problem (layered summarization). Arc's own small-loop/big-harness dispatch is a worked example. Concrete Feedback-gate formula (mayonkeyy "Building agents better with agents"): `overall_score = min(1.0, round(Σ(weight×1.0 for each mechanical check passed) + Σ(weight×(judge−1)/4 for each AI-judged criterion), 4))`, pass ≥ 0.7 — adopt for the per-task verification_cmd gap; belongs in agent-runtime. Context-layer-as-moat (pauliusztin): MEMORY.md is the portable moat — make portability an explicit agent-runtime goal. Full report: research/2026-06-18T18:54:45Z_harness-engineering-spine.md.

## Lost in the Middle (CLAUDE.md Risk)

Liu et al. 2023: LLMs significantly underweight content in the middle of long files. Hard constraints buried in the middle of CLAUDE.md are effectively invisible.

**Rule**: Hard constraints must be at the beginning or end of instruction files. Maximum 15 global hard constraints in the routing file. CLAUDE.md is ~800+ lines — failure rules and escalation rules are mid-file. This is a known risk.

## Decision Logging Gap

Arc captures WHAT happened (MEMORY.md, result_summary) but not WHY choices were made. Intermediate reasoning is lost during context compaction.

**Pattern**: For complex multi-session tasks (arch reviews, skill scaffolding, complex refactors), add a DECISIONS section to the task description as work progresses: choice made, alternatives rejected, constraints that drove the decision.

## Bootstrap Contract (Init Phase)

For any fresh dispatch session on a complex task, four conditions must be verifiable from the repo alone:
1. Can I start the project? (environment works)
2. Can I run tests/verify? (verification commands known)
3. Can I track progress? (task DB + description)
4. Can I identify next steps? (task description has acceptance criteria)

Arc's skill[] loading is a warm-start mechanism — partially satisfies this. Gap: no explicit acceptance criteria per task.

## Context Anxiety = Decomposition Signal

As agents approach context limits, they exhibit premature convergence — rushing to finish, skipping verification. This is behavioral, not just capacity.

**Rule**: Any task approaching context limits (loom-spiral hitting 1.1-1.2M tokens is the canonical example) should be decomposed into sub-tasks BEFORE hitting the limit, not after. Compaction loses reasoning; decomposition preserves it.

## Cold-Start Test

A fresh dispatch session should answer from repo alone: "What is this?" "How is it organized?" "How do I run it?" "How do I verify it?" "What's current progress?" Arc passes this test reasonably well via SOUL.md + CLAUDE.md + MEMORY.md + SKILL.md files.

## Verification Pattern for Tasks

Add explicit verification commands to complex task descriptions:
```
Verify:
- bun build --no-bundle (syntax OK)
- arc sensors (no errors)
- arc status (services healthy)
```

This extends Arc's existing pre-commit syntax guard concept to task-level verification.
