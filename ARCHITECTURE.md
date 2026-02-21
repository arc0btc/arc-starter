# Arc Architecture

The dispatch loop pattern for autonomous agents.

---

## Philosophy

Three principles drive every design decision:

1. **Claude handles intelligence** — use LLM judgment for decisions; use TypeScript for plumbing
2. **Context shapes behavior** — identity, memory, and skill descriptions are the primary levers
3. **Simple over clever** — a boring 200-line loop that runs reliably beats an elegant framework that's hard to debug

---

## The Dispatch Loop

The core pattern is deliberately thin:

```
systemd timer fires
        │
        ▼
loop.ts starts (fresh process)
        │
        ├── init database
        ├── run hooks (fast, no Claude)
        ├── check for pending work
        │
        ├── [empty] → run sensors (check.ts files)
        │              └── sensors queue tasks if conditions found
        │              └── exit (work queued for next cycle)
        │
        ├── [comms] → build prompt → claude --print → parse JSON → mark read
        │
        └── [tasks] → build prompt → claude --print → parse JSON → mark done
                                                               │
                                                               └── next_steps → queue follow-ups
        │
        ▼
loop.ts exits (process ends)
        │
        ▼
systemd timer fires again in 5 minutes
```

That's the whole agent. Everything else is skill implementations and context files.

### The Prompt

Every dispatch call assembles a prompt from:

```
# Identity
[SOUL.md contents]

# Loop Context
[LOOP.md contents]

# Memory
[MEMORY.md contents]

# Task Instructions
[prompts/task.md — generic task execution instructions]

# Skill Agent Context (optional)
[skills/<name>/AGENT.md — skill-specific dispatch context]

# Task to Execute
Subject: [task subject]
Description: [task description]
Priority: [task priority]
Source: [where this task came from]
```

Claude reads this, does the work, and returns structured JSON. The loop parses it and updates the database.

### The Response Format

Tasks return:

```json
{
  "status": "completed",
  "summary": "One sentence: what happened.",
  "actions_taken": ["list", "of", "steps"],
  "next_steps": [
    {
      "title": "Follow-up task title",
      "description": "What needs doing and why",
      "priority": 40
    }
  ]
}
```

The `next_steps` field is how multi-step work chains. Each entry becomes a new task in the database with priority 30 (lower than most work). This is how an agent self-directs without a human queuing every step.

---

## Context Files

These three files load every dispatch cycle:

### SOUL.md — Identity

Who the agent is. Values, voice, relationships, what it cares about. Claude reads this before doing anything else. A well-written SOUL.md produces coherent, on-brand behavior across thousands of cycles without further instruction.

What belongs here:
- Core values and how to apply them
- Voice and tone (with examples)
- What the agent will and won't do
- Key relationships and how to engage them
- Current state and recent history

### LOOP.md — Operation

What the agent does and how. Output format requirements, decision rules, available tools, when to escalate. This is the operational manual.

What belongs here:
- JSON output format (exact schema)
- Decision rules (when to act vs. defer vs. escalate)
- Tool access (what tools are available)
- Skills overview (where capabilities live)
- Memory and what-to-do guide pointers

### MEMORY.md — Accumulated Knowledge

What the agent has learned. Stable patterns, key file paths, architectural decisions, operational discoveries. Claude reads this to avoid relearning the same things every cycle.

What belongs here:
- Environment facts (runtime, database location, service name)
- Key people and relationships
- On-chain identity
- Learned patterns (what works, what doesn't)
- Operational notes (gotchas, known issues)

Keep MEMORY.md concise — it loads every cycle. Daily observations go in `memory/YYYY-MM-DD.md` and get consolidated periodically.

---

## Skills Tree

Capabilities live under `skills/`. Each skill is a directory:

```
skills/
├── README.md              # Map of all capabilities
├── inbox/
│   ├── SKILL.md           # Contract: what this does, how to invoke
│   ├── AGENT.md           # Optional: dispatch context when running this skill
│   ├── check.ts           # Sensor: runs on empty ticks
│   └── send.ts            # Action: sends a reply
└── heartbeat/
    ├── SKILL.md
    └── run.ts             # Hook: runs every cycle without Claude
```

**SKILL.md is the contract.** Claude reads it to understand what the skill does and how to call its scripts. Verbose, descriptive skill names and descriptions matter — they are the context that makes Claude use skills correctly.

**Three skill types:**

| Type | File | When it runs | Uses Claude? |
|------|------|--------------|-------------|
| Hook | `run.ts` (registered in hooks.ts) | Every cycle | No — fast, code-only |
| Sensor | `check.ts` (registered in checks.ts) | Empty ticks | No — detects conditions, queues tasks |
| Action | any `.ts` or `.sh` | When Claude invokes | Yes (Claude decides to run it) |

---

## Database

`bun:sqlite` for all structured data. Two tables in the default schema:

### tasks

```sql
CREATE TABLE tasks (
  task_id INTEGER PRIMARY KEY,
  task_subject TEXT NOT NULL,
  task_description TEXT NOT NULL,
  task_status TEXT DEFAULT 'pending',  -- pending/active/completed/failed
  task_priority INTEGER DEFAULT 50,
  task_source TEXT NOT NULL,           -- where this task came from
  created_at TEXT DEFAULT (datetime()),
  started_at TEXT,
  completed_at TEXT,
  result_summary TEXT,                 -- first 500 chars of Claude's response
  scheduled_for TEXT,                  -- ISO datetime for future scheduling
  cost_usd REAL DEFAULT 0,
  attempt_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3
);
```

### comms

Internal message threading — for communication between Arc and whoabuddy, threaded by `parent_message_id`.

**Key principle:** SQLite is for what *code* queries. Markdown is for what *Claude* reads. Don't try to make Claude query the database directly — give it context in the prompt.

---

## Memory Pattern

Two layers:

**Flat markdown** (`MEMORY.md`, `memory/YYYY-MM-DD.md`) — Claude reads this. Keep concise. Daily files hold observations; MEMORY.md holds consolidated learnings. A consolidate-memory sensor runs periodically to merge daily files.

**SQLite** (`db/arc.sqlite`) — code queries this. Task history, comm history, sensor state, deduplication keys. Claude doesn't read the database directly; the loop extracts relevant context and puts it in the prompt.

---

## Sensor Pattern

Sensors detect conditions and return tasks to queue. They are:

- **Stateless**: each run fetches fresh data
- **Focused**: one sensor, one condition
- **Non-blocking**: run only on empty ticks
- **Conservative**: return null if no action needed

```typescript
// skills/inbox/check.ts
export default async function check(): Promise<CheckResult | null> {
  const unreplied = getUnrepliedMessages();
  if (unreplied.length === 0) return null; // Nothing to do

  const msg = unreplied[0];
  return {
    title: `Reply to message from ${msg.sender}`,
    body: `Full message context: ${msg.content}`,
    source: "inbox:check",
    priority: 50,
  };
}
```

The loop in `src/checks.ts` imports and runs all registered sensors, inserts any returned tasks, and exits. The next cycle picks them up.

---

## Deployment Pattern

**Timer + oneshot service**, not a persistent process.

```ini
# arc-starter.timer
[Timer]
OnActiveSec=60
OnUnitActiveSec=5min

# arc-starter.service
[Service]
Type=oneshot
ExecStart=/home/user/.bun/bin/bun /home/user/arc-starter/src/loop.ts
```

Each invocation is one complete cycle. The process exits cleanly. The timer re-invokes 5 minutes later. No crash recovery needed — the next cycle always starts fresh.

---

## Two Approaches: A Comparison

Arc Starter has evolved through two architectures. The old code in `src/server/`, `src/channels/`, and `src/query-tools/` represents the server-based approach. Understanding the tradeoffs helps you choose what's right for your agent.

### Server-Based (Persistent Process)

```
start server
    │
    ▼
schedule tasks (internal scheduler)
    │
    ▼
run continuously ←──────────────────┐
    ├─ sensor fires every N minutes  │
    ├─ emits event on eventBus       │
    ├─ decision engine reacts        │
    ├─ channel sends notification    │
    └─ loop back ────────────────────┘
```

**Strengths:**
- True real-time responses (Discord messages, webhooks)
- In-memory state shared across tasks
- Sub-second reaction time

**Weaknesses:**
- Process crashes require restart logic
- Memory leaks accumulate over days
- Harder to debug (state not visible between cycles)
- All intelligence must be pre-programmed in TypeScript
- Cannot easily use Claude for decision-making (cost, latency)

**Use when:** You need real-time communication (Discord bot, webhook receiver), or your decisions are deterministic enough to encode in code.

### Dispatch Loop (Stateless Cycles)

```
timer fires
    │
    ▼
fresh process
    │
    ▼
build context + dispatch to Claude
    │
    ▼
parse JSON response
    │
    ▼
update DB, queue follow-ups
    │
    ▼
process exits
```

**Strengths:**
- Claude handles all judgment — no pre-programming required
- Each cycle starts clean (no accumulated state/drift)
- Trivial to debug (read the prompt, read the output)
- Identity and behavior tunable via text files
- Scales to arbitrary task types without code changes

**Weaknesses:**
- Not real-time (5-minute minimum response latency)
- Each cycle has LLM cost (~$0.01-0.05 per dispatch)
- Requires well-written context files to produce good behavior
- No in-memory state between cycles (use database)

**Use when:** Your agent needs judgment, natural language reasoning, or handles diverse task types. This is the right default for most autonomous agents.

### Combining Both

The approaches are not mutually exclusive. The AIBTC sensors in `src/sensors/` (server-based pattern) can be adapted to:

1. Run as hooks (every cycle, fast, no Claude)
2. Run as sensors (empty ticks, detect conditions, queue tasks)
3. Keep as server channels if real-time communication is needed

A production agent might use the dispatch loop for all intelligence work and add a small always-running server for webhooks and real-time notifications.

---

## Error Handling

**Tasks:** Automatic retry up to `max_retries` (default: 3). After exhausting retries, the task is marked `failed` with the error in `result_summary`.

**Crash recovery:** On startup, the loop checks for any tasks left in `active` state from a previous cycle (indicates a crash) and marks them `failed`. Clean slate every cycle.

**Escalation:** Claude can return `status: "partial"` with an explanation when a task requires human judgment or has irreversible consequences. The loop stores this and the task is not retried — whoabuddy reviews it.

---

## Security Patterns

**Secrets:** Store in a `.arc-secrets` file (loaded as `EnvironmentFile` in the service). Never commit. Access via `process.env.MY_SECRET`.

**Least privilege:** The systemd service uses `ProtectSystem=strict` + `ReadWritePaths` to limit what the process can access.

**Validation:** All external data (API responses, webhook payloads) should be validated before trusting.

**Signing:** Authenticated actions (heartbeat posts, on-chain transactions) require cryptographic signing. Use `@stacks/transactions` or `@aibtc/mcp-server` for Stacks signing.

---

## Testing

Test the parts that don't involve Claude:

- **Sensors:** Does `check()` return null when there's no work? Does it return the right structure when there is?
- **Database helpers:** Do queries return the right data?
- **Utility functions:** Do transformations produce correct output?

Don't try to unit-test the dispatch loop or mock Claude — integration test by running `bun src/loop.ts` with a known task queued.

```bash
bun test                    # Run all tests
bun test src/__tests__/     # Run specific test directory
```

---

## Next: Read SOUL.md

This doc explained **how** the architecture works. [SOUL.md](./SOUL.md) explains **why** — the identity, values, and purpose that guide your agent's behavior. Start there before writing a line of code.
