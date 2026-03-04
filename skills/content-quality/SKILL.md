---
name: content-quality
description: Quality gate that checks content for AI writing patterns before publishing blog posts, X posts, and AIBTC signals
tags:
  - publishing
  - quality
  - content
  - gate
---

# Content Quality Gate

Pre-publish quality gate for Arc's written content. Checks for AI writing patterns and voice authenticity before blog posts, X posts, and AIBTC signals go live.

## Why This Exists

AI-generated text has recognizable patterns: inflated significance, overused vocabulary ("landscape", "testament"), formulaic structure, sycophantic filler. This skill detects those patterns and blocks publication of content that sounds like a bot, not Arc.

## Content Types

| Type | Max Length | Voice Requirements |
|------|-----------|-------------------|
| `blog` | No limit | Personal, specific, first-person, varied rhythm |
| `x-post` | 280 chars | Punchy, dry wit, concrete claim, no filler |
| `signal` | 500 chars/field | Economist voice, precise, evidence-driven, no hype |

## CLI Commands

```
arc skills run --name content-quality -- check --content <text> --type blog|x-post|signal
arc skills run --name content-quality -- gate  --content <text> --type blog|x-post|signal
```

**`check`** — Full analysis: lists each pattern detected, scores the content, and gives edit suggestions. JSON output.

**`gate`** — Binary pass/fail. Exit 0 = pass, exit 2 = fail. Use in CI or before `file-signal` / `publish`.

## Integration Pattern

```bash
# Before filing an AIBTC signal:
arc skills run --name content-quality -- gate \
  --content "BRC-20 transfers up 40% this week." \
  --type signal && \
arc skills run --name aibtc-news -- file-signal ...

# Before publishing a blog post:
arc skills run --name content-quality -- gate \
  --content "$(cat content/.../index.md)" \
  --type blog && \
arc skills run --name blog-publishing -- publish --id <id>
```

## Detected Patterns

**Content:** Inflated significance ("pivotal moment", "landmark"), undue emphasis, promotional phrasing, vague attribution ("experts say"), superficial analysis.

**Vocabulary:** Overused AI words (landscape, testament, delve, tapestry, beacon, foster, underscore, leverage, robust, seamless, groundbreaking, revolutionary, transformative, innovative, crucial, vital, key).

**Structure:** Formulaic rule-of-three, false ranges ("two to three"), excessive synonym cycling, copula avoidance ("serves as" instead of "is"), em-dash overuse.

**Style:** Excessive boldface, sycophantic openings ("Great question!"), chatbot filler ("I hope this helps"), knowledge-cutoff disclaimers.

## Scoring

Each detected pattern adds to the issue count. The LLM check evaluates overall voice authenticity.

- **0 issues + LLM pass:** PASS
- **1-2 issues or LLM warn:** WARN (passes gate, logs issues)
- **3+ issues or LLM fail:** FAIL

## Dependencies

- `ANTHROPIC_API_KEY` — required for LLM voice check
- No wallet unlock required
