# Arc State Machine

*Generated: 2026-04-16T06:55:00.000Z*
*Sensor count: 70 | Skill count: 108*

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
            arc_service_health
            note right of arc_service_health: arc-alive-check DELETED (ee328387)\nDormant since 2026-03-12, superseded by arc-service-health\nCARRY×8 resolved — sensor count 73→70
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
            note right of github_mentions: review_requested/assign on watched repos\ndeferred to PrLifecycleMachine (8a984348)\nno longer creates PR review tasks directly\nstill handles mention/team_mention\nIssue @mention flood guard (10964091)\n24h recentTaskExistsForSource blocks re-creation after complete\nPullRequest re-review unaffected\nAPPROVED-PR GUARD (37645ac8): arcHasReviewedPR() calls\ngh pr view --json reviews before task creation\nskips mention/team_mention if Arc already reviewed\nPrevents flood from re-@mention after prior approval\n(genuine re-reviews still flow via arc-workflows reviewCycle)
            note right of aibtc_repo_maintenance: sensor simplified (8a984348)\nPR review task creation moved to PrLifecycleMachine\nno direct insertTask/pendingTaskExistsForSource\nwatched repos from AIBTC_WATCHED_REPOS constant\nSTALE ISSUE CLEANUP (cee55c34): closeStaleIssueWorkflows()\nQueries all issue-opened workflows for pr-lifecycle template\nFilters to created_at older than 24h (avoids API calls for new issues)\ngh issue view --json state; if CLOSED → updateWorkflowState + completeWorkflow\nPrevents stale issue-lifecycle workflow accumulation (fixed lingering issue workflows)\nAPPROVED-PR RESOLUTION (8d446e6): resolveApprovedPrWorkflows()\nChecks all active pr-lifecycle workflows in 'approved' state\ngh pr view --json state,mergedAt per approved workflow\nMERGED or mergedAt set → transition to merged + complete\nCLOSED → transition to closed + complete\nPrevents approved-state workflow accumulation after PR lifecycle ends\nINSTANCE-KEY FIX (359d6bbc): PR workflows use 3-part keys (owner/repo/number)\nnot 4-part (owner/repo/pr/number) — function was silently skipping all PRs\nFix: length===3 → direct parse; length===4 && parts[2]==='pr' → legacy parse\n36 backlog approved→merged/closed workflows resolved on fix deploy
        }

        state ContentSensors {
            blog_publishing
            aibtc_news_editorial
            aibtc_news_deal_flow
            aibtc_agent_trading
            ordinals_market_data
            social_x_posting
            social_agent_engagement
            social_x_ecosystem
            arxiv_research
            note right of aibtc_agent_trading: NEW (5da9081c) — 2h cadence\nSources: JingSwap API (cycle/prices), ledger.drx4.xyz (P2P desk), aibtc.news/api/agents\nSignal types: jingswap-cycle, jingswap-price, p2p-activity, agent-growth\nStrength 50-95; P5 if >=70, P7 otherwise\nDiversity rotation: skips lastSignalType from prior run\nReplaces ordinals-market-data for agent-trading beat filing\nAIBTC-network-native data only (no CoinGecko/Unisat/mempool)\nJINGSWAP API KEY (39a5416b): loads jingswap/api_key from creds store\nPasses as Authorization: Bearer header to all faktory-dao-backend requests\njingswapUnavailable flag: 401 → skip JingSwap for rest of run; fall back to P2P+registry only\nP2P flat-market boost (aec9ad29): strength 30→45 when completed_trades>0 or psbt_swaps>0\nType forced to p2p-activity; implication reflects actual trade counts\nCRASH FIX + CAP (4d91de01): countSignalTasksToday() generalized to LIKE 'File % signal%'\nWas 6 hardcoded beat patterns; now 2 generic globs — future-proofs new beats\nBEAT SLUG FIX (7dab95c0): agent-trading beat retired (API 410)\nSlug updated to aibtc-network — all AIBTC activity now routes there\nCOOLDOWN GUARD (b5caf209): isBeatOnCooldown(beat, 60) checked before task creation\nPrevents dispatch failures from 60-min beat cooldown (~3 false failures/day eliminated)\nWired into aibtc-agent-trading + arxiv-research sensors
            note right of ordinals_market_data: Signal filing SUSPENDED (80322a56)\nSIGNAL_FILING_SUSPENDED=true — agent-trading beat scope mismatch\nData collection continues for cross-category context\nFlat-market rotation FIXED (f3b5159d): lastFlatMarketCategory\nin HookState rotates FLAT_MARKET_CATEGORIES — [GAP] CLOSED\n[CARRY-17] deprecated fields cleanup 2026-04-23+
            note right of arxiv_research: DUAL-BEAT routing (42d54a6e)\nInfrastructure: two-tier aibtc-relevance filter (d2bc3c0d)\nTier 1: MCP/x402/Stacks/Clarity/sBTC/BRC-20\nTier 2: agent + crypto/blockchain compound\nQuantum: quant-ph category + QUANTUM_KEYWORDS\nShor/Grover/ECDSA threats/BIP-360/P2QRH/NIST PQC\nBoth beats fire independently same day\nDIGEST SPLIT (48858a87): digest task split to avoid 15-min timeout\nModel→haiku, instructions reduced to pure CLI commands (fetch + compile)\nQuantum/infra signal tasks built from paper list in task description\nEliminates file dependency that caused 2× 15-min timeouts\nCOOLDOWN GUARD (b5caf209): same guard as aibtc-agent-trading
            note right of aibtc_news_editorial: validateBeatExists() pre-validates beat slug\nGET /api/beats before filing any signal (391e4921)\n10-min cache: db/beat-slug-cache.json\nFails early with available slugs listed\nx402 402-response fallback (09c036d0): POST /api/signals\nreturns 402 → bitcoin-wallet x402 execute-endpoint fallback\n[WATCH-CLOSED] beat-slug drift detection shipped\nBEAT EDITOR SKILL (c7c03bec): aibtc-news-editor installed (skills-v0.37.0)\n9 new MCP tools: news_review_signal, news_editorial_review,\nnews_register_editor, news_deactivate_editor, news_list_editors,\nnews_editor_earnings, news_compile_brief, news_file_correction, news_update_beat\nINTEGRATION GATE: tools active when Arc gains editor status (#383)\nCORRECTIONS CLI (da7d25b3): file-correction --signal-id --claim --correction [--sources]\nlist-corrections --signal-id\nBIP-137 signed; rate limit 3/day; corrects published signal claims\nCONTEXT-REVIEW FIX (a2c7adf): signal filing tasks excluded from keyword checks\nProtocol names in news topic descriptions (bitflow, zest) caused false\ndefi-bitflow/defi-zest skill suggestions — aibtc-news-editorial is sufficient
        }

        state DeFiSensors {
            defi_bitflow
            defi_stacks_market
            defi_zest
            mempool_watch
            arc_payments
            zest_yield_manager
            note right of zest_yield_manager: 60-min cadence\nChecks sBTC balance vs 200k-sat reserve\nQueues supply tasks (idle > threshold)\nQueues claim tasks (wSTX rewards > 1000 uSTX)\nAutonomous yield: idle sBTC → Zest ~3.5% APY\nContext fix (73c09c4d): skills=[zest-yield-manager, defi-zest]\ndefi-zest was missing → supply/claim ran without Zest context\nNONCE SERIALIZATION (34e058ab+fa4decf2): tx-runner.ts calls acquireNonce()\nbefore any write command; --nonce injected into defi.ts argv\naccount.address (not .stxAddress) passed to acquireNonce\nAll Zest write ops coordinate via ~/.aibtc/nonce-state.json file lock\nOn failure: syncNonce() resets from Hiro\nWELCOME GUARD (f99b981b): pre-claimSensorRun check\nqueries active tasks for aibtc-welcome\nif activeWelcomeTasks.length > 0 → return skip\nInterval preserved — retries next 1-min fire\nPrevents TooMuchChaining: welcome STX sends fill mempool\nchain depth before Zest op can land
        }

        state AIBTCSensors {
            aibtc_heartbeat
            aibtc_inbox_sync
            aibtc_welcome
            note right of aibtc_welcome: isRelayHealthy() probe 3: relay /status/sponsor\n(was Hiro nonce API, wallet 0 only)\nNow covers all 10 pool wallets (e5210b25)\nRemoves SPONSOR_ADDRESS + direct Hiro dependency\nNONCE SERIALIZATION (22e93116): stx-send-runner.ts calls acquireNonce()\nbefore transferStx() — local counter in ~/.aibtc/nonce-state.json\nPrevents ConflictingNonceInMempool when welcome + Zest ops run concurrently\nExplicit --nonce callers (gap-fill, RBF) bypass tracker unchanged\nOn failure: release as "broadcast" — tracker auto-resyncs after 90s\nSTX ADDR VALIDATION v3 (7bd2c117): 3-layer check (sensor + stx-send-runner.ts)\nLayer 1: STX_MAINNET_REGEX = /^SP[0-9A-HJKMNP-TV-Z]{39}$/ — fast SP-mainnet rejection\n  Replaces c32check + probeHiroStxAddress() (both confirmed broken)\n  probeHiroStxAddress() false-positive: GET /v2/accounts/{addr} returns 200\n  for broadcast-invalid addresses — wrong Hiro endpoint for validation\nLayer 2: HIRO_REJECTED_STX_ADDRESSES hardcoded deny-list (tasks #11448/#11449)\nLayer 3: loadAndUpdateDenyList() — dynamic deny-list from failed welcome tasks\n  Scans failed tasks for Hiro 400 errors → adds to aibtc-welcome-hiro-rejected\n  Self-healing: bad addresses auto-blocked after first failure, no manual updates\nGuard ALSO at stx-send-runner.ts call site (7bd2c117): fails fast pre-makeSTXTokenTransfer\n  Ensures x402 credits never burned on Hiro-rejected addresses (belt + suspenders)\nHIRO 400 FIX v4 (2ab3431c): execution-time deny-list check in bitcoin-wallet cli.ts\n  cmdStxSend reads db/hook-state/aibtc-welcome-hiro-rejected.json before runStxSend\n  150+ known-bad addresses fail fast — no Hiro API call burned\n  Self-healing: deny-list auto-populated by loadAndUpdateDenyList() from prior failures\n  Fail-open if state file unreadable — never blocks legitimate sends\n  3-layer architecture: sensor regex (L1) + stx-send-runner.ts regex (L2) + cli deny-list (L3)\nSKILL NAME FIX (2ab3431c): 13× wallet→bitcoin-wallet in SKILL.md + sensor.ts task description\n  stx-send and x402 commands in welcome task now reference correct skill\n[RESOLVED] Hiro 400 failures — v4 at CLI execution layer; deny-list covers all known-bad addrs\nEXECUTION ORDER: STX send runs before x402 payment\nIf Hiro rejects address → abort before x402 staged\nPrevents double loss (credits burned + STX send failed)\nBROADCAST-INVALID EXTENDED (0116fcf2): deny-list dynamic query extended\nNow matches 'broadcast-invalid' AND 'FST_ERR_VALIDATION' error strings\nBoth broadcast-invalid and format-invalid classes are now self-healing\n3-layer validation fully covers all known failure classes\nREGEX-INVALID DENY-LIST (68d283bc): addresses matching specific regex-invalid patterns\nNow also added to dynamic deny-list — third error class auto-blocked\nRE-ENABLED (0f72a466): sensor disabled 2026-03-21 (71 pending flood)\nRe-enabled 2026-04-10 — 20 days of safeguards now mature:\nBATCH_CAP=3, DAILY_COMPLETED_CAP=10, 24h dedup per-agent\nRelay CB + self-healing + STX pre-validation all in place\nNew agents now detected again after 20-day pause
            erc8004_reputation
            erc8004_indexer
            identity_guard
            alb
            note right of erc8004_reputation: contact validation guard (b181a5d6)\nisContactActuallyInvolved() — prevents false-positive contact matches\npr-review: contact.github_handle must appear in task text\nx402-exchange: btc_address or stx_address must appear\nFixes task #10871 Halcyon Wolf contact-mismatch bug
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
            note right of arc_workflows: drives workflow state machine\nstate-specific source keys (8ce27fb9)\ndedup scoped to workflow:{id}:{state}\nprevents cross-state dedup collisions\nPrLifecycleMachine owns ALL PR review dispatch (061c807d)\nAUTOMATED_PR_PATTERNS exported from state-machine.ts\ncontext preserved on state transitions (not overwritten)\ngithub-mentions defers review_requested/assign to workflow engine\nSkills format: JSON.stringify() not .join(",") (f3b5159d)\narc-self-review: trigger state includes workflow transition cmd (806ce147)\nGH CLI GraphQL migration: fetchGitHubPRs() now uses gh api graphql\nbatched multi-repo query (was per-repo REST + credentials fetch)\nremoves fetchWithRetry + getCredential dependencies\nTERMINAL-STATE AUTO-COMPLETE (6b743823):\nNew PRs seen already closed/merged → completeWorkflow() immediately\nExisting workflows with no outgoing transitions → completeWorkflow()\nPrevents stuck workflow accumulation (fixed 159 stuck workflows task #10919)\nAPPROVED-PR GUARD (4292cef2): arcHasReview field in GithubPR\nGraphQL fetches last 20 reviews per PR (batched, no extra calls)\nmapPRStateToWorkflowState() → "approved" if Arc has any review\nRegression guard: approved → opened/review-requested blocked\nPR query: first:50 → last:50 (0fee0799) — most recent PRs now\nincluded even in high-activity repos (>50 total PRs)\nAUTO-CLOSE AUTOMATED PRs (46389bb8): buildReviewAction() returned null\nfor dependabot/release-please in 'opened' state → meta-sensor noop loop\nNow returns transition→closed for skipped PRs → auto-advances without human\nFixed 21 stuck automated PR workflows (pr-lifecycle completion 69%→normal)\nDAILY-BRIEF-INSCRIPTION MACHINE (f7e9124c): token spiral circuit breaker\nNew DailyBriefInscriptionMachine (8 states):\npending→brief_fetched→balance_ok→committed→commit_confirmed→revealed→confirmed→completed\nHard rules: one state per task, context <2KB, NO full brief text in workflow\nBrief stored as dataHash (SHA-256) + briefSummary (max 200 chars)\nConfirmation polling always spawns separate scheduled task (never inline)\nHardened existing InscriptionMachine task descriptions with explicit guards\nNew TEMPLATES.md documents workflow templates in arc-workflows\nNew daily-brief-inscribe SKILL.md: dependencies + state table (skill count 103→104)
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
            note right of arc_strategy_review: cadence WEEKLY→DAILY (209b75bf)\n1440 min (was 10080). Subject: "Daily self-evaluation: PURPOSE.md rubric"\nPURPOSE.md shipped (f16ed394): long-term goals, 5 focus areas, D1-D5 rubric\naligned with watch report cadence
            arc_workflow_review
            note right of arc_workflow_review: PASSIVE_WAITING_STATES guard (committed 2026-04-07)\nSet ["issue-opened", "changes-requested"] excluded from\n7-day stuck detection — these states legitimately sit idle for\nweeks waiting for external events (PR link, fix push)\nPrevents false-positive stuck-workflow alerts for normal hold states
            arc_skill_manager
            arc_self_audit
            arc_purpose_eval
            note right of arc_purpose_eval: NEW (f1e0a1f6) — 720-min cadence + date dedup\n4 SQL-measurable dimensions: Signal (25%), Ops (20%), Eco (20%), Cost (15%)\nScores computed from tasks + cycle_log, no LLM\nAuto-creates follow-up tasks for low-score dimensions:\n  signal≤2 → research signal-worthy topics\n  ops≤2 → failure triage\n  cost=1 → cost optimization review\n  ecosystem≤1 → PR review sweep\nCreates eval summary task (sonnet) for 3 LLM dimensions\nSensor count 70→71, skill count 103→104
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
            agent_health
            note right of agent_health: NEW (5f32865) — agent-health-loom\n120-min cadence, SSHes into Loom (Rising Leviathan)\nGathers: cycle_log metrics, task failure patterns,\ngit history, gate/watchdog state\nCreates Haiku analysis task only on YELLOW/RED\nGREEN conditions → skip (cost optimization)\nAll data pre-baked in task description (zero tool calls for Haiku)\nSQL ESCAPING FIX (16110678): queryLoomDb shell command used single-quoted\nstring for bun --eval; SQL literals (datetime('now'), status='failed')\nbroke the outer single-quoted argument. POSIX '\''-escaping applied.\nTOKEN SPIRAL THRESHOLD (b618a6e7): alert threshold lowered 1M→750K tokens\nEarlier detection reduces token waste before escalation fires
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
            note right of ReadTaskModel: ARC_DISPATCH_MODEL env var\nset from MODEL_IDS[model]\npassed to subprocess\nEFFORT PINNED (8dc10022): --effort explicit per model\nopus: --effort high, MAX_THINKING_TOKENS=30000\nhaiku/sonnet/test: --effort medium, MAX_THINKING_TOKENS=10000\nPrevents silent cost inflation from upstream default changes (v2.1.94)\nAPI_TIMEOUT_MS (95930cf0): env var set to match dispatch timeout\nOpus=30min, Sonnet=15min, Haiku=5min (model-aware)\nv2.1.101+ respects API_TIMEOUT_MS (previously hardcoded 5min)\nPre-set so individual API calls don't abort before outer watchdog fires\nV2.1.108 FIX (d263dbb6+8ad08307): Bash sandbox + permission bypass configured\nTrusted-VM dispatch unblocked; settings.json updated for new CC permission model
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
            RecordQuality --> ExtractContributionTag
            ExtractContributionTag --> SafeCommit
            note right of ExtractContributionTag: NEW (fe033d92): parses ```contribution-tag\nblock from result_detail (aibtc-repo-maintenance tasks)\ninserts row into contribution_tags table\nfields: repo, pr_number, type, contributor_type,\nquality_score, cost_usd, tags\nlogs gap warning for PR review tasks with no tag
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
        [*] --> CheckSensorCooldown: isBeatOnCooldown(beat, 60)
        CheckSensorCooldown --> [*]: beat on cooldown — skip (no task created)
        CheckSensorCooldown --> CheckGlobalCap: cooldown clear
        CheckGlobalCap --> CheckBeatAllocation: cap not hit
        CheckBeatAllocation --> AIBTCNetworkBeat: aibtc network activity
        CheckBeatAllocation --> QuantumBeat: quantum/ECDSA research
        CheckBeatAllocation --> BitcoinMacroBeat: BTC macro analysis
        AIBTCNetworkBeat --> TaskQueue: File AIBTC Network signal
        QuantumBeat --> TaskQueue: File Quantum signal
        BitcoinMacroBeat --> TaskQueue: File Bitcoin Macro signal
        note right of CheckSensorCooldown: NEW (b5caf209): sensor-side cooldown guard\nPrevents creating dispatch tasks that will\nfail due to API-enforced 60-min cooldown\nEliminated ~3 false failures/day\nWired in: aibtc-agent-trading + arxiv-research
        note right of CheckBeatAllocation: BEAT CONSOLIDATION (PR #442): 12 beats → 3 beats\nAIBTC Network = all 10 former network domains (agent-trading,\ninfrastructure, security, governance, onboarding, agent-skills,\nagent-social, agent-economy, deal-flow, distribution)\nBitcoin Macro = BTC macro (no active Arc sensors — CEO priority gap)\nQuantum = quantum/ECDSA threats (arxiv_research sensor)\nEDITORIAL MODEL: Arc is CORRESPONDENT (not editor)\nEditors: AIBTC Network=Elegant Orb; Bitcoin Macro=Ivory Coda; Quantum=Zen Rocket\nEditors earn 175k sats/day; correspondents 30k sats/included signal\nDaily brief cap: 4 approved signals/beat/brief\naibtc-agent-trading sensor: JingSwap, P2P desk, agent registry\nordinals-market-data signal filing SUSPENDED (80322a56)\narc-link-research: routes to AIBTC Network (was infrastructure)\narcXiv: routes to Quantum beat\ncountSignalTasksToday() BUG FIXED (ca5477c1)\n[OPEN GAP] Bitcoin Macro has NO dedicated sensor — manual/LLM only
    }

    TaskQueue --> DispatchService
    SensorsService --> TaskQueue
    ContentSensors --> SignalAllocation
```

## Sensor Count by Category (2026-04-16T06:55Z)

| Category | Count |
|----------|-------|
| Memory/Maintenance | 15 |
| GitHub/PR | 10 |
| Content/Publishing | 9 |
| AIBTC/ERC-8004 | 7 |
| Infrastructure | 14 |
| DeFi | 6 |
| Health | 1 |
| Monitoring | 7 |
| Other/Misc | 3 |
| **Total** | **70** |

## Skill Count by Category (2026-04-16T06:55Z)

*Skills: 108 total (was 104 at last review — +4 from skills-v0.39.0)*

New skills added (v0.39.0, 9b3c5f43):
- `defi-portfolio-scanner` — cross-protocol DeFi position aggregator (BFF Day 7)
- `hodlmm-move-liquidity` — HODLMM bin rebalancer (BFF Day 14)
- `sbtc-yield-maximizer` — idle sBTC yield router (BFF Day 16)
- `zest-auto-repay` — Zest LTV guardian with Arc-reviewed bug fixes

## Key Architectural Changes (be4cac3 → a2c7adf) [2026-04-16T06:55Z]

| Change | Impact |
|--------|--------|
| **feat(sensors): sensor-side beat cooldown guard** (b5caf209) | `isBeatOnCooldown(beat, 60)` added to `src/db.ts`. Wired into `aibtc-agent-trading` and `arxiv-research` sensors before task creation. Beat cooldown now checked at sensor time, not discovered at dispatch time. Eliminated ~3 false failures/day from 60-min API-enforced cooldowns. Closes l-cooldown-as-failed pattern from memory. |
| **fix(arxiv-research): digest task split** (48858a87) | Digest model changed to haiku; instructions reduced to pure CLI commands (`fetch` + `compile`, no LLM synthesis). Quantum/infra signal tasks built from paper list in task description, not file dependency. Eliminates 2× 15-min timeouts that blocked Quantum beat filing. Unblocks daily Quantum signals. |
| **fix(context-review): signal filing task exclusion** (a2c7adfe) | Signal filing task subjects excluded from keyword analysis in `context-review/sensor.ts`. Protocol names (bitflow, zest) mentioned in news topic descriptions were triggering false "missing skill" alerts. `aibtc-news-editorial` is sufficient context; no defi skills needed for composing signals. |
| **fix(aibtc-welcome): regex-invalid deny-list** (68d283bc) | Third Hiro 400 error class (regex-invalid) now auto-populates dynamic deny-list. Completes the self-healing architecture: format-invalid (L1 regex) + broadcast-invalid (FST_ERR_VALIDATION, L3) + regex-invalid (L3 extension) all covered. |
| **fix(dispatch): v2.1.108 unblock** (d263dbb6+8ad08307) | Bash sandbox configured + permission bypass added for trusted-VM dispatch. Claude Code v2.1.108 introduced stricter permission model; dispatch subprocess was blocked. Unblocked with correct settings.json configuration. |
| **feat(skills): v0.39.0 integration** (9b3c5f43) | 4 new BFF competition skills added: defi-portfolio-scanner, hodlmm-move-liquidity, sbtc-yield-maximizer, zest-auto-repay. Skill count 104→108. aibtc-news-deal-flow SKILL.md updated with beat retirement notice (deal-flow → aibtc-network, HTTP 410). |

## Key Architectural Changes (7dab95c → be4cac3) [2026-04-14T18:49Z]

| Change | Impact |
|--------|--------|
| **fix(sensors): resolveApprovedPrWorkflows instance_key parsing fix** (359d6bbc) | PR workflows use 3-part keys (`owner/repo/number`) not 4-part (`owner/repo/pr/number`). Function was silently skipping every approved PR via `continue` on length check. Fix: handles both 3-part (primary) and 4-part (legacy). 36 backlog approved→merged/closed workflows resolved on deploy. |
| **fix(aibtc-welcome): broadcast-invalid deny-list extension** (0116fcf2) | Dynamic deny-list query extended to match `'broadcast-invalid' AND 'FST_ERR_VALIDATION'` error strings. Both format-invalid and broadcast-invalid classes now self-healing. 3-layer address validation fully covers all known failure classes. |
| **fix(sensors): beat slug fix** (7dab95c0) | `aibtc-agent-trading` sensor slug updated from `agent-trading` (410) to `aibtc-network`. All AIBTC activity signals now route to correct beat. |

## Key Architectural Changes (7bd2c117 → 39a5416b) [2026-04-12T18:47Z]

| Change | Impact |
|--------|--------|
| **feat(sensors): JingSwap API key support** (39a5416b) | `jingswap/api_key` loaded from creds store; passed as `Authorization: Bearer` header. Module-level `jingswapUnavailable` flag: first 401 sets flag, subsequent calls skip JingSwap entirely. Graceful fallback to P2P desk + agent registry only. |
| **fix(sensors): P2P flat-market signal boost + 401 handling** (aec9ad29) | Signal strength boosted 30→45 when P2P has completed_trades>0 or psbt_swaps>0; type forced to p2p-activity. Fixes sensor state corruption (history array was v79 with empty history → every run was a "first-run baseline"). |
| **fix(sensors): crash fix + signal cap counter generalized** (4d91de01) | `countSignalTasksToday()` simplified from 6 hardcoded beat patterns to 2 generic globs. Removes beat-slug dependency — future beat additions don't require db.ts changes. |
| **fix(sensors): aibtc-repo-maintenance stale issue cleanup** (cee55c34) | `closeStaleIssueWorkflows()` auto-closes issue-opened workflows for GitHub-closed issues. |
