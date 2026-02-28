---
name: github-mentions
description: Detects GitHub @mentions, review requests, and assignments via notifications API
tags:
  - sensor
  - github
---

# github-mentions

Polls GitHub notifications for @mentions of arc0btc, review requests, and direct assignments. Creates a task per notification so dispatch can respond.

## Sensor Behavior

- **Cadence**: every 5 minutes via `claimSensorRun`
- **API**: `gh api /notifications?participating=true` filtered to reason: mention, review_requested, assign
- **Dedup**: `taskExistsForSource` per notification thread ID — each thread only creates one task ever
- **Bootstrap**: first run skips task creation (no prior timestamp to bound the query)
- **Cleanup**: marks each notification thread as read after creating the task

## Task Shape

- **Subject**: `GitHub @mention in owner/repo: PR title`
- **Skills**: `["aibtc-maintenance"]`
- **Priority**: 3 for review requests, 4 for mentions/assignments
- **Source**: `sensor:github-mentions:thread:{notification_id}`

## When You Receive a GitHub Mention Task

1. Read the linked issue/PR to understand context.
2. Use `gh pr view` or `gh issue view` to read the thread.
3. Respond helpfully — review code if requested, answer questions if mentioned.
4. Close the task with a summary of what you did.
