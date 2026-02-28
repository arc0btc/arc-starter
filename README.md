# arc-agent

A minimal autonomous agent that runs on [Bun](https://bun.sh), stores all work as tasks in SQLite, and operates through its own CLI. Built on [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

## How it works

Two independent services run on a timer:

- **Sensors** (fast, no LLM) — detect signals and queue tasks. All sensors run in parallel. Pure TypeScript, no API calls.
- **Dispatch** (LLM-powered, lock-gated) — picks the highest-priority pending task, builds a prompt from the agent's identity + memory + skill context, spawns Claude Code, and records the result.

Everything flows through the **task queue**. Sensors create tasks. Dispatch executes them. Humans create tasks via the CLI. Nothing else matters structurally.

**Skills** are knowledge containers that extend the agent's capabilities. Each skill can bring CLI commands, sensor logic, orchestrator context, and subagent briefings. See `skills/` for examples.

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

All arguments use named flags (`--flag value`) for consistency.

```
arc status                                              # task counts, last cycle, cost today
arc tasks [--status STATUS] [--limit N]                 # list tasks (default: pending + active)
arc tasks add --subject "text" [--priority N]           # create a task
arc tasks update --id N [--subject TEXT] [--priority N] # update a task
arc tasks close --id N --status completed --summary "text"
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

Sensors run every minute, detect signals, and queue tasks. Dispatch runs every minute, picks the top task, and executes it with Claude Code. The dispatch lock prevents concurrent execution.

### Model routing

Dispatch routes tasks to models based on priority:
- **Priority 1-3** (strategic): Opus — deep reasoning, complex decisions
- **Priority 4+** (routine): Haiku — fast, cheap, good enough for standard work

### Dispatch resilience

The dispatch runner includes two safety layers:

1. **Pre-commit syntax guard** — Bun's transpiler validates all staged `.ts` files before committing. If syntax errors are detected, the commit is blocked and a follow-up task is created.
2. **Post-commit service health check** — After committing `src/` changes, the runner snapshots systemd/launchd service state and checks if any services died. If so, the commit is reverted, services are restarted, and a follow-up task is created.

### Worktree isolation

Tasks that include the `worktrees` skill run in an isolated git worktree. Changes are validated before merging back to the main branch. If validation fails, the worktree is discarded — the main tree stays clean and runnable.

### Dual cost tracking

Every dispatch cycle records two cost fields:
- `cost_usd` — Actual Claude Code consumption cost
- `api_cost_usd` — Estimated API cost from tokens

## Autonomous mode

Dispatch spawns Claude Code with `--dangerously-skip-permissions` when `DANGEROUS=true` is set in the environment. This is required for unattended operation — without it, Claude Code will prompt for permission on every tool use.

**What this means:** The agent can read, write, and execute anything your user account can. It operates within the constraints defined in `SOUL.md` and `CLAUDE.md`, but there is no technical permission boundary beyond your OS user account.

Enable it during install (`--autonomous` flag) or set it manually in `.env`.

## Creating skills

```bash
arc skills run --name manage-skills -- create my-skill --description "Does something useful"
```

This creates `skills/my-skill/` with a `SKILL.md` template. Add optional files:

- `sensor.ts` — auto-discovered and run by the sensors service
- `cli.ts` — exposed as `arc skills run --name my-skill -- <command>`
- `AGENT.md` — detailed instructions for subagents (never loaded into orchestrator context)

## Platform support

- **Linux** — systemd user timers (tested on Ubuntu 24.04)
- **macOS** — launchd user agents

Services are installed per-user, no root required. On Linux, `loginctl enable-linger` is recommended for boot persistence.

## License

MIT
