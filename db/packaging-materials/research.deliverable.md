# Research Report — Agent Loop Design & the loop-library Ecosystem

A coordinated content wave (7 of the 19 links) is selling one idea: stop one-shot prompting, design a *loop* — a goal + verification rubric + guardrails + budget that runs unattended.

## TL;DR
- "The loop" is the agent meme of the week: a goal, an LLM-as-judge verify gate, a token/turn budget, and a circuit breaker, exported as a portable artifact.
- A whole tooling layer is forming around it: Forward-Future's **loop-library** skill, **Looper** (loop design coach), Loop Library's "Lazy Loops / Discover," and a 300-agent Kimi swarm with an Opus verify gate.
- Arc already *is* this loop — but the market is naming and packaging the harness Arc runs silently. That's both validation and a packaging opportunity.

## Key Takeaways
- **@sunaiuse** ("97% of AI builders are doing this wrong"): the loop config is the product — `max_turns: 50`, `max_budget_usd: 10`, `circuit_breaker: 3` (same call 3× = halt), `heartbeat: STATUS.md` (silence = alarm). A `STATUS.md` the loop reads first and writes last, with Done / In Progress / **Never Touch** sections. ([cache db75e2b1](../skills/arc-link-research/cache/db75e2b123967eff.json))
- **@AnatoliKopadze** ("Loops explained: Claude, GPT, Mira", 8.18M impressions): one-request-at-a-time is "the whole problem" — every step runs through the human. The loop removes the human from the inner step and keeps them at the gate. ([cache 7e734b60](../skills/arc-link-research/cache/7e734b60b070db71.json))
- **@shannholmberg / Looper** (@KSimback): a *design layer* that critiques your loop before you run it, builds a verification rubric ("so the loop knows what done means"), adds an LLM-as-judge (Codex / non-Claude included), sets a token budget, exports a portable artifact. Pairs with an "LLM council." ([cache f5230f59](../skills/arc-link-research/cache/f5230f599837e2d2.json))
- **@SleepMoneyMaker**: a worked `/goal` — derive a verified, code-grounded behavioral spec into one canonical spreadsheet (spec → tested → fixed → verified), Phase 0 plan / Phase 1 catalog, "log an open question, don't guess." ([cache dd3db402](../skills/arc-link-research/cache/dd3db402c8114857.json))
- **@0xMovez**: a 300-agent Kimi K2.6 swarm across 4,000 steps, Opus 4.8 sitting at one verify gate whose only job is "stop garbage from getting saved as a skill." Each run leaves behind a reusable skill / sharper spec / new constraint — "yesterday's swarm should be dumber than today's." ([cache a4254f0b](../skills/arc-link-research/cache/a4254f0b957a2d84.json))
- **@MatthewBerman / Loop Library "Discover"**: scans your codebase + chat threads to *find* loops worth building. ([cache f1d91517](../skills/arc-link-research/cache/f1d91517d692647f.json))

## Arc-alignment (grounded in real code)
Arc is the production version of this meme, and the mapping is near-exact:
- **The loop = `src/dispatch.ts` + `src/sensors.ts`.** Sensors detect signals → queue tasks; dispatch picks one task, runs it, records to `cycle_log`. That's the goal/run/verify cycle the threads describe, already running 24/7.
- **`circuit_breaker: 3` = ARC-0011 escalation ladder.** Arc's `escalation_rung` / `pivot_count` / `dead_ends` columns and the REFINE→PIVOT→WEB-SEARCH→HANDOFF rungs are a *more sophisticated* circuit breaker than "same call 3× = halt" (see escalation-ladder-arc0011). The recurring-error-signature short-circuit (≥3 same-subject failures in 7d → PIVOT) is exactly @sunaiuse's idea, generalized.
- **`max_budget_usd` = the per-turn budget directive + `cost_usd`/`api_cost_usd` dual tracking.** Arc already meters spend per task; what Arc *lacks* is a hard per-loop ceiling that aborts mid-task (twelve-factor F6 pause/resume gap, see twelve-factor-agents-arc-scorecard).
- **`STATUS.md` heartbeat = `memory/recent.log` + the heartbeat sensor (360min).** Arc writes a one-line reflection per task close; the "silence = alarm" pattern is Arc's health sensors. The "Never Touch" section maps to the PreToolUse path guards on `.env` / dispatch-lock (path-conditional-hook-guards).
- **The verify gate = `arc-worktrees` isolation.** @0xMovez's "Opus at the verify gate, stop garbage from being saved as a skill" is precisely Arc's worktree-validate-before-merge (DIA mechanical validation, agent-reliability-dispatch-loop).
- **LLM-as-judge / "LLM council"** is the one piece Arc under-uses inline — see llm-council-deliberation-pattern. Arc has it as a Workflow judge-panel pattern but doesn't run a second-model check on routine task output.

**Port to agent-runtime?** Yes — the loop *is* the runtime. If `aibtcdev/agent-runtime` is the shared fleet base, the dispatch loop + escalation ladder + worktree verify gate should live there so every agent inherits the harness, not just Arc. The loop-library framing is a clean external spec to validate agent-runtime's interface against.

## How this was verified
- Sources: 7 links — primary @AnatoliKopadze, @sunaiuse, @shannholmberg, @SleepMoneyMaker, @0xMovez, @MatthewBerman + Forward-Future/loop-library repo.
- Cache: `skills/arc-link-research/cache/{7e734b60,db75e2b1,f5230f59,dd3db402,a4254f0b,f1d91517}.json`
- Fetched 2026-06-23T13:31:13Z · task #19751
