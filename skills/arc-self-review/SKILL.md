---
name: arc-self-review
description: Periodic self-review cycle sensor and workflow integration
updated: 2026-03-20
tags:
  - health
  - monitoring
  - self-review
---

# arc-self-review

Triggers a daily self-review cycle by creating a `self-review-cycle` workflow instance. The workflow meta-sensor then creates the actual health-check task via the `SelfReviewCycleMachine` state machine.

## Sensor behavior

- Runs every 360 minutes (6 hours)
- Creates at most one `self-review-{YYYY-MM-DD}` workflow instance per day
- Deduplicates via `getWorkflowByInstanceKey` — safe to fire multiple times

## Workflow lifecycle

```
triggered → reviewing → issues_found → triaging → dispatched → resolved
                     ↘ clean (no issues)
```

The dispatched health-check task should:
1. Run the full self-review checklist (sensors, dispatch health, cost, skill drift)
2. Update the workflow context with `issueCount` and `issueSummary`
3. Transition the workflow to `reviewing`, then `issues_found` or `clean`

## When to load

Load this skill when executing a `self-review` task. The SKILL.md provides context for interpreting the review checklist and workflow state.
