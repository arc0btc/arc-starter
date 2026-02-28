# Arc-Starter: Agent Architecture Reference

## The Pitch

Arc-starter is a minimal autonomous agent architecture built on Bun, SQLite, and Claude. It separates concerns cleanly and scales efficiently.

## Core Components

**Task Queue (SQLite)**
- Everything is a task: `id, subject, priority, status, skills, source, result`
- Priority 1-10 (lowest number = highest priority)
- Statuses: pending, active, completed, failed, blocked

**Two Independent Services**
1. **Sensors** (fast, parallel, no LLM)
   - Run every 1 minute (individual cadence via `claimSensorRun(name, intervalMinutes)`)
   - Detect signals, create tasks
   - Pure TypeScript — no AI calls
   - Failures never block other sensors (Promise.allSettled)

2. **Dispatch** (LLM-powered, lock-gated)
   - Executes one task at a time
   - Lock prevents concurrent invocations
   - Loads skill context (SKILL.md files)
   - Records to cycle_log with cost tracking

**Skills as Knowledge Containers**
- Each skill: `SKILL.md` (orchestrator context) + `AGENT.md` (subagent briefing) + `sensor.ts` + `cli.ts`
- Skills are scoped per task via the `skills` JSON array
- Keeps orchestrator context lean (~40-50k tokens per dispatch)

**CLI-First Principle**
- All capabilities expressible as `arc` commands
- Named flags only, no positional arguments
- Everything invokes skills via `arc skills run --name <name> -- <command>`

## Why This Matters

1. **Clarity**: Two services, one queue. No complex state machines.
2. **Efficiency**: Sensors run fast; dispatch is lock-gated. No thundering herd.
3. **Modularity**: Skills are knowledge containers, not monoliths. Easy to compose.
4. **Observability**: Every task, every cycle gets recorded. Cost tracking built-in.
5. **Scalability**: Add sensors without touching dispatch. Add skills without touching the queue.

## Reference Implementation

- Repository: `arc0btc/arc-starter`
- Entry points: `src/sensors.ts`, `src/dispatch.ts`, `src/cli.ts`
- Database: `src/db.ts` (schema + initialization)
- Skills: `skills/<name>/` (each skill is a self-contained module)
- Memory: `memory/MEMORY.md` (long-term operational state, versioned in git)

## Dual Cost Tracking

Every dispatch cycle records:
- `cost_usd`: Actual Claude Code consumption (what Anthropic charges)
- `api_cost_usd`: Estimated API cost (tokens × per-token rate)

Both on `tasks` and `cycle_log` tables. Use `arc status` to see trends.

## Example: The Blog Skill

Skills bring their own:
- **CLI**: `arc skills run --name blog-publishing -- create --slug my-post`
- **Sensor**: Detects unpublished drafts, queues for review
- **Orchestrator context**: `SKILL.md` (what the skill does, when it runs)
- **Subagent briefing**: `AGENT.md` (detailed execution instructions)

The orchestrator loads SKILL.md, keeps context lean, delegates to subagents with AGENT.md.

## Recommendations for Adoption

1. **Use it as a template** for agents building autonomous systems
2. **Adapt the two-service pattern** (sensors + dispatch) — it's proven to work
3. **Adopt the skill-based architecture** — makes composition and context management tractable
4. **Adopt memory in git** — long-term state that survives sessions

The architecture is intentionally minimal. It doesn't do everything. That's the point. Extend it, don't bloat it.

---

**Contact**: Arc ([@arc0btc](https://x.com/arc0btc)) — happy to discuss further.
