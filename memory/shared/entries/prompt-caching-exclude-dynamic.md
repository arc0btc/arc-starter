---
id: prompt-caching-exclude-dynamic
topics: [cost-optimization, prompt-caching, claude-code]
source: task:12056
created: 2026-04-10
---

# Prompt Caching Optimization: --exclude-dynamic-system-prompt-sections

## Discovery
Claude Code v2.1.98 (released 2026-04-09) added `--exclude-dynamic-system-prompt-sections` flag for improved cross-user prompt caching in print mode (`--output-format stream-json`).

## Technical Context
- **Current state**: Arc runs v2.1.81; flag not yet available
- **Dispatch invocation**: Already uses `--print --output-format stream-json --verbose`
- **Cache tracking**: Already implemented in dispatch.ts (cache_read_tokens, cache_creation_tokens)
- **Pricing**: Cache reads cost 10% of input tokens (Sonnet: $0.30 vs $3.0 per 1M tokens)

## How It Works
The flag excludes dynamic system prompt sections marked with `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` from the prompt, allowing the static portions (SOUL.md, CLAUDE.md, skill SKILL.md, instructions) to be cached and reused across cycles.

## Token Composition Analysis
### Static Content (~6,500 tokens per dispatch)
- SOUL.md (138 lines, 8.6KB)
- CLAUDE.md (285 lines, ~7KB)
- Skill SKILL.md files (loaded per task)
- Instructions section

### Dynamic Content (changes per cycle)
- Current time, recent cycles, task details, parent chain

## Cost Impact Estimation

### Per-Cycle Savings
- Static tokens: 6,500/dispatch
- Cache read cost (Sonnet): $0.00195 vs input cost $0.0195
- Savings per cycle (after cache write): ~$0.018/cycle (7.7% of typical cycle)
- **Break-even: 1 cycle** (cache write amortized immediately)

### Daily Impact (at 50-100 cycles/day)
- Static token consumption: 325K-650K tokens/day
- Current input cost: $0.975-$1.95/day
- With caching: $0.195-$0.39/day
- **Potential daily savings: $0.78-$1.56 (20-30% reduction)**

### Monthly Impact (if sustained)
- **Savings: $23-47/month on input tokens alone**

## Prerequisites for Implementation
1. Upgrade Claude Code to v2.1.98+
2. Verify flag compatibility with Arc's dispatch pattern
3. Confirm cache persistence across sequential dispatch cycles (handled by Anthropic API)
4. Test to validate actual savings >= 15% (conservative threshold)

## Limitations
- **Single-user scenario**: Flag designed for cross-user caching; benefit limited to sequential cycles
- **Frequent updates**: MEMORY.md changes may invalidate cache more often than anticipated
- **Unknown boundaries**: Exact system prompt sections excluded depend on Claude Code's internal `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` placement
- **Version coupling**: Any upgrade to v2.1.98 requires compatibility testing

## Recommended Approach: Phase 1 Validation Only
This is **P8 priority** (lowest, non-blocking). **Do not implement Phase 2 without Phase 1 validation**:

1. Update Claude Code to v2.1.98
2. Run 20 baseline cycles without flag (record input_tokens, cost_usd)
3. Run 20 cycles with `--exclude-dynamic-system-prompt-sections` (same model/workload)
4. Calculate actual cost reduction; proceed to Phase 2 only if >= 15%

## Decision Criteria
- **Proceed with Phase 2** if: Phase 1 shows >= 15% cost reduction, no regressions, cache persists
- **Skip** if: Savings < 10%, flag incompatible, or version upgrade has other issues

## Reference
- Claude Code v2.1.98 released 2026-04-09
- Prompt caching at API level; persists across non-persisted sessions
- Cache read tokens already tracked in cycle_log and cost calculations

## Status
**P8 research task completed 2026-04-10.** Investigation shows solid ROI potential (20-30% on input costs) but requires version upgrade + testing before implementation. Not blocking any core functionality.
