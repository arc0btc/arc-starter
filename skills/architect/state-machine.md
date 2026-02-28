# Arc State Machine

*Generated: 2026-02-28T12:36:00Z*

```mermaid
stateDiagram-v2
    [*] --> SystemdTimer: every 1 min

    state SystemdTimer {
        [*] --> SensorsService
        [*] --> DispatchService
    }

    state SensorsService {
        [*] --> DiscoverSensors: discoverSkills().filter(hasSensor)
        DiscoverSensors --> RunAll: Promise.all()

        state RunAll {
            [*] --> SensorCommonPattern
        }

        note right of RunAll
            20 sensors discovered.
            Each follows the common pattern below.
        end note

        state SensorCommonPattern {
            [*] --> Gate: claimSensorRun(name, interval)
            Gate --> Skip: interval not elapsed
            Gate --> Dedup: interval elapsed
            Dedup --> Skip: pending task exists
            Dedup --> CreateTask: no dupe
            CreateTask --> [*]: insertTask()
            Skip --> [*]: return skip
        }

        note left of SensorCommonPattern
            Exception: report-email is event-driven
            (fires on new CEO-reviewed report,
            uses custom last_emailed_report state)
        end note
    }

    note right of SensorsService
        Sensors (20):
        aibtc-heartbeat (5min)
        aibtc-inbox (5min)
        aibtc-maintenance (15min)
        architect (360min)
        ceo-review (post-report)
        ci-status (60min)
        cost-alerting (10min)
        email (1min)
        failure-triage (60min)
        github-mentions (5min)
        health (5min)
        heartbeat (360min)
        housekeeping (30min)
        manage-skills (360min)
        overnight-brief (360min)
        release-watcher (60min)
        report-email (event-driven)
        security-alerts (60min)
        status-report (240min)
        worker-logs (120min)
    end note

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

    note right of CLI
        Skills with CLI (11):
        aibtc-maintenance, architect,
        credentials, dashboard, email,
        failure-triage, housekeeping,
        manage-skills, research,
        wallet, worker-logs
    end note
```

## Decision Points

| # | Point | Context Available | Gate |
|---|-------|-------------------|------|
| 1 | Sensor fires | Hook state (interval check) | `claimSensorRun()` |
| 2 | Sensor creates task | External data + dedup check | `pendingTaskExistsForSource()` |
| 3 | Dispatch lock check | Lock file (PID + task_id) | `isPidAlive()` |
| 4 | Task selection | All pending tasks sorted | Priority ASC, ID ASC |
| 5 | Skill loading | `task.skills` JSON array | SKILL.md existence |
| 6 | Prompt assembly | SOUL + CLAUDE + MEMORY + skills | Token budget ~40-50k |
| 7 | LLM execution | Full prompt + CLI access | `arc` commands only |
| 8 | Result handling | Task status check post-run | Self-close vs fallback |
| 9 | Auto-commit | Staged dirs: memory/ skills/ src/ templates/ | `git diff --cached` |

## Skills Inventory (25)

| Skill | Sensor | CLI | Agent | Description |
|-------|--------|-----|-------|-------------|
| aibtc-heartbeat | yes | - | - | Signed AIBTC platform check-in every 5 minutes via BIP-137 Bitcoin message signing |
| aibtc-inbox | yes | - | yes | Poll AIBTC platform inbox, sync messages locally, queue tasks for unread messages |
| aibtc-maintenance | yes | yes | yes | Triage, review, test, and support aibtcdev repos we depend on |
| architect | yes | yes | yes | Continuous architecture review, state machine diagrams, and simplification via SpaceX 5-step process |
| ceo | - | - | yes | Strategic operating manual — treat yourself as CEO of a one-entity company |
| ceo-review | yes | - | yes | CEO reviews the latest watch report and actively manages the task queue |
| ci-status | yes | - | - | Monitors GitHub Actions CI runs on our PRs and detects failures |
| cost-alerting | yes | - | - | Monitor daily spend and alert when thresholds are exceeded |
| credentials | - | yes | yes | Encrypted credential store for API keys, tokens, and secrets used by other skills |
| dashboard | - | yes | yes | Arc's live web dashboard — real-time task feed, sensor status, cost tracking |
| email | yes | yes | yes | Sync email from arc-email-worker, detect unread messages, read and send email |
| failure-triage | yes | yes | yes | Detect recurring failure patterns, escalate to investigation instead of retry |
| github-mentions | yes | - | - | Detects GitHub @mentions, review requests, and assignments via notifications API |
| health | yes | - | - | System health monitor — detects stale cycles and stuck dispatch |
| heartbeat | yes | - | - | Periodic system-alive task creator |
| housekeeping | yes | yes | yes | Periodic repo hygiene checks — uncommitted changes, stale locks, WAL size, memory bloat, file archival |
| manage-skills | yes | yes | yes | Create, inspect, and manage agent skills |
| overnight-brief | yes | - | yes | Generate a consolidated overnight brief at 6am PST covering all activity from 8pm–6am |
| release-watcher | yes | - | - | Detects new releases on watched repos and creates review tasks |
| report-email | yes | - | - | Email watch reports when new ones are generated |
| research | - | yes | yes | Process batches of links into mission-relevant research reports |
| security-alerts | yes | - | - | Monitor dependabot security alerts on repos we maintain |
| status-report | yes | - | yes | Generate watch reports (4-hour) summarizing all agent activity |
| wallet | - | yes | yes | Wallet management and cryptographic signing for Stacks and Bitcoin |
| worker-logs | yes | yes | yes | Sync worker-logs forks, monitor production events, report trends |
