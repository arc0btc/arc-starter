# Arc Starter - AI Agent Instructions

Instructions for Claude Code and other AI agents working on this repository.

---

## Project Overview

**arc-starter** is a template for building autonomous agents using the dispatch loop architecture. Built with Bun and TypeScript.

Key characteristics:
- Systemd timer fires every 5 minutes, runs one cycle, exits
- Claude handles all intelligence: receives a prompt, returns structured JSON
- SQLite for structured data; flat markdown files for what Claude reads
- Skills tree: capabilities as directories with SKILL.md + scripts
- Sensors detect conditions (check.ts), hooks run every cycle without Claude

This is a **template repo** — designed to be copied, customized, and deployed. Not a library or framework.

---

## Architecture Quick Reference

### Core Files

```
src/
├── loop.ts         # Main entry point — one cycle and exit
├── db.ts           # All database queries (bun:sqlite)
├── checks.ts       # Sensor runner — imports check.ts files, queues tasks
└── hooks.ts        # Hook runner — lightweight per-cycle side effects
```

### Context Files (what Claude reads)

```
SOUL.md       # Identity: who the agent is, values, voice
LOOP.md       # Operation: output format, decision rules, tool access
MEMORY.md     # Knowledge: learned patterns, key facts, file paths
```

### Skills

```
skills/
├── README.md          # Map of all capabilities
└── <skill-name>/
    ├── SKILL.md        # Contract: what, when, how to invoke
    ├── AGENT.md        # Optional: dispatch context for this skill
    └── check.ts        # Optional: sensor (runs on empty ticks)
```

### Data Flow

```
systemd timer → loop.ts → build prompt (SOUL + LOOP + MEMORY + task) →
claude --print → parse JSON → update DB → queue next_steps
```

---

## How to Add a Skill

1. Create `skills/my-skill/`
2. Write `SKILL.md` — describes what the skill does, when to use it, how to invoke scripts
3. Write implementation scripts (TypeScript or bash)
4. Optional: `AGENT.md` for additional Claude dispatch context
5. Optional: `check.ts` sensor if the skill needs to detect conditions

```typescript
// skills/my-skill/check.ts
export default async function check(): Promise<CheckResult | null> {
  const needsWork = await detectCondition();
  if (!needsWork) return null;

  return {
    title: "Handle the condition",
    body: "Full context for Claude...",
    source: "my-skill:check",
    priority: 50,
  };
}
```

Register in `src/checks.ts`.

---

## How to Add a Task Manually

Queue work directly into the database:

```bash
bun -e "
import { initDatabase, insertTask } from './src/db.ts';
initDatabase();
insertTask('Task title', 'Full description of what to do', 50, 'manual');
"
```

Priority scale: 70 = urgent, 50 = normal, 30 = background follow-ups.

---

## Legacy Code (src/server/, src/sensors/, src/channels/)

These directories contain examples from the previous server-based architecture (Hono + event bus + always-running process). They are **not** the core dispatch loop.

They remain as reference implementations for:
- Adding webhook receivers
- Building real-time Discord integration
- Understanding the sensor pattern

Do not modify or delete them — they document a valid alternative architecture. See ARCHITECTURE.md for context.

---

## Commit Conventions

Conventional commits:

```
feat(skill): add inbox sensor check
fix(loop): handle empty next_steps array
docs(readme): update quick start for dispatch loop
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`

---

## Testing

```bash
bun test
```

Test sensors, DB helpers, and utility functions. For integration testing, run a manual cycle:

```bash
bun src/loop.ts
```

---

## Key Principles

- **Prompt-first**: Intelligence lives in SOUL.md, LOOP.md, and SKILL.md — not TypeScript
- **Verbose naming**: Names are context. `task_queue_items` beats `tasks` in a database.
- **Skills navigate like a tree**: README.md is the map, SKILL.md is the contract
- **Flat files for Claude, SQLite for code**: Don't make Claude query the database directly

---

## Resources

- ARCHITECTURE.md — full pattern comparison and deep dives
- SOUL.md — identity template (edit this first)
- LOOP.md — operation context (understand before modifying)
- Bun docs: https://bun.sh/docs
