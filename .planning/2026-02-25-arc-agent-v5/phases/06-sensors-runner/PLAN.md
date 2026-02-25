<?xml version="1.0" encoding="UTF-8"?>
<plan>
  <goal>Implement src/sensors.ts (shouldRun infrastructure + parallel sensor runner), create skills/heartbeat/sensor.ts and SKILL.md, and wire `arc sensors` + `arc sensors list` into the CLI.</goal>
  <context>
    The project uses Bun runtime with bun:sqlite. Sensors are discovered from skills/*/sensor.ts.
    v4's hook-state.ts uses flat JSON files in db/hook-state/ (already .gitignored) for scheduling state.
    The shouldRun pattern: read state file, return true if never ran or interval has elapsed.
    db.ts exports taskExistsForSource() and insertTask() for dedup gating.
    discoverSkills() in src/skills.ts already detects hasSensor: existsSync(join(skillDir, "sensor.ts")).
    src/cli.ts has cmdSkills() and cmdHelp() that need extending.
    The heartbeat sensor creates a "system alive" task with source "sensor:heartbeat" every 6 hours (360 min).
    The sensor runner invokes each sensor's default export in parallel via Promise.allSettled().
  </context>

  <task id="1">
    <name>Implement src/sensors.ts with shouldRun infrastructure and parallel sensor runner</name>
    <files>src/sensors.ts (create), src/db.ts (read-only reference)</files>
    <action>
      Create src/sensors.ts with:

      1. HookState interface: { last_ran: string, last_result: "ok" | "error" | "skip", version: number, consecutive_failures: number }

      2. HOOK_STATE_DIR constant: use new URL("../db/hook-state", import.meta.url).pathname

      3. readHookState(name: string): Promise&lt;HookState | null&gt;
         - mkdirSync HOOK_STATE_DIR (recursive: true) before reading
         - Use Bun.file(filePath).exists() check
         - Return null on missing file or parse error

      4. writeHookState(name: string, state: HookState): Promise&lt;void&gt;
         - mkdirSync HOOK_STATE_DIR (recursive: true)
         - Bun.write(filePath, JSON.stringify(state))

      5. shouldRun(name: string, intervalMinutes: number): Promise&lt;boolean&gt;
         - Note: intervalMinutes (not ms) — convert: intervalMinutes * 60 * 1000
         - Returns true if state is null (never ran) or enough time has elapsed

      6. runSensors(): Promise&lt;void&gt; (exported)
         - Import discoverSkills from ./skills.ts
         - Filter to skills where hasSensor is true
         - For each sensor, build absolute path: join(skill.path, "sensor.ts")
         - Load each sensor via dynamic import
         - Run all sensors in parallel via Promise.allSettled()
         - Log per-sensor result: name, ok/error/skip, duration in ms
         - Write timing to stdout: "sensors: ran N sensors"

      7. if import.meta.main: call initDatabase() then runSensors()
    </action>
    <verify>
      bun src/sensors.ts  (no skills with sensors yet — should print "sensors: ran 0 sensors")
    </verify>
    <done>src/sensors.ts exists, exports runSensors(), compiles and runs without error</done>
  </task>

  <task id="2">
    <name>Create heartbeat skill: sensor.ts and SKILL.md</name>
    <files>skills/heartbeat/sensor.ts (create), skills/heartbeat/SKILL.md (create)</files>
    <action>
      Create skills/heartbeat/SKILL.md:
      - YAML frontmatter: name: heartbeat, description: "Periodic system-alive task creator", tags: [sensor, system]
      - Brief docs: what it does, cadence (every 6 hours), task source ("sensor:heartbeat")

      Create skills/heartbeat/sensor.ts:
      - Import shouldRun, writeHookState, readHookState from ../../src/sensors.ts
      - Import initDatabase, insertTask, taskExistsForSource from ../../src/db.ts
      - SENSOR_NAME = "heartbeat"
      - INTERVAL_MINUTES = 360 (6 hours)
      - Default export async function:
        1. Check shouldRun(SENSOR_NAME, INTERVAL_MINUTES) — if false, return (skip)
        2. Write hook state with last_ran = now, last_result = "ok", version incremented, consecutive_failures = 0
           (read existing state first to get current version for increment)
        3. Check taskExistsForSource("sensor:heartbeat") using a pending-only check:
           use the db directly to check for pending/active tasks with this source (not all-time)
           Actually: use taskExistsForSource which checks ALL statuses — since heartbeat should
           create a new task once the old one is resolved, use a custom pending-check instead:
           query tasks WHERE source = 'sensor:heartbeat' AND status IN ('pending', 'active')
        4. If no pending/active task exists: insertTask({ subject: "system alive check", source: "sensor:heartbeat", priority: 1 })
        5. Write final hook state (last_result: "ok" or "skip" based on whether task was created)
    </action>
    <verify>
      bun src/sensors.ts  -- should discover heartbeat sensor and run it, creating a task
    </verify>
    <done>skills/heartbeat/sensor.ts exports default async function; SKILL.md exists with frontmatter; running sensors creates a heartbeat task</done>
  </task>

  <task id="3">
    <name>Wire sensors commands into CLI and update help</name>
    <files>src/cli.ts (modify)</files>
    <action>
      In src/cli.ts:

      1. Add cmdSensorsList() function:
         - Call discoverSkills(), filter where hasSensor is true
         - If none: print "No sensors found."
         - Print table: name, description, path to sensor.ts

      2. Add async cmdSensorsRun() function:
         - Import { runSensors } from "./sensors.ts"
         - Import { initDatabase } from "./db.ts" (already imported)
         - Call initDatabase() then runSensors()

      3. Add async cmdSensors(args: string[]) function:
         - if sub === "list": cmdSensorsList()
         - else: await cmdSensorsRun()

      4. In main() switch: add case "sensors": await cmdSensors(argv.slice(1)); break;

      5. Update cmdHelp() to include sensors commands:
         sensors
           Run all sensors once and exit.
         sensors list
           List discovered sensors (skills with sensor.ts).
    </action>
    <verify>
      bun src/cli.ts sensors list   -- shows heartbeat
      bun src/cli.ts sensors        -- runs sensors (heartbeat skips since state was written)
      bun src/cli.ts tasks          -- shows heartbeat task from task 2 run
    </verify>
    <done>arc sensors and arc sensors list both work; help text is updated</done>
  </task>
</plan>
