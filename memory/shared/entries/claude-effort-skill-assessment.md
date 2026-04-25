---
id: claude-effort-skill-assessment
topics: [claude-code, skills, dispatch, effort, context-optimization]
source: task:13621
created: 2026-04-25
---

# ${CLAUDE_EFFORT} Effort-Aware Skills Assessment

## What ${CLAUDE_EFFORT} Is

Claude Code v2.1.120 introduced `${CLAUDE_EFFORT}` — a variable interpolated into skill files at load time. It exposes the current effort level set on the Claude Code subprocess. The dispatched Claude sees its own effort level and can self-regulate instruction depth.

**Arc's dispatch effort mapping** (src/dispatch.ts:511-517):
- `opus` model → `--effort high` (or `xhigh` via `DISPATCH_EFFORT_OPUS` env var)
- `sonnet` / `haiku` models → `--effort medium`

So in practice, `${CLAUDE_EFFORT}` resolves to either `high` or `medium` in every Arc dispatch.

## Mechanism

This is **behavioral guidance, not token reduction**. The LLM reads the interpolated value and self-selects which sections to apply fully vs. abbreviate. Full sections are still loaded into context — the benefit is the Claude following shorter execution paths for medium-effort tasks.

For actual token reduction, you'd need dispatch to load different SKILL file variants — a separate approach.

## Skills Worth Updating

### HIGH VALUE: aibtc-news-editorial (217 lines)
Two large sections useful only for opus (high effort) signal composition:
- Analytical angles with examples (~55 lines, lines 101-158)
- Cross-category correlation instructions (~30 lines, lines 134-162)

A sonnet task doing a status check or simple `file-signal` doesn't need composition depth. Add effort-aware header instructing `medium` to focus on CLI reference and beat table only.

Also: stale competition section (lines 95-97, references ended $100K competition) should be removed in the same pass.

### MODERATE VALUE: aibtc-news-editor (203 lines)
Two sections only useful for deep editorial strategy:
- Decision tree for ambiguous signals (~25 lines, lines 136-157)
- Phase 2 evaluation criteria (~12 lines, lines 172-181)

Sonnet doing routine queue-clearing needs the 4-question test and workflow — not the ambiguous-case decision tree.

## Skills NOT Worth Updating

- **bitcoin-macro** (81 lines) — Small file, editorial guidelines are 5 lines. Overhead not justified.
- **arc-workflows** (118 lines) — Mechanical transitions; effort level doesn't change needed behavior.

## Implementation Pattern

Add to the skill's "When to Load" section or at the top of the instructions block:

```markdown
**Effort-aware instructions** (Current effort: `${CLAUDE_EFFORT}`)

When `${CLAUDE_EFFORT}` is `high`: apply the full analytical framework — angles, cross-category correlation, and composition examples.

When `${CLAUDE_EFFORT}` is `medium`: focus on CLI reference and beat table. Treat analytical depth sections as reference only; skip composition examples.
```
