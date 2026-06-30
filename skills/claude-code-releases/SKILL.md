---
name: claude-code-releases
description: Applicability research on new Claude Code releases — how each release affects Arc, AIBTC, and agents in general
updated: 2026-03-07
tags:
  - research
  - monitoring
  - claude-code
disallowed-tools:
  - Edit
  - Write
  - NotebookEdit
  - Bash
---

# claude-code-releases

Triggered by the `github-release-watcher` sensor when a new `anthropics/claude-code` release is detected. Two-phase process: **Phase 1 (Haiku)** does fast relevance triage; **Phase 2 (Sonnet)** does deep research only if relevant.

## Process

### Phase 1: Haiku Triage

- **Model:** Haiku (fast, bounded context)
- **Input:** Release tag, URL, 500-char preview
- **Decision:** Is this relevant to Arc, AIBTC, or agent architecture?
- **Output:** Either close the task (not relevant) OR create a Phase 2 sonnet task (relevant)

### Phase 2: Sonnet Deep Analysis (if triggered)

- **Model:** Sonnet (unrestricted context)
- **Input:** Full release notes fetched at dispatch time
- **Output:** Report to `research/claude-code-releases/{tag}.md` + follow-up tasks if needed

## Why Two Phases?

Claude Code changelogs are often 50KB+ and tokenize to 1M+ tokens when loaded into dispatch context. A single-phase sonnet task for every release (including irrelevant ones) wastes ~$0.20-0.50 per task. Haiku triage costs ~$0.01-0.02 and filters out 70-80% of releases (minor bug fixes, docs, tooling). Only relevant releases escalate to the expensive Phase 2.

**Context cost reduction:** ~80% fewer big-context sonnet runs; when Phase 2 runs, full changelog is justified (deep analysis required).

## Research Lenses (Phase 2)

Each relevant release is assessed across three:

1. **Arc applicability** — New flags, config changes, context controls, breaking changes to dispatch?
2. **AIBTC applicability** — Skill-author or agent-developer patterns affected?
3. **Agent-general applicability** — Signal about Claude Code's direction as an agent runtime?

Plus editorial take: **like/dislike**.

## Output

Report written to `research/claude-code-releases/{tag}.md` (Phase 2 only). Follows structure:
- Release metadata (tag, date, URL)
- Arc lens
- AIBTC lens
- Agent-general lens
- Like / dislike summary
- Follow-up tasks (created via `arc tasks add`)

## When to Load

Load when: task subject starts with "New release: anthropics/claude-code". Do NOT load for unrelated release tasks.

## Sensor Source Format

`sensor:github-release-watcher:anthropics/claude-code@{tag}`
