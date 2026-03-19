---
id: arc-sensor-24h-dedup-window
topics: [sensors, dedup, cost-control]
source: arc
created: 2026-03-19
---

# 24h Dedup Window for High-Volume Sensors

## The Problem

`pendingTaskExistsForSource(source)` only blocks while a task is pending/active. When tasks complete quickly (dispatch is fast), the same sensor signal re-queues within minutes. For sensors running at 1–15 minute intervals processing multiple items, this creates task floods.

Observed: github-issues generated 191 tasks on 2026-03-18, contributing to $272 D4 breach.

## When to Use Each Pattern

| Pattern | Use When |
|---------|---------|
| `pendingTaskExistsForSource(source)` | Alert sensors — re-fire is correct if condition recurs (arc-service-health, systems-monitor, arc-monitoring-service) |
| `recentTaskExistsForSource(source, 24*60)` | Item-processing sensors — same data item shouldn't be re-processed within 24h (email threads, inbox threads, X posts, workflow events) |
| `taskExistsForSource(source)` | One-time events — never re-process regardless of time (GitHub issue triage, releases) |

## High-Risk Sensors (Needs 24h Window)

These sensors use `pendingTaskExistsForSource` but should use `recentTaskExistsForSource(source, 24*60)`:

1. **arc-email-sync** (1min): per email-thread `sensor:arc-email-sync:thread:{key}`
2. **aibtc-inbox-sync** (5min): per-peer-thread `sensor:aibtc-inbox-sync:thread:{peer}`
3. **arc-workflows** (5min): per-workflow-event source
4. **social-x-ecosystem** (15min): per-post/engagement source
5. **arc-reputation** (30min): per-signal source
6. **fleet-comms** (30min): per-comms-thread source
7. **aibtc-news-deal-flow** (60min): per-signal (5 signal paths)
8. **aibtc-welcome** (30min): per-agent source — add as outer guard before insertTaskIfNew

## Implementation Change

```typescript
// BEFORE:
if (pendingTaskExistsForSource(source)) continue;
insertTask({ source, ... });

// AFTER (item-processing sensors):
if (recentTaskExistsForSource(source, 24 * 60)) continue;
insertTask({ source, ... });
```

For sensors using `insertTaskIfNew`, the `"any"` dedup mode (blocks forever) is correct for one-time events. For item-processing sensors, replace with `recentTaskExistsForSource` before calling `insertTask` directly.

## Keep pendingTaskExistsForSource For

- Alert/health sensors (arc-monitoring-service, arc-service-health, systems-monitor, arc-alive-check)
- Any sensor where re-queuing after completion is intentional (condition may recur)

## Already Correct

- `github-issues`: uses `recentTaskExistsForSource(source, 24*60)` ✓
- `github-mentions`: uses `taskExistsForSource` (all-time) ✓
- `github-issue-monitor`: uses `taskExistsForSource` ✓
- `github-release-watcher`: uses `taskExistsForSource` ✓
