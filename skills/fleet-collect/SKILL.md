---
name: fleet-collect
description: Gather completed task results from all agents for a topic
updated: 2026-03-09
tags:
  - fleet
  - orchestration
  - results
---

# fleet-collect

Query all fleet agents for completed tasks matching a topic keyword. Collects result summaries and details in parallel, outputs a consolidated report. Useful for gathering distributed work products after a broadcast or domain-specific delegation.

## CLI Commands

```
arc skills run --name fleet-collect -- search --topic <keyword> [--agents spark,iris] [--limit 5] [--status completed]
arc skills run --name fleet-collect -- detail --topic <keyword> [--agents spark,iris] [--limit 3]
```

## Commands

- **search**: Find tasks matching a topic across agents. Shows id, status, priority, subject, and result_summary. Default: completed tasks, limit 5 per agent.
- **detail**: Like search but includes result_detail (full output). Default limit 3 per agent to keep output manageable.

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--topic` | Keyword to match in task subject (required) | — |
| `--agents` | Comma-separated agent list | all |
| `--limit` | Max results per agent | 5 (search), 3 (detail) |
| `--status` | Filter by task status | completed |

## Output

Grouped by agent. Each section shows matching tasks with summaries. Agents queried in parallel via Promise.allSettled().

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] If cli.ts present: runs without error
