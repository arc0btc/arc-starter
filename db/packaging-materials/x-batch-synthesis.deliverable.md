# Synthesis — 2026-07-06 X Research Batch (18 links → 16 gated)

Full paid-quality synthesis emailed to whoabuddy as HTML:
`research/2026-07-06T23-20Z_x-batch-synthesis.html`. Raw per-link catalog:
`research/2026-07-06T23:10:31Z_research.md`.

## TL;DR (3 lines)
- The market spent this week naming and packaging what Arc already runs: loops, durable local memory, multi-agent orchestration, pay-per-use cost.
- One link hands Arc genuinely new work — the DeepMind 6-attack agent taxonomy (@rohanpaul_ai). Arc reads untrusted content every cycle, keeps persistent memory, holds keys = every precondition.
- Everything else is validation + a packaging cue for the $9 Harness line.

## Relevance gate (honest, 0-5)
| Link | Score | Note |
|------|-------|------|
| @ClaudeDevs official 4-loop taxonomy | 5 | turn/goal/time/proactive; Arc is a running instance |
| @rohanpaul_ai DeepMind 6-attack taxonomy | 5 | the one actionable gap — environment security |
| @DanKornas CAO (supervisor-worker, tmux, MCP handoff) | 4 | maps to arc-worktrees + proposals/0013 |
| @HowToPrompt__ TencentDB Agent Memory (SQLite, L0-L3, drill-back) | 4 | mirrors MEMORY.md+recent.log; drill-back = upgrade idea |
| @phosphenq STATE.md loop ("lessons here not in chat") | 4 | parallel to recent.log + escalation ladder |
| @PrajwalTomar_ Fable July-7 pricing → credits | 4 | validates today's X pay-per-use reframe (#21463) |
| @ryancarson wave-based migration + real cost tables | 4 | phased-risk orchestration, $115 orchestrator |
| @Sumanth_077 Omnigent meta-harness | 3 | orchestration layer above coding agents |
| @Suryanshti777 "managing ten agents" | 3 | subagent teams, Karpathy 80% agent-driven |
| @AiCamila_ LLM-as-Judge eval | 3 | maps to daily-eval 7-dim + council RANK |
| danielmiessler 10 Fable meta-prompts / LifeOS-as-Skill | 3 | harness meta-work + pricing shift |
| @free_ai_guides skill YAML example | 3 | SKILL.md authoring reference |
| @alex_prompter "interview me → write a skill" | 3 | AGENT.md/skill generation meta-prompt |
| @jerryjliu0 LlamaIndex document layer | 2 | noted, not written up (Arc isn't doc-parsing) |
| @systematicls 100x-engineer essay | 2 | noted, thin |
| @thisdudelikesAI Pipecat voice agents | 2 | noted, Arc isn't voice |
| **@cyrilXBT "CS degree optional"** | **1** | SKIPPED — culture take, thin for code mission |
| **@nurijanian PRD-quality / emoji-where-errorhandling** | **1** | SKIPPED — PM content, thin for Arc |

## Six themes
A. The loop is the product (ClaudeDevs, phosphenq, Suryansh).
B. Memory durable/readable/local (HowToPrompt, phosphenq) — validates Arc's markdown+SQLite.
C. Multi-agent orchestration standardizing on MCP primitives (DanKornas, Sumanth).
D. Environment is the attack surface, not the model (DeepMind/rohanpaul) — the gap.
E. Pay-per-use is the default (Prajwal, Miessler, ryancarson) — validates #21463 one day later.
F. The skill/harness is the durable artifact (free_ai_guides, alex_prompter, Miessler).

## Arc-alignment (real files)
- Loops: `src/sensors.ts` (claimSensorRun) = time/proactive; `src/dispatch.ts` = goal; `src/escalation.ts` (ARC-0011) = hand-rolled stop-after-N. No named goal primitive.
- Memory: `memory/MEMORY.md` + `memory/recent.log` + SQLite `tasks`. Upgrade: node_id-style drill-back from consolidated lines to source task IDs. Port → `agent-runtime/src/memory.ts`.
- Orchestration: dispatch single-task lock-gated; `agent-runtime/proposals/0013` atomic-claim fleet dispatch is the path; CAO tmux ≈ `skills/arc-worktrees`, MCP handoff ≈ HANDOFF rung.
- Security: `skills/arc-email-sync/AGENT.md`, `skills/wot/AGENT.md` already do "data not instructions." Gap: `arc-link-research` auto-follows embedded t.co (this batch followed 8) + persistent memory writes = the poisoning surface.
- Cost: `src/classifier.ts` (--model auto) + X reframe (`lib/x-api.ts`, #21462/#21463) already assume metered pricing.

## Top actionable
1. Security audit vs DeepMind 6-attack taxonomy (arc-starter, effort M, risk low) — queued as follow-up.
2. Map loops→ClaudeDevs taxonomy, name the missing goal primitive (S).
3. Memory drill-back prototype (both, S).
4. Package "Agent Loop Engineering" $9 SKU (M).
5. Confirm model-spend pay-per-use discipline matches the X path (S).

## How this was verified
18 source URLs + 8 embedded, cached 2026-07-06 to `skills/arc-link-research/cache/`.
Process note: synthesis written inline (not 13 fan-out opus tasks — budget + dispatch-is-a-fork). Raw research complete on shelf.
