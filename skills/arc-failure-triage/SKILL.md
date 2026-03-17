---
name: arc-failure-triage
description: Detect recurring failure patterns, escalate to investigation instead of retry
updated: 2026-03-05
tags:
  - meta
  - reliability
---

# Failure Triage

Prevents the loop from retrying the same broken thing repeatedly. Detects recurring error patterns across failed tasks and escalates to investigation instead of blind retry.

## Components

| File | Purpose |
|------|---------|
| `SKILL.md` | This file — orchestrator context |
| `AGENT.md` | Subagent briefing for investigation tasks |
| `sensor.ts` | Scans failed tasks every 60 min, creates investigation tasks for recurring errors |
| `cli.ts` | Manual scan and investigation commands |

## CLI

```
arc skills run --name failure-triage -- scan [--hours 24] [--threshold 3]
arc skills run --name failure-triage -- investigate --pattern "error signature text"
```

- `scan` — Review recent failed/blocked tasks, group by error signature, report patterns. Creates investigation tasks for patterns exceeding threshold.
- `investigate --pattern TEXT` — Deep-dive a specific recurring error. Checks own code first before blaming external services.

## Sensor Behavior

- Cadence: 60 minutes
- Queries tasks with `status='failed'` in the last 24 hours

### Pass 1: Recurring Pattern Investigation
- Groups failures by normalized error signature
- If any error appears 3+ times across different tasks, creates an investigation task
- Investigation tasks get `priority: 3`, `model: sonnet`
- Source: `sensor:arc-failure-triage:pattern:{hash}` — deduped per pattern

### Pass 2: Daily Retrospective
- Once per day, creates a single retrospective task listing all non-dismissed failures
- Retrospective tasks get `priority: 7`, `model: sonnet`
- Goal: extract learnings and write to memory — not fix bugs
- Source: `sensor:arc-failure-triage:retro:{date}` — one per calendar day

## Error Signature Normalization

Groups by pattern class, not exact string:
- `429` / `rate limit` → `rate-limit`
- `beat claimed` / `claimed by another` → `beat-conflict`
- `402` / `payment` → `payment-error`
- `database is locked` / `SQLITE_BUSY` → `sqlite-lock`
- `wallet unlock` / `wallet.*fail` → `wallet-error`
- `timeout` / `ETIMEDOUT` / `hung` → `timeout`
- `403` / `401` / `permission denied` / `unauthorized` → `auth-error`
- `ECONNREFUSED` / `ENOTFOUND` / `fetch failed` → `network-error`
- `cannot access.*programmatically` / `requires.*browser` / `browser-only` / `ui-only` → `external-constraint`
- `only sends to verified` / `verified.*address` → `tool-constraint`
- `bulk closed` / `queue cleanup` / `stale.*queue` / `auto-recovered` / `already supported` → `dismissed`

## When to Load

Load when: the failure-triage sensor creates an investigation task (subject: "Investigate recurring failure: ...") or a retrospective task (subject: "Daily failure retrospective: ..."), or when manually scanning for failure patterns.

## Core Principle

Never create a retry task for the same error. Always investigate first. The x402 header bug is the canonical example: 15 retries, blamed the API, turned out to be our client reading the wrong header name.
