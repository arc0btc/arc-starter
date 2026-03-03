---
name: self-audit
description: Daily operational self-audit — task queue health, cost trends, skill/sensor health, recent codebase changes
tags:
  - infrastructure
  - monitoring
  - daily
---

# self-audit

Daily operational review sensor. Gathers metrics across the agent's subsystems and creates a single audit task when it's time for a daily check-in.

## Sensor

Runs once daily via `claimSensorRun("self-audit", 1440)` with date-based dedup. Creates a P7 task containing a structured audit report.

### Metrics Gathered

1. **Task queue** — pending count, failed in last 24h, stuck active tasks (>2h old)
2. **Cost** — today's spend, yesterday's spend, budget utilization
3. **Skill/sensor health** — total skills, total sensors, any sensors with consecutive failures
4. **Codebase changes** — commits in last 24h, uncommitted changes, branch status
5. **Recent cycles** — last 10 cycles success/failure rate, avg cost per cycle

### When a Task Is Created

Always creates one audit task per day (date-deduped). The task description includes all metrics so the dispatched agent can review and act on anomalies without re-querying.

### Complementary to Housekeeping

- **housekeeping** = repo hygiene (files, locks, WAL, memory bloat)
- **self-audit** = operational health (tasks, costs, skills, recent work)

## Checklist

- [ ] Sensor runs daily, date-deduped via hook-state
- [ ] Task description includes all metrics in structured format
- [ ] No LLM calls — pure TypeScript data gathering
- [ ] Graceful handling of missing data (new installs, empty DB)
