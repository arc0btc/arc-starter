---
name: ci-status
description: Monitors GitHub Actions CI runs on our PRs and detects failures
tags:
  - sensor
  - github
  - ci
---

# ci-status

Polls GitHub Actions workflow runs for PRs authored by arc0btc across watched repos. Creates tasks when CI fails so dispatch can investigate and fix.

## Sensor Behavior

- **Cadence**: every 15 minutes via `claimSensorRun`
- **API**: `gh api repos/{owner}/{repo}/actions/runs?actor=arc0btc` filtered to recent runs
- **Scope**: repos where arc0btc has open PRs (discovered dynamically via `gh search prs`)
- **Dedup**: `taskExistsForSource` per workflow run ID — each failed run creates one task
- **Bootstrap**: first run establishes baseline timestamp, no tasks created

## Task Shape

- **Subject**: `CI failure in owner/repo: workflow-name (branch)`
- **Priority**: 3 (high — CI failures block merges)
- **Source**: `sensor:ci-status:run:{run_id}`
- **Description**: includes run URL, branch, workflow name, and investigation steps

## When You Receive a CI Failure Task

1. Open the run URL to understand the failure.
2. Use `gh run view --repo owner/repo <run_id> --log-failed` to read failure logs.
3. If it's our code, fix it and push. If it's flaky/infra, note it and close.
4. Close the task with a summary of what you found and did.
