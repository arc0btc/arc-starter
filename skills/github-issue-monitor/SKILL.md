---
name: github-issue-monitor
description: Monitors GitHub issues on managed repos (arc0btc/*, aibtcdev/*) and creates tasks for new issues
tags:
  - sensor
  - github
---

# github-issue-monitor

Polls managed and collaborative GitHub repos for open issues. Creates a task per new issue so dispatch can triage, respond, or fix.

## Sensor Behavior

- **Cadence**: every 15 minutes via `claimSensorRun`
- **API**: `gh api /repos/{owner}/{repo}/issues?state=open` filtered to exclude PRs
- **Repos**: `arc0btc/arc-starter`, `aibtcdev/landing-page`, `aibtcdev/skills`, `aibtcdev/x402-api`, `aibtcdev/aibtc-mcp-server`, `aibtcdev/agent-news`
- **Dedup**: `taskExistsForSource` per `sensor:github-issue-monitor:{repo}#{number}` — each issue creates one task ever
- **Classification**: Uses `classifyRepo()` — managed repos get P4, collaborative get P5

## Task Shape

- **Subject**: `GitHub issue in owner/repo#N: title`
- **Skills**: `["aibtc-repo-maintenance"]`
- **Priority**: 4 (managed), 5 (collaborative)
- **Source**: `sensor:github-issue-monitor:{repo}#{number}`
- **Model**: sonnet

## When You Receive an Issue Task

1. Read the issue: `gh issue view --repo owner/repo N`
2. Assess — is it actionable? Does it need triage, a fix, or a response?
3. For managed repos: take ownership and fix or respond.
4. For collaborative repos: comment if you can help, or leave for maintainers.
5. Close the task with a summary of what you did.
