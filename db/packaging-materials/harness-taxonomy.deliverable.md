# Harness Engineering Guide (nexu-io / DanKornas) — repo taxonomy vs Arc's 5-subsystem model

## TL;DR
- DanKornas's tweet points to **`github.com/nexu-io/harness-engineering-guide`** (MIT) — a practical guide that breaks "what turns a bare LLM into an agent" into **12 named subsystems**, far more granular than the 5-subsystem model in harness-engineering-five-subsystems.
- Arc already implements **10 of the 12** in real code (`src/dispatch.ts`, `src/escalation.ts`, `src/sensors.ts`, `skills/*/SKILL.md`, `memory/recent.log`+`MEMORY.md`); the two genuine gaps are **container/network sandboxing** and **first-class prompt-injection defense**.
- Biggest structural finding: agent-runtime has the harness *primitives* (`memory.ts`, `skills.ts`, `models.ts`, `scheduler`/`worktrees` skills) but **not the loop** — the agentic loop, ARC-0011 escalation ladder, and sensor engine live only in arc-starter. That is the real "port to agent-runtime?" call.

## Key takeaways (cited)

Source: tweet `cb7d79c893e793f6.json` + repo README (`github.com/nexu-io/harness-engineering-guide`, WebFetch 2026-06-27).

**The repo's harness taxonomy — 12 subsystems** (repo README, Core Concepts + Practice chapters):
1. **Tool System** — registry, static/dynamic loading, MCP protocol
2. **Memory & Context** — session mgmt, two-tier memory (daily logs + long-term)
3. **Guardrails** — permission models, trust boundaries, sandboxing, prompt-injection defense
4. **Agentic Loop** — think → act → observe, turn budgets, parallel tool calls, loop detection
5. **Context Assembly** — priority-based assembly, token budgeting, compression
6. **Sandbox** — Docker/Firecracker, network isolation, filesystem restrictions
7. **Skill System** — "thin harness + thick skills," on-demand loading, **SKILL.md format**
8. **Sub-Agent** — leader-worker pattern, file-based communication, session isolation
9. **Error Handling** — error classification, retry strategies, graceful degradation
10. **Multi-Agent Orchestration** — pipeline, fan-out, supervisor patterns
11. **Scheduling & Automation** — cron, heartbeats, event triggers
12. **Credential/Session Isolation** — brain/hands/session decoupling

- **Pedagogy:** first-principles path opens with "What is a Harness?" and **"Build a working harness in 50 lines of Python"** ("Your First Harness"), then "Harness vs. Framework."
- **Reference comparison:** side-by-side of **OpenClaw, Claude Code, Codex, Cline, Aider, Cursor**.
- **Long-Running Harness Design** chapter names the exact failure modes Arc has logged: **"context anxiety, self-evaluation bias, context reset vs compaction."**
- Practice chapters also include **Eval Infrastructure Noise, Eval Awareness, Classifier-Based Permissions, Initializer + Coding Agent Pattern** — each maps to an existing Arc memory entry (below).
- License **MIT**; community contribution via GitHub issues/PRs.

Note: the cached tweet says "Link in the reply 👇" and the embedded `t.co/xzKVWELIWW` resolves back to the same tweet (circular) — the repo URL was in a reply tweet the triage batch did not capture. Resolved via WebSearch → `nexu-io/harness-engineering-guide`, whose README description matches the tweet's feature list verbatim (concepts/tutorials/papers/tools, 50-line Python harness, OpenClaw/Claude Code/Codex/Cline/Aider/Cursor comparison, MIT).

## Arc-alignment — grounded in the real code

Mapping the repo's 12 subsystems against `~/arc-starter` (Arc's legacy single-agent VM) and `~/agent-runtime` (`aibtcdev/agent-runtime`, the shared fleet base). Verified file/skill paths in both trees.

| # | Repo subsystem | Arc reality (file/skill) | Status |
|---|---|---|---|
| 1 | Tool System | `arc` CLI (`src/cli.ts`) + per-skill `skills/*/cli.ts`; MCP via `arc-mcp-server` (both repos) | ✅ HAS |
| 2 | Memory & Context (two-tier) | `memory/recent.log` (daily, 804 lines) + `memory/MEMORY.md` (long-term); primitive `agent-runtime/src/memory.ts` | ✅ HAS (strong) |
| 3 | Guardrails | `src/dispatch-gate.ts`, `src/safe-commit.ts`, path-conditional hooks (path-conditional-hook-guards) | ⚠️ PARTIAL — no prompt-injection layer |
| 4 | Agentic Loop | `src/dispatch.ts` (one task/cycle, priority pick, lock-gated) — **arc-starter only** | ✅ HAS, not ported |
| 5 | Context Assembly | 40–50k budget (CLAUDE.md), `skills[]` scoping, lean-MEMORY discipline (-36% duration, #19374) | ✅ HAS |
| 6 | Sandbox | `src/worktree.ts` + `skills/arc-worktrees` (git worktree isolation only) | ⚠️ PARTIAL — no container/network isolation |
| 7 | Skill System (SKILL.md) | **Exact convergence** — `skills/<name>/SKILL.md` + `skills[]` JSON array; "thin harness + thick skills" = Arc's orchestrator model | ✅ HAS (converged) |
| 8 | Sub-Agent (file-based comms) | `Agent`/`Workflow` tools + `skills/arc-peer-inbox`/`arc-inbox` (file-inbox-hcom-pattern); but [FLAG] dispatch-is-a-fork limit (self-fork-inherits-full-context) | ⚠️ PARTIAL |
| 9 | Error Handling | **ARC-0011 ladder** `src/escalation.ts` (REFINE/PIVOT/WEB-SEARCH/HANDOFF) (escalation-ladder-arc0011) — **arc-starter only** | ✅ HAS (strong), not ported |
| 10 | Multi-Agent Orchestration | `skills/arc-workflows` state-machine + `Workflow` tool (pipeline/fan-out/supervisor) | ✅ HAS |
| 11 | Scheduling & Automation | `src/sensors.ts` (1-min timer, per-sensor self-gating) + `skills/arc-scheduler`; `agent-runtime/skills/scheduler` | ✅ HAS (strong) |
| 12 | Credential/Session Isolation | `skills/credentials` (AES-256-GCM, `src/credentials.ts`); `agent-runtime/skills/arc-credentials` | ⚠️ PARTIAL — no brain/hands split |

**Practice chapters → existing Arc memory** (the convergence is not just structural, it's down to the failure modes):
- "Long-Running Harness Design: context anxiety, self-evaluation bias, context reset vs compaction" ↔ "Context Anxiety = Decomposition Signal" in harness-engineering-five-subsystems + loom-spiral token-spiral.
- "Eval Infrastructure Noise / Eval Awareness" ↔ Contagion Networks "rotate the eval model" finding (agent-reliability-dispatch-loop).
- "Classifier-Based Permissions" ↔ Arc uses **path-conditional** hook guards instead (path-conditional-hook-guards) — a deliberate alternative, worth noting as a design fork, not a gap.
- "Initializer + Coding Agent Pattern" ↔ Arc's Bootstrap Contract (4 cold-start conditions, harness-engineering-five-subsystems).

**This is the 4th independent convergence data point** on Arc's architecture, after Hermes (hermes-agent-convergent-architecture), 12-Factor Agents (twelve-factor-agents-arc-scorecard), and the walkinglabs lectures. When an external, MIT-licensed guide and a live autonomous agent land on the same 10+ subsystems independently, the model is real, not a post-hoc rationalization. That is exactly the buy-reason for the packaged SKU.

**The "port to agent-runtime?" call (the load-bearing finding):** agent-runtime today holds the harness *nouns* — `src/memory.ts`, `src/skills.ts`, `src/models.ts`, `src/identity.ts`, and the `scheduler`/`worktrees`/`contacts`/`arc-peer-inbox` skills — but **none of the harness *verbs***: there is no `dispatch.ts`, no `sensors.ts`, no `escalation.ts` in `agent-runtime/src/`. The agentic loop (#4), error handling (#9), and the sensor side of scheduling (#11) — Arc's three strongest, most-validated subsystems — are stranded in arc-starter. Every new fleet agent on agent-runtime currently boots without a loop or a recovery ladder. Lifting `dispatch.ts` + `escalation.ts` into agent-runtime levels up *every* agent at once.

## How this was verified
- Tweet: https://x.com/DanKornas/status/2070625882289623344 (@DanKornas, 2026-06-26T21:50:55Z; 140 likes / 177 bookmarks / 5924 impressions). Cache: `skills/arc-link-research/cache/cb7d79c893e793f6.json` (fetched 2026-06-27T14:42:01Z, triage task #20093).
- Repo: `github.com/nexu-io/harness-engineering-guide` (MIT), resolved via WebSearch + WebFetch 2026-06-27 (tweet's reply link not in cache).
- Code grounding: `~/arc-starter` (commit @ branch main 2026-06-27) and `~/agent-runtime` file trees, verified live.
- Verify before you buy: re-run the dedup gate (`arc skills run --name arc-link-research -- check --url <tweet>`), open the repo README, and diff `agent-runtime/src/` against `arc-starter/src/` to confirm the loop is not yet ported.
