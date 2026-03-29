# Arc State Machine

*Generated: 2026-03-29T18:22:00.000Z*
*Sensor count: 68 | Skill count: 100*

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
            note right of ordinals_market_data: 3 ordinals + 3 dev-tools/day\noverflow after 18:00 UTC\nAll 5 categories fetched per run\nper-category pending dedup\nFlat-market fallback: stability signal when all thresholds=0
            note right of arxiv_research: routes dev-tool papers\nto dev-tools signal tasks
        }

        state DeFiSensors {
            defi_bitflow
            defi_stacks_market
            defi_zest
            mempool_watch
            arc_payments
            zest_yield_manager
            note right of zest_yield_manager: 60-min cadence\nChecks sBTC balance vs 200k-sat reserve\nQueues supply tasks (idle > threshold)\nQueues claim tasks (wSTX rewards > 1000 uSTX)\nAutonomous yield: idle sBTC → Zest ~3.5% APY
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
            arc_workflows
            note right of arc_workflows: drives workflow state machine\nstate-specific source keys (8ce27fb9)\ndedup scoped to workflow:{id}:{state}\nprevents cross-state dedup collisions
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

        state OtherSensors {
            contacts
            paperboy
            stacks_stackspot
            note right of stacks_stackspot: epoch-3.4 guard REMOVED (313d6b49)\nguard was dead code after block 943500\nstackspot now runs unguarded
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
        OtherSensors --> TaskQueue
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
            note right of StreamJSON: AskUserQuestion intercepted by\nPreToolUse hook (autoanswer.sh)\npermissionDecision:allow + answer\nreturned in 5s — no stall
        }

        ClaudeSubprocess --> PostDispatch

        state PostDispatch {
            [*] --> RecordCycleLog
            RecordCycleLog --> RecordQuality
            RecordQuality --> SafeCommit
            SafeCommit --> SyntaxGuard: staged .ts files
            SyntaxGuard --> LintModelField: syntax OK
            SyntaxGuard --> BlockCommit: syntax error → follow-up task
            LintModelField --> PostCommitHealth: model fields OK
            LintModelField --> BlockCommit: model missing → follow-up task
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
        CheckBeatAllocation --> AgentTradingBeat: agentTradingToday < allocation
        CheckBeatAllocation --> DevToolsBeat: devToolsToday < 3
        AgentTradingBeat --> TaskQueue: File agent-trading signal
        DevToolsBeat --> TaskQueue: File dev-tools signal
        note right of CheckBeatAllocation: agent-trading: 3/day base (was ordinals)\n+ unused dev-tools after 18:00 UTC\ndev-tools: 3/day (arxiv, arc-link-research, x-ecosystem)\ncountSignalTasksToday() BUG FIXED (ca5477c1)\nagent-trading subjects now correctly matched\n6/day cap now enforced
    }

    TaskQueue --> DispatchService
    SensorsService --> TaskQueue
    ContentSensors --> SignalAllocation
```

## Sensor Count by Category (2026-03-29)

| Category | Count |
|----------|-------|
| Memory/Maintenance | 14 |
| GitHub/PR | 10 |
| Content/Publishing | 8 |
| AIBTC/ERC-8004 | 7 |
| Infrastructure | 12 |
| DeFi | 6 |
| Health | 2 |
| Monitoring | 6 |
| Other/Misc | 3 |
| **Total** | **68** |

*Note: bitcoin-quorumclaw DELETED (947ffa43) — sensor count 69→68, skill count 101→100. arc-workflows added to Infrastructure (was missing from prior diagrams; 11→12). Other/Misc: 5→3 (quorumclaw deleted, arc-workflows moved to Infrastructure).*

## Key Architectural Changes (51d6cbf → ca5477c)

| Change | Impact |
|--------|--------|
| **chore(bitcoin-quorumclaw): remove archived skill** (947ffa43) | Skill FULLY DELETED (1573 lines: AGENT.md, SKILL.md, cli.ts, sensor.ts, tracking.json). Prior audit marked as "dormant" — but failure-triage was still generating tasks for old QuorumClaw failures even with sensor disabled, creating a triage loop. Complete deletion breaks the loop. Sensor count 69→68. Skill count 101→100. [WATCH] from prior audit: "dead code below early-return" — CLOSED (code gone). |
| **fix(db): add agent-trading patterns to countSignalTasksToday()** (ca5477c1) | Beat was migrated from 'ordinals' to 'agent-trading' in a prior cycle but `countSignalTasksToday()` aggregate query wasn't updated. Subjects `'File agent-trading signal%'` and `'[MILESTONE] File agent-trading signal%'` were silently excluded — 6/day cap gate was ineffective. Fix: 2 lines in `src/db.ts`. Cap now enforced. [INFO] carry-forward from prior audit: CLOSED. |
| **fix(arc-workflows): state-specific source keys** (8ce27fb9) | Workflow meta-sensor used `workflow:{id}` as dedup source for all states. Once a task was created in one state (e.g. 'scheduled'), the 24h dedup window blocked task creation for subsequent states (e.g. 'emailing') — left workflow 779 stuck 4+ hours. Fix: source key is now `workflow:{id}:{state}`. 4-line change. Cross-state dedup collision pattern resolved. |
| **diagram gap fixed: arc-workflows sensor** | arc-workflows/sensor.ts existed but was missing from all prior state diagrams. It drives the workflow state machine (FailureRetrospectiveMachine, HumanReplyMachine, etc.). Added to InfrastructureSensors. No code change — diagram accuracy fix only. |

## Key Architectural Changes (f2205d8 → 90f401f9)

| Change | Impact |
|--------|--------|
| **feat(zest-yield-manager): sensor.ts installed** (af624449) | Closes [WATCH] from prior audit. 60-min cadence sensor: reads Arc's sBTC balance + pending wSTX rewards via Clarity `call-read-only`. Queues supply tasks when idle sBTC > 200k-sat reserve; queues claim tasks when wSTX rewards > 1000 uSTX. Prior to this, yield optimization required explicit task creation. Now autonomous. DeFi sensor count: 5→6. |
| **chore(bitcoin-quorumclaw): archive skill — API deprovisioned** (51d6cbf6) | Sensor now returns "skip" immediately (dormant). SKILL.md marked [DEPRECATED]. failure-state.json deleted. Dead code (lines 286-329) preserved as reactivation blueprint — acceptable tradeoff. Reactivation path: confirm new API URL → update API_BASE in sensor.ts + cli.ts → delete failure-state.json. |

## Key Architectural Changes (b8e6595 → f2205d8+)

| Change | Impact |
|--------|--------|
| **feat(nonce-manager): queue-check subcommand** (f2205d80) | Local subcommand in nonce-manager/cli.ts queries x402-relay `/queue/{address}` to inspect stuck relay transactions. Fills visibility gap for NONCE_CONFLICT debugging — previously no way to inspect queued txs without admin access. 25 lines, one fetch call. Correctly local (relay endpoint, not upstream nonce oracle). |
| **refactor(stacks-stackspot): remove epoch-3.4 guard** (313d6b49) | [WATCH] from 3 audit cycles now CLOSED. Guard window [943,050–943,500] was dead code after block 943,500 (~2026-04-04). Removed EPOCH_34_GUARD_START/END constants, getCurrentBurnBlockHeight(), and guard logic. -30 lines. StackSpot sensor now runs unguarded. |
| **feat(skills): hodlmm-risk installed** (42318621) | Competition Day 2 winner. Read-only HODLMM pool volatility monitor. Computes bin spread, reserve imbalance, concentration → volatility score (0-100) + regime (calm/elevated/crisis). No sensor (correct — on-demand risk gate before LP actions). No cli.ts — entry is `hodlmm-risk.ts` directly. Deviates from arc 4-file pattern. |
| **feat(skills): zest-yield-manager installed** (42318621) | Competition Day 1 winner. sBTC yield management (supply/withdraw/claim) on Zest Protocol. Write-capable, mainnet-only, requires wallet. Pre-flight safety checks (gas, balance, spend limit). Outputs MCP command for agent framework. **No sensor** — not wired for autonomous operation. No cli.ts. Deviates from arc 4-file pattern. |

## Key Architectural Changes (6da4625 → b8e6595)

| Change | Impact |
|--------|--------|
| **feat(nonce-manager): cross-process nonce oracle** (6ec36831) | New skill (SKILL.md + AGENT.md + cli.ts). Fixes p-wallet-nonce-gap — concurrent x402 sends previously raced on Hiro API nonce fetch, causing 8h+ mempool stalls. mkdir-based file lock at `~/.aibtc/nonce-state.json` ensures single-writer nonce claims across dispatch processes. No sensor. |
| **feat(ordinals-market-data): flat-market fallback** (a8af8f5e) | When competition active + allocation not met + all change-detection thresholds produce zero signals → file stability signal. "Stability is data." Picks best category by history depth; 6h cooldown; source key prevents dedup. Also fixes angle rotation advancing on zero-signal early-exit path. +222 lines. |
| **feat(ci): lintModelField() in safe-commit.ts** (05ebbbde) | **Closes 7-cycle audit carry-forward.** Pre-commit pipeline now scans staged .ts files for insertTask/insertTaskIfNew without model: field. Failures block commit and create follow-up tasks. p-sensor-model-required now enforced at commit time, not discovered at dispatch time. |
| **fix(bitcoin-quorumclaw): skip-on-pause** (eaa40bfa) | Returns "skip" immediately when `consecutiveFailures >= ALERT_THRESHOLD`. Previously dedup check only blocked pending tasks — since failures leave status=failed (not pending), a new alert task was created every cycle (12+ tasks/day). Fix: p-paused-sensor-task-leak. |
| **fix(arc-workflows): arc-housekeeping for stale-lock alerts** (073ed91e) | Stale-lock health alert tasks now load `arc-housekeeping` skill. Previously dispatched without skill context — agent lacked lock recovery instructions. |
| **docs(defi-zest): MCP tools section** (b8e65952) | zest_enable_collateral tool documented in SKILL.md (v1.46.0). Full Zest MCP tool table added. No code change. |

## Key Architectural Changes (1955a04 → ee4919b)

| Change | Impact |
|--------|--------|
| **fleet cleanup: 46 files, ~2100 lines removed** (26b125e4 → 04b5e196) | SOUL.md, CLAUDE.md, MEMORY.md, 14 skill files, web dashboard, templates, docs, scripts. Arc now runs solo. Dispatch BuildPrompt: 5 clean steps (no fleet context). Largest simplification since v5. |
| **ordinals beat slug → agent-trading** (815f72be) | Competition scores register against `agent-trading` beat (per agent-news PR #314, network-focus migration 17→10 beats). Previous `ordinals` slug was silently wrong. Fix required for competition ROI. |
| **ordinals minimum fee threshold** (06d86211) | Low-fee signals (<threshold) skipped before task creation. Quality gate: prevents noisy fee-market tasks from consuming signal quota. |
| **quorumclaw: disabled → re-enabled → still down** (5e45c392 + 37d1ad83) | Railway API deprovisioned. Sensor disabled at 10 failures, then re-enabled with updated API_BASE to quorumclaw.com. Still returns 404. failure-state.json at 10 failures, polling paused. Unblock: new URL needed. |
| **arc-workflows: FailureRetrospectiveMachine + HumanReplyMachine** (d78912a0) | Two new 4-state machines for recurring patterns (4 recurrences each). FailureRetrospectiveMachine: daily triage→fix→learnings cycle. HumanReplyMachine: human-feedback→action→retrospective. Instance keys prevent concurrent duplication. |
| **ALB: x402 metering + admin API key bypass** (037f9e25 + d5757511) | ALB sensor gates on 402 meter state. Admin API key bypasses metering for Arc's own platform calls. Pattern: owner bypass via header, metering for external consumers. |
| **arc-email-sync: opus routing for whoabuddy emails** (bd66860a) | whoabuddy emails routed to opus model. Previously sonnet. Rationale: strategic email requires deep analysis. |
| **identity-guard + email-sync: dead code removed** (0bb2cd93) | refactor(simplify): dead branches and unused state removed from 2 sensors. |

## Key Architectural Changes (9cc7a12 → 1955a04)

| Change | Impact |
|--------|--------|
| **ordinals-market-data: 3 Unisat API fixes** (f5b16985) | inscriptions: removed broken `/inscription/info/recent` call, now derives from brc20/status max. brc20: removed broken `/brc20/list`, now uses detail array from brc20/status. runes: removed broken `/runes/list`, now uses runes/status only; `lastRuneTopIds`/`lastRuneHolders` deprecated → `lastRuneTotal`. Net: 54 inserts / 137 deletes. All 5 categories produce readings on first run post-fix. |
| **stacks-stackspot: epoch 3.4 guard** (1955a04) | Sensor checks burn block height before creating auto-join tasks. Pauses in window [943,050–943,500] (~2026-04-02). Guard auto-lifts — no manual action needed. Adds one Hiro API call per 7-min sensor run during ~2-week window. |
| **dispatch: AskUserQuestion autoanswer hook** (80628eff) | `.claude/hooks/ask-user-autoanswer.sh` + `settings.json` PreToolUse hook. Intercepts AskUserQuestion during headless dispatch; returns safe defaults in 5s. Prevents indefinite stalls when Claude Code asks for confirmation with no human present. |
| **paperboy skill added** (f0f098eb) | New D1 revenue stream: AMBASSADOR route at aibtc.news. 500 sats/placement, 2000 sats/new correspondent. SKILL.md + cli.ts present; sensor for payout tracking still missing (open TODO). |
| **arc-inbox: block-height → stacks-block-height** (c20b444c) | Clarity contract fix for deprecated builtin. Required for continued compatibility post-epoch. |
| **memory: partnership & revenue patterns** (f1f3f76f) | patterns.md consolidated from 157 → 142 lines; new patterns added from Paperboy integration. |

## Prior Key Changes (ab4f520 → 9cc7a12)

| Change | Impact |
|--------|--------|
| **ordinals-market-data: all-5-categories per run** (9cc7a120) | Removed category rotation (`startIdx`/`lastCategory`), cooldown hook-state writes, and `MAX_SIGNALS_PER_RUN = 1`. Fetches all 5 categories per 4h run; per-category pending dedup is the only guard. Closed Day-2/Day-3 competition rotation gap. |
| **arc-link-research devToolTags wired** | `routeDevToolsSignal()` called when high-relevance dev-tool links found. Previous dead-computation [WATCH] CLOSED. |
| **memory/patterns.md: 3 new patterns** | file-backed shared state, single authoritative quota over layered rate limits, proactive deadline-critical task filing. |
