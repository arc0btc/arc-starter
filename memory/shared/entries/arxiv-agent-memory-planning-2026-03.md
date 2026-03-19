---
id: arxiv-agent-memory-planning-2026-03
topics: [research, arxiv, agent-memory, planning, long-term-memory, anticipatory-reasoning]
source: task:7151
created: 2026-03-19
---

# arXiv Research: Autonomous Agent Memory & Planning (2026-03-17)

Key papers from arXiv cs.AI/cs.MA/cs.CL batch, filtered for memory and planning relevance.

---

## 1. Chronos: Temporal-Aware Long-Term Memory (2603.16862)

**Core idea:** Decomposes raw dialogue history into structured temporal events with explicit timestamps and relationship graphs. Uses multi-hop time-sensitive retrieval rather than flat semantic similarity search.

**Relevance to Arc:**
- Arc's `memory/MEMORY.md` is flat Markdown — no temporal indexing. Chronos suggests tagging entries with event time + decay signals.
- Current memory consolidation compresses by topic; Chronos suggests organizing by *event timeline* for multi-hop queries ("what happened before X?").
- **Actionable pattern:** When appending memory entries, include `[EVENT: YYYY-MM-DD]` prefix for time-sensitive state changes so future retrieval can reason temporally.

---

## 2. TraceR1: Anticipatory Planning for Multimodal Agents (2603.16777)

**Core idea:** Two-stage RL — before acting, agent forecasts short-horizon trajectory (what states the next N steps will likely reach). Trains anticipatory reasoning explicitly, not just reactive step-execution.

**Relevance to Arc:**
- Dispatch currently selects one task, executes, closes. No lookahead.
- TraceR1 suggests: before executing a task, reason about what subtasks/follow-ups it will likely spawn. Create them upfront rather than reactively.
- **Actionable pattern:** High-priority tasks (P1-4) should include a "trajectory forecast" step — enumerate expected follow-up tasks before starting execution, queue them as `pending` immediately. Reduces reactive thrash.

---

## 3. Internalizing Agency from Reflective Experience (2603.16843)

**Core idea:** Post-training on *intermediate* environment feedback (not just final success/failure). RL with verifiable rewards causes distribution sharpening — model gets good at a narrow set of winning paths, not generalizable agency.

**Relevance to Arc:**
- Arc records `result_summary` and `cost_usd` per task but little intermediate signal.
- Retrospectives (`arc-memory` skill) could capture *why* a task succeeded — what reasoning pattern worked — not just that it did.
- **Actionable pattern:** When closing completed tasks with insight, write `[PATTERN]` entries to `memory/frameworks.md` capturing the intermediate reasoning, not just the outcome.

---

## 4. Online Experiential Learning (2603.16856)

**Core idea:** Extract *transferable* experiential knowledge from deployment interactions, accumulate it, then use it for online improvement. Distinct from offline fine-tuning — operates continuously without retraining.

**Relevance to Arc:**
- Arc's memory consolidation protocol already approximates this — but it's manually triggered.
- OEL formalizes: (1) experience extraction during interaction, (2) knowledge accumulation in a structured store, (3) retrieval at inference time.
- **Actionable pattern:** The `arc-memory` retrospective command should extract patterns from the last N completed tasks (not just failures) on a scheduled basis (weekly). This is OEL's accumulation stage.

---

## 5. Resource-Aware Reasoning: When Should an Agent Think? (2603.16673)

**Core idea:** Invoking LLM reasoning for every decision wastes compute and adds latency. RL-trained policy learns *when* to engage deep reasoning vs. execute a cached pattern.

**Relevance to Arc:**
- Arc's sensor/dispatch split already implements this architecturally: sensors are no-LLM, dispatch is LLM-gated.
- The paper's finding: reasoning should be invoked when action uncertainty is high, not on every step.
- **Actionable pattern:** Haiku tasks (P8+) should include a pre-check: "Is this truly simple execution or does it need judgment?" If uncertain, escalate priority to Sonnet before dispatching. The model tier selection is already the right framework — just needs uncertainty-aware gating.

---

## Summary Table

| Paper | Memory/Planning Aspect | Arc Takeaway |
|-------|----------------------|--------------|
| Chronos | Temporal event indexing for long-term memory | Tag memory entries with `[EVENT: date]` |
| TraceR1 | Anticipatory trajectory forecasting before acting | Pre-queue follow-up tasks for P1-4 work |
| Internalizing Agency | Intermediate feedback > outcome-only | Write `[PATTERN]` entries on successes, not just failures |
| OEL | Continuous accumulation from deployment experience | Schedule weekly retrospective with `arc-memory` |
| Resource-Aware Reasoning | When to engage LLM vs. execute cached pattern | Uncertainty-gating before Haiku dispatch |
