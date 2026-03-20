---
name: content-quality-gate
description: Pre-publish quality gate — detects AI writing patterns, checks voice authenticity via LLM, includes sentence-level anti-pattern references
updated: 2026-03-19
tags:
  - publishing
  - quality
  - content
  - gate
---

# Content Quality Gate

Pre-publish quality gate. Detects AI writing patterns and checks voice authenticity before blog posts, X posts, and AIBTC signals go live. Incorporates sentence-level anti-pattern rules (formerly stop-slop).

## Why This Exists

AI-generated text has recognizable patterns: inflated significance, overused vocabulary ("landscape", "testament"), formulaic structure, sycophantic filler. This skill detects those patterns and blocks publication of content that sounds like a bot.

## CLI Commands

```
arc skills run --name content-quality-gate -- check --content <text> --type blog|x-post|signal
arc skills run --name content-quality-gate -- gate  --content <text> --type blog|x-post|signal
```

**`check`** — Full analysis: lists each pattern detected, scores the content. JSON output.

**`gate`** — Binary pass/fail. Exit 0 = pass, exit 2 = fail. Use before `file-signal` / `publish`.

## Content Types

| Type | Max Length | Voice Requirements |
|------|-----------|-------------------|
| `blog` | No limit | Personal, specific, first-person, varied rhythm |
| `x-post` | 280 chars | Punchy, dry wit, concrete claim, no filler |
| `signal` | 500 chars/field | Economist voice, precise, evidence-driven, no hype |

## Detected Patterns

**Content:** Inflated significance ("pivotal moment", "landmark"), undue emphasis, promotional phrasing, vague attribution ("experts say"), superficial analysis.

**Vocabulary:** Overused AI words (landscape, testament, delve, tapestry, beacon, foster, underscore, leverage, robust, seamless, groundbreaking, revolutionary, transformative, innovative, crucial, vital, key).

**Structure:** Formulaic rule-of-three, false ranges ("two to three"), excessive synonym cycling, copula avoidance ("serves as" instead of "is"), em-dash overuse.

**Style:** Excessive boldface, sycophantic openings ("Great question!"), chatbot filler ("I hope this helps"), knowledge-cutoff disclaimers.

## Sentence-Level Rules (from stop-slop)

Detailed banned phrases and structural anti-patterns live in `references/`:
- `references/phrases.md` — throat-clearing openers, emphasis crutches, business jargon
- `references/structures.md` — binary contrasts, negative listings, dramatic fragments, rhetorical setups

Quick checks before delivering prose: any adverbs? passive voice? inanimate thing doing a human verb? "here's what" throat-clearing? "not X, it's Y" contrast? punchy paragraph ender? em dash? vague declarative?

## Scoring

- **0 issues + LLM pass:** PASS
- **1-2 issues or LLM warn:** WARN (passes gate, logs issues)
- **3+ issues or LLM fail:** FAIL

## When to Load

Load as a pre-publish gate before any content goes live. Pair with `publisher-voice` (what good writing looks like) — this skill enforces what to avoid.

## Dependencies

- `ANTHROPIC_API_KEY` — required for LLM voice check
- No wallet unlock required
