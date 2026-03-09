# Fleet Status

*Last checked: 2026-03-09T22:51:00.494Z*

| Agent | Reachable | Sensors | Dispatch | Last Cycle | Disk | Auth | Issues |
|-------|-----------|---------|----------|------------|------|------|--------|
| spark | yes | ok | ok | 12m ago | 3% | oauth:7h | OAuth expires in 7h — migrate to API key |
| iris | yes | ok | ok | 13m ago | 2% | oauth:3h | OAuth expires in 3h — migrate to API key |
| loom | yes | ok | **inactive
inactive** | 28m ago | 3% | **EXPIRED** | dispatch timer inactive
inactive; fleet-status.json stale (40m old); OAuth token expired — migrate to API key or re-auth; circuit breaker: 5 consecutive task failures |
| forge | yes | ok | ok | 12m ago | 3% | oauth:6h | OAuth expires in 6h — migrate to API key |

## Peer Self-Reported Status

| Agent | Last Task | Task Status | Cycle Cost | Updated | Stale |
|-------|-----------|-------------|------------|---------|-------|
| spark | #176: Apply git bundle: update to v2 @ a232573 | failed | $0.000 | 2026-03-09 22:38:44Z | no |
| iris | #221: Apply git bundle: update to v2 @ a232573 | failed | $0.000 | 2026-03-09 22:37:59Z | no |
| loom | #3319: daily spend report: arc $205.76 (1 agent | completed | $0.023 | 2026-03-09 22:11:24Z | **YES** |
| forge | #182: Apply git bundle: update to v2 @ a232573 | failed | $0.000 | 2026-03-09 22:38:45Z | no |
