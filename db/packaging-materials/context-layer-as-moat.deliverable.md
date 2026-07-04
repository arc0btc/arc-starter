# The Context Layer Is the Moat — Models and Harnesses Are Commodities

## TL;DR
Paul Iusztin argues that models and harnesses are both commoditizing, so the only durable moat is the context layer: your data, memory, tasks, preferences, and domain knowledge.
The test he proposes: if you switch from Claude Code to Codex to Gemini CLI to Pi to Hermes, what ports with you? That portable thing is the asset.
Arc already owns a versioned context layer (MEMORY.md + shared entries + recent.log), but it is coupled to arc-starter and Claude Code, not yet portable across the fleet base.

## Key takeaways
- "Models are becoming commoditized. Harnesses are becoming commoditized. The only moat that remains is your context layer." — @pauliusztin_, 2026-06-15.
- The thing you care about is not the model or the harness ("they're just tools") but your data: research, notes, conversations, tasks, preferences, domain knowledge.
- He frames it as switching cost: across Claude Code / Codex / Gemini CLI / Pi / Hermes, the context layer is what should survive the switch. Owning it is what buys freedom, not picking open-source tools.

## Arc-alignment
Arc already treats this as doctrine. `CLAUDE.md` "Context Budget" caps each dispatch at 40-50k tokens and lists exactly what loads: SOUL.md (identity), CLAUDE.md (architecture), MEMORY.md (compressed memory), and per-task SKILL.md files. That is a deliberately owned, curated context layer — Arc's memory is git-versioned (`memory/MEMORY.md`), not locked in a vendor.

The convergence is already documented. `memory/shared/entries/hermes-agent-convergent-architecture.md` notes NousResearch's Hermes agent converges on Arc's Identity/Memory/Skills/Tools/Crons/Profiles model and near-verbatim memory hygiene. `twelve-factor-agents-arc-scorecard.md` scores Arc 10/13 on HumanLayer's factors, with the task-table as F5 and stateless-reducer as F12. Arc's context layer is its strongest, most copied asset — which is exactly Paul's point about where the moat sits.

The gap is portability, the one thing Paul's switching test demands. Today the context layer lives in arc-starter and is shaped for Claude Code. `agent-runtime/src/memory.ts` is the start of a portable layer — it exposes `appendRecentLog`, `appendDeadEnd`, `loadAllDeadEnds`, `filterDeadEnds` against `agent-runtime/memory/` — but the rich layer (MEMORY.md, shared/entries) still sits in arc-starter. If Arc switched harnesses tomorrow, the dead-ends/recent-log machinery would port; the curated MEMORY.md and entries would need manual migration.

Port to agent-runtime? Yes, and it is the highest-leverage move on this list. The context layer is the fleet asset. The memory schema, the shared-entries format, and the injection logic belong in agent-runtime so every agent inherits Arc's proven memory hygiene and so the layer survives a harness switch. Agent-specific content (Arc's actual memories) stays per-agent; the machinery and schema go to the base.

## How this was verified
- Source: https://x.com/pauliusztin_/status/2066860844420653299 (@pauliusztin_, 2026-06-15)
- Cache: skills/arc-link-research/cache/c280d9da0f623d45.json
- Date: 2026-06-18
