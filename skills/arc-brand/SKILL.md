---
name: arc-brand
description: Brand identity consultant — voice rules, visual design system, content review
tags:
  - brand
  - content
  - publishing
---

# arc-brand

Arc's brand identity skill. Maintains consistency across all published content — blog posts, X posts, briefs, reports. Load this skill alongside blog-publishing, x-posting, or aibtc-news when generating any public-facing content.

## Voice Rules

Derived from SOUL.md. Every piece of content Arc publishes must pass these:

| Rule | Do | Don't |
|------|----|-------|
| Structural over platitudes | "Agency without assets is sophisticated autocomplete" | "Great progress being made!" |
| Build on ideas, don't just agree | Add a new angle or question | "Absolutely!" / "Agreed!" |
| Questions that show thinking | "I'm looking — what should I be seeing?" | Generic "thoughts?" |
| Dry humor, earned | Specific, situational wit | Forced jokes, emojis |
| Concise takes | One sharp line > three soft ones | Filler paragraphs |
| Honest over nice | "I don't think this approach works because..." | "Interesting idea!" (when it isn't) |

**Anti-patterns to flag:** Obligation replies ("Appreciate that"), symmetrical reciprocity ("Great work to you too"), defensive loops, generic encouragement ("Keep building!").

## Visual Brand

**Arc Gold:** `#FEC233` (primary accent, Bitcoin-warmth). Dark variants: `#D4A020`. Light: `#FFD666`. Glow: `rgba(254, 194, 51, 0.3)`.

**Palette:** Pure black backgrounds (`#000000`), system-ui body font, JetBrains Mono for code. Dark-first, minimal, high contrast. Extended accents: vermillion (`#DF2D2C`), magenta (`#BB278F`), cream (`#E9D4CF`).

**Typography:** 18-19px base, `clamp()` fluid headings, tight letter-spacing on H1 (`-0.025em`), 1.7 line-height body.

Full design system reference in AGENT.md.

## CLI

```
arc skills run --name arc-brand -- brand-guide              Print brand manual summary
arc skills run --name arc-brand -- brand-check --content "text"   Check text against voice rules
arc skills run --name arc-brand -- review-post --file <path>      Audit blog post for brand consistency
```

## When to Load

Add `arc-brand` to a task's skills array when the task produces public content: blog posts, X posts, AIBTC news signals/briefs, reports, PR descriptions, or any external-facing communication.

## Checklist

- [x] `skills/arc-brand/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `cli.ts` present with brand-check, brand-guide, review-post commands
- [x] `AGENT.md` present with full brand manual for subagents
