---
name: fleet-deploy
description: Canary deployment pipeline — code change → test on one agent → roll out to all
updated: 2026-03-09
tags:
  - fleet
  - infrastructure
  - deployment
---

# fleet-deploy

Orchestrates safe fleet-wide code deployments using a canary pattern. Syncs code via git bundles (no GitHub dependency), validates on a single agent before rolling out to the rest.

## Pipeline Stages

1. **Pre-flight** — Verify local commit is clean, check fleet connectivity
2. **Canary** — Sync code to canary agent (default: forge), restart services, run health checks
3. **Validate** — Wait for canary to complete a dispatch cycle, verify services stayed healthy
4. **Rollout** — Sync remaining agents in parallel, restart services, verify health
5. **Report** — Summary of deployment status across fleet

## CLI Commands

```
arc skills run --name fleet-deploy -- pipeline [--canary forge] [--skip-agents spark]
arc skills run --name fleet-deploy -- canary --agent forge
arc skills run --name fleet-deploy -- rollout [--skip-agents spark]
arc skills run --name fleet-deploy -- status
```

## Options

- `--canary <agent>` — Agent to use as canary (default: forge)
- `--skip-agents <a,b>` — Comma-separated agents to skip during rollout
- `--no-restart` — Sync code without restarting services

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] cli.ts implements pipeline, canary, rollout, status commands
