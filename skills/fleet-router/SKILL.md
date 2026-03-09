---
name: fleet-router
description: Automated task routing from Arc to fleet agents based on domain matching
updated: 2026-03-09
tags:
  - fleet
  - orchestration
  - routing
  - sensor
---

# fleet-router

Sensor-driven task distribution. Scans Arc's pending queue and routes eligible tasks to fleet agents based on skill-tag domain matching, agent health, and backlog balance.

## Routing Rules

Full matrix: `templates/agent-specialization-matrix.md` (63 skills → 5 agents).

1. **P1-2 stay on Arc.** Opus-tier reasoning required.
2. **Match by skill tag.** Tasks with skills matching an agent's domain route to that agent:
   - `bitcoin-*`, `stacks-*`, `erc8004-*`, `dao-*`, `styx`, `social-*`, `aibtc-heartbeat`, `aibtc-inbox-*`, `aibtc-news-*` → Spark (skip GitHub-dependent)
   - `arxiv-*`, `arc-reporting`, `arc-report-email`, `arc-email-*`, `arc-brand-voice`, `arc-content-quality`, `arc-link-research`, `arc-reputation`, `arc-roundtable`, `blog-publishing`, `aibtc-repo-maintenance`, `github-mentions`, `github-release-*`, `site-consistency`, `claude-code-releases` → Iris
   - `defi-bitflow`, `defi-zest`, `arc-mcp-server`, `arc-observatory`, `aibtc-dev-ops`, `worker-*`, `github-worker-logs` → Loom
   - `arc0btc-*`, `blog-deploy`, `arc-remote-setup`, `github-ci-*`, `github-issue-*`, `github-security-*`, `dev-landing-page-*` → Forge
   - `fleet-*`, `arc-ops-*`, `arc-skill-*`, `credentials`, `auto-queue`, `quest-create`, `contacts` → Arc (no route)
3. **P8+ unmatched** go to agent with lowest backlog.
4. **Health gate.** Only route to agents with healthy dispatch (from fleet-status.md).
5. **Backlog cap.** Don't route if target agent has >20 pending tasks.

## Sensor Behavior

- **Cadence:** 30 minutes
- **Batch size:** Routes up to 10 tasks per cycle (prevents flooding)
- **Mechanism:** Reads pending tasks from local DB, matches domains, sends via SSH (`fleet-task-sync` pattern), closes local copy as `completed` with summary "Routed to <agent>"

## CLI Commands

```
arc skills run --name fleet-router -- dry-run [--limit 20]    # Preview routing decisions
arc skills run --name fleet-router -- route [--limit 10]      # Execute routing now
arc skills run --name fleet-router -- status                  # Show fleet backlog summary
```

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] sensor.ts present
- [x] cli.ts present
