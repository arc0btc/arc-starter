# Research Report — Skill Extraction From Sessions

**Topic:** Turning repeated corrections into reusable skills — the "more-than-twice" heuristic, automating SKILL.md generation, and what actually transfers vs. what just reads well.
**Links:** 4 (cobi_bean, omarsar0, leopardracer, VaibhavSisinty)

## TL;DR
- The cross-source consensus is one rule: **if you remind an agent how to work more than twice, that behavior belongs in a skill** (cobi_bean). The rest is mechanics — segment a session, cluster the repetitions, write a SKILL.md, gate it.
- The honest counter-signal: **automated extraction produces readable skills that don't transfer**. omarsar0's cited paper hits 0.95 cluster purity but lifts task accuracy only 18.5%→20.5% and loses to frequency priors. Mining the candidate is cheap; making the candidate *useful* is the hard part.
- Arc already has the reflection substrate (`memory/recent.log`, dead-ends, patterns consolidation) but **no path from "same correction logged 3×" → "draft a skill."** That extraction step is the gap, and it belongs in `agent-runtime`.

## Key Takeaways

### 1. The extraction heuristic is a count threshold, not a vibe (cobi_bean)
> "if i have to remind an agent how to work more than twice, that behavior probably belongs in a skill... you can turn 'please do this every time' into part of the agent's environment that gets invoked every time you ask for 'the thing'." — [cobi_bean](https://x.com/cobi_bean/status/2067962559441908208)

The 7th skill he'd add is the meta one — **skill-factory**: "if the agent had to recover from the same failure, combine the same tools, follow the same 3+ step process, or obey the same correction, that should become procedural memory. make it a skill the next run can use, instead of another note you forget." This is the operational definition of the heuristic: **3+ repetitions of {failure-recovery | tool-combo | step-sequence | correction} → skill candidate.**

His "boring-first" ordering (design-before-implementation, identity-before-autonomy, repo-memory-before-rediscovery, session-memory-before-resets, safe-workspace-before-clicking, diagrams-before-hand-waving, skill-creation-before-repeating) is the **same** convergence already filed in `memory/shared/entries/hermes-agent-convergent-architecture.md` — NOT new signal. The new signal is narrowly: (a) the count-threshold heuristic, and (b) skill-factory as an automated extraction surface.

### 2. Mining sessions is now a first-class technique — and a hard one (omarsar0)
> "Increasingly, mining sessions is one of the best ways to improve your agents. OpenAI released something similar yesterday that lets Codex package skills from interactions." — [omarsar0](https://x.com/omarsar0/status/2067986774241251433)

He cites a paper running a **three-stage pipeline: segment trajectories → cluster into candidate skills → train a skill-aware policy.** The sobering result: clusters are readable (5/8 ≥0.95 purity against ground-truth labels) but **readability does not transfer** — GRPO lifts skill-step accuracy only 18.5%→20.5%, leaves BrowseComp+ flat, and loses to trivial frequency priors. Named culprits: **weak boundary detector, orderless segment representation, offline reward model.** Lesson for Arc: a sensor that *detects* repeated patterns is the easy 80%; the value is in clean boundaries (where does the reusable unit start/stop?) and ordering (a skill is a *sequence*, a frequency count is not).

### 3. The unit of extraction is a workflow with file handoffs, not a longer prompt (leopardracer)
The prompt artifact is concrete and directly reusable: *"analyze whether this task could be converted into a reusable skill or workflow"* with four questions — step-sequencing (does each step's output feed the next?), handoff points (what context carries forward?), clean-context splitting (separate steps vs. one long convo?), and the input/instructions/output/checkpoint shape. ([leopardracer](https://x.com/leopardracer/status/2067892652306018598))

His architecture claim is grounded in research, not vibes: *"LLM accuracy drops significantly when relevant information is embedded within longer contexts"* (cites arXiv 2406.15782, the Lost-in-the-Middle line of work) → **"Hitting a ceiling with prompting means you have an architecture problem."** The fix: each step **writes to a file, the next reads it; you only stop where a real decision is needed.** This is Arc's `arc-workflows` state-machine model almost verbatim (contextUpdate between states), and it matches our own filed `workflow-context-clobber` and `self-fork-inherits-full-context` lessons about where context handoffs break.

### 4. A shippable skill pack already proves the cost case (VaibhavSisinty)
> "Matt Pocock just open-sourced... mattpocock-skills v1... /codebase-design teaches architecture, /domain-modeling sharpens language, /diagnosing-bugs hunts hard bugs, /ask-matt is a router that picks the right skill automatically. The wildest part: he cut token cost by 63% while making the skills better." — [VaibhavSisinty](https://x.com/VaibhavSisinty/status/2067925888235340243)

Two transferable ideas: (a) a **router skill** (`ask-matt`) that selects the right skill for a situation — Arc has no skill-router; today the *task author* picks the `skills` array by hand; (b) **well-factored skills cut tokens** (63%), which directly corroborates our own `memory/recent.log` note "Memory structure → dispatch speed (task #19374): -4.8% cost, -36% avg duration." Skill quality is a cost lever, not just hygiene. (Unverified third-party claim — the 63% is Pocock's number, not measured by Arc.)

## Arc-Alignment (grounded in real code)

**Where Arc already does this:**
- **Reflection substrate exists.** `arc-starter/skills/arc-skill-manager/sensor.ts` runs `arc-memory-consolidate` (120min), `arc-patterns-consolidate`, and `arc-recent-log-consolidate` (500-line threshold, 14-day archive). Every task close appends to `memory/recent.log` (currently **537 lines**) per CLAUDE.md's RARV Reflect protocol. In `agent-runtime/src/memory.ts` this is formalized as code: `appendRecentLog()`, `appendDeadEnd()`, `addPattern()`, `loadLessonBundle()`, with a `PATTERN_LINE_CAP` consolidation trigger. **This is the cobi "session-memory" + "repo-memory" boring-first skills, already built.**
- **Manual skill scaffolding exists.** `arc-skill-manager/cli.ts` exposes `create`, `lint-skills`, `consolidate-memory`, `sensor-health-report`. The 4-file pattern (`SKILL.md`/`AGENT.md`/`sensor.ts`/`cli.ts`) in `arc-skill-manager/SKILL.md` is exactly the "package a skill" target format the sources describe.
- **Workflow handoffs exist.** `arc-workflows` state machines already do leopardracer's "write-to-file → next-step-reads-it" via `contextUpdate` (see filed `workflow-context-clobber`).

**Where the gap is (the NEW signal):**
- **No extraction step.** Nothing in either repo reads `recent.log` (or session transcripts) and detects "this same correction/step-sequence appeared ≥3 times → draft a SKILL.md." `arc-skill-manager` *consolidates memory* and *scaffolds empty skills*, but the candidate-detection → skill-draft bridge does not exist. `recent.log` is append-and-archive; it is never mined for skill candidates.
- **`agent-runtime/skills/skill-manager/` is an empty directory** — a planned-but-unimplemented stub (verified: `ls` shows only `.`/`..`). This is the obvious home for the extraction logic, and building it there levels up every fleet agent at once rather than just Arc.
- **No skill-router.** Task authors hand-pick the `skills` array; there is no `ask-matt`-style selector. Lower priority, but a real gap as the skill count grows (100+ skills per SOUL.md).

**Port to agent-runtime? Yes — emphatically.** The reflection primitives already live in `agent-runtime/src/memory.ts`, and `skills/skill-manager/` is an empty stub waiting for exactly this. Building extraction in `arc-starter` would be a one-agent solution that has to be re-ported later; building it in `agent-runtime/src/memory.ts` + `skills/skill-manager/` makes it fleet-wide on day one. **Honest caveat:** the omarsar0 paper is a direct warning that the naive version (detect-and-emit) yields readable-but-non-transferring skills. The valuable build is detection-as-a-*suggestion* (queue a `[SKILL-CANDIDATE]` task for human/opus review), not auto-generated skills wired live.

## How this was verified
- https://x.com/cobi_bean/status/2067962559441908208 — `skills/arc-link-research/cache/6347e07443c5bfe5.json` — fetched 2026-06-19T19:22Z
- https://x.com/omarsar0/status/2067986774241251433 — `skills/arc-link-research/cache/7b543ff48d2df77e.json` — fetched 2026-06-19T19:22Z
- https://x.com/leopardracer/status/2067892652306018598 — `skills/arc-link-research/cache/7de9ea6bdad83bf9.json` — fetched 2026-06-19T19:22Z
- https://x.com/VaibhavSisinty/status/2067925888235340243 — `skills/arc-link-research/cache/12a344be17d6b6f9.json` — fetched 2026-06-19T19:22Z
- Repo grounding: `arc-starter/skills/arc-skill-manager/{SKILL.md,cli.ts,sensor.ts}`, `arc-starter/memory/recent.log` (537 lines), `agent-runtime/src/memory.ts`, `agent-runtime/skills/skill-manager/` (empty stub) — read 2026-06-19
- Dedup: `memory/shared/entries/hermes-agent-convergent-architecture.md` (boring-first convergence already filed; this report adds only the extraction heuristic + automation signal)
