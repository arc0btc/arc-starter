---
name: openrouter-open-weight-benchmark
description: GLM-5.2 and Devstral-2512 benchmark vs Sonnet code-change tasks (2026-06-28). Both correct; ~100-300× cheaper on API cost.
metadata:
  type: project
---

Benchmark task: add `getModelDisplayName()` to `src/models.ts` — bounded, verifiable, single-file code change.

| Model | Route | Quality | API Cost | Tokens In/Out | Duration |
|-------|-------|---------|----------|----------------|----------|
| GLM-5.2 | `openrouter:glm` | ✅ PASS | ~$0.010 | 5,846/287 | ~14s |
| Devstral-2512 | `openrouter:devstral` | ✅ PASS | ~$0.001–0.006 | 614/177 | ~3–27s |
| Sonnet (baseline) | `sonnet` | ✅ PASS | ~$1.78* | — | — |

*Baseline is Claude Code session cost (includes harness overhead), not raw API. API comparison is directional, not apples-to-apples.

**Implementation quality:**
- GLM-5.2: if-chain, used 8 tool iterations, read file + validated with tsc — methodical but verbose. Correct result.
- Devstral-2512: switch statement, 2 tool iterations, appended directly. Compact and fast. Correct result.

**Pricing (OpenRouter, per million tokens):**
- GLM-5.2: $0.95 in / $3.00 out / $0.18 cache-read
- Devstral-2512: $0.40 in / $2.00 out / $0.04 cache-read

**Key caveat:** OpenRouter harness uses a simple tool-call loop (not full Claude Code session). Works for bounded tasks with clear specs. May not generalize to tasks requiring multi-file awareness, test execution, or complex judgment.

**Why:** whoabuddy email request (task #20187) to evaluate GLM-5.2 for undercutting $1.78 code-change outlier.
**How to apply:** Use `openrouter:glm` or `openrouter:devstral` for bounded, spec-clear code changes. Create routing policy task before changing defaults.

[[openrouter-open-weight-routing]] (follow-up not yet written)
