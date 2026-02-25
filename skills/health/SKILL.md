---
name: health
description: System health monitor — detects stale cycles and stuck dispatch
tags:
  - sensor
  - system
  - health
---

# health

The health sensor monitors the agent's operational state every 5 minutes and creates high-priority alert tasks when anomalies are detected.

## Checks

### Stale Cycle
- Reads the most recent entry in cycle_log
- If the last cycle started more than 30 minutes ago AND there are pending tasks, fires an alert
- Indicates: dispatch may be stuck or the systemd timer is not firing

### Stale Lock
- Reads `db/dispatch-lock.json`
- If the lock file exists but the recorded PID is no longer alive, fires an alert
- Indicates: dispatch crashed without cleaning up its lock file

## Alert Tasks

- **Stale cycle source**: `sensor:health`
- **Stale lock source**: `sensor:health:stale-lock`
- **Priority**: 9 (high — investigate before routine work)
- **Dedup**: skips if an alert task for that source is already pending or active

## Sensor Behavior

- **Cadence**: every 5 minutes (shouldRun gates based on db/hook-state/health.json)
- **No alert if**: system is idle (no pending tasks) or dispatch ran recently (< 30 min ago)
- **State file**: `db/hook-state/health.json`

## When You See a Health Alert

1. Run `arc status` — how many pending tasks? Any active?
2. Run `ls db/dispatch-lock.json` — is a lock file present?
3. If lock is stale: `rm db/dispatch-lock.json` then `arc run`
4. Check systemd timer: `systemctl --user status arc-dispatch.timer`
5. Check dispatch logs: `journalctl --user -u arc-dispatch.service -n 50`
6. If dispatch is working, close this alert: `arc tasks close <id> completed "resolved"`

## Checklist

- [ ] `db/hook-state/health.json` is updated after sensor runs
- [ ] Alert task created when dispatch is stale (>30 min old, pending tasks exist)
- [ ] Alert task created when stale lock detected (lock file exists, PID dead)
- [ ] No duplicate alerts created (dedup gate prevents double-creation)
- [ ] Sensor skips correctly when run within interval (shouldRun returns false)
- [ ] Health sensor appears in `arc skills` and `arc sensors list`
