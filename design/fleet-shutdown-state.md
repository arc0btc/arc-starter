# Fleet Agent Shutdown State

## Problem

When a fleet agent needs to go offline (e.g., account suspension, maintenance, debugging), there's no clean way to:
1. Stop sensors from creating new tasks
2. Stop dispatch from executing tasks
3. Signal to the fleet that the agent is intentionally down
4. Bring the agent back up cleanly

Systemd service stop alone doesn't prevent task creation on restart, and doesn't communicate intent to the observatory.

## Design

### State File: `db/shutdown-state.json`

```json
{
  "enabled": true,
  "reason": "Worker fleet suspended — account appeal in progress",
  "since": "2026-03-11T03:00:00.000Z",
  "initiated_by": "cli"
}
```

When this file exists and `enabled: true`, both sensors and dispatch skip their entire cycle with a log message. The file is deleted on resume.

### Gates

**Sensors** (`src/sensors.ts`): Checked at the top of `runSensors()`. If shutdown, all sensors are skipped. The systemd timer still fires (so it resumes automatically when the file is removed), but no work is done.

**Dispatch** (`src/dispatch.ts`): Checked after the lock check but before lock acquisition. If shutdown, writes idle fleet status and returns. No lock acquired, no task selected.

### CLI

```
arc shutdown [--reason TEXT]    # Enter shutdown state (idempotent)
arc resume                      # Exit shutdown state (idempotent)
arc status                      # Shows ** SHUTDOWN ** banner when active
```

### Properties

- **Idempotent**: Calling `arc shutdown` twice is safe (preserves original `since` timestamp).
- **Reversible**: `arc resume` deletes the state file. Next timer cycle resumes normal operation.
- **Non-destructive**: Pending tasks remain in the queue. No tasks are deleted or modified.
- **Observable**: `arc status` shows shutdown banner. Fleet status file reflects idle state.
- **Timer-friendly**: Systemd timers keep firing. The gate is inside the code, not at the service level. This means resume is instant — no need to reinstall services.

### Shutdown Procedure (Full)

For a complete agent shutdown:

```bash
# 1. Enter shutdown state (sensors + dispatch skip)
arc shutdown --reason "Account suspended — appeal in progress"

# 2. Optionally stop services entirely (saves CPU)
arc services uninstall

# 3. Optionally clear stale pending tasks
arc tasks --status pending  # review
arc tasks close --id <N> --status failed --summary "Agent shutdown — clearing queue"
```

### Resume Procedure

```bash
# 1. Clear shutdown state
arc resume

# 2. If services were stopped, reinstall them
arc services install

# 3. Verify
arc status
```

### Integration Points

| Component | How it checks | Behavior when shutdown |
|-----------|--------------|----------------------|
| `runSensors()` | `getShutdownState()` at entry | Logs + returns immediately |
| `runDispatch()` | `getShutdownState()` after lock check | Logs + writes idle status + returns |
| `arc status` | `getShutdownState()` | Shows `** SHUTDOWN **` banner |
| Observatory | Reads `fleet-status.json` (idle=true) | Shows agent as idle/down |

### Future Extensions

- `arc shutdown --drain`: Wait for active task to finish before entering shutdown
- `arc shutdown --clean`: Also close all pending sensor-generated tasks
- Remote shutdown via fleet API: `POST /api/shutdown` from Arc to workers
- Auto-shutdown on repeated auth failures (circuit breaker integration)
