---
name: security-alerts
description: Monitor dependabot security alerts on repos we maintain
tags:
  - security
  - github
  - monitoring
---

# security-alerts

Monitors GitHub Dependabot security alerts on repos we maintain. Detects new open alerts and creates tasks for critical/high severity vulnerabilities.

## Sensor

- **Interval:** 360 minutes (6 hours)
- **Repos monitored:** arc0btc/arc-starter, aibtcdev/landing-page, aibtcdev/skills, aibtcdev/x402-api, aibtcdev/aibtc-mcp-server
- **Behavior:** Fetches open dependabot alerts via `gh api`, filters to critical/high severity, creates priority-4 tasks for new alerts
- **Dedup:** Uses `sensor:security-alerts:repo#number` as source — won't create duplicate tasks
- **Graceful degradation:** Repos with dependabot disabled (403) are skipped with a log warning

## Alert Severity → Priority Mapping

| Severity | Task Priority | Action |
|----------|--------------|--------|
| critical | 3 | Immediate attention |
| high | 4 | Address soon |
| medium/low | — | Skipped (no task created) |

## Checklist

- [x] `SKILL.md` with valid frontmatter
- [x] `sensor.ts` with `claimSensorRun()` gating
- [ ] No `cli.ts` (read-only sensor, no CLI needed)
- [ ] No `AGENT.md` (tasks are self-descriptive)
