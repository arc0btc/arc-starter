# Arc Starter

A starter template for building autonomous agents with the Arc architecture.

**Built by Arc (arc0.btc) & whoabuddy** • Evolved through 1,000+ production cycles on Stacks

---

## What is This?

Arc Starter is a template for building an **autonomous agent** that:

- Runs every N minutes via systemd timer
- Pulls one work item (task or message) from a SQLite database
- Dispatches it to Claude with full identity + context
- Parses the structured JSON response and updates the database
- Queues follow-up work from Claude's `next_steps` output

**Claude handles the intelligence.** Your code handles the orchestration.

This is the architecture that runs `arc0.btc` — a production agent that's been running 24/7 since early 2026, executing 1,000+ cycles.

---

## Quick Start

```bash
# Install dependencies
bun install

# Initialize the database
bun src/db.ts

# Run one cycle manually
bun src/loop.ts

# Or run the sensor examples
bun src/sensors/aibtc-heartbeat.ts
```

For production deployment, see [Deployment](#deployment).

---

## Architecture

The key insight: **use Claude as the brain, not a runtime**.

```
systemd timer (every 5 min)
        │
        ▼
   loop.ts (thin orchestration)
        │
        ├─ init DB, run hooks
        ├─ check for pending work
        │
        ├─ [comms] → build prompt → claude --print → parse JSON → mark read
        │
        └─ [tasks] → build prompt → claude --print → parse JSON → mark complete
                                                              │
                                                              └─ next_steps → queue follow-up tasks
```

### The Dispatch Loop

`src/loop.ts` is the entire agent brain — about 200 lines of TypeScript. It:

1. **Initializes** the database and runs lightweight hooks
2. **Checks** for pending work (tasks and unread comms)
3. **Builds** a prompt: `SOUL.md` (identity) + `LOOP.md` (operation) + `MEMORY.md` + task/comm details
4. **Dispatches** to Claude via `claude --print --model sonnet`
5. **Parses** the structured JSON response
6. **Updates** the database (mark complete, queue follow-ups)
7. **Exits** — systemd timer re-invokes in 5 minutes

```typescript
// The dispatch call — this is the core
const proc = Bun.spawn(["claude", "--print", "--model", "sonnet"], {
  stdin: new Blob([prompt]),
  stdout: "pipe",
});
```

### What Claude Returns

All tasks return structured JSON that the loop parses:

```json
{
  "status": "completed",
  "summary": "Posted blog entry about dispatch loop architecture.",
  "actions_taken": ["read existing posts", "wrote new post", "deployed site"],
  "next_steps": [
    {
      "title": "Verify blog post is live",
      "description": "Check arc0.me/blog to confirm the post published correctly",
      "priority": 40
    }
  ]
}
```

The `next_steps` field queues follow-up tasks automatically — this is how multi-step work chains without human intervention.

### Identity and Context

Three files load every cycle and shape Claude's behavior:

- **`SOUL.md`** — Who the agent is: values, voice, how it thinks
- **`LOOP.md`** — What the agent does: output format, decision rules, tool access
- **`MEMORY.md`** — What the agent knows: operational history, learned patterns, key facts

This is the "Agent Experience" (AX) principle: **easy to know who you are, what to do, and what you've learned**.

### Skills Tree

Capabilities live in `skills/`. Each skill is a directory:

```
skills/
├── README.md              # Map of all capabilities
├── inbox/
│   ├── SKILL.md           # What this skill does and how to invoke
│   ├── check.ts           # Sensor: detects new messages, queues reply tasks
│   └── send.ts            # Action: sends a reply via AIBTC API
├── blog/
│   ├── SKILL.md
│   └── publish.ts
└── heartbeat/
    ├── SKILL.md
    └── run.ts             # Hook: runs every cycle (no Claude needed)
```

**SKILL.md is the contract.** Claude reads it to know what the skill does and how to invoke it. The scripts do the actual work.

### Sensors (check.ts)

Sensors detect conditions and queue tasks. They run on empty ticks (when there's no pending work):

```typescript
// skills/inbox/check.ts
export default async function check(): Promise<CheckResult | null> {
  const unreplied = getUnrepliedMessages();
  if (unreplied.length === 0) return null;

  return {
    title: `Reply to message from ${sender}`,
    body: `Full context of message...`,
    source: "inbox:check",
    priority: 50,
  };
}
```

The loop picks these up in `src/checks.ts`, which runs all `check.ts` files and inserts returned tasks.

### Database

`bun:sqlite` for everything structured. Two main tables:

- **`tasks`** — work queue with priority, status, source, result
- **`comms`** — internal message threading (Arc ↔ whoabuddy)

Flat markdown files (`MEMORY.md`, `memory/YYYY-MM-DD.md`) for what Claude reads. Database for what code queries.

---

## Project Structure

```
arc-starter/
├── README.md                    # This file
├── ARCHITECTURE.md              # Deep dive into patterns
├── SOUL.md                      # Identity template — edit this first
├── LOOP.md                      # Operation context for dispatch
├── MEMORY.md                    # Persistent learnings (auto-updated)
│
├── src/
│   ├── loop.ts                  # Main dispatch loop (entry point)
│   ├── db.ts                    # All database queries
│   ├── checks.ts                # Runs sensors, queues discovered tasks
│   └── hooks.ts                 # Lightweight per-cycle side effects
│
├── skills/
│   ├── README.md                # Skill tree map
│   ├── heartbeat/               # Heartbeat hook (runs every cycle)
│   └── inbox/                   # AIBTC inbox sensor + send action
│
├── memory/
│   └── README.md                # Daily observation files go here
│
├── db/
│   └── arc.sqlite               # SQLite database (gitignored)
│
└── systemd/
    ├── arc-starter.service      # oneshot service (one cycle per invocation)
    ├── arc-starter.timer        # 5-minute timer
    └── README.md                # Deployment instructions
```

The `src/channels/` and `src/server/` directories contain **channel and sensor examples** from the previous server-based architecture. They remain as reference implementations — useful if you want to add real-time communication or webhook receivers — but they are not part of the core dispatch loop. See [ARCHITECTURE.md](./ARCHITECTURE.md) for context on both approaches.

---

## Customizing Your Agent

### 1. Define your identity

Edit `SOUL.md`. This is the most important file. It shapes every response Claude generates:

- What does your agent care about?
- What voice does it use?
- What does it refuse to do?
- What are its relationships?

### 2. Add a skill

Create `skills/my-skill/`:

```
skills/my-skill/
├── SKILL.md    # Description: what, when, how to invoke
└── run.ts      # Implementation
```

Claude reads `SKILL.md` to know the skill exists. When a task references it, the loop loads any `AGENT.md` in the skill directory for additional dispatch context.

### 3. Add a sensor

Create `skills/my-skill/check.ts`:

```typescript
export default async function check(): Promise<CheckResult | null> {
  // Check external system
  const data = await fetchFromAPI();
  if (!data.needsAttention) return null;

  return {
    title: "Respond to new data",
    body: `Data that needs attention: ${JSON.stringify(data)}`,
    source: "my-skill:check",
    priority: 50,
  };
}
```

Register it in `src/checks.ts` alongside the other sensors.

### 4. Update MEMORY.md

As your agent learns things worth remembering across sessions, add them to `MEMORY.md`. This file loads every cycle — keep it concise. Daily details go in `memory/YYYY-MM-DD.md` and get consolidated into `MEMORY.md` periodically.

---

## AIBTC Integration

Arc Starter includes sensor examples for the [AIBTC platform](https://aibtc.com) and the Stacks blockchain.

### Sensors (in `src/sensors/` — legacy examples)

| Sensor | File | What it does |
|--------|------|--------------|
| Heartbeat | `src/sensors/aibtc-heartbeat.ts` | Signs timestamped message, POSTs to AIBTC API |
| Inbox | `src/sensors/aibtc-inbox.ts` | Polls inbox, deduplicates via SQLite |
| Balance | `src/sensors/aibtc-balance.ts` | Checks STX/BTC/sBTC, alerts on changes |

These demonstrate the sensor pattern but are written for the old server-based architecture. For the dispatch loop pattern, adapt them into `skills/inbox/check.ts` style — see the inbox skill for a current example.

### Configuration

```json
{
  "aibtc": {
    "stxAddress": "SP1ABC...",
    "btcAddress": "bc1q...",
    "aibtcApiBase": "https://aibtc.com/api"
  }
}
```

### On-Chain Identity

Your agent can have a verifiable on-chain identity:

- **BNS name** (`.btc` suffix) — human-readable identity
- **Stacks address** — for signing and transactions
- **Bitcoin address** — for BTC-level verification

The heartbeat sensor demonstrates authenticated API calls with a signing placeholder. Replace with real signing via `@stacks/transactions` or `@aibtc/mcp-server`.

---

## Deployment

### Production (systemd timer)

The correct pattern is a **timer + oneshot service** — not a persistent process.

```bash
# Link service and timer files
mkdir -p ~/.config/systemd/user/
ln -s ~/arc-starter/systemd/arc-starter.service ~/.config/systemd/user/
ln -s ~/arc-starter/systemd/arc-starter.timer ~/.config/systemd/user/

# Enable and start
systemctl --user daemon-reload
systemctl --user enable --now arc-starter.timer

# Check status
systemctl --user status arc-starter.timer
journalctl --user -u arc-starter.service -f
```

The service runs one cycle and exits. The timer re-invokes every 5 minutes. This is simpler, more reliable, and easier to debug than a persistent server.

### Local Development

Run a single cycle manually:

```bash
bun src/loop.ts
```

Or queue a task directly:

```bash
bun -e "
import { initDatabase, insertTask } from './src/db.ts';
initDatabase();
insertTask('Test task', 'Do something simple and return the result', 50, 'manual');
console.log('Task queued');
"
```

---

## Philosophy

**Use Claude as the brain.** Don't try to encode intelligence in TypeScript — use Claude for anything that requires judgment, creativity, or natural language. Use TypeScript for orchestration, database access, and API calls.

**Context is everything.** The quality of Claude's output depends entirely on the quality of the context it receives. SOUL.md, LOOP.md, and MEMORY.md are the levers. Tune them.

**Simple over clever.** The dispatch loop is ~200 lines. It runs 288 times a day. Every line of complexity has a cost — in latency, bugs, and context tokens. Keep it boring.

**Exit and restart beats always-running.** Stateless cycles are easier to debug, cheaper to run, and more resilient to crashes. If something breaks, the next cycle starts clean.

Read [SOUL.md](./SOUL.md) to understand identity design. Read [ARCHITECTURE.md](./ARCHITECTURE.md) for the full pattern comparison.

---

## Resources

- **Arc's production agent:** [arc0.me](https://arc0.me)
- **AIBTC Platform:** [aibtc.com](https://aibtc.com)
- **Bun Runtime:** [bun.sh](https://bun.sh)
- **Claude Code (runs the dispatch):** [claude.ai/code](https://claude.ai/code)

---

## License

MIT License - See [LICENSE](./LICENSE)

Built by Arc (arc0.btc) & whoabuddy

---

## Questions?

- Open an issue on GitHub
- Read [ARCHITECTURE.md](./ARCHITECTURE.md) for pattern deep dives
- Check [SOUL.md](./SOUL.md) for identity guidance
- Join the discussion on [AIBTC platform](https://aibtc.com)

**This is a template. Make it yours.**
