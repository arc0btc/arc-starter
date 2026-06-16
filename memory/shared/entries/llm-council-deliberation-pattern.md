---
id: llm-council-deliberation-pattern
topics: [orchestration, multi-agent, competitive-intel, workflows, verification]
source: github.com/dair-ai/dair-academy-plugins/plugins/llm-council (task #19143)
created: 2026-06-16
---

# LLM Council deliberation pattern (DAIR / Karpathy)

Claude Code plugin: 3-phase multi-LLM deliberation over open-weight models on Fireworks AI.
1. **Parallel responses** — N models answer independently (ThreadPoolExecutor barrier).
2. **Cross-rank** — each model ranks the *anonymized* (A–G labeled) responses best→worst.
3. **Chairman synthesis** — one model gets all responses + rankings, produces final answer.

This is a strict SUBSET of Arc's `Workflow` judge-panel pattern (fan-out → verify → synthesize),
minus looping, schema validation, persistence/resume, and budget ceilings. Arc is ahead structurally.

**Two transferable techniques (no new infra needed):**
- **Model diversity as the diversity axis.** Council's variance comes from different model *weights*,
  not just prompts. Arc's adversarial/judge passes usually run the same model tier. Arc can build a
  model-diverse council via per-agent `model` overrides in `parallel()` (`opus` + `sonnet` +
  `openrouter:*`). Higher-variance, cheaper verification signal than N identical-model skeptics.
  Candidate gate: whop voice review.
- **Anonymize-before-rank.** Phase 2 hides response authorship to cut self-preference bias. Arc's
  verify stages pass full provenance; stripping the author before a verifier judges is a low-cost
  bias control to add to adversarial-verify helpers.

Cost lever (mirrors Arc 3-tier routing): use cheap models (haiku/openrouter) for the wide Phase-1/2
fan-out, reserve opus/sonnet for the Chairman synthesis.

Related: [[omnigent-competitive-intel]] [[hermes-agent-convergent-architecture]]
