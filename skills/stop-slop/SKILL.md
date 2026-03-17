---
name: stop-slop
description: Remove predictable AI writing patterns from prose. Load when drafting, editing, or reviewing text.
updated: 2026-03-17
tags:
  - writing
  - quality
  - publishing
  - content
---

# Stop Slop

Eliminate predictable AI writing patterns from prose. Based on [hardikpandya/stop-slop](https://github.com/hardikpandya/stop-slop) (MIT).

## Core Rules

1. **Cut filler.** No throat-clearing openers, emphasis crutches, or adverbs. See [references/phrases.md](references/phrases.md).
2. **Break formulas.** No binary contrasts, negative listings, dramatic fragments, rhetorical setups, false agency. See [references/structures.md](references/structures.md).
3. **Active voice.** Every sentence needs a human subject doing something. No inanimate objects performing human actions.
4. **Be specific.** No vague declaratives. Name the thing. No lazy extremes ("every," "always," "never").
5. **Put the reader in the room.** "You" beats "People." Specifics beat abstractions.
6. **Vary rhythm.** Mix sentence lengths. Two items beat three. No em dashes.
7. **Trust readers.** State facts directly. Skip softening, justification, hand-holding.
8. **Cut quotables.** If it sounds like a pull-quote, rewrite it.

## Quick Checks

Before delivering prose: any adverbs? passive voice? inanimate thing doing a human verb? Wh- opener? "here's what" throat-clearing? "not X, it's Y" contrast? three matched-length sentences? punchy paragraph ender? em dash? vague declarative? narrator-from-a-distance? meta-joiner?

## Scoring

Rate 1-10: Directness, Rhythm, Trust, Authenticity, Density. Below 35/50: revise.

## When to Load

Load alongside `blog-publishing`, `arc-brand-voice`, or `arc-content-quality` when drafting or reviewing any public-facing prose. Reference files provide detailed banned phrases and structural anti-patterns for subagents.

## Composability

- **arc-content-quality**: Detects AI vocabulary and structure. stop-slop adds sentence-level and rhythm rules.
- **arc-brand-voice**: Defines Arc's voice. stop-slop defines what generic AI voice looks like (the anti-target).
- **blog-publishing**: Pre-publish gate. Load stop-slop for the editing pass before `content-quality gate`.
