---
id: twelve-factor-agents-arc-scorecard
topics: [agent-architecture, harness-engineering, competitive-intel, orchestrator-dispatch]
source: github.com/humanlayer/12-factor-agents (Dex Horthy / HumanLayer, 23.3k★, Apache-2.0 code / CC-BY-SA-4.0 content); surfaced via @ishaansehgal "agent is the log" (task #19012); research task #19021
created: 2026-06-15
---

# 12-Factor Agents — scorecard against Arc's harness

Dex Horthy's **12-Factor Agents** is a Heroku-style principles list for "LLM-powered software
good enough for production." It is the **third independent convergence** on Arc's architecture
(after [[harness-engineering-five-subsystems]] and [[hermes-agent-convergent-architecture]]).
Most factors describe bets Arc already made years ago. Mapping each factor to Arc:

| # | Factor | Arc status | Where |
|---|--------|-----------|-------|
| 1 | NL → tool calls | ✅ strong | sensors emit structured tasks; dispatch maps NL subjects → `arc` CLI |
| 2 | Own your prompts | ✅ strong | SOUL/CLAUDE/SKILL.md hand-authored, git-versioned (not framework-templated) |
| 3 | Own your context window | ✅ strong | 40-50k budget, selective SKILL.md load, MEMORY.md compression |
| 4 | Tools are just structured outputs | ✅ strong | **CLI-first principle = Factor 4 verbatim**; every action is an `arc` command |
| 5 | Unify execution + business state | ✅ strong | `tasks` table IS both: status=execution, result/cost/dead_ends=business; one SQLite |
| 6 | Launch/Pause/Resume | ⚠️ partial | pending/active/blocked + scheduled_for + requeue; **no mid-cycle checkpoint** — resume = re-dispatch a pending task from scratch |
| 7 | Contact humans with tool calls | ✅ strong | HANDOFF rung creates `[ESCALATED]` blocked task to whoabuddy — escalation is a structured action, not a freeform "I'm stuck" |
| 8 | Own your control flow | ✅ strong | dispatch loop is explicit TS (sensors/dispatch split, priority queue), not LLM-driven |
| 9 | Compact errors into context | ✅ strong | `dead_ends` JSON + `escalation_rung` + recent.log; PIVOT loads dead_ends — [[escalation-ladder-arc0011]] |
| 10 | Small, focused agents | ✅ strong | skills as scoped knowledge containers; AGENT.md subagent delegation; one task at a time |
| 11 | Trigger from anywhere | ✅ strong | 68+ sensors + human CLI + X + email + whop + [[file-inbox-hcom-pattern]] |
| 12 | Stateless reducer | ✅ strong | **Arc IS a stateless reducer** over (task queue + git): each cycle reads SOUL/CLAUDE/MEMORY, acts, writes back. SOUL.md's "no memory but I have notes" = Factor 12 philosophy |
| 13 (appx) | Pre-fetch context | ⚠️ partial | SKILL.md preloaded per task `skills` array; otherwise lazy per-task fetch |

**The one genuine gap (Factor 6):** Arc's pause/resume is coarse — a task is either pending or
active; an interrupted dispatch cycle restarts the task, it doesn't resume mid-work. ARC-0011's
escalation ladder persists *attempt* state on the row (rung/pivot_count/dead_ends) but not
*intra-cycle* progress. For long multi-step tasks this is real wasted work. Worth considering a
checkpoint column only if cycle-restart waste shows up in cost retros — not a speculative build.

**Tension worth naming (Factor 2/3 vs 10):** "Own your prompts" ≠ "giant prompts." Arc's CLAUDE.md
is large enough to carry Lost-in-the-Middle risk (already flagged in
[[harness-engineering-five-subsystems]]). 12-factor's Factor 10 (small/focused) + Factor 3
(own/trim context) are the corrective: the win is a *curated* context window, not a maximal one.

**Why this matters:** three independent teams (HumanLayer, NousResearch, Arc) converged on
task-queue-as-state + CLI/structured-tools + stateless-reducer + error-compaction + structured
human-escalation. These aren't Arc quirks — they're the emerging standard shape of reliable agents.
Arc's structural lead is the *integration*: the task table unifies Factors 5/6/8/9 in one schema
that most frameworks bolt on separately. The auto-research CLI under-served this link (captured
README boilerplate + license/badge noise, missed all 12 factors) — substance came from reading the
factor files directly. [[rfc-demand-first-evaluation]]: the value here is the scorecard, not the list.
