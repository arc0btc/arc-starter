# Agent-Skills Market Signal — Small, Sharp Workflows Win

## TL;DR
Bilgin Ibryam ranked the top-10 most-starred agent skills on GitHub and read one signal off the list: small, single-purpose workflows win, frameworks-plus-methodology lead the long tail.
The winners are narrow (job search, taste, trend research, UI/UX critique), not monolithic platforms.
Arc runs 129 skills against agent-runtime's 12 — the market data argues for a portable base of sharp skills, not breadth for its own sake.

## Key takeaways
- "The agent skills market has a clear signal: small, sharp workflows are winning." — @bibryam, 2026-06-15 (16,205 impressions, 514 bookmarks).
- Top-10 most-starred agent skills (from cache):
  - 228,740 — obra/superpowers — agentic skills framework + dev methodology
  - 151,088 — anthropics/skills — official Agent Skills repo
  - 130,016 — mattpocock/skills — real-world skill setup
  - 110,407 — garrytan/gstack — Claude Code setup for exec/design/eng/docs/QA
  - 92,040 — nextlevelbuilder/ui-ux-pro-max-skill — design intelligence for UI/UX
  - 60,442 — Egonex-AI/Understand-Anything — turns code into interactive knowledge graph
  - 60,265 — addyosmani/agent-skills — production-grade engineering skills
  - 53,903 — santifer/career-ops — job-search system using Claude Code skill modes
  - 44,469 — Leonxlnx/taste-skill — pushes agents away from generic output
  - 42,815 — (trend researcher across Reddit/X/YouTube/HN/web)
- Two shapes lead: (1) a framework + methodology that other skills sit on top of (superpowers, anthropics/skills), and (2) one narrow job done well (career-ops, taste, trend research). Nothing in the top-10 is a sprawling do-everything skill.

## Arc-alignment
Arc's skill model already matches the winning shape on paper. `CLAUDE.md` "Skills as Knowledge Containers" defines the 4-file pattern (`SKILL.md` orchestrator context, `AGENT.md` subagent briefing, `sensor.ts` signal detection, `cli.ts` commands) — each skill is meant to do one job and expose it as an `arc` command. That is the "small, sharp" shape the market rewards.

The gap is breadth-without-portability. `arc-starter/skills/` holds 129 skills; `agent-runtime/skills/` holds 12 (`alive-check`, `arc-credentials`, `arc-mcp-server`, `arc-peer-inbox`, `arc-worktrees`, `contacts`, `quest-create`, `scheduler`, `service-health`, `skill-manager`, `workflows`, `worktrees`). agent-runtime is the shared fleet base — the 12 there are the infrastructure-level skills every agent needs. The 129 in arc-starter are Arc-specific and mostly correct to keep local (signal filing, whop, bitcoin-macro, arxiv-research are Arc's domain, not fleet base).

What the market list surfaces that Arc lacks as a discrete skill: a "taste"/anti-generic-output gate (taste-skill, 44k stars) and a codebase-knowledge-graph skill (Understand-Anything, 60k). Arc has a prose voice filter referenced in `SOUL.md` (stop-slop rules) and the `memory/shared/entries/stop-slop-prose-voice-filter.md` entry, but it is not yet a callable skill with a CLI — it lives as inline rules. The market says a sharp "taste gate" skill earns adoption on its own.

Port to agent-runtime? The 4-file pattern and `skill-manager` already live there — that is the right home for a generic "skill-lint" (does each skill do one job, is its SKILL.md lean). Arc-specific skills stay in arc-starter. A portable `taste`/voice-gate skill belongs in agent-runtime so every fleet agent inherits it.

I could not verify exact star counts independently — they are quoted from the cached article, which is @bibryam's own refresh, not a primary GitHub query.

## How this was verified
- Source: https://x.com/bibryam/status/2066652088029852098 (@bibryam, 2026-06-15)
- Cache: skills/arc-link-research/cache/5f72050619c3fef1.json
- Date: 2026-06-18
