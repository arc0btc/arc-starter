# Research Report — Self-Optimizing Skill Files & Agent Design Patterns

Two links argue the same thesis from different ends: the bottleneck for reliable agents is no longer the model, it's the *skill files* and *design patterns* you give it. @AlphaSignalAI covers automated skill optimizers; @sairahul1 catalogs 15 production agent patterns.

## TL;DR
- @AlphaSignalAI: in modern harnesses a "skill" is a standalone `.md` operating procedure; hand-editing them is slow and unscalable, so optimizers (**SkillOpt, GEPA, EvoSkill**) now auto-tune skill files against a task suite.
- @sairahul1: 15 design patterns every production agentic system is built from, with a gate up front — "not every task needs an agent" (only when one call can't be reliable, or the model must choose tools/data at runtime).
- Both validate Arc's bet that the SKILL.md/AGENT.md layer is where reliability is won — and both expose the same gap: Arc's skills are hand-written, never auto-optimized.

## Key Takeaways
- "The real bottleneck for deploying reliable agentic systems is no longer the core capabilities of the underlying LLM... the quality hinges largely on the skills you give them." ([cache 31e0d38c](../skills/arc-link-research/cache/31e0d38ca7f1b3f3.json))
- The manual skill loop (edit → test on suite → analyze failures → rewrite) "is not scalable," and unlike the model the skill doc can't be trained — so optimizers treat the prompt text as the thing to search over.
- @sairahul1's framing: requirements grow → "your agent is a 3,000-word system prompt doing five jobs at once" → the fix isn't more prompt engineering, it's picking the right pattern. ([cache 11789a59](../skills/arc-link-research/cache/11789a597cc314f2.json))
- The "when does a task justify an agent" gate is itself a useful design discipline (most tasks don't need a full agent).

## Arc-alignment (grounded in real code)
- **Arc's skill model is exactly this layer.** Each skill is `SKILL.md` (orchestrator context) + `AGENT.md` (subagent briefing) + `sensor.ts` + `cli.ts` — the "standalone .md operating procedure" AlphaSignal describes, already split by audience to keep the orchestrator's context lean (CLAUDE.md Context Budget, 40–50k cap).
- **The optimization loop is missing.** Arc creates/edits skills via `arc-skill-manager` by hand. SkillOpt/GEPA/EvoSkill's "test on a suite, analyze failures, rewrite" loop has no Arc analog — and Arc lacks the *task suite* to optimize against (the Feedback/eval gap again; maintainability-sensors-coding-agents).
- **"Not every task needs an agent" = Arc's model routing.** Arc already encodes a weaker version: haiku for simple/bounded, sonnet for multi-step, opus for deep work; Nostr-note → haiku (MEMORY.md). @sairahul1's gate is the same instinct one level up — decide *whether* to spawn, not just *which model*.
- **3,000-word-prompt-doing-five-jobs is a real Arc risk.** Per-dispatch context is SOUL.md + CLAUDE.md + MEMORY.md + each task's SKILL.md array. The lean-MEMORY.md win (−36% duration, −72% P95) is Arc already fighting this; the patterns catalog is a checklist for *when to decompose into follow-up tasks* vs. one big prompt.

**Port to agent-runtime?** Yes for the optimizer; no rush on the catalog. A skill-optimization harness (run a skill against a small golden suite, propose edits) is fleet infrastructure — it belongs in `agent-runtime` so every agent's skills improve from shared eval cases (ties to agent-eval-volume-taxonomy golden cases).

## How this was verified
- Sources: @AlphaSignalAI (skill optimizers), @sairahul1 (15 patterns)
- Cache: `skills/arc-link-research/cache/{31e0d38c,11789a59}.json` (11789a59 = 11789a597cc314f2.json)
- Fetched 2026-06-23T13:31:13Z · task #19751
