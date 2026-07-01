# Arc State Machine

*Generated: 2026-07-01T14:34:26.350Z | Skills: 133 | Sensors: 83 | CLI: 83 | Agents: 68*

```mermaid
stateDiagram-v2
    [*] --> SystemdTimer: every 1 min

    state SystemdTimer {
        [*] --> SensorsService
        [*] --> DispatchService
    }

    state SensorsService {
        [*] --> RunAllSensors: 83 sensors via Promise.allSettled
        RunAllSensors --> SensorGate: claimSensorRun(name, intervalMin)
        SensorGate --> Skip: interval not elapsed
        SensorGate --> DedupCheck: interval elapsed
        DedupCheck --> Skip: pending task exists
        DedupCheck --> CreateTask: no dupe
        CreateTask --> [*]: insertTask()
        Skip --> [*]
    }

    state DispatchService {
        [*] --> CheckLock: db/dispatch-lock.json
        CheckLock --> Exit: lock held by live PID
        CheckLock --> CrashRecovery: lock held by dead PID
        CheckLock --> PickTask: no lock
        CrashRecovery --> PickTask: mark stale active tasks failed
        PickTask --> Idle: no pending tasks
        PickTask --> BuildPrompt: highest priority task

    state DispatchService {
        [*] --> CheckLock: db/dispatch-lock.json
        CheckLock --> Exit: lock held by live PID
        CheckLock --> CrashRecovery: lock held by dead PID
        CheckLock --> PickTask: no lock
        CrashRecovery --> PickTask: mark stale active tasks failed
        PickTask --> Idle: no pending tasks
        PickTask --> BuildPrompt: highest priority task

        state BuildPrompt {
            [*] --> LoadCore: SOUL.md + CLAUDE.md + MEMORY.md
            LoadCore --> LoadSkills: task.skills JSON array
            LoadSkills --> LoadSkillMd: for each skill name
            LoadSkillMd --> AssemblePrompt: SKILL.md content
            note right of LoadSkillMd: Only SKILL.md loaded\nAGENT.md stays for subagents
        }

        BuildPrompt --> WriteLock: markTaskActive()
        WriteLock --> SpawnClaude: claude --print --verbose
        SpawnClaude --> ParseResult: stream-json output
        ParseResult --> CheckSelfClose: task still active?
        CheckSelfClose --> RecordCost: LLM called arc tasks close
        CheckSelfClose --> FallbackClose: fallback markTaskCompleted
        FallbackClose --> RecordCost
        RecordCost --> ClearLock
        ClearLock --> AutoCommit: git add memory/ skills/ src/ templates/
        AutoCommit --> [*]
    }

    state CLI {
        [*] --> ArcCommand: arc <subcommand>
        ArcCommand --> TasksCRUD: tasks add/close/list
        ArcCommand --> SkillsRun: skills run --name X
        ArcCommand --> ManualDispatch: run
        ArcCommand --> StatusView: status
    }
```

## Decision Points

| # | Point | Gate |
|---|-------|------|
| 1 | Sensor fires | `claimSensorRun()` |
| 2 | Sensor creates task | `pendingTaskExistsForSource()` |
| 3 | Dispatch lock check | `isPidAlive()` |
| 4 | Task selection | Priority ASC, ID ASC |
| 5 | Skill loading | `task.skills` JSON array |
| 6 | Prompt assembly | Token budget ~40-50k |
| 7 | LLM execution | `arc` commands only |
| 8 | Result handling | Self-close vs fallback |
| 9 | Auto-commit | `git diff --cached` |

*Skill inventory: run `arc skills` for the full list (133 skills, 83 sensors, 83 with CLI)*
