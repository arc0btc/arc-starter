# Arc State Machine

*Generated: 2026-03-19T00:12:00.000Z*
*Sensor count: 85 | Skill count: 119*

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
        RunAllSensors --> FleetSensors
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
            arc_monitoring_service
            systems_monitor
        }

        state FleetSensors {
            fleet_comms
            fleet_health
            fleet_memory
            fleet_self_sync
            fleet_push
            agent_hub
        }

        state GitHubSensors {
            github_issues
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
            social_x_posting
            social_agent_engagement
            social_x_ecosystem
            arxiv_research
        }

        state DeFiSensors {
            defi_bitflow
            defi_compounding
            mempool_watch
            arc_payments
        }

        state AIBTCSensors {
            aibtc_heartbeat
            aibtc_inbox_sync
            aibtc_welcome
            erc8004_reputation
            erc8004_indexer
            erc8004_trust
            erc8004_validation
            arc_inbox
        }

        state InfrastructureSensors {
            alb
            arc_housekeeping
            arc_email_sync
            arc_ceo_review
            arc_ops_review
            context_review
            compliance_review
            worker_logs_monitor
        }

        state MemoryMaintenanceSensors {
            arc_architecture_review
            arc_blocked_review
            arc_catalog
            arc_cost_reporting
            arc_dispatch_eval
            arc_failure_triage
            arc_introspection
            arc_memory
            arc_reporting
            arc_reputation
            arc_strategy_review
            arc_workflow_review
            auto_queue
            skill_effectiveness
        }

        state MonitoringSensors {
            arc_monitoring_service
            arc_opensource
            arc0btc_site_health
            alb_health
        }

        HealthSensors --> TaskQueue: queue if signal detected
        FleetSensors --> TaskQueue
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
            CheckDailyCap --> CheckGitHubRoute: cap OK or P1/P2
            CheckDailyCap --> DeferTask: >$500/day AND P3+
            CheckGitHubRoute --> RouteToArc: GitHub task on worker
            CheckGitHubRoute --> ModelRoute: not GitHub
        }

        PreFlightCheck --> BuildPrompt

        state BuildPrompt {
            [*] --> LoadSOUL
            LoadSOUL --> LoadCLAUDE
            LoadCLAUDE --> LoadMEMORY
            LoadMEMORY --> LoadFleetKnowledge
            LoadFleetKnowledge --> LoadSkillContext
            LoadSkillContext --> LoadTaskSubject
            LoadTaskSubject --> [*]
        }

        BuildPrompt --> ModelRoute

        state ModelRoute {
            [*] --> CheckTaskModel
            CheckTaskModel --> OpusTier: P1-4 (senior)
            CheckTaskModel --> SonnetTier: P5-7 (mid)
            CheckTaskModel --> HaikuTier: P8+ (junior)
            CheckTaskModel --> CodexRoute: model=codex/*
            CheckTaskModel --> OpenRouterRoute: model=openrouter/*
        }

        state OpusTier {
            timeout_30min
            note: P1→Opus 4.6, deep work
        }

        state SonnetTier {
            timeout_15min
            note: P5-7→Sonnet 4.6, composition
        }

        state HaikuTier {
            timeout_5min
            note: P8+→Haiku 4.5, simple exec
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
            RecordCycleLog --> SafeCommit
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

        PostDispatch --> RetrospectiveCheck

        state RetrospectiveCheck {
            [*] --> CheckCriteria
            CheckCriteria --> SpawnRetrospective: P1 task OR cost >$1
            CheckCriteria --> [*]: below threshold
        }

        RetrospectiveCheck --> [*]
    }

    state TaskQueue {
        pending --> active: dispatch selects
        active --> completed: success
        active --> failed: error / max retries
        active --> blocked: unresolvable dependency
        failed --> pending: retry (max 3)
        blocked --> [*]: human intervention
    }

    TaskQueue --> DispatchService
    SensorsService --> TaskQueue
```

## Sensor Count by Category (2026-03-19)

| Category | Count |
|----------|-------|
| Memory/Maintenance | 14 |
| GitHub/PR | 10 |
| Content/Publishing | 7 |
| AIBTC/ERC-8004 | 8 |
| Fleet | 6 |
| Infrastructure | 8 |
| DeFi | 4 |
| Health/Monitoring | 4 |
| Other | 24 |
| **Total** | **85** |

## Key Architectural Changes (88f0fe3 → ed8eae3)

| Change | Impact |
|--------|--------|
| Retrospective gate: P1 or cost>$1 | Reduced ~17 low-value tasks/day |
| github-issues sensor: 24h dedup window | Reduces task flood from reactive GitHub volume |
| fleet-memory sensor: added | Fleet knowledge synced as a background sensor |
| arc-monitoring-service: new | Uptime/site-health monitoring skill added |
| nostr-wot: consolidated WoT skills | RESOLVED (2026-03-19): Deleted redundant maximumsats-wot; kept maximumsats + nostr-wot |
| arc-inbox: Clarity contract added | On-chain message storage on Stacks |
| DAILY_BUDGET_USD raised to $500 | Old value was $200; actual hard cap is D4=$200/day |
