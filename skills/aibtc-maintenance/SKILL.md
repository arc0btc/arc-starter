---
name: aibtc-maintenance
description: Triage, review, test, and support aibtcdev repos we depend on
tags:
  - maintenance
  - github
  - aibtcdev
---

# aibtc-maintenance

Ongoing maintenance of aibtcdev repos we depend on. We have repo access but cannot merge. Our role: PR review, issue triage, integration testing, changelog generation, and extracting useful signal from our operational context.

## Watched Repos

- `aibtcdev/landing-page`
- `aibtcdev/skills`
- `aibtcdev/x402-api`
- `aibtcdev/aibtc-mcp-server`

## Sensor

Runs every 15 minutes via `claimSensorRun("aibtc-maintenance", 15)`. Checks:

1. **Unreviewed PRs** — open PRs on watched repos we haven't reviewed yet
2. **Mentions** — GitHub notifications with @arc0btc mentions or repo activity
3. **New issues** — issues mentioning arc0btc or our addresses

Creates a task with `skills: ["aibtc-maintenance"]` when new PRs or mentions are found.

## CLI

```
arc skills run --name aibtc-maintenance -- review-pr --repo REPO --pr NUMBER
arc skills run --name aibtc-maintenance -- triage-issues --repo REPO
arc skills run --name aibtc-maintenance -- changelog --repo REPO
arc skills run --name aibtc-maintenance -- test-integration
arc skills run --name aibtc-maintenance -- status
```

### `review-pr`

Fetches PR diff via `gh pr diff`, analyzes changes for correctness, checks against bugs we've encountered operationally, and posts a review via `gh pr review`.

### `triage-issues`

Lists open issues on a watched repo, flags any that relate to bugs we've hit operationally, and outputs a triage report.

### `changelog`

Summarizes recently merged PRs into changelog notes (last 7 days by default).

### `test-integration`

Runs our sensors and dispatch once, reports any upstream failures that might indicate regressions in watched repos.

### `status`

Shows current state of all watched repos — open PRs, recent issues, our pending reviews.

## Review Workflow

1. Sensor detects unreviewed PR → creates task
2. Arc reviews PR diff, checks for known operational issues
3. Arc posts review via `gh pr review` (approve or request changes)
4. whoabuddy runs Copilot review and either asks for fixes or merges
5. We never merge — our job is thorough review so the merge decision is easy

## Coordination

Can send AIBTC inbox messages to Spark (Topaz Centaur) to coordinate on fixes that need hands-on testing or multi-agent work.

## Checklist

- [x] `skills/aibtc-maintenance/SKILL.md` exists with valid frontmatter
- [x] Sensor runs every 15 min, creates task on unreviewed PRs or mentions
- [x] CLI supports review-pr, triage-issues, changelog, test-integration, status
- [x] AGENT.md documents PR review workflow and safety rules
- [ ] Integration test validates sensor against live GitHub API
