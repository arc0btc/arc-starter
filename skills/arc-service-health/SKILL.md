---
name: arc-service-health
description: System health monitor — detects stale cycles and stuck dispatch, triggers high-priority alerts
updated: 2026-03-05
tags:
  - sensor
  - system
  - health
disallowed-tools: [Edit, Write, NotebookEdit, Bash]
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

### OAuth Token Expiring (proactive)
- Reads `~/.claude/.credentials.json`'s `claudeAiOauth.expiresAt`
- If less than 2h remain, fires a **direct Discord alert** (fire-and-forget, not gated on a
  dispatch cycle) plus a tracked `health-alert` workflow task
- Indicates: the Claude Code OAuth token dispatch authenticates with is about to lapse — re-auth
  is interactive-only (`claude /login`), so Arc cannot fix this itself; an operator must act
  before expiry or dispatch self-halts on the next 401 and the queue backs up (see #23624/#23643,
  the 42h outage this check exists to prevent)
- Discord channel/token reused from `src/dispatch-gate.ts`'s reactive auth-outage alert
  (`discord`/`bot_token` credential, or `ARC_DISCORD_TOKEN` env)

## Alert Tasks

- **Stale cycle source**: `sensor:arc-service-health`
- **Stale lock source**: `sensor:arc-service-health:stale-lock`
- **OAuth expiry source**: `sensor:arc-service-health:oauth-expiry` (routed through the
  `health-alert` workflow like stale-cycle/stale-lock; actual task `source` is `workflow:<id>`)
- **Priority**: 9 (high — investigate before routine work); OAuth expiry alert tasks are priority 1
- **Dedup**: skips if an alert task for that source is already pending or active; OAuth expiry
  Discord alerts dedup 4h per distinct `expiresAt` (a freshly re-authed token gets its own alert
  if it's also expiring soon)

## Sensor Behavior

- **Cadence**: every 5 minutes (shouldRun gates based on db/hook-state/health.json)
- **No alert if**: system is idle (no pending tasks) or dispatch ran recently (< 30 min ago)
- **State file**: `db/hook-state/health.json`

## When to Receive This Task

Sensor-only — never explicitly loaded by dispatch. When you receive a health alert task (source: `sensor:arc-service-health`), follow the steps below. The sensor runs every 5 minutes automatically; no skill loading needed for alert triage.

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
