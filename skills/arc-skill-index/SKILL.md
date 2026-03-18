---
name: arc-skill-index
description: Indexes skill capabilities into arc_memory for smart skill discovery
updated: 2026-03-18
tags:
  - meta
  - memory
  - skills
---

# Arc Skill Index

Turns the skills directory into a searchable knowledge base. A sensor periodically reads all SKILL.md files, extracts capability summaries, and upserts them into `arc_memory` with `domain='skills'`. Failed tasks are also indexed per-skill so dispatch can avoid known-broken combinations.

## Sensor

Runs every **60 minutes**. For each skill with a SKILL.md:
1. Extracts name, description, tags from frontmatter
2. Builds a capability summary (description + tags + key sections)
3. Upserts into `arc_memory` with key `skill:<name>`, domain `skills`, importance 4
4. Scans recent failed tasks for each skill and upserts failure patterns with key `skill-failure:<name>`, domain `skills`, TTL 30 days

## CLI

```
arc skills run --name arc-skill-index -- search-skills --query TEXT [--limit N]
arc skills run --name arc-skill-index -- reindex
arc skills run --name arc-skill-index -- failures [--skill NAME]
```

- `search-skills` — FTS5 search across skill capabilities in arc_memory
- `reindex` — Force immediate re-index of all skills
- `failures` — Show indexed failure patterns, optionally filtered by skill

## Dispatch Integration

When dispatch selects a task with no explicit `skills` array, it can query `arc memory search-skills --query "<task subject>"` to suggest relevant skills. This is surfaced as a hint in the prompt, not auto-loaded — the dispatched model decides whether to use them.

## Memory Schema

| Key pattern | Domain | Content | TTL |
|---|---|---|---|
| `skill:<name>` | skills | Capability summary: description, tags, CLI commands, sensor info | none |
| `skill-failure:<name>` | skills | Recent failure patterns and counts | 30d |
