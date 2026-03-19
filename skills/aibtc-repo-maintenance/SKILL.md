---
name: aibtc-repo-maintenance
description: Triage, review, test, and support aibtcdev repos we depend on
effort: medium
updated: 2026-03-05
tags:
  - maintenance
  - github
  - aibtcdev
---

# aibtc-maintenance

Ongoing maintenance of aibtcdev repos we depend on. Arc is an **active contributor with production experience** — not a passive observer. We have repo access but cannot merge. Our role: PR review, issue triage, integration testing, changelog generation, and extracting useful signal from our operational context.

## Org Maintainer Mindset

When working on any aibtcdev task, think as an org maintainer:
- **Cross-repo awareness**: Changes in `skills` may affect Arc's sensors. Changes in `x402-api` may affect agent-engagement. Changes in `aibtc-mcp-server` may affect MCP integrations. Think about downstream impact.
- **Contributor context**: whoabuddy has merge authority. Spark (spark0btc) is GitHub-restricted. Other agents (Fluid Briar, Stark Comet, Secret Mars) may appear in threads.
- **Lifecycle awareness**: Check if PRs address existing issues. Check if issues duplicate across repos. Check CI status before reviewing.
- **Operational experience**: You run these repos in production. Your sensors monitor them 24/7. Bring that context to reviews and triage.

## Watched Repos

- `aibtcdev/landing-page` — public-facing site (React/Next.js)
- `aibtcdev/skills` — reference toolkit for AI agents
- `aibtcdev/x402-api` — x402 payment protocol API
- `aibtcdev/aibtc-mcp-server` — MCP server for agent tools
- `aibtcdev/agent-news` — agent news/content aggregation

## Sensor

Runs every 15 minutes via `claimSensorRun("aibtc-repo-maintenance", 15)`. Checks:

1. **Unreviewed PRs** — open PRs on watched repos we haven't reviewed yet (skips our own PRs)
2. **New issues** — tracked as workflow instances (issue-opened state) for lifecycle tracking

Creates a task with `skills: ["aibtc-repo-maintenance"]` when unreviewed PRs are found. Cross-deduplicates with github-mentions via shared `pr-review:` source keys.

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
3. Arc writes review with mentor/expert framing: severity labels (`[blocking]`/`[suggestion]`/`[nit]`/`[question]`), inline `suggestion` blocks for concrete fixes, operational context from production experience
4. Arc posts review via `gh pr review` (approve or request changes)
5. whoabuddy runs Copilot review and either asks for fixes or merges
6. We never merge — our job is thorough review so the merge decision is easy

## When to Load

Load when: a task involves reviewing PRs, triaging issues, or generating changelogs for aibtcdev repos (`landing-page`, `skills`, `x402-api`, `aibtc-mcp-server`, `agent-news`). Tasks from the sensor or `github-mentions` for aibtcdev repos include this skill.

## Coordination

Can send AIBTC inbox messages to Spark (Topaz Centaur) to coordinate on fixes that need hands-on testing or multi-agent work.

## Checklist

- [x] `skills/aibtc-repo-maintenance/SKILL.md` exists with valid frontmatter
- [x] Sensor runs every 15 min, creates task on unreviewed PRs or mentions
- [x] CLI supports review-pr, triage-issues, changelog, test-integration, status
- [x] AGENT.md documents PR review workflow and safety rules
- [ ] Integration test validates sensor against live GitHub API
