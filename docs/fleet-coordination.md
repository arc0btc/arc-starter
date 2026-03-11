# Fleet Coordination Reference

Consolidated reference for fleet-wide task orchestration and coordination patterns. These are utility CLIs for managing distributed work across Arc's agent fleet.

---

## fleet-broadcast — Parallel Task Broadcasting

Broadcasts a task to all fleet agents (or a subset) in parallel via SSH. Each agent receives the task in their local queue. Uses `Promise.allSettled()` so one agent's failure never blocks others.

### CLI Commands

```bash
arc skills run --name fleet-broadcast -- send \
  --subject "text" [--priority <n>] [--skills s1,s2] [--description "text"] [--agents spark,iris]

arc skills run --name fleet-broadcast -- status --subject "text" [--agents spark,iris]
```

### Commands

- **send**: Create a task on every target agent simultaneously. Defaults to all 4 agents. Reports per-agent success/failure with created task IDs.
- **status**: Check if a previously broadcast task exists on each agent by subject substring match. Shows task ID, status, and summary per agent.

### Options

- `--subject` — Task subject (required for send)
- `--priority` — Priority 1-10 (default: 5)
- `--skills` — Comma-separated skill names
- `--description` — Task description
- `--agents` — Comma-separated agent names or "all" (default: all)
- `--source` — Source tag (default: `fleet:arc:broadcast`)

### Agents

spark (192.168.1.12), iris (192.168.1.13), loom (192.168.1.14), forge (192.168.1.15)

---

## fleet-collect — Distributed Task Result Aggregation

Query all fleet agents for completed tasks matching a topic keyword. Collects result summaries and details in parallel, outputs a consolidated report. Useful for gathering distributed work products after a broadcast or domain-specific delegation.

### CLI Commands

```bash
arc skills run --name fleet-collect -- search --topic <keyword> [--agents spark,iris] [--limit 5] [--status completed]
arc skills run --name fleet-collect -- detail --topic <keyword> [--agents spark,iris] [--limit 3]
```

### Commands

- **search**: Find tasks matching a topic across agents. Shows id, status, priority, subject, and result_summary. Default: completed tasks, limit 5 per agent.
- **detail**: Like search but includes result_detail (full output). Default limit 3 per agent to keep output manageable.

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--topic` | Keyword to match in task subject (required) | — |
| `--agents` | Comma-separated agent list | all |
| `--limit` | Max results per agent | 5 (search), 3 (detail) |
| `--status` | Filter by task status | completed |

### Output

Grouped by agent. Each section shows matching tasks with summaries. Agents queried in parallel via Promise.allSettled().

---

## fleet-consensus — High-Impact Decision Voting

Formal voting protocol for high-impact fleet decisions. Arc orchestrates: creates a proposal, fans out to each agent's HTTP API, collects votes, and resolves when quorum (default 3-of-5) is reached or deadline expires.

### When to Use

Use consensus for decisions that are **irreversible or high-impact**: spending >50 STX, deploying to production, architectural changes, adding/removing agents, security policy changes. Do NOT use for routine operational tasks.

### How It Works

1. **Propose** — Creates a `consensus_proposals` row. Fans out `POST /api/consensus/vote` to each fleet agent with the proposal details.
2. **Vote** — Each agent receives a task, evaluates the proposal, and votes (approve/reject/abstain) with reasoning. Posts vote back via CLI.
3. **Finalize** — Checks vote tally against threshold. If ≥threshold approve → `approved`. If >total-threshold reject → `rejected`. If deadline passed → `expired`.

### DB Tables

- `consensus_proposals` — id, topic, description, action_payload, threshold, total_voters, status (open/approved/rejected/expired), proposed_by, created_at, resolved_at, expires_at
- `consensus_votes` — id, proposal_id, agent_name, vote (approve/reject/abstain), reasoning, voted_at

### CLI Commands

```bash
arc skills run --name fleet-consensus -- propose --topic "Topic" --description "Details" --action "action payload" [--threshold 3] [--expires-in 60]
arc skills run --name fleet-consensus -- vote --id N --vote approve|reject|abstain [--reason "Why"]
arc skills run --name fleet-consensus -- status --id N
arc skills run --name fleet-consensus -- finalize --id N
arc skills run --name fleet-consensus -- list [--status open]
```

### Web Endpoint

`POST /api/consensus/vote` — Accepts `{ proposal_id, topic, description }`. Creates a task for the local agent to evaluate and vote.

---

## fleet-deploy — Canary Deployment Pipeline

Orchestrates safe fleet-wide code deployments using a canary pattern. Syncs code via git bundles (no GitHub dependency), validates on a single agent before rolling out to the rest.

### Pipeline Stages

1. **Pre-flight** — Verify local commit is clean, check fleet connectivity
2. **Canary** — Sync code to canary agent (default: forge), restart services, run health checks
3. **Validate** — Wait for canary to complete a dispatch cycle, verify services stayed healthy
4. **Rollout** — Sync remaining agents in parallel, restart services, verify health
5. **Report** — Summary of deployment status across fleet

### CLI Commands

```bash
arc skills run --name fleet-deploy -- pipeline [--canary forge] [--skip-agents spark]
arc skills run --name fleet-deploy -- canary --agent forge
arc skills run --name fleet-deploy -- rollout [--skip-agents spark]
arc skills run --name fleet-deploy -- status
```

### Options

- `--canary <agent>` — Agent to use as canary (default: forge)
- `--skip-agents <a,b>` — Comma-separated agents to skip during rollout
- `--no-restart` — Sync code without restarting services

---

## fleet-email-report — Fleet Status Email Reports

Generates and sends formatted email reports about fleet status. Pulls data from local DB (`cycle_log`, `tasks`), `memory/fleet-status.json`, and peer agents via SSH. Replaces ad-hoc email tasks with a reusable, repeatable command.

### Report Contents

- **Agent health table** — service status, last dispatch age, disk usage per agent
- **Task throughput** — tasks created/completed/failed today, pending queue
- **Cost summary** — today's spend per agent and total fleet cost
- **Active alerts** — blocked tasks, failing agents, cost warnings

### CLI Commands

```bash
# Send a fleet status report
arc skills run --name fleet-email-report -- send --to whoabuddy@gmail.com --type status

# Preview the report body without sending
arc skills run --name fleet-email-report -- preview --type status
```

### Supported Report Types

| Type   | Description                           |
|--------|---------------------------------------|
| status | Full fleet health + throughput + cost |

### Credentials Required

- `arc-email-sync/api_base_url` — Email Worker API endpoint
- `arc-email-sync/admin_api_key` — Authentication key
- `vm-fleet/ssh-password` — SSH password for peer agents (optional — peers skipped if missing)

### Data Sources

- Local SQLite `cycle_log` — recent cycles, costs, token usage
- Local SQLite `tasks` — today's task counts by status
- `memory/fleet-status.json` — self-reported agent status
- SSH to peer agents `memory/fleet-status.json` — peer self-reports (best-effort)

---

## fleet-exec — Parallel SSH Command Execution

Run commands across the agent fleet in parallel via SSH. Built on `src/ssh.ts` shared utilities. Uses `Promise.allSettled()` — one agent failure never blocks others.

### CLI Commands

```bash
arc skills run --name fleet-exec -- run --command "CMD" [--agents spark,iris]
arc skills run --name fleet-exec -- pull [--agents spark,iris]
arc skills run --name fleet-exec -- restart [--agents spark,iris]
arc skills run --name fleet-exec -- status [--agents spark,iris]
```

### Subcommands

| Command | What it does |
|---------|-------------|
| `run --command CMD` | Execute arbitrary shell command on each agent VM |
| `pull` | `git pull --ff-only` + `bun install` in arc-starter |
| `restart` | Restart sensor + dispatch systemd timers |
| `status` | Run `arc status` on each agent |

### Options

- `--agents spark,iris` — Comma-separated agent list (default: all)
- `--command "CMD"` — Shell command for `run` subcommand

### Credentials

Uses `vm-fleet/ssh-password` from credential store (same as arc-remote-setup).

---

## fleet-handoff — Task Continuity Protocol

Transfer partially complete tasks from one agent to another with structured context about work done, work remaining, and relevant files. Ensures continuity when an agent is overloaded, blocked, or lacks a required capability.

### Protocol

A handoff packages three things:

1. **Progress context** — What's been done so far (completed steps, findings, partial results)
2. **Remaining work** — What still needs to happen (explicit checklist)
3. **Artifact references** — Files changed, branches created, external state touched

The receiving agent gets a new task with a structured description containing all three sections. The sending agent's task is closed with status `completed` and summary linking to the handoff.

### When to Handoff

- Agent is overloaded (load score > soft cap)
- Task requires a skill/domain owned by another agent
- Agent is blocked on infrastructure only another agent can access
- Task partially done but remaining work maps to a different agent's specialty
- Budget pressure — shift remaining work to a cheaper-tier agent

### CLI Commands

```bash
arc skills run --name fleet-handoff -- initiate \
  --agent <target> \
  --task-id <local-task-id> \
  --progress "What has been completed so far" \
  --remaining "What still needs to be done" \
  [--artifacts "file1.ts, file2.ts, branch:feature-x"] \
  [--priority <n>] \
  [--skills s1,s2] \
  [--reason "Why handing off"]

arc skills run --name fleet-handoff -- status --id <handoff-id>

arc skills run --name fleet-handoff -- list [--limit <n>]
```

### Handoff Description Format

The remote task description follows this template:

```
[HANDOFF from <source-agent> task #<id>]

## Progress (completed)
<what was done>

## Remaining (TODO)
<what needs to happen next>

## Artifacts
<files, branches, external state>

## Reason
<why this was handed off>

## Original task
Subject: <original subject>
Priority: <original priority>
Skills: <original skills>
```

### State Tracking

Handoffs are tracked in `memory/fleet-handoffs.json`:
```json
[{
  "id": 1,
  "source_agent": "arc",
  "target_agent": "spark",
  "local_task_id": 42,
  "remote_task_id": 105,
  "subject": "...",
  "reason": "domain mismatch",
  "handed_off_at": "2026-03-09T12:00:00Z",
  "status": "handed-off"
}]
```

### Composability

- Uses `fleet-task-sync` SSH patterns for remote task creation
- Integrates with `fleet-router` domain rules for suggesting handoff targets
- Handoff source tracking: `source: "handoff:<agent>:<task-id>"`

---

## fleet-task-sync — Remote Task Management

Orchestrate work across the agent fleet by sending tasks, checking status, and recalling results from remote agents via SSH.

### CLI Commands

```bash
arc skills run --name fleet-task-sync -- send --agent <name> --subject "text" [--priority <n>] [--skills s1,s2] [--description "text"]
arc skills run --name fleet-task-sync -- check --agent <name> --id <n>
arc skills run --name fleet-task-sync -- recall --agent <name> --id <n>
```

### Commands

- **send**: SSH into agent VM, run `bash bin/arc tasks add` with given subject/priority/skills. Returns the created task ID.
- **check**: Query a specific task's status and subject on the remote agent.
- **recall**: Pull `result_summary` and `result_detail` from a completed task on the remote agent.

### Agent Names

Same as `arc-remote-setup`: spark, iris, loom, forge.

### Credentials

Uses `vm-fleet` / `ssh-password` (same as arc-remote-setup).
