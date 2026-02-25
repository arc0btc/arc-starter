# Phases

## Phase 1: Initialize project and write architecture doc
Goal: Create the project skeleton (package.json, tsconfig.json, directory structure, git init) and write CLAUDE.md -- the architecture document that replaces both ARCHITECTURE.md and LOOP.md from v4. This is the foundation every subsequent phase builds on.
Status: completed
Dependencies: none

### Details

**What gets created:**
- `package.json` with name `arc-agent`, Bun runtime, `bin` entry for `arc` CLI
- `tsconfig.json` targeting Bun with strict mode
- Directory structure: `src/`, `skills/`, `templates/`, `memory/`, `db/`, `systemd/`
- `CLAUDE.md` -- project instructions covering architecture, conventions, skill pattern, dispatch model, context budget, and the full schema DDL (two tables: tasks, cycle_log)
- `SOUL.md` -- copied from v4 with "Current State" section updated for v5 launch
- `memory/MEMORY.md` -- empty initial memory file
- `.gitignore` for `node_modules/`, `db/*.sqlite`, `db/*.sqlite-*`, `db/dispatch-lock.json`, `db/hook-state/`
- Initial git commit

**CLAUDE.md must cover:**
- What arc-agent is (one paragraph)
- Architecture: tasks table as the universal queue, priority-based dispatch, skills as context loaders
- Two services: sensors (no LLM, parallel, 1-5 min timer) and dispatch (LLM, lock-gated, up to 60 min)
- Skills pattern: SKILL.md (orchestrator), AGENT.md (subagent), sensor.ts (auto-run), cli.ts (CLI commands)
- Task templates and the `skills` JSON array field
- CLI as primary interface: `arc status`, `arc tasks`, `arc skills`, `arc run`
- Full SQL schema (tasks, cycle_log) — memory lives in MEMORY.md, versioned by git
- Conventions: conventional commits, verbose DB column naming, Bun runtime
- Context budget: 40-50k tokens per dispatch
- **CLI-first principle:** Arc operates through its own CLI. If a capability doesn't have a CLI command, create the skill first. The CLI is the tool boundary — every action Arc can take must be expressible as an `arc` command. This enforces that all capabilities are discoverable (`arc skills`), testable by humans, and properly structured as skills. When Arc needs something new, it uses `arc skills run manage-skills create` before doing the work. The CLI is also the stable interface for future API dispatch — the same commands become tool definitions.
- **Dual cost tracking:** Every dispatch records both `cost_usd` (actual Claude Code consumption cost from stream-json result) and `api_cost_usd` (estimated API cost calculated from tokens × per-token rate). This provides ongoing comparison data regardless of which transport is active.

**Verification:**
- `bun --version` runs
- `git log --oneline` shows initial commit
- `cat CLAUDE.md` contains the schema DDL
- Directory structure matches target layout

---

## Phase 2: Build database layer
Goal: Implement `src/db.ts` with the complete schema (tasks, memory_versions, cycle_log) and all query/mutation functions. This is the data foundation everything depends on.
Status: completed
Dependencies: Phase 1

### Details

**Schema (exact DDL):**

```sql
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  subject TEXT NOT NULL,
  description TEXT,
  skills TEXT,              -- JSON array: ["manage-skills", "stacks-js"]
  priority INTEGER DEFAULT 5,
  status TEXT DEFAULT 'pending',  -- pending|active|completed|failed|blocked
  source TEXT,              -- "human", "sensor:heartbeat", "task:42"
  parent_id INTEGER,        -- task chaining
  template TEXT,            -- template name if from template
  scheduled_for TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  result_summary TEXT,
  result_detail TEXT,
  cost_usd REAL DEFAULT 0,        -- actual cost (Claude Code consumption)
  api_cost_usd REAL DEFAULT 0,    -- estimated API cost (tokens × rate)
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
  cost_usd REAL DEFAULT 0,        -- actual cost (Claude Code consumption)
  api_cost_usd REAL DEFAULT 0,    -- estimated API cost (tokens × rate)
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  skills_loaded TEXT,       -- JSON array of skill names loaded for this cycle
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

Memory lives in `memory/MEMORY.md`, versioned by git history. No memory table needed.

**Required functions (exported):**

Database lifecycle:
- `initDatabase(): Database` -- singleton, creates tables, sets WAL mode
- `getDatabase(): Database` -- returns singleton or throws

Task queries:
- `getPendingTasks(): Task[]` -- status='pending', respects scheduled_for, ordered by priority DESC
- `getActiveTasks(): Task[]` -- status='active'
- `getTaskById(id: number): Task | null`
- `getTasksByParent(parentId: number): Task[]` -- for task chains
- `taskExistsForSource(source: string): boolean` -- dedup gate

Task mutations:
- `insertTask(fields: InsertTask): number` -- returns id. InsertTask has subject (required), all else optional
- `markTaskActive(id: number): void` -- sets status='active', started_at, increments attempt_count
- `markTaskCompleted(id: number, summary: string, detail?: string): void`
- `markTaskFailed(id: number, summary: string): void`
- `markTaskBlocked(id: number, reason: string): void`
- `requeueTask(id: number): void` -- back to pending
- `updateTaskCost(id: number, cost: number, apiCost: number, tokensIn: number, tokensOut: number): void` -- records both actual and estimated API cost

Cycle log:
- `insertCycleLog(entry: InsertCycleLog): number`
- `updateCycleLog(id: number, fields: Partial<CycleLog>): void`
- `getRecentCycles(limit?: number): CycleLog[]` -- default 10

**Types (exported):**
- `Task`, `InsertTask`, `CycleLog`, `InsertCycleLog`

**Patterns from v4 to follow:**
- Singleton `_db` pattern (see v4 `src/db.ts` line 124-128)
- `PRAGMA journal_mode = WAL`
- `toSqliteDatetime()` for consistent timestamp formatting
- Dedup gate: `taskExistsForSource()` checks any status, not just pending

**Verification:**
- `bun src/db.ts` runs smoke test: init, insert task, query it back, insert cycle log
- Smoke test is gated by `if (import.meta.main)` -- does not insert into production DB when imported
- `ls db/arc.sqlite` exists after smoke test

---

## Phase 3: Build CLI with status and task commands
Goal: Implement `src/cli.ts` as the `arc` command entry point with `status`, `tasks`, and `run` (placeholder) subcommands. This is the primary interface for both humans and Arc.
Status: completed
Dependencies: Phase 2

### Details

**Entry point:** `src/cli.ts` -- invoked as `bun src/cli.ts <command>` or via package.json bin as `arc <command>`.

**Commands to implement:**

`arc status`
- Shows: pending task count, active task count, last cycle timestamp + duration, total cost (today), sensor state summary
- Reads from: tasks table, cycle_log table
- Format: compact terminal output, no colors (pipe-friendly)

`arc tasks [--status STATUS] [--limit N]`
- Lists tasks filtered by status (default: pending + active)
- Columns: id, priority, status, subject, source, created_at
- `--limit` defaults to 20
- When no tasks: prints "No tasks found."

`arc tasks add "subject" [--description TEXT] [--priority N] [--source TEXT] [--skills SKILL1,SKILL2] [--parent ID]`
- Creates a task via insertTask()
- Prints: "Created task #N: subject"

`arc tasks close ID completed|failed "summary"`
- Closes a task with status and summary
- Prints: "Closed task #N as STATUS"

`arc run`
- Placeholder that prints: "Dispatch not yet implemented. See Phase 5."
- Will be wired to dispatch.ts in Phase 5

`arc skills`
- Placeholder that prints: "Skills not yet implemented. See Phase 4."
- Will be wired to skill discovery in Phase 4

**Implementation pattern:**
- Parse `process.argv` manually (no arg-parsing library). v4 used simple positional parsing; follow that pattern.
- Each command is a function. `main()` dispatches based on argv[2].
- Unknown command prints usage help.
- All output goes to stdout. Errors to stderr with non-zero exit.

**package.json bin entry:**
```json
{ "bin": { "arc": "src/cli.ts" } }
```

**Verification:**
- `bun src/cli.ts status` -- prints status summary (zeros initially)
- `bun src/cli.ts tasks` -- prints "No tasks found."
- `bun src/cli.ts tasks add "Test task" --priority 8` -- creates task, shows ID
- `bun src/cli.ts tasks` -- shows the test task
- `bun src/cli.ts tasks close 1 completed "Done"` -- closes it
- `bun src/cli.ts run` -- prints placeholder message
- `bun src/cli.ts help` -- prints usage

---

## Phase 4: Build manage-skills skill and skill discovery
Goal: Create the manage-skills skill (SKILL.md, AGENT.md, cli.ts) and implement skill discovery in the CLI. This establishes the skill pattern that all future skills follow.
Status: completed
Dependencies: Phase 3

### Details

**Skill discovery logic (add to src/cli.ts or src/skills.ts):**

```typescript
// Discover skills by scanning skills/*/SKILL.md
function discoverSkills(): SkillInfo[] {
  // Read skills/ directory
  // For each subdirectory with SKILL.md, parse frontmatter (name, description, tags)
  // Return array of { name, description, path, hasSensor, hasCli, hasAgent }
}
```

A skill directory is valid if it contains `SKILL.md`. Optional files: `AGENT.md`, `sensor.ts`, `cli.ts`.

**`arc skills` command (replace placeholder):**
- Lists all discovered skills
- Columns: name, description, has sensor, has cli
- Format: compact table

**`arc skills show <name>` command:**
- Prints the full SKILL.md content for a skill
- Errors if skill not found

**manage-skills/SKILL.md:**
```markdown
---
name: manage-skills
description: Create, modify, and organize skills
tags: [meta, skills]
---

# Skill: Manage Skills

Arc's self-extension capability. Use this skill to create new skills,
update existing ones, and maintain the skill tree.

## What Skills Are

Skills are knowledge containers that load context into dispatch.
Each skill lives in `skills/<name>/` and contains:

- `SKILL.md` (required) -- Orchestrator context. Loaded into dispatch
  when a task lists this skill. Keep under 2000 tokens.
- `AGENT.md` (optional) -- Subagent briefing. Passed to subagents
  via Task tool. Never loaded into orchestrator context.
- `sensor.ts` (optional) -- Auto-run check. Discovered by sensors
  runner, gated by shouldRun(). Creates tasks when conditions met.
- `cli.ts` (optional) -- CLI commands. Discovered by `arc skills run`.

## Creating a New Skill

1. Create directory: `skills/<name>/`
2. Write SKILL.md with frontmatter (name, description, tags)
3. Include a Checklist section (see below)
4. Optionally add AGENT.md, sensor.ts, cli.ts
5. Verify: `arc skills` shows the new skill

## Checklist

Every SKILL.md must include a `## Checklist` section. This is how
dispatch verifies its own work. Items should be concrete and testable.

- [ ] New skill directory exists with SKILL.md
- [ ] SKILL.md has valid frontmatter (name, description, tags)
- [ ] SKILL.md is under 2000 tokens
- [ ] Checklist section is present in SKILL.md
- [ ] `arc skills` lists the new skill

## CLI

```
arc skills run manage-skills create <name> [--description TEXT]
arc skills run manage-skills list
arc skills run manage-skills show <name>
```

## Context

When loaded into dispatch, this SKILL.md provides the patterns
for creating well-structured skills. The key constraint: SKILL.md
must stay under 2000 tokens to preserve context budget.
```

**manage-skills/AGENT.md:**
Brief instructions for a subagent that creates/modifies skills. Should cover:
- The 4-file pattern (SKILL.md required, rest optional)
- Frontmatter format (name, description, tags)
- SKILL.md token limit (2000 tokens)
- Checklist section requirement (concrete, testable items for dispatch self-verification)
- sensor.ts pattern (export default, shouldRun gate, create tasks)
- cli.ts pattern (process.argv parsing, standalone execution)

**manage-skills/cli.ts:**
- `create <name>` -- scaffolds a new skill directory with template SKILL.md
- `list` -- delegates to arc skills (or prints discovered skills directly)
- `show <name>` -- prints SKILL.md content

**`arc skills run <skill> [args]` command:**
- Discovers skill, checks for cli.ts
- Runs: `bun skills/<skill>/cli.ts [args]`
- Passes through exit code and output

**Verification:**
- `bun src/cli.ts skills` -- lists manage-skills
- `bun src/cli.ts skills show manage-skills` -- prints SKILL.md
- `bun src/cli.ts skills run manage-skills create test-skill --description "A test"` -- creates skills/test-skill/SKILL.md
- `bun src/cli.ts skills` -- now lists both manage-skills and test-skill
- Clean up: `rm -rf skills/test-skill`

---

## Phase 5: Build dispatch engine
Goal: Implement `src/dispatch.ts` -- the core dispatch loop that picks a task, resolves skill context, builds a prompt, calls `claude` via stream-JSON, and records results. This is the most complex piece.
Status: completed
Dependencies: Phase 4

### Details

**Dispatch flow (single cycle):**

1. **Lock check.** Read `db/dispatch-lock.json`. If locked and PID alive, exit. If locked and PID dead, clear stale lock.
2. **Crash recovery.** Query active tasks. Mark any stale active tasks as failed (same pattern as v4 `dispatch-runner.ts` lines 693-704).
3. **Pick task.** Query pending tasks ordered by priority DESC. First task wins. If none, log idle and exit.
4. **Resolve skills.** Parse task's `skills` JSON array. For each skill name, read `skills/<name>/SKILL.md`. Concatenate into skills context block.
5. **Build prompt.** Assemble context sections:
   - Current time (UTC + MST)
   - SOUL.md (identity)
   - MEMORY.md (compressed memory)
   - Recent cycles (last 10 from cycle_log)
   - Skills context (from step 4)
   - Task details (subject, description, priority, source, parent chain)
6. **Mark task active.** Call `markTaskActive()`.
7. **Write dispatch lock.** PID + task_id + timestamp.
8. **Spawn claude.** Flags: `claude --print --verbose --model opus --output-format stream-json --include-partial-messages --no-session-persistence --setting-sources project,local`. If `DANGEROUS=true` env var is set, add `--dangerously-skip-permissions`. Stdin = prompt.
9. **Parse stream-JSON.** Line-buffered parsing. Accumulate text deltas. Extract cost/tokens from result message. Same processLine pattern as v4 `dispatch-runner.ts` lines 274-342.
10. **Record results.** Check if task was self-closed by LLM (status no longer active). If still active, fallback close as completed. Update cost. Log cycle.
11. **Clear lock.** Remove dispatch-lock.json.
12. **Auto-commit.** Stage modified tracked files only (respects .gitignore). Explicit include list: `memory/`, `skills/`, `src/`, `templates/`. Never stage `.env`, `db/*.sqlite`, credentials, or untracked files outside the include list. Commit if changes exist.

**Retry logic (from v4):**
- On dispatch failure: if attempt_count < max_retries, requeue. Otherwise mark failed.
- Never retry 403/401 -- mark failed immediately.

**Wire into CLI:**
- Replace `arc run` placeholder with actual dispatch call
- `arc run` calls `runDispatch()` once and exits

**Key files to reference from v4:**
- `~/arc0btc/src/dispatch-runner.ts` lines 238-367 (dispatch function with stream-JSON parsing)
- `~/arc0btc/src/dispatch-runner.ts` lines 577-609 (dispatch lock)
- `~/arc0btc/src/dispatch-runner.ts` lines 613-669 (auto-commit)
- `~/arc0btc/src/dispatch-runner.ts` lines 679-770 (runDispatch entry point)

**What is different from v4:**
- No round-robin. Just pick highest priority pending task.
- No comm processing. Messages are tasks.
- No quest detection. Task chains via parent_id.
- One prompt builder (not separate buildCommPrompt / buildTaskPrompt).
- Skills resolved from task's `skills` field, not from source prefix.

**Dual cost tracking:**
- After dispatch, extract `total_cost_usd` from stream-json result → `cost_usd` (actual)
- Always calculate from tokens: `api_cost_usd = (tokens_in / 1M × 15) + (tokens_out / 1M × 75)` (Opus rates)
- Record both on the task AND the cycle_log entry
- `arc status` should show both: "Cost today: $X (actual) / $Y (API estimate)"

**CLI-first enforcement in prompt:**
- The dispatch prompt must instruct Arc to use `arc` CLI commands for all actions:
  - Close tasks: `arc tasks close ID completed "summary"`
  - Create follow-up tasks: `arc tasks add "subject" --skills skill1,skill2 --parent ID`
  - Create new skills: `arc skills run manage-skills create <name>`
  - Update memory: edit `memory/MEMORY.md` directly
- Arc should NOT use raw SQL, direct DB writes, or ad-hoc scripts
- If Arc needs a capability that doesn't exist in the CLI, the task output should note this and a follow-up task should be created to build the skill first

**Verification:**
- `bun src/cli.ts tasks add "Say hello" --description "Respond with a greeting"` -- create test task
- `bun src/cli.ts run` -- dispatches the task (requires claude CLI installed)
- `bun src/cli.ts tasks --status completed` -- shows the completed task with cost
- `bun src/cli.ts status` -- shows cycle count = 1, cost > 0
- `ls db/dispatch-lock.json` -- should not exist (lock was cleared)
- `cat db/arc.sqlite` is non-empty (cycle_log has an entry)

---

## Phase 6: Build sensors runner
Goal: Implement `src/sensors.ts` -- discovers and runs all `skills/*/sensor.ts` files in parallel with shouldRun gating. Create a heartbeat sensor as the first concrete sensor.
Status: completed
Dependencies: Phase 5

### Details

**Sensors runner (`src/sensors.ts`):**

```typescript
// Discover all skills/*/sensor.ts files
// Run them all in parallel via Promise.allSettled()
// Each sensor is responsible for its own shouldRun() gating
// Log results: name, ok/error, duration
export async function runSensors(): Promise<void>
```

**Key differences from v4 hooks:**
- No groups (sync/sensor/meta). All sensors run in parallel.
- No hook-helpers.ts complexity. Sensors are simpler: check condition, maybe create task.
- shouldRun pattern stays the same (from v4 `src/hook-state.ts`).

**Implement shouldRun infrastructure:**
- Port `src/hook-state.ts` from v4 (readHookState, writeHookState, shouldRun)
- Same flat JSON files in `db/hook-state/`
- Same HookState interface (last_ran, last_result, version, consecutive_failures)

**Create heartbeat sensor (`skills/heartbeat/sensor.ts`):**
- Simple sensor that creates a "system alive" task every 6 hours
- Uses shouldRun() with 6-hour interval
- Creates task with source `sensor:heartbeat`, priority 1 (lowest)
- Dedup: checks taskExistsForSource before creating
- This validates the full sensor pattern without requiring external APIs

**Create heartbeat SKILL.md:**
- Minimal SKILL.md with frontmatter
- Documents the heartbeat sensor and its cadence

**Wire into CLI:**
- `arc sensors` -- runs all sensors once and exits
- `arc sensors list` -- lists discovered sensors (skills with sensor.ts)

**Verification:**
- `bun src/cli.ts sensors list` -- shows heartbeat sensor
- `bun src/cli.ts sensors` -- runs sensors, heartbeat creates a task
- `bun src/cli.ts tasks` -- shows the heartbeat task
- `bun src/cli.ts sensors` -- run again immediately, heartbeat skips (shouldRun returns false)
- `ls db/hook-state/heartbeat.json` -- exists with last_ran timestamp

---

## Phase 7: Build systemd services and end-to-end verification
Goal: Create systemd service+timer units for sensors and dispatch. Add a health sensor. Verify the complete system works end-to-end: sensors create tasks, dispatch executes them, costs are tracked, auto-commit works.
Status: pending
Dependencies: Phase 6

### Details

**Systemd units (in systemd/ directory):**

`arc-sensors.service`:
- Type=oneshot
- ExecStart=bun src/sensors.ts (or src/cli.ts sensors)
- WorkingDirectory=~/dev/arc0btc/arc-agent
- Environment: PATH, HOME, DANGEROUS (if set)

`arc-sensors.timer`:
- OnBootSec=1min
- OnUnitActiveSec=1min (sensors fire every 1 minute, shouldRun gates cadence)

`arc-dispatch.service`:
- Type=oneshot
- ExecStart=bun src/dispatch.ts (or src/cli.ts run)
- WorkingDirectory=~/dev/arc0btc/arc-agent
- Environment: PATH, HOME, DANGEROUS (if set)
- TimeoutStopSec=3600 (dispatch can run up to 60 min)

`arc-dispatch.timer`:
- OnBootSec=2min
- OnUnitActiveSec=1min

**Install script (`scripts/install-services.sh`):**
- Symlinks units to ~/.config/systemd/user/
- Runs systemctl --user daemon-reload
- Enables and starts both timers
- Prints status

**Make src/sensors.ts and src/dispatch.ts runnable as standalone entry points:**
- `src/sensors.ts`: if import.meta.main, call initDatabase() then runSensors()
- `src/dispatch.ts`: if import.meta.main, call initDatabase() then runDispatch()
- Both include preflight checks (critical files exist, git branch check)

**Create health sensor (`skills/health/sensor.ts`):**
- Checks last cycle age from cycle_log — if >30 min and tasks are pending, creates alert task
- Checks dispatch lock staleness (PID dead but lock exists)
- Uses shouldRun() with 5-minute interval
- Creates task with source `sensor:health`, priority 9 (high)
- Dedup: checks taskExistsForSource before creating
- Foundation for future web UI status endpoint

**Create health SKILL.md:**
- Documents health checks, alert conditions, and thresholds
- When loaded into dispatch, provides context for investigating health issues

**End-to-end verification sequence:**
1. `arc status` -- clean state
2. `arc skills` -- shows manage-skills, heartbeat, health
3. `arc sensors` -- heartbeat and health sensors run
4. `arc tasks` -- shows heartbeat task (priority 1)
5. `arc tasks add "Test dispatch" --priority 8 --description "Say hello and close yourself"` -- human task
6. `DANGEROUS=true arc run` -- dispatches the priority-8 task (skips heartbeat due to lower priority)
7. `arc status` -- shows 1 cycle, cost > 0
8. `arc tasks --status completed` -- shows the completed task
9. `git log --oneline -3` -- shows auto-commit from dispatch cycle
10. Systemd: `bash scripts/install-services.sh` -- installs services
11. `systemctl --user status arc-sensors.timer arc-dispatch.timer` -- both active
