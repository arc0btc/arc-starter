# Compound Engineering plugin — ce-code-review, ce-polish, and the skills-only pivot

## TL;DR
- EveryInc's Compound Engineering plugin (21.2k★) shipped a structural rewrite (2026-06-26): **killed all standalone agent definitions, everything is now self-contained skills** — for cross-harness portability (Claude Code, Codex, Cursor, Gemini, Pi, OpenCode).
- **ce-code-review gained a cross-model adversarial pass** — a second model actively trying to break the first's work — and **ce-resolve-pr-feedback now judges findings centrally before dispatching fixers** (vs. fire-in-parallel-and-hope).
- The plan doc is now **one unified `/goal`-ready artifact** with explicit definition-of-done; multi-hour autonomous runs (one topping 6h) implement → test → open PR → ship with no human past the plan handoff. ce-polish is the post-build human-iteration pass.

## Key takeaways (cited)
Source: @trevin (Trevin Chow), 2026-06-26 release thread [cache: 021cddc812f497ee.json] + repo README [cache: 6365cdba987672c9.json, fetched 2026-06-14, pre-rewrite].

1. **Skills-only, no agent definitions.** "Every skill is now self-contained. We still achieve our specialist 'agent' behavior, but everything lives in skill-local prompt assets vs formal agent definition." Rationale: "formal agent definitions aren't a reliable common denominator across harnesses." Result: clean Codex/Cursor/Pi/OpenCode support, plugin auto-updates, no re-run-setup-after-update. [tweet]

2. **ce-code-review = multi-agent review before merging** (README skill table), now with a **cross-model adversarial pass**: "a second model actively trying to break the first one's work. We also right-sized the review and routed it through one portable path so it behaves consistently everywhere." [tweet]

3. **ce-resolve-pr-feedback judges centrally first.** "now judges findings centrally before dispatching fixers, instead of firing off fixes in parallel and hoping." [tweet] — a dedup/triage gate ahead of expensive fix work.

4. **Unified `/goal`-ready plan doc.** Collapsed the old requirements-doc + implementation-plan into one artifact to stop the two-document drift problem ("which one is authoritative… agents have to hold both and reconcile them"). The new doc has "a clear definition of done, the scope is bounded, and the implementation approach is explicit enough that an agent can operate from it without needing to check in." `/ce-plan` can hand straight to `/goal` and walk away. [tweet]

5. **ce-polish = post-implementation iteration pass.** "On features with UI, at the end of the initial set of agent work, there's room for you to review, iterate and change things and where our skills like /ce-polish comes in." [tweet] Human-in-the-loop refinement after the autonomous build, distinct from pre-merge correctness review.

6. **Philosophy** (README): "80% is in planning and review, 20% is in execution… A good review catches the pattern, not just the bug." Loop = brainstorm → plan → work → review → compound → repeat with better context.

## Arc-alignment — grounded in the real code

**`/code-review` + `/ultrareview` ↔ ce-code-review.** Arc's PR workflow (`CLAUDE.md` "Arc PR Workflow" steps 4–5) already mandates `/code-review --fix` then `/ultrareview` before opening a PR. `/code-review` is a harness slash command (available as the `code-review` skill; supports effort low→max and `ultra` = cloud multi-agent review). So Arc *has* the multi-agent-review shape. **The gap is the cross-model axis**: ce-code-review's new edge is a *different model family* trying to break the first's work. Arc's `code-review`/`ultrareview` run within one harness/model. This isn't a new idea for Arc — `memory/shared/entries/agent-reliability-dispatch-loop.md` (Contagion Networks) and `llm-council-deliberation-pattern.md` both say **rotate the eval model / model-diversity-as-axis**. CE just shipped it into a review skill. Arc's `Workflow()` judge-panel can express this directly via `opts.model` per agent (per the Workflow tool's perspective-diverse-verify pattern).

**ce-resolve-pr-feedback's central-judge gate ↔ Arc's existing patterns.** Arc already knows "dedup/judge before expensive verify" — it's the canonical barrier pattern in the `Workflow` tool docs and the ARC-0011 escalation ladder (`escalation-ladder-arc0011.md`) PIVOT rung that loads `dead_ends` before re-trying. But Arc's `/code-review --fix` applies fixes inline with no central triage step. CE validates adding a judge-before-fix gate.

**Unified `/goal`-ready plan ↔ Arc's task schema + the verification gap.** Arc tasks carry `subject`/`description` but **no explicit definition-of-done field** (see `src/db.ts` schema in CLAUDE.md). `memory/shared/entries/harness-engineering-completion-verification.md` already flags this exact gap (the missing `verification_cmd` / independent-evaluator). CE's "the agent knows a complete picture of what done looks like because it's in the document" is the same insight: **a bounded, done-defined artifact is what lets an agent run multi-hour autonomously.** Arc's dispatch is one-task-at-a-time with no done-criteria contract beyond prose.

**Skills-only / no-agent-definitions pivot ↔ Arc's skills-as-knowledge-containers AND agent-runtime.** Arc is *already* skills-first (`SKILL.md` orchestrator context + `AGENT.md` subagent briefing per `CLAUDE.md`), so the philosophical convergence is strong — but Arc's heavy delegation uses `Agent({subagent_type})` and `Workflow()`, both **Claude-Code-specific**. Arc's `model` column already supports `codex` and `openrouter:*` (CLAUDE.md), so CE's portability lesson is live: skill-local prompt assets survive a harness swap; formal agent/workflow definitions don't. This is the third convergence data point after Hermes (`hermes-agent-convergent-architecture.md`) and 12-Factor (`twelve-factor-agents-arc-scorecard.md`).

**ce-polish ↔ Arc has NO analog.** Arc has a *prose* voice gate (`stop-slop-prose-voice-filter.md`, SOUL.md stop-slop rules) but no post-implementation code/UI polish pass. Minor gap; Arc ships little UI.

**Port to agent-runtime? — the sharpest finding.** `~/agent-runtime` is the new shared fleet base, but it has **no root CLAUDE.md** and its `skills/workflows/` directory is **empty** (verified: `ls ~/agent-runtime/skills/workflows/` → empty). All of Arc's review/PR machinery — `arc-workflows/state-machine.ts` (`PrLifecycleMachine`, `ArchitectureReviewMachine`), `arc0btc-pr-review`, the `/code-review`+`/ultrareview` PR-workflow doctrine — lives **only in arc-starter**. agent-runtime *does* carry `arc-worktrees`/`worktrees` (isolation primitive) but not the review loop on top. So the CE lesson "review is 80% of the leverage, and it must be portable across harnesses" maps to a real porting backlog: the review pipeline should live in agent-runtime so every fleet agent inherits it, not just Arc.

## How this was verified
- Primary: https://x.com/trevin/status/2070711838803948020, fetched 2026-06-27T14:42:01Z (release thread, 2026-06-26).
- Secondary (pre-rewrite, for skill inventory): repo README via t.co, fetched 2026-06-14T07:48:34Z. NOTE: README cache predates the skills-only rewrite (lists 37 skills / 51 agents; the rewrite removed the agent set).
- Repos read on VM: `~/arc-starter` (CLAUDE.md PR workflow, `skills/arc-workflows/state-machine.ts`, `skills/arc0btc-pr-review/SKILL.md`, `skills/arc-worktrees/`), `~/agent-runtime` (skills/ listing; empty `skills/workflows/`; no root CLAUDE.md).
- DEDUP: trevin's RTK token-saving hooks (`research/2026-06-18..._rtk-token-saving-hooks.md`) are a *different* artifact — not re-researched.
