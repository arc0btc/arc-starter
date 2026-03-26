# Arc State Machine

*Generated: 2026-03-26T18:20:00.000Z*
*Sensor count: 67 | Skill count: 97*

```mermaid
stateDiagram-v2
    [*] --> SystemdTimer: every 1 min

    state SystemdTimer {
        [*] --> SensorsService
        [*] --> DispatchService
    }

    state SensorsService {
        [*] --> RunAllSensors: parallel via Promise.allSettled
        RunAllSensors --> HealthSensors
        RunAllSensors --> GitHubSensors
        RunAllSensors --> ContentSensors
        RunAllSensors --> DeFiSensors
        RunAllSensors --> AIBTCSensors
        RunAllSensors --> InfrastructureSensors
        RunAllSensors --> MemoryMaintenanceSensors
        RunAllSensors --> MonitoringSensors

        state HealthSensors {
            arc_alive_check
            arc_service_health
        }

        state GitHubSensors {
            github_issue_monitor
            github_mentions
            github_release_watcher
            github_security_alerts
            github_ci_status
            github_worker_logs
            arc0btc_pr_review
            arc0btc_security_audit
            aibtc_dev_ops
            aibtc_repo_maintenance
        }

        state ContentSensors {
            blog_publishing
            aibtc_news_editorial
            aibtc_news_deal_flow
            ordinals_market_data
            social_x_posting
            social_agent_engagement
            social_x_ecosystem
            arxiv_research
            note right of ordinals_market_data: 3 ordinals + 3 dev-tools/day\noverflow after 18:00 UTC\nAll 5 categories fetched per run\nper-category pending dedup
            note right of arxiv_research: routes dev-tool papers\nto dev-tools signal tasks
        }

        state DeFiSensors {
            defi_bitflow
            defi_stacks_market
            defi_zest
            mempool_watch
            arc_payments
        }

        state AIBTCSensors {
            aibtc_heartbeat
            aibtc_inbox_sync
            aibtc_welcome
            erc8004_reputation
            erc8004_indexer
            identity_guard
            alb
        }

        state InfrastructureSensors {
            arc_housekeeping
            arc_email_sync
            arc_ceo_review
            arc_report_email
            arc_scheduler
            arc_umbrel
            arc_starter_publish
            blog_deploy
            worker_deploy
            context_review
            compliance_review
        }

        state MemoryMaintenanceSensors {
            arc_architecture_review
            arc_blocked_review
            arc_catalog
            arc_cost_reporting
            arc_failure_triage
            arc_introspection
            arc_memory
            arc_reporting
            arc_reputation
            arc_strategy_review
            arc_workflow_review
            arc_skill_manager
            arc_self_audit
            auto_queue
        }

        state MonitoringSensors {
            arc_monitoring_service
            arc_opensource
            arc0btc_site_health
            arc0btc_services
            arc_self_review
            site_consistency
        }

        HealthSensors --> TaskQueue: queue if signal detected
        GitHubSensors --> TaskQueue
        ContentSensors --> TaskQueue
        DeFiSensors --> TaskQueue
        AIBTCSensors --> TaskQueue
        InfrastructureSensors --> TaskQueue
        MemoryMaintenanceSensors --> TaskQueue
        MonitoringSensors --> TaskQueue
    }

    state DispatchService {
        [*] --> CheckShutdown
        CheckShutdown --> [*]: shutdown flag set
        CheckShutdown --> CheckLock

        CheckLock --> [*]: lock held by live PID
        CheckLock --> CheckGate

        CheckGate --> [*]: gate closed (rate limit / auth failure)
        CheckGate --> SelectTask

        SelectTask --> [*]: no pending tasks
        SelectTask --> PreFlightCheck

        state PreFlightCheck {
            [*] --> CheckDailyCap
            CheckDailyCap --> CheckLandingPageGate: cap OK or P1/P2
            CheckDailyCap --> DeferTask: >$500/day AND P3+
            CheckLandingPageGate --> AutoClose: subject matches landing-page pattern
            CheckLandingPageGate --> CheckGitHubRoute: not landing-page
            CheckGitHubRoute --> RouteToArc: GitHub task on worker
            CheckGitHubRoute --> ModelGate: not GitHub
            ModelGate --> RejectTask: no model set (Claude tasks)
            ModelGate --> BuildPrompt: model set
        }

        PreFlightCheck --> BuildPrompt

        state BuildPrompt {
            [*] --> LoadSOUL
            LoadSOUL --> LoadCLAUDE
            LoadCLAUDE --> LoadMEMORY_ASMR
            LoadMEMORY_ASMR --> LoadSkillContext
            LoadSkillContext --> LoadTaskSubject
            LoadTaskSubject --> [*]
            note right of LoadMEMORY_ASMR: ASMR v1 format\n6 categories + temporal tags\nsupersession tracking
        }

        BuildPrompt --> ModelRoute

        state ModelRoute {
            [*] --> ReadTaskModel
            ReadTaskModel --> OpusTier: model=opus (explicit)
            ReadTaskModel --> SonnetTier: model=sonnet (explicit)
            ReadTaskModel --> HaikuTier: model=haiku (explicit)
            ReadTaskModel --> CodexRoute: model=codex/*
            ReadTaskModel --> OpenRouterRoute: model=openrouter/*
            note right of ReadTaskModel: ARC_DISPATCH_MODEL env var\nset from MODEL_IDS[model]\npassed to subprocess
        }

        state OpusTier {
            timeout_30min
            note: deep work
        }

        state SonnetTier {
            timeout_15min
            note: composition
        }

        state HaikuTier {
            timeout_5min
            note: simple exec
        }

        ModelRoute --> WorktreeCheck

        state WorktreeCheck {
            [*] --> HasWorktreeSkill
            HasWorktreeSkill --> CreateWorktree: arc-worktrees skill
            HasWorktreeSkill --> RunInPlace: no worktree skill
            CreateWorktree --> ClaudeSubprocess
            RunInPlace --> ClaudeSubprocess
        }

        WorktreeCheck --> ClaudeSubprocess

        state ClaudeSubprocess {
            [*] --> StreamJSON
            StreamJSON --> ParseResult
            ParseResult --> ExtractCost
            ExtractCost --> [*]
        }

        ClaudeSubprocess --> PostDispatch

        state PostDispatch {
            [*] --> RecordCycleLog
            RecordCycleLog --> RecordQuality
            RecordQuality --> SafeCommit
            SafeCommit --> SyntaxGuard: staged .ts files
            SyntaxGuard --> PostCommitHealth: syntax OK
            SyntaxGuard --> BlockCommit: syntax error → follow-up task
            PostCommitHealth --> ValidateServices
            ValidateServices --> MergeWorktree: worktree path
            ValidateServices --> UpdateFleetStatus: in-place path
            MergeWorktree --> UpdateFleetStatus: validate OK
            MergeWorktree --> DiscardWorktree: validate failed
            UpdateFleetStatus --> RecordGateSuccess
            RecordGateSuccess --> [*]
        }

        PostDispatch --> LearningCheck

        state LearningCheck {
            [*] --> CheckCriteria
            CheckCriteria --> SpawnRetrospective: P1 task OR cost >$1
            CheckCriteria --> KeywordScan: completed, below threshold
            KeywordScan --> SpawnLearningExtraction: discovery keywords matched (P8/Haiku)
            KeywordScan --> [*]: no keywords matched
            SpawnRetrospective --> [*]
            SpawnLearningExtraction --> [*]
        }
    }

    state TaskQueue {
        pending --> active: dispatch selects
        active --> completed: success
        active --> failed: error / max retries / no model set
        active --> blocked: unresolvable dependency
        failed --> pending: retry (max 3)
        blocked --> [*]: human intervention
    }

    state SignalAllocation {
        [*] --> CheckGlobalCap: 6/day total
        CheckGlobalCap --> CheckBeatAllocation: cap not hit
        CheckBeatAllocation --> OrdinalsBeat: ordinalsToday < allocation
        CheckBeatAllocation --> DevToolsBeat: devToolsToday < 3
        OrdinalsBeat --> TaskQueue: File ordinals signal
        DevToolsBeat --> TaskQueue: File dev-tools signal
        note right of CheckBeatAllocation: ordinals: 3/day base\n+ unused dev-tools after 18:00 UTC\ndev-tools: 3/day (arxiv, arc-link-research, x-ecosystem)
    }

    TaskQueue --> DispatchService
    SensorsService --> TaskQueue
    ContentSensors --> SignalAllocation
```

## Sensor Count by Category (2026-03-26)

| Category | Count |
|----------|-------|
| Memory/Maintenance | 14 |
| GitHub/PR | 10 |
| Content/Publishing | 8 |
| AIBTC/ERC-8004 | 7 |
| Infrastructure | 11 |
| DeFi | 5 |
| Health | 2 |
| Monitoring | 6 |
| Other/Misc | 4 |
| **Total** | **67** |

*Note: Fleet sensor group removed (committed b73f1a21). Previous total was 80.*

## Key Architectural Changes (ab4f520 → 9cc7a12)

| Change | Impact |
|--------|--------|
| **ordinals-market-data: all-5-categories per run** (9cc7a120) | Removed: per-run hook-state cooldown, legacy `lastSignalQueued` field sync, `recentTaskExistsForSourcePrefix` DB check, `MAX_SIGNALS_PER_RUN = 1` cap, category rotation logic (`startIdx`/`lastCategory` state). Now fetches all 5 categories every 4h run; per-category `pendingTaskExistsForSource` dedup prevents duplicate queuing; daily allocation cap (3/day) is the only throttle. Closes rotation gap that cost Day-2 and Day-3 competition signals. |
| **arc-link-research devToolTags wired** | `routeDevToolsSignal()` function called when high-relevance dev-tool links found. Previous [WATCH] item RESOLVED — devToolTags computation is no longer dead. |
| **memory/patterns.md updated** | 3 new patterns added from x402-sponsor-relay review: file-backed shared state for multi-process coordination, single authoritative quota over layered rate limits, proactive deadline-critical task filing. |

## Prior Key Changes (bc144e6 → ab4f520)

| Change | Impact |
|--------|--------|
| **Fleet context layer removed from dispatch** | `resolveFleetKnowledge()`, `fleet-learnings` index loader, and `LoadFleetKnowledge` BuildPrompt step removed. BuildPrompt now: SOUL → CLAUDE → MEMORY → Skills → Task. |
| **Worker sensor allowlist removed** | `WORKER_SENSORS` set and `GITHUB_TASK_RE` regex removed. No per-agent branching in runner. |
| **`model: "sonnet"` on all follow-up insertTask calls** | safe-commit.ts, dispatch.ts, experiment.ts, web.ts. Modelless-task pattern CLOSED. |
| **Multi-beat signal rotation** (3+3/day) | `BEAT_DAILY_ALLOCATION = 3` + `countSignalTasksTodayForBeat(beat)`. Three dev-tools sources: arxiv-research, arc-link-research, social-x-ecosystem. |
| **`SENSOR_FETCH_TIMEOUT_MS = 15_000` exported** | Canonical 15s timeout. `fetchWithRetry` applies 30s AbortSignal default. |
| **`erc8004-reputation` subprocess timeout** | `Promise.race([subprocess, 30s timeout])`. |
| **Fleet skills committed (b73f1a21)** | 15+ skill directories removed. Sensors 80→67, skills 115→97. |
