# arc-starter

A reference implementation for building autonomous agents on [Bun](https://bun.sh) + [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Everything is a task in SQLite. Two services — sensors and dispatch — coordinate through a shared queue. Skills extend what the agent can do without touching core code.

This is Arc's own stack. It's opinionated: CLI-first, file-based memory, git-versioned state, no external orchestrator. If you're coming from [aibtcdev/loop-starter-kit](https://github.com/aibtcdev/loop-starter-kit), the key differences are custom dispatch with 3-tier model routing, worktree isolation for risky tasks, a skill system that scopes context per-task, and encrypted credential management.

## How it works

Two independent services run on systemd/launchd timers:

- **Sensors** (fast, no LLM) — detect signals and queue tasks. All sensors run in parallel via `Promise.allSettled()`. Each sensor controls its own cadence through `claimSensorRun(name, intervalMinutes)` — the timer fires every minute, but sensors self-gate and skip when it's not time yet.
- **Dispatch** (LLM-powered, lock-gated) — picks the highest-priority pending task, loads the agent's identity + memory + skill context, spawns Claude Code, and records the result. Only one dispatch runs at a time, enforced by a lock file.

Everything flows through the **task queue**. Sensors create tasks. Dispatch executes them. Humans create tasks via the CLI. The dispatched Claude Code session commits its own work and closes the task.

**Skills** are knowledge containers. Each skill can bring CLI commands (`cli.ts`), sensor logic (`sensor.ts`), orchestrator context (`SKILL.md`), and subagent briefings (`AGENT.md`). Skills are loaded per-task — only the skills listed in a task's `skills` array get loaded into context, keeping dispatch lean.

## Quick start

```bash
# Clone the repo
git clone https://github.com/arc0btc/arc-starter.git
cd arc-starter

# Install prerequisites (tmux, bun, gh, claude CLI, database, arc CLI)
bash scripts/install-prerequisites.sh

# Or enable autonomous mode (grants Claude Code full permissions)
bash scripts/install-prerequisites.sh --autonomous

# Authenticate Claude Code (first time only)
claude

# Define your agent's identity
$EDITOR SOUL.md

# Install and start the timer services
arc services install
```

## CLI

All arguments use named flags (`--flag value`), never positional args.

```
arc status                                              # task counts, last cycle, cost today
arc tasks [--status STATUS] [--limit N]                 # list tasks (default: pending + active)
arc tasks add --subject "text" [--priority N]           # create a task
              [--description TEXT] [--source TEXT]
              [--skills SKILL1,SKILL2] [--parent ID]
              [--model opus|sonnet|haiku]
arc tasks update --id N [--subject TEXT] [--priority N] # update a task
                 [--description TEXT] [--model opus|sonnet|haiku]
arc tasks close --id N --status completed|failed --summary "text"
arc run                                                 # trigger a dispatch cycle
arc skills                                              # list installed skills
arc skills show --name NAME                             # print skill context
arc skills run --name NAME [-- extra-args]              # run a skill's CLI
arc sensors                                             # run all sensors once
arc sensors list                                        # list discovered sensors
arc services install|uninstall|status                   # manage timer services
arc creds list                                          # list credential keys
arc creds get --service NAME --key KEY                  # retrieve a credential
arc creds set --service NAME --key KEY --value VALUE    # store a credential
arc creds delete --service NAME --key KEY               # remove a credential
arc help                                                # show full CLI reference
```

## Key files

| File | Purpose |
|------|---------|
| `SOUL.md` | Agent identity — who it is, what it values, how it works. Loaded every dispatch cycle. |
| `CLAUDE.md` | Architecture reference and dispatch instructions. Loaded by Claude Code automatically and by dispatch. |
| `memory/MEMORY.md` | Compressed long-term memory. Updated by the agent, versioned by git. |
| `skills/` | Skill tree — each skill has `SKILL.md` + optional `AGENT.md`, `sensor.ts`, `cli.ts`. |
| `src/dispatch.ts` | Dispatch service — task selection, model routing, Claude Code subprocess, result recording. |
| `src/sensors.ts` | Sensors service — parallel sensor execution with per-sensor cadence gating. |
| `src/cli.ts` | CLI entry point (`arc` command). |
| `src/web.ts` | Web dashboard — task list, cycle log, cost tracking, sensor status. |
| `.env` | Environment config. `ARC_CREDS_PASSWORD` for credential store, `DANGEROUS=true` for autonomous dispatch. |

## Architecture

```
                 ┌─────────────────┐
                 │   Task Queue    │
                 │   (SQLite)      │
                 └────┬───────┬────┘
                      │       │
              creates │       │ picks + executes
                      │       │
          ┌───────────┴──┐ ┌──┴───────────┐
          │   Sensors    │ │   Dispatch    │
          │  (parallel,  │ │  (sequential, │
          │   no LLM)    │ │   lock-gated) │
          └──────────────┘ └──────────────┘
```

Sensors fire every minute, self-gate by interval, detect signals, and queue tasks. Dispatch fires every minute, picks the top pending task by priority, and executes it with Claude Code. The dispatch lock (`db/dispatch-lock.json`) prevents concurrent execution.

### 3-tier model routing

Dispatch routes tasks to Claude models based on priority, with an explicit `--model` override:

| Priority | Model | Role | Use for |
|----------|-------|------|---------|
| P1-4 | Opus | Senior | New skills/sensors, architecture, deep reasoning, complex code, security |
| P5-7 | Sonnet | Mid | Composition, PR reviews, moderate complexity, operational tasks |
| P8+ | Haiku | Junior | Simple execution, config edits, status checks, health alerts |

Set `--model opus|sonnet|haiku` on a task to override priority-based routing.

### Dispatch resilience

Three safety layers protect the agent from self-inflicted damage:

1. **Pre-commit syntax guard** — Bun's transpiler validates all staged `.ts` files before committing. Syntax errors block the commit and create a follow-up task.
2. **Post-commit service health check** — After committing `src/` changes, snapshots service state and checks if any services died. If so, the commit is reverted, services are restarted, and a follow-up task is created.
3. **Worktree isolation** — Tasks with `arc-worktrees` in their skills array run in an isolated git worktree. Changes are syntax-validated before merging back. If validation fails, the worktree is discarded — the main tree stays clean and runnable.

### Sensor cadence

The systemd/launchd timer fires every **1 minute** — this is the floor frequency. Each sensor controls its own cadence via `claimSensorRun(name, intervalMinutes)`. A health-check sensor might run every 5 minutes, a heartbeat every 6 hours. The timer fires frequently; sensors self-gate and return early when it's not time yet.

### Dual cost tracking

Every dispatch cycle records two cost fields:
- `cost_usd` — Actual Claude Code consumption cost (what Anthropic charges for the session)
- `api_cost_usd` — Estimated API cost calculated from tokens (what API-rate billing would cost)

Use `arc status` to see daily cost totals.

## Autonomous mode

Dispatch spawns Claude Code with `--dangerously-skip-permissions` when `DANGEROUS=true` is set in `.env`. This is required for unattended operation — without it, Claude Code will prompt for permission on every tool use.

**What this means:** The agent can read, write, and execute anything your user account can. It operates within the constraints defined in `SOUL.md` and `CLAUDE.md`, but there is no technical permission boundary beyond your OS user account.

Enable it during install (`--autonomous` flag) or set it manually in `.env`.

## Creating skills

```bash
arc skills run --name arc-skill-manager -- create my-skill --description "Does something useful"
```

This creates `skills/my-skill/` with a `SKILL.md` template. Add optional files:

- `sensor.ts` — Auto-discovered and run by the sensors service. Controls its own cadence.
- `cli.ts` — Exposed as `arc skills run --name my-skill -- <command>`.
- `AGENT.md` — Detailed instructions for subagents. Never loaded into orchestrator context — passed to subagents when delegating work. Keeps dispatch lean.

## Platform support

- **Linux** — systemd user timers (tested on Ubuntu 24.04)
- **macOS** — launchd user agents

Services are installed per-user, no root required. On Linux, `loginctl enable-linger` is recommended for boot persistence.

## License

MIT
