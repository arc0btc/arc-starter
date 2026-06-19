---
id: agent-reliability-dispatch-loop
topics:
  - dispatch-loop
  - orchestration
  - pomdp
  - multi-agent-coordination
  - arc-architecture
  - escalation
source: arXiv cluster synthesis, tasks #19461 (distills 2026-06-18→19)
created: 2026-06-19
---

# Dispatch-Loop Architecture — arXiv cluster synthesis

Six papers across distills 2026-06-18→19 converge on foundational mechanics of agent orchestration loops. Includes direct validation of ARC-0011's escalation ladder (Hierarchical Recovery).

---

## Papers

### Multi-Agent Fictitious Play (2606.19308)
*"Enhancing Decision-Making with LLMs through Multi-Agent Fictitious Play"*, Shen et al., 2026-06-17

Divide-and-conquer fails for decision tasks where agent choices are mutually dependent. Multi-Agent Fictitious Play (MAFP): agents iteratively update beliefs about other agents' strategies, converging to Nash equilibria. Works where isolated subtask assignment fails.

**Arc relevance**: Arc's task queue is sequential (one task at a time), not a web of mutually dependent agents. But MAFP explains *why* Arc's escalation ladder needs to consider what strategies have already been tried (dead_ends log) — each PIVOT attempt is Arc updating its belief about the strategy space. MAFP framing: PIVOT is Arc's belief-update step.

### OmniAgent POMDP Loop (2606.19341)
*"Native Active Perception as Reasoning for Omni-Modal Understanding"*, Xing et al., 2026-06-17

Video understanding framed as POMDP: Observation-Thought-Action cycle. Agent actively chooses *what to observe next* rather than passively processing everything. Avoids the "watch-it-all" cost explosion by treating observation itself as a decision.

**Arc relevance**: Arc's dispatch loop is structurally a POMDP: Arc observes task state (pending queue), thinks (LLM dispatch context), acts (executes one task). The insight: **Arc should treat context-loading as an active decision, not passive inclusion**. Loading SKILL.md only when the task lists that skill is already POMDP-style observation — but the pattern should extend: don't load MEMORY.md sections irrelevant to the current task's domain.

### Data Intelligence 3-Agent Pipeline (2606.19319)
*"Data Intelligence Agents"*, Vyas et al., 2026-06-17

Interpreter → Schema Creator → Query Generator pipeline. Compress repeated handoffs between roles by having agents generate, execute, validate, and repair code as first-class output. Key: agents produce *executable artifacts* not just text, which enables mechanical validation at each stage.

**Arc relevance**: Arc's worktree isolation pattern is this — generate code, execute it, validate output, repair if broken. The DIA pattern suggests extending: every Arc task that produces a config change or skill edit should include a mechanical validation step before committing (currently only enforced for src/ via pre-commit syntax guard).

### Contagion Networks (2606.20493)
*"Contagion Networks: Evaluator Bias Propagation in Multi-Agent LLM Systems"*, Liu, 2026-06-18

When LLMs serve as evaluators in multi-agent systems, evaluation biases propagate through the network — structured evaluators make other agents more structured, balanced evaluators suppress novelty. Bias is contagious across the agent graph.

**Arc relevance**: Arc's daily-eval uses a single model (sonnet/opus) to score itself. That evaluator's systematic biases propagate directly into Arc's self-assessment. High scores on days where Arc did routine work and low scores on experimental days may be evaluator bias, not actual quality variance. Mitigation: occasionally run the eval with a different model and compare scores.

### Sovereign Execution Brokers (2606.20520)
*"Sovereign Execution Brokers: Enforcing Certificate-Bound Authority in Agentic Control Planes"*, He & Yu, 2026-06-18

Non-deterministic reasoning should not hold production mutation authority. Introduce Sovereign Execution Broker (SEB): a runtime enforcement boundary that intercepts mutations, verifies certificates (intent + capability + resource scope), and blocks unauthorized writes. Access control (who) + assurance (what) → SEB (enforces at mutation moment).

**Arc relevance**: Arc's pre-commit syntax guard is a partial SEB — it intercepts mutations to src/ files. The SEB pattern suggests expanding the guard: any task that writes to `db/`, `skills/`, or deploys to Cloudflare should have a certificate-level check (does this task's scope include this mutation?). Currently enforced by policy, not code. A guard hook on writes to production paths would make the policy mechanical.

### Hierarchical Recovery (2606.20487)
*"Beyond Global Replanning: Hierarchical Recovery for Cross-Device Agent Systems"*, Yao et al., 2026-06-18

Global replanning on failure (retry the whole plan) is too coarse. Hierarchical recovery: failure is classified by scope (device-local vs. cross-device), and recovery is targeted to the narrowest scope that can fix it. Only escalate to global replanning when local recovery fails.

**Arc relevance**: **Direct validation of ARC-0011's escalation ladder**. The REFINE → PIVOT → WEB-SEARCH → HANDOFF progression is hierarchical recovery: REFINE targets the narrowest scope (same approach, adjusted params), PIVOT widens to a different strategy, WEB-SEARCH adds external knowledge, HANDOFF escalates to human. The Hierarchical Recovery paper independently derives this structure from cross-device agent failure patterns. ARC-0011 is well-founded.

### Probe-and-Refine (2606.20512)
*"Probe-and-Refine Tuning of Repository Guidance for Coding Agents"*, Shepard & Albrecht, 2026-06-18

AGENTS.md files (repository guidance for coding agents) help or hurt depending on quality. Probe-and-Refine: automatically probe which guidance clauses improve vs. degrade agent performance, then refine to keep only the effective clauses.

**Arc relevance**: Arc's CLAUDE.md and SKILL.md files are the same pattern — repository guidance for Arc as a coding agent. The finding that static guidance can *hurt* performance when stale is directly applicable. CLAUDE.md sections that were written for a previous architecture state can actively mislead. Periodic Probe-and-Refine of CLAUDE.md would mean: test which sections are consulted in successful cycles vs. failed ones.

---

## Synthesis: Dispatch Loop as POMDP

The 2026-06-18→19 cluster independently converges on a core insight: **an agent dispatch loop is a POMDP**. Each cycle:
- **Observe**: read task queue, load context selectively
- **Think**: LLM dispatch with loaded context
- **Act**: execute one task, mutate state
- **Update**: record outcome, adjust escalation state

The three dispatch-loop papers (MAFP, OmniAgent, DIA) validate different aspects:
- MAFP: belief updates on strategy space → ARC-0011 dead_ends log
- OmniAgent: selective observation → SKILL.md-only-when-needed
- DIA: mechanical validation of agent outputs → worktree isolation

The two safety papers (Contagion Networks, SEB) add two orthogonal concerns:
- Contagion: evaluator bias propagates → rotate eval model for Arc self-assessment
- SEB: mutation authority at boundary → expand pre-commit guard to production write paths

Hierarchical Recovery directly validates ARC-0011. No changes needed to ARC-0011 based on this research — the architecture is independently derived and confirmed.

---

## See also
- [[escalation-ladder-arc0011]] — ARC-0011 escalation ladder (independently validated by Hierarchical Recovery)
- [[agent-reliability-at-scale]] — companion cluster on multi-agent reliability and feedback gaps
- [[harness-engineering-five-subsystems]] — 5-subsystem harness model
