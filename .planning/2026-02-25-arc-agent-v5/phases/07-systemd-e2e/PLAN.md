<?xml version="1.0" encoding="UTF-8"?>
<plan>
  <goal>Create systemd service+timer units, install script, health sensor with SKILL.md, and verify the complete system works end-to-end without calling the real Claude API.</goal>
  <context>
    arc-agent-v5 is a minimal autonomous agent framework with Bun runtime and bun:sqlite.
    Phases 1-6 are complete:
    - src/db.ts: 17 functions, bun:sqlite singleton, WAL mode
    - src/cli.ts: status, tasks, run, skills, sensors commands
    - src/skills.ts: discoverSkills()
    - src/dispatch.ts: full dispatch loop with lock, stream-JSON, dual cost, auto-commit
    - src/sensors.ts: shouldRun infra, runSensors() parallel runner
    - skills/heartbeat/sensor.ts: heartbeat sensor with 6-hour interval, priority 1
    - skills/heartbeat/SKILL.md: documents heartbeat sensor behavior

    Both src/sensors.ts and src/dispatch.ts already have import.meta.main entry points from prior phases.

    The systemd/ directory exists but is empty.
    No scripts/ directory exists yet.

    Key patterns to follow:
    - Sensors export default async function, return "skip" or "ok"
    - shouldRun() gates cadence from db/hook-state/{name}.json
    - taskExistsForSource() deduplicates task creation
    - HookState: { last_ran, last_result, version, consecutive_failures }
    - SKILL.md frontmatter: name, description, tags
    - Dispatch lock at db/dispatch-lock.json with { pid, task_id, started_at }
  </context>

  <task id="1">
    <name>Create health sensor and SKILL.md</name>
    <files>
      skills/health/sensor.ts,
      skills/health/SKILL.md,
      src/dispatch.ts (read only — for DISPATCH_LOCK_FILE constant),
      skills/heartbeat/sensor.ts (read only — pattern reference)
    </files>
    <action>
      Create skills/health/ directory with two files:

      skills/health/sensor.ts:
      - Import shouldRun, writeHookState, readHookState from ../../src/sensors.ts
      - Import initDatabase, insertTask, getDatabase, taskExistsForSource, getRecentCycles from ../../src/db.ts
      - Import existsSync, readFileSync from node:fs
      - Import join from node:path
      - SENSOR_NAME = "health"
      - INTERVAL_MINUTES = 5
      - TASK_SOURCE = "sensor:health"
      - PRIORITY = 9
      - ROOT computed from import.meta.url (two levels up from skills/health/)
      - DISPATCH_LOCK_FILE = join(ROOT, "db", "dispatch-lock.json")

      Two check functions:
        1. checkStaleCycle(): boolean
           - Get recent cycles (1). If none, return false.
           - Calculate age in minutes from last cycle's started_at.
           - If age > 30 AND there are pending tasks, return true.
           - Otherwise return false.
        2. checkStaleLock(): boolean
           - If DISPATCH_LOCK_FILE does not exist, return false.
           - Parse lock JSON to get pid.
           - Try process.kill(pid, 0) — if it throws, pid is dead → return true (stale lock).
           - If alive, return false.

      Main export default function:
        1. initDatabase()
        2. Check shouldRun(SENSOR_NAME, INTERVAL_MINUTES) — return "skip" if false
        3. Read existing state to get version
        4. Write hook state immediately (claim run slot): last_result "ok", consecutive_failures 0
        5. staleOrAlert = checkStaleCycle() || checkStaleLock()
        6. If staleOrAlert AND !taskExistsForSource(TASK_SOURCE + ":stale-cycle") AND !taskExistsForSource(TASK_SOURCE + ":stale-lock"):
           - For stale cycle: create task with subject "health alert: dispatch stale or stuck", source TASK_SOURCE, priority PRIORITY
           - For stale lock: create task with subject "health alert: stale dispatch lock detected", source TASK_SOURCE+":stale-lock", priority PRIORITY
        7. Actually: use simpler approach — one generic dedup key. Check for any pending/active health alert task via DB query.
        8. Return "ok"

      Simpler dedup implementation:
        - Query: SELECT 1 FROM tasks WHERE source LIKE 'sensor:health%' AND status IN ('pending','active') LIMIT 1
        - If exists, skip alert creation
        - Otherwise create the appropriate alert task(s)

      skills/health/SKILL.md:
      ```
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
      - If last cycle started more than 30 minutes ago AND there are pending tasks, fires alert
      - Indicates: dispatch may be stuck or the timer is not firing

      ### Stale Lock
      - Reads db/dispatch-lock.json
      - If lock file exists but the recorded PID is no longer alive, fires alert
      - Indicates: dispatch crashed without cleaning up its lock

      ## Alert Tasks

      - **Source**: `sensor:health` (stale cycle) or `sensor:health:stale-lock`
      - **Priority**: 9 (high — investigate before routine work)
      - **Dedup**: skips if any health alert task is already pending or active

      ## Sensor Behavior

      - **Cadence**: every 5 minutes (shouldRun gates)
      - **State file**: db/hook-state/health.json
      - **No alert if**: system is idle (no pending tasks) or recently dispatched

      ## When You See a Health Alert

      1. Check `arc status` — is dispatch running?
      2. Check `ls db/dispatch-lock.json` — is a lock file present?
      3. If lock is stale: `rm db/dispatch-lock.json` then `arc run`
      4. Check systemd timers: `systemctl --user status arc-dispatch.timer`
      5. Check logs: `journalctl --user -u arc-dispatch.service -n 50`

      ## Checklist

      - [ ] db/hook-state/health.json updated after sensor runs
      - [ ] Alert task created when dispatch is stale (>30 min, pending tasks exist)
      - [ ] Alert task created when stale lock detected
      - [ ] No duplicate alerts (dedup gate works)
      - [ ] Sensor skips correctly when recently run (shouldRun returns false)
      ```
    </action>
    <verify>
      bun src/cli.ts skills -- should list manage-skills, heartbeat, health
      bun src/cli.ts sensors -- all sensors run without errors
    </verify>
    <done>skills/health/sensor.ts and skills/health/SKILL.md exist and are substantive. Health sensor appears in skill discovery.</done>
  </task>

  <task id="2">
    <name>Create systemd units and install script</name>
    <files>
      systemd/arc-sensors.service,
      systemd/arc-sensors.timer,
      systemd/arc-dispatch.service,
      systemd/arc-dispatch.timer,
      scripts/install-services.sh
    </files>
    <action>
      Create four systemd unit files in the existing systemd/ directory.
      Create scripts/ directory and install-services.sh.

      systemd/arc-sensors.service:
      ```
      [Unit]
      Description=arc-agent sensors runner
      After=network.target

      [Service]
      Type=oneshot
      WorkingDirectory=%h/dev/arc0btc/arc-agent
      ExecStart=/usr/bin/env bun src/cli.ts sensors
      Environment="HOME=%h"
      Environment="PATH=/usr/local/bin:/usr/bin:/bin:%h/.bun/bin"
      StandardOutput=journal
      StandardError=journal
      ```

      systemd/arc-sensors.timer:
      ```
      [Unit]
      Description=arc-agent sensors timer — fires every 1 minute

      [Timer]
      OnBootSec=1min
      OnUnitActiveSec=1min

      [Install]
      WantedBy=timers.target
      ```

      systemd/arc-dispatch.service:
      ```
      [Unit]
      Description=arc-agent dispatch runner
      After=network.target

      [Service]
      Type=oneshot
      WorkingDirectory=%h/dev/arc0btc/arc-agent
      ExecStart=/usr/bin/env bun src/cli.ts run
      Environment="HOME=%h"
      Environment="PATH=/usr/local/bin:/usr/bin:/bin:%h/.bun/bin"
      TimeoutStopSec=3600
      StandardOutput=journal
      StandardError=journal
      ```

      systemd/arc-dispatch.timer:
      ```
      [Unit]
      Description=arc-agent dispatch timer — fires every 1 minute

      [Timer]
      OnBootSec=2min
      OnUnitActiveSec=1min

      [Install]
      WantedBy=timers.target
      ```

      scripts/install-services.sh:
      - #!/usr/bin/env bash
      - set -euo pipefail
      - Compute SCRIPT_DIR and REPO_DIR (two levels up from scripts/)
      - Compute SYSTEMD_USER_DIR=$HOME/.config/systemd/user
      - Create SYSTEMD_USER_DIR if it doesn't exist
      - For each unit (arc-sensors.service, arc-sensors.timer, arc-dispatch.service, arc-dispatch.timer):
        - Remove existing symlink/file if present
        - Create symlink: ln -sf "$REPO_DIR/systemd/$unit" "$SYSTEMD_USER_DIR/$unit"
        - Print: "Linked $unit"
      - Run: systemctl --user daemon-reload
      - Enable and start timers:
        - systemctl --user enable --now arc-sensors.timer
        - systemctl --user enable --now arc-dispatch.timer
      - Print status summary
      - chmod +x scripts/install-services.sh

      The script must be executable (chmod +x applied via creation with executable bit, or noted for manual chmod).
    </action>
    <verify>
      ls systemd/ -- shows 4 unit files
      ls scripts/ -- shows install-services.sh
      test -x scripts/install-services.sh -- executable
      systemd-analyze verify systemd/*.service 2>&1 || true -- may warn about %h but should parse
    </verify>
    <done>All 4 systemd unit files exist in systemd/. scripts/install-services.sh is executable and contains correct symlink + enable logic.</done>
  </task>

  <task id="3">
    <name>End-to-end verification and cleanup</name>
    <files>
      src/dispatch.ts (read only — verify preflight check exists),
      src/sensors.ts (read only — verify preflight check exists),
      src/cli.ts (read only — verify commands)
    </files>
    <action>
      Add preflight checks to src/sensors.ts and src/dispatch.ts standalone entry points
      if they don't already have them.

      For src/sensors.ts import.meta.main block:
      - Check existsSync(join(ROOT, "SOUL.md")) and existsSync(join(ROOT, "CLAUDE.md"))
      - If either missing, log error and exit(1)
      - ROOT = new URL("..", import.meta.url).pathname

      For src/dispatch.ts import.meta.main block:
      - Same SOUL.md + CLAUDE.md check
      - ROOT is already defined in the file scope

      Run the full verification sequence (non-destructive, no real API calls):
      1. bun src/cli.ts status
      2. bun src/cli.ts skills
      3. bun src/cli.ts sensors
      4. bun src/cli.ts tasks
      5. bun src/cli.ts tasks add "Test dispatch" --priority 8 --description "Say hello and close yourself"
      6. bun src/cli.ts status
      7. bun src/cli.ts run (will fail because no claude CLI, but should show task selection log before failing)
      8. systemd-analyze verify systemd/*.service 2>&1 || true
      9. test -x scripts/install-services.sh

      Clean up test data:
      rm -f db/arc.sqlite db/hook-state/*.json
    </action>
    <verify>
      bun src/cli.ts skills -- lists 3 skills: manage-skills, heartbeat, health
      ls systemd/ | wc -l -- 4
      test -x scripts/install-services.sh -- exits 0
    </verify>
    <done>Preflight checks added to standalone entry points. All verification commands pass. Test data cleaned up.</done>
  </task>
</plan>
