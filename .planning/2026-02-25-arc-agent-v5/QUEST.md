# Quest: arc-agent-v5

**Goal:** Build arc-agent -- a minimal autonomous agent framework. v5 rewrite of Arc's loop, radically simplified from v4 (45+ skills, 6600 TS lines) to a clean task-driven architecture. Everything is a task, skills are knowledge containers, CLI is the primary interface.

**Status:** active
**Repo:** ~/dev/arc0btc/arc-agent
**Reference:** ~/arc0btc (v4, read-only reference)
**Phases:** 7
**Created:** 2026-02-25

---

## Design Principles

1. **Everything is a task.** No round-robin. Priority queue. Task's `skills` field (JSON array) determines what prompt context loads.
2. **Skills are knowledge containers.** Tools, projects, workflows — not just capabilities. SKILL.md + optional AGENT.md + optional sensor.ts + optional cli.ts. Skills accumulate as Arc learns and fight context rot.
3. **CLI-first.** Arc operates through its own CLI. If a capability doesn't have a CLI command, create the skill first. The CLI is the tool boundary — the stable interface regardless of dispatch transport (Claude Code today, API tomorrow). Every action is discoverable, testable, and properly structured.
4. **Two services.** Sensors (fast, no LLM, 1-5 min) create tasks. Dispatch (LLM, lock-gated, up to 60 min) executes one task per cycle. Sensors never blocked by dispatch.
5. **Start with one skill: manage-skills.** Everything else learned through it.
6. **Dual cost tracking.** Every dispatch records actual cost (Claude Code consumption) and estimated API cost (tokens x rate). Ongoing comparison data regardless of transport.
7. **Task templates (post-bootstrap).** Workflows like "dev-task" expand into chained tasks via parent_id. Templates are declarative JSON. Built as a skill via manage-skills, not hardcoded into the core.

## Key Decisions vs v4

| v4 | v5 |
|----|-----|
| Round-robin (comm/quest/work) | Priority queue |
| LOOP.md universal context | CLAUDE.md + skills context |
| Hook groups (sync/sensor/meta) | All sensors parallel |
| Quest system (state.json, PHASES.md) | parent_id task chains |
| Comms table | Messages are tasks |
| 45+ skills | Just manage-skills at launch |
| 1000+ line db.ts with migrations | Clean schema, ~200 lines |
| Multiple prompt builders | One dispatcher |
| memory_versions table | Git history on MEMORY.md |

## Carry Forward from v4

- Dispatch lock (PID-based, stale detection)
- Crash recovery (stale active tasks -> failed)
- Auto-commit after cycles
- Stream-JSON parsing from `claude --output-format stream-json`
- Cost calculation + cycle logging
- shouldRun pattern for sensor cadence gating
- Dedup gate (check before duplicate task creation)

## Schema

Two tables: `tasks`, `cycle_log`. Both track dual costs (`cost_usd` for actual, `api_cost_usd` for estimated). Memory lives in `memory/MEMORY.md` — git history provides versioning. See PHASES.md Phase 2 for full DDL.

## Post-Bootstrap Priorities

After Phase 7 (core system running), the first skills to build:

1. **VM setup** — explore the fresh VM, verify tooling (bun, claude, git, gh), install missing deps, configure accounts/credentials
2. **Messaging** — sensor to detect incoming messages, create tasks. Skill to compose and send replies. Re-enables the AIBTC communication loop.
3. **Health sensor** — monitor last cycle age, dispatch failures, disk/resource basics. Foundation for web UI status.
4. **Web UI** — dashboard for whoabuddy to monitor and interact. Task list, status, cycle history, cost tracking. The health sensor feeds this.
5. **Task templates** — `manage-templates` skill for declarative workflow expansion (dev-task, review-task, etc.)

## Idle Cycle Policy

When the task queue is empty, dispatch should not spin. Options (to be decided during build):
- **Deferred self-reflection.** Create a low-priority introspection task on a gated cadence (e.g., every 6-12 hours). Reviews recent cycles, updates MEMORY.md, identifies optimization opportunities. NOT every cycle — only when genuinely idle and enough time has passed.
- **Sensor-only mode.** If no tasks exist, dispatch exits immediately. Sensors continue running and will create tasks when conditions are met. This is the default — idle is fine.

## Security

- `--dangerously-skip-permissions` gated behind `DANGEROUS=true` env var. Plan to use it on the controlled VM, but the gate makes the decision explicit and removable.
- Credentials follow the stored credential pattern from v4 skills (env vars, not in repo).
- `.gitignore` covers sensitive files. Auto-commit stages only tracked files — nothing in gitignore gets committed.
- No secrets in task descriptions or result fields.

## Target Structure

```
arc-agent/
  SOUL.md
  CLAUDE.md
  package.json, tsconfig.json
  src/cli.ts, db.ts, dispatch.ts, sensors.ts
  skills/manage-skills/SKILL.md, AGENT.md, cli.ts
  skills/heartbeat/SKILL.md, sensor.ts
  skills/health/SKILL.md, sensor.ts
  memory/MEMORY.md
  db/                           # gitignored: *.sqlite, dispatch-lock.json, hook-state/
  scripts/install-services.sh
  systemd/arc-sensors.service+timer, arc-dispatch.service+timer
```
