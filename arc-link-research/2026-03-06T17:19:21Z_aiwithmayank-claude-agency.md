# Research Report — 2026-03-06T17:19:21Z

**Task:** 1711 — Research: @aiwithmayank open-source AI agency for Claude Code (re-run)
**Links analyzed:** 1 tweet (JS-gated article) + 1 GitHub repo (found via web search)
**Verdict:** medium — validates Arc's direction, offers taxonomy reference, not architecturally novel

---

## Tweet: @aiwithmayank — Open-source AI agency for Claude Code

**URL:** https://x.com/aiwithmayank/status/2029857046636679469
**Article:** JS-gated (unfetchable again). GitHub repo identified via web search.

**Tweet text:** "🚨 BREAKING: Someone just open sourced a full AI agency you can run inside Claude Code. Each with a personality, workflow, and deliverables."

**Identified project:** [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents)

---

## Project: The Agency — `msitarzewski/agency-agents`

**What it is:** 55+ specialized AI agent personalities as markdown files, organized into 9 divisions. Installed via `cp agents/ ~/.claude/agents/`. MIT license. Community-contributed.

**Divisions:** Engineering, Design, Marketing, Product, Project Management, Testing, Support, Spatial Computing, Specialized.

**Agent structure:** Each file contains identity/personality, core mission, critical rules, technical examples, workflow processes, and measurable success metrics. Not interchangeable templates — each has distinct voice.

**Sample agents:**
- Engineering: Frontend Developer, Backend Architect, AI Engineer, Rapid Prototyper
- Marketing: Twitter Engager, TikTok Strategist, Reddit Community Builder
- Testing: Evidence Collector, Reality Checker, Performance Benchmarker
- Design: Whimsy Injector, Brand Guardian, Visual Storyteller

**Integration pattern:** Agents go to `~/.claude/agents/` — Claude Code's native subagent directory. Activate by referencing agent persona names in conversation.

**Multi-agent scenario:** "Nexus Spatial Discovery Exercise" — 8 agents run simultaneously on a complex product evaluation. Shows coordinated multi-agent invocation patterns.

---

## Assessment for Arc

### What this is

A CLAUDE.md / subagent definition collection. Same primitive Arc uses: markdown files that set agent persona, context, and behavior. Arc calls these `SKILL.md` + `AGENT.md`. The Agency stores them in `~/.claude/agents/`.

### Structural difference

| Dimension | The Agency | Arc |
|-----------|-----------|-----|
| Architecture | Flat markdown files | Skills with SKILL.md + AGENT.md + sensor.ts + cli.ts |
| Execution model | Human-invoked in conversation | Autonomous dispatch loop |
| Persistence | None | SQLite task queue |
| Sensing | None | 43 active sensors |
| Memory | None | git-versioned MEMORY.md |
| Scope | Prompt engineering | Full agent runtime |

The Agency is prompt engineering packaged as a collection. Arc is an autonomous operating system. Not in the same category architecturally.

### What's useful for Arc

**1. Division taxonomy.** The 9-division org (Engineering, Design, Marketing, Product, PM, Testing, Support, Spatial, Specialized) is a mature way to categorize agent capabilities. Arc's 63 skills lack explicit categorization. Worth applying this mental model to Arc's skill tree for discoverability and gap analysis.

**2. Marketing/social agent patterns.** The Twitter Engager, Reddit Community Builder, Content Creator definitions likely contain specific voice and engagement heuristics. Arc's X agent (arc-x-engagement skill) could cross-reference these for pattern comparison — particularly the "Evidence Collector" requiring "visual proof for everything" discipline.

**3. Reality Checker pattern.** Having a dedicated "reality checker" agent that validates claims before delivery is a pattern Arc's dispatch could implement — a post-execution validation agent to review outputs before closing tasks.

**4. Deliverable-focused framing.** Each agent includes "measurable success metrics." This is a useful constraint Arc's AGENT.md files could adopt more explicitly — what does a successful output *look like* in concrete terms?

### Competitive positioning

This project is widely cited in the "Claude Code agency" ecosystem. Mayank's tweet amplifies it to a non-technical audience. The pattern of "put specialized agents in `~/.claude/agents/`" is becoming a common recommendation. Arc's skill system is the production-grade version of this — automated triggering, persistence, sensor loop — but Arc doesn't present itself in these terms externally.

**Signal:** The "AI agency for Claude Code" framing resonates publicly. Arc could position its skill tree more explicitly as "a running agency, not just prompt files."

---

## Key Takeaways

1. **Identified project:** `msitarzewski/agency-agents` (55+ agents, 9 divisions, MIT). The tweet was amplifying this repo.
2. **Not architecturally novel for Arc.** It's a well-organized CLAUDE.md collection, not an autonomous system.
3. **Taxonomy gap:** Arc's skill tree has no explicit categorization. The Agency's 9-division model is worth adopting as an organizational lens.
4. **Cross-reference opportunity:** Twitter Engager + Reddit Community Builder agent definitions may contain engagement heuristics worth comparing against Arc's X engagement behavior.
5. **Positioning signal:** "AI agency" framing is resonating. Arc's public narrative could lean into this — Arc is the agency that runs itself.

---

## Follow-up

- **Optional P8:** Browse 2-3 specific agent files from The Agency (Twitter Engager, Evidence Collector, Reality Checker) and compare against Arc's equivalent AGENT.md patterns. Low priority — directional reference only.
- **No new skill needed.** Arc already has the superior architecture; this is validation, not a gap to fill.
