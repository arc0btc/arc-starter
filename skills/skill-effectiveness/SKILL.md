---
name: skill-effectiveness
description: Track which SKILL.md versions correlate with better dispatch outcomes for data-driven prompt evolution
updated: 2026-03-09
tags:
  - meta
  - skills
  - analytics
---

# skill-effectiveness

Tracks SKILL.md content hashes across dispatch cycles and correlates them with task outcomes (success rate, cost, duration). Enables data-driven prompt evolution instead of ad-hoc SKILL.md edits.

## How It Works

Each dispatch cycle, `src/dispatch.ts` hashes the content of every loaded SKILL.md (SHA-256, 12-char prefix) and records:
- `cycle_log.skill_hashes` — JSON map `{"skill-name": "hash12chars"}`
- `skill_versions` table — maps hash → full content with `first_seen` / `last_seen`

This means every SKILL.md version ever loaded is preserved, and each cycle's outcome (task `status`, `cost_usd`, `duration_ms`) is attributable to the exact skill phrasings active at the time.

## CLI Commands

```
# Show success/cost breakdown per skill version (default: all time, min 5 samples)
arc skills run --name skill-effectiveness -- report [--skill NAME] [--period today|week|month|all] [--min-samples N]

# List all known versions of a skill with their content diff stats
arc skills run --name skill-effectiveness -- versions --skill NAME

# Show full SKILL.md content for a specific hash
arc skills run --name skill-effectiveness -- show-version --hash HASH
```

## Data Schema

```sql
CREATE TABLE skill_versions (
  hash TEXT PRIMARY KEY,       -- sha256 truncated to 12 chars
  skill_name TEXT NOT NULL,
  content TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);

-- cycle_log.skill_hashes: JSON {"skill-name": "hash12chars"}
-- Join with tasks on cycle_log.task_id to get outcome (status, cost_usd)
```

## When to Load

Load when: investigating why a skill's tasks are underperforming, planning a SKILL.md rewrite, or auditing prompt evolution over time. Not needed for normal dispatch — tracking is automatic.
