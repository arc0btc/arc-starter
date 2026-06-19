---
id: agent-reliability-at-scale
topics:
  - agent-reliability
  - multi-agent-systems
  - failure-modes
  - feedback-subsystem
  - arc-architecture
source: arXiv cluster synthesis, tasks #19461 (distills 2026-06-15→19)
created: 2026-06-19
---

# Agent Reliability at Scale — arXiv cluster synthesis

Three consecutive distills (2026-06-15→17) surfaced a coherent cluster on why multi-agent systems fail and how to detect it. Maps directly to Arc's weak Feedback subsystem.

---

## Papers

### LDPC Reliability Model (2606.18121)
*"On the Reliability of Networks of AI Agents"*, Aghazadeh & Pishro-Nik, 2026-06-16

Multi-agent pipelines modeled as message passing on sparse graphs (LDPC codes). Key finding: **stopping sets** — small groups of agents that mutually reinforce errors — cause cascading failures. Density-evolution analysis predicts where systems fail before they do. Architecture choice (which agents verify which other agents) determines reliability ceiling.

**Arc relevance**: Arc's dispatch loop is a single-agent pipeline, not a web — but the stopping-set concept applies to Arc's internal retry behavior. When REFINE fails and PIVOT attempts the same strategy, that's a 2-agent stopping set (same-strategy agents in a feedback loop). ARC-0011 PIVOT rung *loading dead_ends* breaks stopping sets by demanding a structurally different strategy.

### TAC Benchmark (2606.18142)
*"Your AI Travel Agent Would Book You a Bullfight"*, Brazilek et al., 2026-06-16

Advisor→actor gap: models that reason correctly about ethics in text prompts fail to apply that reasoning when taking tool actions. Introduces TAC (Travel Agent Compassion) benchmark — first agentic benchmark exposing the gap between what a model *says* and what it *does*.

**Arc relevance**: Arc often reads its own task descriptions and summarizes results — but actual tool-call behavior diverges from stated reasoning. Any self-assessment of Arc's adherence to policy should be measured at the action level, not at the prose level. "I said I'd check idempotency" ≠ "I did check idempotency."

### ReproRepo (2606.18237)
*"Scaling Reproducibility Audits with GitHub Repository Issues"*, Li et al., 2026-06-16

Uses naturally occurring GitHub issues as supervision signal for agent reproducibility audits. Key insight: **GitHub issues are free labeled data** — when a human raises an issue pointing to a bug, that's ground truth about what the agent did wrong. Scales without manual curation.

**Arc relevance**: Arc's PR reviews could use the same pattern. When whoabuddy reopens a task that Arc marked completed, or adds a comment to a closed issue, that's natural supervision. Log these events to `memory/recent.log` with a distinct tag (e.g., `[REOPEN]`) and treat them as negative examples for Arc's reasoning patterns. Currently wasted signal.

---

## Synthesis: Arc's Feedback Subsystem Gap

The common thread: **all three papers expose feedback gaps** — the system acts but doesn't observe consequences of its actions:
1. LDPC: multi-agent systems can't detect their own stopping sets without external reliability monitoring
2. TAC: action behavior diverges from stated reasoning, undetected
3. ReproRepo: natural failure signals (GitHub issues, re-opened tasks) exist but aren't harvested

Arc's Feedback subsystem is weak because the feedback signal is latent in external events (task re-dispatch, whoabuddy comments, post-completion corrections) but isn't systematically collected. `memory/recent.log` captures task outcomes but not *correction events* from the environment.

**Gap to close**: A sensor that watches for `[REOPEN]` or whoabuddy corrections to Arc's completed tasks would turn the TAC/ReproRepo pattern into operational feedback.

---

## See also
- [[escalation-ladder-arc0011]] — ARC-0011 PIVOT rung breaks stopping-set feedback loops
- [[agent-reliability-dispatch-loop]] — companion cluster on dispatch-loop architecture
- [[maintainability-sensors-coding-agents]] — Böckeler sensor taxonomy for feedback

## Related
- [harness-engineering-completion-verification](harness-engineering-completion-verification.md) — verification_cmd gap; independent evaluator
- [recursive-improve-failure-detectors](recursive-improve-failure-detectors.md) — 4-class detector taxonomy
