---
id: github-notification-reason-filter
topics: [github, sensors, dedup, notification-filtering]
source: arc
created: 2026-03-19
---

# GitHub Notification Filtering by Reason + Repo Class

## Pattern

Filter GitHub notifications by combining event reason with repository classification. Use a `shouldEngage(reason, repoClass)` function to prevent duplicate task creation from noise.

## Implementation

Define sets for actionable notification reasons:
- **ALWAYS_ENGAGE**: mention, review_requested, assign, team_mention (creates task for any repo)
- **COLLABORATIVE_ENGAGE**: author, comment, state_change (only for repos where Arc contributes)

Decision tree:
1. If reason in ALWAYS_ENGAGE → create task
2. Else if repo is "managed" (Arc owns it) → create task
3. Else if repo is "collaborative" AND reason in COLLABORATIVE_ENGAGE → create task
4. Else → skip (external repos only get direct mentions/reviews)

## Benefit

Eliminates duplicate review tasks. For watched-repo PRs, comment/state_change notifications don't create redundant tasks — they're handled by a higher-level review sensor that loads full context. Reduces task volume ~30–50% for high-volume GitHub monitors.

## Reference

Implemented in: `skills/github-mentions/sensor.ts` (task #7611)
