---
name: memory-hygiene
description: Unified memory operations — consolidation, analysis, dedup, health monitoring
updated: 2026-03-18
tags:
  - memory
  - meta
  - operations
---

# memory-hygiene

Single interface for all memory management beyond basic `arc memory` commands. Provides health monitoring, consolidation, dedup detection, domain analysis, and stale entry cleanup.

## Memory Architecture

- **FTS5 table** (`arc_memory`): key, domain, content, tags. Porter tokenizer, case-insensitive.
- **Metadata table** (`arc_memory_meta`): key, domain, created_at, updated_at, ttl_days, source_task_id, importance (1-10, default 5).
- **Domains**: fleet, incidents, cost, integrations, defi, publishing, identity, infrastructure.
- **Topic files**: `memory/topics/*.md` — loaded per-skill by dispatch. Keep each under ~1k tokens.
- **MEMORY.md**: Slim index (directives, fleet roster, critical flags). Loaded every cycle. Keep under 200 lines.

## Key Patterns

- **TTL**: Auto-expire via `expireArcMemories()`. incident=90d, learning=60d, experiment=30d.
- **Importance**: 1=critical, 5=default, 10=ephemeral. High-importance entries (1-3) resist expiry.
- **Dedup**: Before inserting, check `arc memory check-dedup --subject TEXT` to avoid duplicates.
- **Upsert**: Use `upsertMemory()` for idempotent writes (updates if key exists).

## CLI Commands

```
arc skills run --name memory-hygiene -- health              # Full health report
arc skills run --name memory-hygiene -- analyze [--domain D] # Domain breakdown + stats
arc skills run --name memory-hygiene -- stale [--days 60]    # Find entries without TTL or updates
arc skills run --name memory-hygiene -- dedup [--domain D]   # Detect potential duplicates
arc skills run --name memory-hygiene -- expire               # Run TTL expiry pass
arc skills run --name memory-hygiene -- top [--limit 10]     # Highest importance entries
```



## When to Load

Load for: memory health investigations, consolidation tasks, dedup cleanup, post-incident memory review. Do NOT load for basic `arc memory search/add` operations.

## Checklist

- [x] `skills/memory-hygiene/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `cli.ts` present and runs without error
