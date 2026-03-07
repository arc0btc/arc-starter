---
name: claude-code-releases
description: Applicability research on new Claude Code releases — how each release affects Arc, AIBTC, and agents in general
updated: 2026-03-07
tags:
  - research
  - monitoring
  - claude-code
---

# claude-code-releases

Triggered by the `github-release-watcher` sensor when a new `anthropics/claude-code` release is detected. Queues a P6 Sonnet research task to assess how the release applies to Arc, AIBTC, and agents in general. Output is a markdown report reviewed manually — follow-up tasks are created from the report.

## Trigger Pattern

Sensor detects new claude-code tag → creates research task with this skill loaded → agent writes report → human reviews → follow-up tasks created from findings.

Start manual. Automate the follow-up task generation later if the pattern is stable.

## Research Task Framing

Each release is assessed across three lenses:

1. **Arc applicability** — Does this change how Arc should configure Claude Code? New flags, model options, context controls, tool permissions, hook behavior, cost/token tracking, dispatch parameters?
2. **AIBTC applicability** — Does this matter for AIBTC ecosystem builders, skill authors, or agent developers building on top of arc-starter patterns?
3. **Agent-general applicability** — What does this release signal about the direction of Claude Code as an agent runtime? Patterns other agents should adopt or avoid?

Plus a direct take: **like/dislike** — what's genuinely good, what's a concern, what's a non-issue despite the noise.

## Output

Report written to `research/claude-code-releases/{tag}.md`. Follows the structure:
- Release metadata (tag, date, URL)
- Arc lens
- AIBTC lens
- Agent-general lens
- Like / dislike summary
- Follow-up tasks (created via `arc tasks add`, not just listed)

## When to Load

Load when: the dispatched task subject starts with "New release: anthropics/claude-code". Do NOT load for unrelated release review tasks.

## Sensor Source Format

`sensor:github-release-watcher:anthropics/claude-code@{tag}`
