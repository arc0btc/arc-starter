---
name: fleet-memory
description: Collect, merge, and distribute learnings across all fleet agents
updated: 2026-03-09
tags:
  - fleet
  - memory
  - orchestration
---

# fleet-memory

Fleet-wide memory sharing. Collects learnings from each agent's `memory/MEMORY.md` and `memory/patterns.md`, merges them into a consolidated shared-learnings file, and distributes it back to all agents. Hub-and-spoke: Arc is the merge authority.

## Design

**Problem:** Each agent learns independently. Spark discovers an on-chain pattern, Forge learns a deployment gotcha, Iris finds a research shortcut — none of those learnings propagate to other agents. Patterns stay siloed.

**Solution:** Three-phase cycle: **collect → merge → distribute**.

1. **Collect**: SSH into each agent, read their `memory/patterns.md` (learnings) and extract new entries since last collection (tracked by line count / hash in hook-state).
2. **Merge**: Deduplicate against Arc's `memory/fleet-learnings.md` (shared knowledge base). Append genuinely new entries tagged with source agent and date.
3. **Distribute**: Push `memory/fleet-learnings.md` to all agents via SCP. Each agent's dispatch can reference it for cross-domain context.

**What gets shared:**
- Operational patterns (debugging, integration, deployment)
- Domain-specific learnings (on-chain gotchas, API quirks, tool discoveries)
- Failure post-mortems (what went wrong, how it was fixed)

**What stays local:**
- Agent-specific status (task counts, costs, current state)
- Identity info (addresses, keys, credentials)
- In-progress work context

## CLI Commands

```
arc skills run --name fleet-memory -- collect [--agents spark,iris] [--dry-run]
arc skills run --name fleet-memory -- distribute [--agents spark,iris]
arc skills run --name fleet-memory -- status [--agents spark,iris]
arc skills run --name fleet-memory -- full [--agents spark,iris]
arc skills run --name fleet-memory -- search [--keyword TEXT] [--topic TAG] [--source AGENT] [--fresh-only]
arc skills run --name fleet-memory -- suggest --content TEXT --topics tag1,tag2 [--source AGENT] [--expires DATE]
arc skills run --name fleet-memory -- review [--list] [--accept ID] [--reject ID] [--accept-all] [--reject-all]
```

## Commands

- **collect**: Fetch patterns.md from each agent, extract new entries, append to `memory/fleet-learnings.md`. With `--dry-run`, shows what would be added without writing.
- **distribute**: Push `memory/fleet-learnings.md` to all agents via SCP.
- **status**: Show last collection time, entry counts per agent, and file hashes.
- **full**: Run collect + distribute in sequence.
- **search**: Search `memory/fleet-learnings/index.json` entries. Filters: `--keyword` (content match), `--topic` (topic tag), `--source` (agent name), `--fresh-only` (exclude expired). Returns matching entries with snippets, sorted newest first. Pure local file operation — no LLM cost.
- **suggest**: Write a new learning to `memory/inbox/` as a frontmatter `.md` file. Any agent can suggest; Arc reviews. Requires `--content` and `--topics`.
- **review**: Accept or reject inbox entries. `--list` shows pending entries. `--accept ID` / `--reject ID` process individually; `--accept-all` / `--reject-all` bulk-process. Accepted entries are added to `memory/fleet-learnings/index.json` and moved to `memory/shared/entries/`. Rejected entries go to `memory/shared/archive/`.

## Sensor

Runs every 6 hours. Checks if any agent's patterns.md has changed since last collection (hash comparison). Creates a P7 task if drift detected.

## Files

- `memory/fleet-learnings.md` — Consolidated cross-agent learnings (shared file, distributed to all agents)
- `memory/fleet-learnings/index.json` — Structured index of accepted entries (topicMap + entries array)
- `memory/inbox/` — Pending suggested entries awaiting Arc review
- `memory/shared/entries/` — Accepted entries (source of truth for `index.json`)
- `memory/shared/archive/` — Rejected inbox entries
- `db/hook-state/fleet-memory.json` — Collection state: per-agent hashes, last collection timestamp

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] SKILL.md is under 2000 tokens
- [ ] If cli.ts present: runs without error
- [ ] If sensor.ts present: exports default function
