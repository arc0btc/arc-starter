# Research Report — 2026-03-30T12:15:35Z

**Links analyzed:** 1 (+ 1 embedded repo via web search)
**Analyst:** Arc

---

## Link 1: ARIS — Auto-Research-In-Sleep (Claude Code Skill Set)

**URL:** https://x.com/i/status/2038548934659047745
**Author:** Millie Marconi (@MillieMarconnni) — "Founder backed by VC, building AI-driven tech without a technical background"
**Date:** 2026-03-30
**Type:** Tweet (promotional thread)
**Engagement:** 30 likes, 14 RTs, 21 bookmarks, 1,785 views

### Relevance: **HIGH** — Claude Code Skill Architecture / Autonomous Agent Orchestration

Directly relevant to Arc's skill architecture. ARIS is a Markdown-only skill system for Claude Code that runs autonomous ML research loops — comparable design philosophy to Arc's SKILL.md/AGENT.md pattern.

### The Project

**Repo:** [wanshuiyin/Auto-claude-code-research-in-sleep](https://github.com/wanshuiyin/Auto-claude-code-research-in-sleep)
**Stars:** 4,762 | **Forks:** 379 | **License:** MIT | **Created:** 2026-03-10

ARIS (Auto-Research-In-Sleep) is a collection of Markdown-only Claude Code skills for autonomous ML research. The entire system is plain `.md` files — no framework, no database, no Docker. Each skill is a single `SKILL.md` file readable by any LLM agent.

**Core capabilities:**
- Cross-model review loops (Claude Code executes, external LLM via Codex MCP reviews)
- Autonomous experiment automation (GPU-bounded, safety-constrained)
- Paper narrative rewriting based on experimental evidence
- Idea discovery and literature review

**Documented overnight run:** Starting at 5.0/10 with a borderline-reject verdict, the system ran 20+ GPU experiments across 4 rounds, discovered the main improvement claim didn't survive a large seed study, pivoted the narrative to diagnostic evidence that held up, and reached 7.5/10 by morning.

**Safety constraints built into skill design:**
- Experiments over 4 GPU hours get skipped
- Reviewer explicitly prompted not to hide weaknesses to game scores
- Loop must implement fixes before re-review submission

### Takeaways for Arc

1. **Markdown-only skill convergence.** ARIS validates the exact pattern Arc uses — skills as Markdown knowledge containers (SKILL.md), no runtime framework. At 4,762 stars in 20 days, this approach is resonating with the Claude Code community. Arc arrived at this independently; ARIS confirms it scales.

2. **Cross-model review pattern.** ARIS uses an external LLM as a critical reviewer while Claude Code drives execution. Arc's dispatch does something analogous with model tiering (Opus thinks, Sonnet composes, Haiku executes). The "executor + critic" split is becoming a standard agentic pattern.

3. **Safety via skill constraints.** ARIS embeds safety directly in skill instructions (GPU hour caps, anti-gaming prompts). Arc does this too — e.g., dispatch-gate, bare-flag-exclusion, context budget limits. Both arrive at "the skill file IS the safety boundary" rather than external guardrails.

4. **Overnight autonomy.** ARIS is designed for unattended multi-hour runs with built-in quality gates. Arc's 24/7 dispatch loop is the same concept at a different scale — continuous rather than batch. The documented run (20+ experiments, narrative pivot) shows what's possible when the loop has clear stopping criteria.

5. **Framework-agnostic portability.** ARIS skills work with Claude Code, Codex CLI, OpenClaw, or Cursor. Arc's skills are more tightly integrated (TypeScript sensors, CLI commands), trading portability for deeper system integration. Worth noting as the ecosystem fragments.

6. **Growth velocity.** 4,762 stars in 20 days signals strong demand for "skill collections" over "agent frameworks." The Claude Code ecosystem is coalescing around lightweight, composable skill sets rather than heavy orchestration layers.

### Verdict

High-relevance competitive intelligence. ARIS validates Arc's Markdown-first skill architecture at scale and demonstrates the "autonomous overnight research loop" pattern. The safety-via-skill-constraints approach is identical to Arc's. No direct action needed — the project is ML-research-specific and not Bitcoin/AIBTC-related, but the architectural patterns are directly applicable. File for pattern awareness and potential dev-tools signal.

---

## Embedded Link: t.co redirect (failed)

**URL:** https://t.co/Uv0Xq1GUFN
**Status:** Failed — JavaScript redirect, not resolvable via server-side fetch
**Resolution:** Repo identified via web search as https://github.com/wanshuiyin/Auto-claude-code-research-in-sleep

---

## Cross-Cutting Themes

- **Markdown-as-skill-format convergence:** ARIS, Arc, and OpenClaw all use Markdown files as the primary skill definition format. This is becoming a de facto standard for LLM agent skill systems.
- **Safety embedded in instructions:** Rather than external guardrails, the emerging pattern is embedding safety constraints directly in skill/prompt files — the LLM self-enforces because the constraints are part of its context.
- **Autonomous loop design:** The overnight research loop (execute → review → pivot → re-execute) mirrors Arc's sensor → dispatch → close pattern. Quality gates and stopping criteria are the differentiator between useful autonomy and runaway loops.
