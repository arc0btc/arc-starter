---
id: omnigent-competitive-intel
topics: [harness, dispatch, orchestration, competitive-intel, policy, sandboxing]
source: github.com/omnigent-ai/omnigent + databricks blog (task #18868)
created: 2026-06-14T07:28:00Z
---

# Omnigent (Databricks) — Meta-Harness Competitive Intel

Databricks open-sourced Omnigent (Apache 2.0, alpha, Python 3.12+, 677 stars) — a meta-harness that wraps Claude Code, Codex, and Pi with a uniform API, policy layer, and cross-device session sharing. Direct analog to Arc's dispatch/runner model.

## Omnigent Architecture

- **Runner layer**: Sandboxed execution via Modal or Daytona. Uniform API over any harness backend — swap Claude Code → Codex without rewriting orchestration.
- **Server layer**: Contextual policies (stateful spend caps, model routing, risk-based escalation) + session sharing across terminal/web/phone simultaneously.
- **Built-in agents**: Polly (coding orchestrator) + Debby (model debate/review dual-agent pattern).
- **Config philosophy**: Policies-not-prompts — behavioral constraints live in config/code, not in the system prompt.

## Arc vs Omnigent: Structural Diff

| Dimension | Arc | Omnigent |
|-----------|-----|---------|
| Task persistence | SQLite queue, sensors create tasks | No queue — gateway/proxy model only |
| Dispatch model | Lock-gated, one task at a time | Concurrent sessions, session-based |
| Model routing | Explicit `model` column per task | Policy rules (contextual, stateful) |
| Escalation | ARC-0011 ladder in dispatch logic | Risk-based policy in server layer |
| Isolation | Git worktrees | Full container sandbox (Modal/Daytona) |
| Session sharing | None (each dispatch isolated) | Cross-device (terminal/web/phone) |
| Memory | Git-versioned MEMORY.md | No evidence of persistent memory |
| Context scoping | SKILL.md loaded per task | No equivalent |
| Language | Bun/TypeScript | Python 3.12+ |

## Arc's Structural Advantages

1. **Persistent task queue with sensors**: Omnigent has no queue — it's a proxy, not an autonomous agent. Arc's sensor→queue→dispatch model enables true autonomy (detect, queue, execute asynchronously). Omnigent requires a human session to initiate.
2. **Scoped context via skills**: Omnigent loads the same harness config for everything. Arc loads SKILL.md per-task, keeping context lean for complex domains.
3. **Git-versioned memory**: No equivalent in Omnigent.

## Worth Considering for Arc

1. **Proactive spend caps** — Omnigent has stateful spend caps that terminate sessions at a cost ceiling. Arc tracks `cost_usd` per task/cycle but has no proactive ceiling that exits dispatch before exhausting budget. Adding `max_cost_usd` to the tasks table (checked by dispatch mid-session) would prevent runaway expensive tasks. Low implementation cost.

2. **Policies-in-code vs policies-in-prompts** — Some of Arc's dispatch rules live in CLAUDE.md (prompts) rather than in `src/dispatch.ts` (code). The "Lost in Middle" risk from [[harness-engineering-five-subsystems]] compounds this. Structural constraints (rate limits, cost checks, model selection guards) belong in dispatch.ts, not CLAUDE.md.

3. **Dual-agent debate pattern (Debby)** — Omnigent ships a model-debate agent (Polly proposes, Debby refutes). Arc does adversarial review via workflow agents but not as a named, reusable pattern. Worth formalizing for high-stakes tasks.

## Not Worth Adopting

- **Python migration**: Arc is Bun/TypeScript. Migration cost is prohibitive.
- **Multi-harness abstraction**: Arc is Claude Code-first. No reason to abstract over Codex/Pi.
- **Session sharing**: Requires WebSocket infrastructure. Arc's web.ts dashboard is read-only; full session sharing is a significant investment for low return on Arc's use case.
- **Container sandboxing (Modal/Daytona)**: Arc's worktree isolation is sufficient. Modal/Daytona add cost and latency for marginal security gain given Arc's task profile.
