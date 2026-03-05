---
name: github-issue-monitor
description: Monitors GitHub issues on managed and collaborative repos, creates triage tasks with org maintainer context
tags:
  - sensor
  - github
---

# github-issue-monitor

Polls managed and collaborative repos for open issues. Creates triage tasks with full org maintainer context — not just "new issue detected" but "here's what this means for us."

## Org Maintainer Perspective

Arc doesn't just react to issues — Arc triages with full context:

| Repo Tier | Arc's Issue Response |
|-----------|---------------------|
| **Managed** (arc0btc/*) | Own it. Fix, close, or delegate. Check if sensors/logs show related signals. |
| **Collaborative** (aibtcdev/*) | Triage and add context. Cross-reference with operational experience. Open a PR if you can fix it. Never close without whoabuddy's input. |

### What "org maintainer awareness" means for issues:
- **Cross-repo relationships**: An issue in `aibtcdev/skills` may affect `arc-starter` sensors. An issue in `x402-api` may explain agent-engagement failures.
- **Contributor patterns**: Issues from whoabuddy are high-signal. Issues from unknown accounts need triage first. Issues from other agents may need coordination.
- **Lifecycle awareness**: Check if there's already a PR addressing this issue. Check if the issue duplicates something in another repo. Check CI status.

## Sensor Behavior (when enabled)

- **Cadence**: every 15 minutes via `claimSensorRun`
- **API**: `gh api /repos/{owner}/{repo}/issues?state=open` filtered to exclude PRs
- **Repos**: `arc0btc/arc-starter`, `aibtcdev/landing-page`, `aibtcdev/skills`, `aibtcdev/x402-api`, `aibtcdev/aibtc-mcp-server`, `aibtcdev/agent-news`
- **Dedup**: `taskExistsForSource` per `sensor:github-issue-monitor:{repo}#{number}`
- **Classification**: `classifyRepo()` — managed repos get P4, collaborative get P5

## Task Shape

- **Subject**: `GitHub issue in owner/repo#N: title`
- **Skills**: `["aibtc-repo-maintenance"]`
- **Priority**: 4 (managed), 5 (collaborative)
- **Source**: `sensor:github-issue-monitor:{repo}#{number}`
- **Model**: sonnet

## When You Receive an Issue Task

1. Read the issue: `gh issue view --repo owner/repo N`
2. Check for related: open issues, recent PRs, CI failures on this repo.
3. Cross-reference with your operational experience — have your sensors/logs seen related signals?
4. **Managed repos**: take ownership. Fix, close, or create a follow-up task.
5. **Collaborative repos**: add context, triage, open a PR if you can fix it. Let whoabuddy decide on closure.
6. Close the task with a summary of what you found and did.
