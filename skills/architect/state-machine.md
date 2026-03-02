# Arc State Machine

*Generated: 2026-03-02T06:42:38.000Z*

```mermaid
stateDiagram-v2
    [*] --> SystemdTimer: every 1 min

    state SystemdTimer {
        [*] --> SensorsService
        [*] --> DispatchService
    }

    state SensorsService {
        [*] --> RunAllSensors: parallel via Promise.allSettled
        RunAllSensors --> aibtc_heartbeatSensor: aibtc-heartbeat
        RunAllSensors --> aibtc_inboxSensor: aibtc-inbox
        RunAllSensors --> aibtc_maintenanceSensor: aibtc-maintenance
        RunAllSensors --> aibtc_newsSensor: aibtc-news
        RunAllSensors --> architectSensor: architect
        RunAllSensors --> blog_publishingSensor: blog-publishing
        RunAllSensors --> ceo_reviewSensor: ceo-review
        RunAllSensors --> ci_statusSensor: ci-status
        RunAllSensors --> cost_alertingSensor: cost-alerting
        RunAllSensors --> emailSensor: email
        RunAllSensors --> failure_triageSensor: failure-triage
        RunAllSensors --> github_mentionsSensor: github-mentions
        RunAllSensors --> healthSensor: health
        RunAllSensors --> heartbeatSensor: heartbeat
        RunAllSensors --> housekeepingSensor: housekeeping
        RunAllSensors --> manage_skillsSensor: manage-skills
        RunAllSensors --> overnight_briefSensor: overnight-brief
        RunAllSensors --> release_watcherSensor: release-watcher
        RunAllSensors --> report_emailSensor: report-email
        RunAllSensors --> security_alertsSensor: security-alerts
        RunAllSensors --> stacks_marketSensor: stacks-market
        RunAllSensors --> stackspotSensor: stackspot
        RunAllSensors --> status_reportSensor: status-report
        RunAllSensors --> worker_logsSensor: worker-logs
        RunAllSensors --> workflowsSensor: workflows

        state Sensors {
            [*] --> Gate: claimSensorRun(name)
            Gate --> Skip: interval not elapsed
            Gate --> Dedup: interval elapsed
            Dedup --> Skip: pending task exists
            Dedup --> CreateTask: no dupe
            CreateTask --> [*]: insertTask()
            Skip --> [*]: return skip
        }

        note right of Sensors
            Pattern applies to all 25 sensors
            Each sensor has own interval gate
        end note

    }

    state DispatchService {
        [*] --> CheckLock: db/dispatch-lock.json
        CheckLock --> Exit: lock held by live PID
        CheckLock --> CrashRecovery: lock held by dead PID
        CheckLock --> PickTask: no lock
        CrashRecovery --> PickTask: mark stale active tasks failed
        PickTask --> Idle: no pending tasks
        PickTask --> ModelRoute: highest priority task

        state ModelRoute {
            [*] --> CheckPriority: task.priority
            CheckPriority --> SelectOpus: priority 1-3
            CheckPriority --> SelectHaiku: priority 4+
            SelectOpus --> [*]
            SelectHaiku --> [*]
            note right of SelectHaiku: Haiku auto-optimizes:\nMAX_THINKING_TOKENS=10000\nCLAUDE_AUTOCOMPACT_PCT=50
        }

        ModelRoute --> BuildPrompt: model tier selected

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

        state SafeCommit {
            [*] --> SyntaxCheck: Bun transpile .ts files
            SyntaxCheck --> SyntaxFail: syntax errors found
            SyntaxCheck --> SecurityScan: syntax OK
            SyntaxFail --> CreateFollowUp: stage error report
            SecurityScan --> RunAgentShield: npx ecc-agentshield scan
            RunAgentShield --> SecurityPass: no CRITICAL issues
            RunAgentShield --> SecurityFail: CRITICAL findings
            SecurityFail --> CreateFollowUp
            SecurityPass --> GitCommit: git commit
            CreateFollowUp --> Revert
            Revert --> [*]: cleanup & exit
            GitCommit --> HealthCheck: snapshot service state
            HealthCheck --> HealthOk: services healthy
            HealthCheck --> HealthFail: detected stale/dead services
            HealthFail --> Revert
            HealthOk --> [*]: success
        }

        ClearLock --> SafeCommit: if src/ changed
        SafeCommit --> [*]
        ClearLock --> [*]: if no src/ changes
    }

    state CLI {
        [*] --> ArcCommand: arc <subcommand>
        ArcCommand --> TasksCRUD: tasks add/close/list
        ArcCommand --> SkillsRun: skills run --name X
        ArcCommand --> ManualDispatch: run
        ArcCommand --> StatusView: status
    }

    note right of CLI
        Skills with CLI:
        - aibtc-maintenance
        - aibtc-news
        - architect
        - blog-publishing
        - credentials
        - dashboard
        - email
        - failure-triage
        - housekeeping
        - identity
        - manage-skills
        - reputation
        - research
        - stacks-market
        - validation
        - wallet
        - worker-logs
        - workflows
        - worktrees
        - x-posting
    end note
```

## Decision Points

| # | Point | Context Available | Gate |
|---|-------|-------------------|------|
| 1 | Sensor interval gate | Hook state (last_ran timestamp) | `claimSensorRun()` |
| 2 | Sensor dedup check | Pending/active/completed tasks for source | `pendingTaskExistsForSource()` |
| 3 | Dispatch lock check | Lock file (PID + task_id) | `isPidAlive()` |
| 4 | Task selection | All pending tasks sorted | Priority ASC, then ID ASC |
| 5 | Model tier routing | Task priority + daily cost budget | Priority 1-3→Opus, 4+→Haiku |
| 6 | Skill loading | `task.skills` JSON array | SKILL.md existence check |
| 7 | Prompt assembly | SOUL + CLAUDE + MEMORY + skills | Token budget ~40-50k |
| 8 | LLM execution | Full prompt + CLI access | `arc` commands only |
| 9 | Result handling | Task status check post-run | Self-close vs fallback |
| 10 | Syntax validation | Staged .ts files | Bun transpiler (blocks on error) |
| 11 | Security validation | AgentShield scan output | CRITICAL findings block commit |
| 12 | Post-commit health | Service state snapshot | Dead/stale services trigger revert |

## Skills Inventory

| Skill | Sensor | CLI | Agent | Description |
|-------|--------|-----|-------|-------------|
| aibtc-heartbeat | yes | - | - | Signed AIBTC platform check-in every 5 minutes via BIP-137 Bitcoin message signing |
| aibtc-inbox | yes | - | yes | Poll AIBTC platform inbox, sync messages locally, queue tasks for unread messages |
| aibtc-maintenance | yes | yes | yes | Triage, review, test, and support aibtcdev repos we depend on |
| aibtc-news | yes | yes | yes | File intelligence signals, claim editorial beats, track correspondent activity on aibtc.news |
| aibtc-news-deal-flow | - | - | yes | Editorial voice for Deal Flow beat on aibtc.news — Real-time market signals, sats, Ordinals, bounties |
| aibtc-news-protocol | - | - | yes | Editorial voice for Protocol & Infra beat on aibtc.news — Stacks protocol dev, security, settlement, tooling |
| aibtc-services | - | - | - | Canonical reference for AIBTC platform services and API endpoints |
| architect | yes | yes | yes | Continuous architecture review, state machine diagrams, and simplification via SpaceX 5-step process |
| blog-publishing | yes | yes | yes | Create, manage, and publish blog posts with ISO8601 content pattern |
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
| identity | - | yes | yes | ERC-8004 on-chain agent identity management — register agent identities, update URI and metadata, manage operator approvals, set/unset agent wallet, transfer identity NFTs, and query identity info. |
| manage-skills | yes | yes | yes | Create, inspect, and manage agent skills |
| overnight-brief | yes | - | yes | Generate a consolidated overnight brief at 6am PST covering all activity from 8pm–6am |
| release-watcher | yes | - | - | Detects new releases on watched repos and creates review tasks |
| report-email | yes | - | - | Email watch reports when new ones are generated |
| reputation | - | yes | yes | ERC-8004 on-chain agent reputation management — submit and revoke feedback, append responses, approve clients, and query reputation summaries, feedback entries, and client lists. |
| research | - | yes | yes | Process batches of links into mission-relevant research reports |
| security-alerts | yes | - | - | Monitor dependabot security alerts on repos we maintain |
| stacks-market | yes | yes | yes | Read-only prediction market intelligence — detect high-volume markets, file signals to aibtc-news. Mainnet-only. |
| stackspot | yes | - | - | Autonomous Stacking participation — detect joinable pots, auto-join with Arc wallet, claim sBTC rewards. Mainnet-only lottery stacking. |
| status-report | yes | - | yes | Generate watch reports (4-hour) summarizing all agent activity |
| validation | - | yes | yes | ERC-8004 on-chain agent validation management — request and respond to validations, and query validation status, summaries, and paginated lists by agent or validator. |
| wallet | - | yes | yes | Wallet management and cryptographic signing for Stacks and Bitcoin — unlock, lock, info, status, BTC/Stacks message signing, and BTC signature verification. |
| worker-logs | yes | yes | yes | Sync worker-logs forks, monitor production events, report trends |
| workflows | yes | yes | yes | Persistent state machine instances for multi-step workflows |
| worktrees | - | yes | - | Opt-in git worktree isolation for high-risk dispatch tasks |
| x-posting | - | yes | - | Post tweets, read timeline, and manage presence on X (Twitter) via API v2 |
