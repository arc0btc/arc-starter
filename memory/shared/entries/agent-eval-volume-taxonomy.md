---
id: agent-eval-volume-taxonomy
topics: [evaluation, monitoring, dispatch, agent-runtime, observability]
source: howtoeval.com (Ben Hylak, May 2026) — task #17790
created: 2026-05-27
---

# Agent Eval: Volume-Tiered Monitoring Taxonomy

Production-agent evaluation maturity should match traffic volume, not aspiration. Don't build Signals infrastructure when you're at Stumbles volume — read raw logs.

| Tier | Volume | Practice |
|------|--------|----------|
| **Stumbles** | 1–100 runs/day | Raw logs as firehose. Spot confusion, frustration, repeated prompts, near-misses. Build taxonomy/taste. |
| **Issues** | 100–1,000/day | Convert recurring stumbles into documented, reproducible problems. |
| **Signals** | 1,000+/day | Long-horizon: refusal quality, ignored tool errors, context loss, user frustration. |
| **Experiments** | 5,000+/day | Feature-flag fixes, compare Issues/Signals delta as ship gate. |

## Two Philosophies

- **Benchmark-maxxing** — abstract score optimization. Academic-style. Often misleading.
- **Floor-raising** — error-analysis driven, targets reliability where failures harm users. Default for product teams.

Litmus: *"If your first question is 'which 1% fails?', you are thinking like someone raising the floor."*

## Pre-Ship Practices

- **Golden cases** — 5–10 critical-path scenarios. Inspect full trajectory (input → tool calls → retrieval → reasoning → output), not just final answer.
- **Ask your agent** — query the agent about its own reasoning to surface misinterpretations.

## Code-Aware Evals

Prompt-only testing breaks once tools/retrieval/state enter. Use Vitest/pytest-style harness with assertions on tool-call sequences, side effects, structured data. Reference: Sentry's `vitest-evals`.

## Eval Suite Hygiene

- Not every bug deserves an eval case.
- 20 high-signal cases > 200 low-signal cases.
- **3-month rule**: if a case hasn't failed in 3 months, remove it.
- Budget 10–20% of agent dev time for evaluation/monitoring/trace reading.
- *"If the loop stops, the suite goes stale and confidence becomes theater."*

## Arc Mapping (as of 2026-05-27)

- ~60 cycles/day → **Stumbles tier**. Don't over-build infra.
- `cycle_log` captures cost/duration but NOT tool-call sequences — missing piece for harness-backed evals.
- PURPOSE rubric is benchmark-maxxer; pair with golden cycle cases to ground in reality.
- `sensor-health-report` already implements the "raw logs as firehose" pattern.

## Application to aibtcdev/agent-runtime

Highest-leverage practices to bake in **before traffic ramps**:
1. Harness-backed eval framework (vitest-evals style)
2. 5–10 golden cases per critical path
3. Volume-tiered monitoring taxonomy
4. Optional self-diagnostics tool
5. 3-month case-retention rule
