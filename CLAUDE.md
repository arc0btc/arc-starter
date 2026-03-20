# Loom Agent

Loom is a minimal autonomous agent that runs on Bun, stores all work as tasks in a SQLite database, and operates primarily through its own CLI. It runs two independent services — sensors (fast, no LLM, detects signals and queues tasks) and dispatch (LLM-powered, lock-gated, executes one task at a time) — coordinated through a shared task queue. Skills are knowledge containers: each skill brings its own CLI commands, sensor logic, orchestrator context, and subagent briefing. Memory lives in `memory/MEMORY.md`, versioned by git.

---

## Identity

Your full identity is in SOUL.md. Read it. That is who you are. If you feel disoriented, re-read SOUL.md before acting.

---

## Architecture

### The Task Queue

Everything is a task. The `tasks` table is the universal queue. Sensors create tasks. Dispatch executes them one at a time, in priority order. Humans create tasks via `arc` CLI. Nothing else matters structurally.

Task priority: 1 (highest) to 10 (lowest). Default is 5. Past-due scheduled tasks get a +2 priority boost. Dispatch always picks the lowest-numbered priority first among `status = 'pending'` tasks.

The `skills` column is a JSON array of skill names the dispatched Claude instance should load before starting work. Example: `["aibtc-news-classifieds"]`. This is how context is scoped per task. Use `--skills none` to explicitly dispatch with no skill context.

The `template` column links tasks to `templates/` for recurring or structured work patterns.

### Two Services

**Sensors** (no LLM, fast, parallel):
- The systemd/launchd timer fires every **1 minute** — this is the floor frequency
- Each sensor controls its own cadence via `claimSensorRun(name, intervalMinutes)`
- The interval is defined per-sensor in `sensor.ts` (e.g., health=5min, heartbeat=360min)
- The timer fires frequently; sensors self-gate and return `"skip"` when it's not time yet
- Each sensor is a TypeScript file at `skills/<name>/sensor.ts`
- All sensors run in parallel via `Promise.allSettled()`
- A sensor failure never blocks others
- Sensors read external data, detect signals, and create tasks via the task queue
- No LLM calls — pure TypeScript logic only
- Entry point: `src/sensors.ts`

**Dispatch** (LLM-powered, lock-gated):
- Timer: up to 30 minutes per cycle
- Gated by `db/dispatch-lock.json` — if another dispatch is running, new invocation exits immediately
- Selects highest-priority pending task, marks it `active`, runs Claude Code as a subprocess
- **Model routing** (3-tier):
  | Priority | Model  | Use For |
  |----------|--------|---------|
  | P1-4     | Opus   | New skills/sensors, architecture decisions, deep reasoning, complex code, security, strategy |
  | P5-7     | Sonnet | Composition, reviews, moderate complexity, operational tasks, signal filing, reports |
  | P8+      | Haiku  | Simple execution, mark-as-read, config edits, status checks, health alerts |
- Loads SOUL.md, CLAUDE.md, MEMORY.md, and skill SKILL.md files specified in the task's `skills` array
- Records everything to `cycle_log`
- **Dispatch resilience** — two safety layers protect against self-inflicted damage:
  1. *Pre-commit syntax guard*: Bun's transpiler validates all staged `.ts` files before committing. Syntax errors block the commit and create a follow-up task.
  2. *Post-commit service health check*: After committing `src/` changes, snapshots service state and checks if any died. If so, reverts the commit, restarts services, and creates a follow-up task.
- **Worktree isolation**: Tasks with `worktrees` skill run in an isolated git worktree. Changes are validated before merging back. If validation fails, the worktree is discarded — main tree stays clean.
- Entry point: `src/dispatch.ts`

### Skills as Knowledge Containers

Skills live under `skills/<name>/`. Each skill can have:

- `SKILL.md` — Orchestrator context. What the skill does, CLI syntax, composability, data schemas. Loaded into dispatch context when the task lists this skill. Keeps the orchestrator's context lean.
- `AGENT.md` — Subagent briefing. Detailed execution instructions. Never loaded into the orchestrator's context. Pass it to subagents via the Task tool when delegating heavy work.
- `sensor.ts` — Auto-run by the sensors service. Detects signals, creates tasks.
- `cli.ts` — CLI commands exposed via `arc skills run --name <skill> -- <command>`. Every action Loom can take must be expressible as an `arc` command.

Read SKILL.md, keep context lean, delegate detailed execution to subagents that receive AGENT.md. Do not load AGENT.md into your own context.

---

## CLI: Primary Interface

The CLI is the tool boundary. If a capability doesn't have a CLI command, create the skill first. All arguments use named flags (`--flag value`), never positional args.

```
arc status                                    # task counts, last cycle, cost today
arc tasks [--status STATUS] [--limit N]       # list tasks (default: pending + active)
arc tasks add --subject TEXT [--priority N]    # create a task
arc tasks update --id N [--subject TEXT] [--priority N] [--description TEXT] [--model MODEL] [--status pending]  # update a task
arc tasks close --id N --status completed|failed --summary TEXT
arc skills                                    # list installed skills
arc skills show --name NAME                   # print SKILL.md content
arc skills run --name NAME [-- extra-args]    # run a skill's CLI
arc sensors                                   # run all sensors once
arc sensors list                              # list discovered sensors
arc services install|uninstall|status         # manage platform services
arc run                                       # trigger a dispatch cycle
arc creds list                                # list credential keys (no values shown)
arc creds get --service NAME --key KEY        # retrieve a single credential value
arc creds set --service NAME --key KEY --value VALUE  # store or update a credential
arc creds delete --service NAME --key KEY    # remove a credential
arc creds unlock                              # verify ARC_CREDS_PASSWORD works
arc scratchpad read --task N                  # read project scratchpad for task family
arc scratchpad append --task N --content TEXT  # append to scratchpad
arc scratchpad write --task N --content TEXT   # overwrite scratchpad
arc scratchpad clear --task N                 # clear scratchpad
```

Every action Loom can take must be expressible as an `arc` command. This is the CLI-first principle.

---

## Context Budget

Hard limit: 40-50k tokens per dispatch.

Context loaded per dispatch:
- `SOUL.md` — identity anchor (always)
- `CLAUDE.md` — this file, architecture + dispatch instructions (always)
- `memory/MEMORY.md` — compressed long-term memory (always)
- `skills/*/SKILL.md` — loaded for each skill listed in the task's `skills` array
- `db/projects/<root_task_id>.md` — project scratchpad, loaded if task belongs to a family

Archive over delete. If context grows, compress into MEMORY.md.

---

## SQL Schema

```sql
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  subject TEXT NOT NULL,
  description TEXT,
  skills TEXT,              -- JSON array: ["aibtc-news-classifieds"] or null
  priority INTEGER DEFAULT 5,
  status TEXT DEFAULT 'pending',  -- pending|active|completed|failed|blocked
  source TEXT,              -- "human", "sensor:aibtc-heartbeat", "task:42"
  parent_id INTEGER,
  template TEXT,
  scheduled_for TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  result_summary TEXT,
  result_detail TEXT,
  cost_usd REAL DEFAULT 0,
  api_cost_usd REAL DEFAULT 0,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  attempt_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  FOREIGN KEY (parent_id) REFERENCES tasks(id)
);

CREATE TABLE cycle_log (
  id INTEGER PRIMARY KEY,
  task_id INTEGER,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER,
  cost_usd REAL DEFAULT 0,
  api_cost_usd REAL DEFAULT 0,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  skills_loaded TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

---

## Dual Cost Tracking

Every dispatch cycle records two cost fields:

- `cost_usd` — Actual Claude Code consumption cost. Pulled from the Claude Code subprocess invocation report (what Anthropic charges for the Claude Code session itself).
- `api_cost_usd` — Estimated API cost calculated from tokens × per-token rate. This tracks what the underlying API calls would cost if billed at API rates.

Both fields exist on both `tasks` and `cycle_log` tables. Use `arc status` to see cost trends.

---

## Memory

Memory uses a topical file split. `memory/MEMORY.md` is a slim index (directives, critical flags, identity) loaded every cycle. Domain-specific memory lives in `memory/topics/` — dispatch loads only the topics relevant to the task's skills.

Memory is for operational learnings: what worked, what failed, domain-specific patterns, identity details, wallet state.

**Active topic files:** `incidents.md`, `publishing.md`.

**Memory update protocol:**
1. During dispatch, append new learnings to the relevant `memory/topics/<topic>.md` file
2. Edit `memory/MEMORY.md` only for directives, identity, or critical flags
3. Prefix important items with `[FLAG]`
4. Commit memory changes after significant updates
5. Periodically consolidate topic files to keep each under ~1k tokens

---

## Conventions

**Commits:** Conventional commits format required. `type(scope): message`. Types: feat, fix, refactor, test, docs, chore. One logical change per commit.

**DB columns:** Verbose naming. `started_at` not `start`. `cost_usd` not `cost`. `tokens_in` not `in`. Ambiguity in column names causes bugs.

**Runtime:** Bun. No Node.js. Use `Bun.file()`, `Bun.spawn()`, `bun:sqlite`. Do not import from `node:*` unless unavoidable.

**TypeScript:** Strict mode. No `any`. Explicit return types on exported functions. Use `satisfies` for config objects.

**Error handling:** Every sensor and CLI command catches and logs errors. Dispatch records failures to `cycle_log` and sets `tasks.status = 'failed'`.

**Testing:** Never run test suites inline during dispatch. Tests block the dispatch queue — a hanging test means zero tasks execute until timeout. Instead, follow the full PR workflow:

**PR Workflow:**
1. **Triage** — Discover or be assigned an open issue
2. **Branch** — Create a feature branch (`git checkout -b fix/issue-slug`)
3. **Changes** — Implement the fix or feature; keep scope tight
4. **Simplify** — Run `/simplify` against all changed files before opening the PR. This reviews changed code for reuse, quality, and efficiency, then fixes issues found. Do this before PR creation, not as a post-merge review.
5. **PR** — Push branch and open a PR via `gh pr create`
6. **CI** — Let GitHub Actions run tests; review results
7. **Review** — Address review comments, push fixups
8. **Merge** — Squash merge when green; wait 30s, then merge release-please if present

For `arc-starter` itself, run only targeted syntax checks (e.g. `bun build --no-bundle`), never full test suites. If a repo lacks CI, create a follow-up task to add GitHub Actions workflows before attempting test-dependent work.

---

## Debugging Conventions

When a task involves an error, failure, or unexpected behavior, search memory before investigating fresh. Prior incidents often contain root causes and resolutions that apply directly.

### Memory Search Workflow

1. **Search first.** Before reading code or running commands, query memory for the failure pattern:
   ```
   arc memory search --query "dispatch stall lock" --domain incidents
   arc memory search --query "blog cadence token spike" --domain cost
   arc memory search --query "aibtc api auth" --domain publishing
   ```
2. **Use domain filters.** Always filter by domain when the failure type is known. Unfiltered searches return noise. Domain map:
   - `incidents` — dispatch stalls, broken sensors, retry storms, service crashes
   - `cost` — budget spikes, token anomalies, skill cost outliers
   - `integrations` — API auth, external service outages
   - `infra` — dispatch gate, service restarts, credential issues
   - `publishing` — aibtc.news API patterns, inscription workflow, signal review

3. **Check incidents.md directly** for any failure involving dispatch, locks, or services:
   ```
   arc memory search --query "<error text or symptom>" --domain incidents
   ```

4. **Match before hypothesizing.** If a memory hit directly describes the symptom, apply the documented fix before forming new theories.

5. **Write it down.** After resolving a novel failure, record the root cause and fix:
   ```
   arc memory add --key "incident:<slug>" --domain incidents \
     --content "Symptom: ... Root cause: ... Fix: ..."
   ```

### Common Debug Patterns

| Symptom | First query |
|---------|-------------|
| Dispatch not running | `arc memory search --query "dispatch stall lock" --domain incidents` |
| Sensor skipping unexpectedly | `arc memory search --query "sensor skip claimSensorRun" --domain incidents` |
| Token/cost spike | `arc memory search --query "<skill-name> token spike" --domain cost` |
| Auth failure | `arc memory search --query "auth 401 403" --domain incidents` |
| Repeated task failures | `arc memory search --query "<error keyword>" --domain incidents` |
| External API errors | `arc memory search --query "<service name> outage" --domain integrations` |

---

## GitHub

Loom's GitHub account is being set up — not available yet. If a task requires `git push`, a PR, or `gh` CLI:

- Set `status=blocked` with a clear explanation
- Note what whoabuddy needs to do to unblock it
- Do not create follow-up tasks requesting GitHub credentials

---

## Escalation

- `blocked` status — Task cannot proceed. Set it and explain in `result_summary`.
- Escalate to whoabuddy if: irreversible action, >100 STX spend, uncertain consequences, GitHub operations needed
- Never retry: 403/401/permission denied — fail immediately
- Max 3 retries for transient errors (network, timeouts)
- One escalation per failure type per day — don't spam

### Exhaust Your Own Tools First

Before setting `status=blocked`:

1. **Check your own skills.** Run `arc skills` — the answer is usually already installed.
2. **Does it need sBTC, or just BIP-137?** Free inbox operations (read/reply) use BIP-137 signatures — no sBTC required.
3. **Is this truly irreversible or >100 STX?** If yes → escalate to whoabuddy. If no → proceed autonomously.

---

## Failure Rules

- Never fabricate results. If you cannot complete the task, say so honestly.
- If a tool fails, try once more, then report failure.
- Do not expand scope beyond the given task.
- If you need a capability that doesn't exist, create a follow-up task.
- Fail honestly: an honest failure is more useful than a confident wrong answer.

---

## Dispatch Output Format

Output is free-form for tasks. Prose, structured text, code — whatever is most useful. The dispatch runner stores full output in `tasks.result_detail` and prompts for a one-line `result_summary`.

For creating follow-up tasks during execution, use the CLI:
```
arc tasks add --subject "<subject>" --priority <n> --skills s1,s2 --source "task:<id>"
arc tasks close --id <id> --status completed --summary "<summary>"
```

**Include `--skills` when the follow-up involves a specific skill domain.** Without it, SKILL.md isn't loaded and context is missing. Use `--skills none` when you explicitly want no skill context loaded.

**Priority = model selection.** When creating follow-up tasks, choose priority based on what model tier the work needs:
- **P1-4 (Opus):** New code, architecture decisions, complex debugging, security analysis, strategic reasoning.
- **P5-7 (Sonnet):** Composition (blog posts, briefs), reviews, moderate operational work, signal filing, report generation.
- **P8+ (Haiku):** Simple execution — mark-as-read, config edits, status checks, memory consolidation, simple API calls.

Ask: "Could a junior dev do this?" If yes → P8+. "Does this need careful judgment?" → P5-7. "Does this need senior-level reasoning?" → P1-4.

**Git commits:** The dispatched session is responsible for committing its own work. The dispatch runner has a fallback auto-commit that stages `memory/`, `skills/`, `src/`, and `templates/` after each cycle — but this is a safety net, not the primary path. Commit deliberately during the session. Dispatch never pushes to remote.

---

## Reference

- `SOUL.md` — Identity anchor, never auto-modified
- `memory/MEMORY.md` — Compressed operational memory
- `skills/` — Skill tree (SKILL.md + optional AGENT.md + sensor.ts + cli.ts)
- `src/sensors.ts` — Sensors service entry point
- `src/dispatch.ts` — Dispatch service entry point
- `src/db.ts` — Database initialization and schema
- `src/cli.ts` — CLI entry point (`arc` command)
- `src/services.ts` — Cross-platform service installer (systemd/launchd, generates units dynamically)
- `src/web.ts` — Web dashboard (task list, cycle log, cost tracking). Installed as `arc-web.service`.
- `templates/` — Task templates for recurring or structured work
- `bin/arc` — CLI wrapper (symlinked to ~/.local/bin/arc by installer)
- `src/credentials.ts` — Re-export helper; use `getCredential(service, key)` / `setCredential(service, key, value)` to access the store from other skills
- `skills/credentials/` — Encrypted credential store (AES-256-GCM + scrypt KDF); data stored at `~/.aibtc/credentials.enc`; password from `ARC_CREDS_PASSWORD` env var
