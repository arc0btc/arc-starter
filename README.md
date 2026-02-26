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
git clone https://github.com/arc0btc/arc-agent.git
cd arc-agent

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

```
arc status                    # task counts, last cycle, cost today
arc tasks                     # list pending/active tasks
arc tasks add "subject"       # create a task
arc tasks close ID completed "summary"
arc run                       # trigger a dispatch cycle
arc skills                    # list installed skills
arc skills show <name>        # print skill context
arc skills run <name> [args]  # run a skill's CLI
arc sensors                   # run all sensors once
arc services install          # enable timer services
arc services status           # check service status
```

## Key files

| File | Purpose |
|------|---------|
| `SOUL.md` | Agent identity — who it is, what it values, how it works. Loaded every dispatch cycle. |
| `CLAUDE.md` | Architecture reference and dispatch instructions. Loaded by Claude Code automatically and by dispatch. |
| `memory/MEMORY.md` | Compressed long-term memory. Updated by the agent, versioned by git. |
| `skills/` | Skill tree — each skill has `SKILL.md` + optional `AGENT.md`, `sensor.ts`, `cli.ts`. |
| `.env` | Environment config. Set `DANGEROUS=true` here for autonomous dispatch. |

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

## Autonomous mode

Dispatch spawns Claude Code with `--dangerously-skip-permissions` when `DANGEROUS=true` is set in the environment. This is required for unattended operation — without it, Claude Code will prompt for permission on every tool use.

**What this means:** The agent can read, write, and execute anything your user account can. It operates within the constraints defined in `SOUL.md` and `CLAUDE.md`, but there is no technical permission boundary beyond your OS user account.

Enable it during install (`--autonomous` flag) or set it manually in `.env`.

## Creating skills

```bash
arc skills run manage-skills create my-skill --description "Does something useful"
```

This creates `skills/my-skill/` with a `SKILL.md` template. Add optional files:

- `sensor.ts` — auto-discovered and run by the sensors service
- `cli.ts` — exposed as `arc skills run my-skill <command>`
- `AGENT.md` — detailed instructions for subagents (never loaded into orchestrator context)

## Platform support

- **Linux** — systemd user timers (tested on Ubuntu 24.04)
- **macOS** — launchd user agents

Services are installed per-user, no root required. On Linux, `loginctl enable-linger` is recommended for boot persistence.

## License

MIT
