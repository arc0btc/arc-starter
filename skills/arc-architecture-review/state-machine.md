# Arc State Machine

*Generated: 2026-04-13T18:48:00.000Z*
*Sensor count: 70 | Skill count: 104*

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
            note right of aibtc_repo_maintenance: sensor simplified (8a984348)\nPR review task creation moved to PrLifecycleMachine\nno direct insertTask/pendingTaskExistsForSource\nwatched repos from AIBTC_WATCHED_REPOS constant\nSTALE ISSUE CLEANUP (cee55c34): closeStaleIssueWorkflows()\nQueries all issue-opened workflows for pr-lifecycle template\nFilters to created_at older than 24h (avoids API calls for new issues)\ngh issue view --json state; if CLOSED → updateWorkflowState + completeWorkflow\nPrevents stale issue-lifecycle workflow accumulation (fixed lingering issue workflows)\nAPPROVED-PR RESOLUTION (8d446e6): resolveApprovedPrWorkflows()\nChecks all active pr-lifecycle workflows in 'approved' state\ngh pr view --json state,mergedAt per approved workflow\nMERGED or mergedAt set → transition to merged + complete\nCLOSED → transition to closed + complete\nPrevents approved-state workflow accumulation after PR lifecycle ends
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
            note right of aibtc_agent_trading: NEW (5da9081c) — 2h cadence\nSources: JingSwap API (cycle/prices), ledger.drx4.xyz (P2P desk), aibtc.news/api/agents\nSignal types: jingswap-cycle, jingswap-price, p2p-activity, agent-growth\nStrength 50-95; P5 if >=70, P7 otherwise\nDiversity rotation: skips lastSignalType from prior run\nReplaces ordinals-market-data for agent-trading beat filing\nAIBTC-network-native data only (no CoinGecko/Unisat/mempool)\nJINGSWAP API KEY (39a5416b): loads jingswap/api_key from creds store\nPasses as Authorization: Bearer header to all faktory-dao-backend requests\njingswapUnavailable flag: 401 → skip JingSwap for rest of run; fall back to P2P+registry only\nP2P flat-market boost (aec9ad29): strength 30→45 when completed_trades>0 or psbt_swaps>0\nType forced to p2p-activity; implication reflects actual trade counts\nCRASH FIX + CAP (4d91de01): countSignalTasksToday() generalized to LIKE 'File % signal%'\nWas 6 hardcoded beat patterns; now 2 generic globs — future-proofs new beats
            note right of ordinals_market_data: Signal filing SUSPENDED (80322a56)\nSIGNAL_FILING_SUSPENDED=true — agent-trading beat scope mismatch\nData collection continues for cross-category context\nFlat-market rotation FIXED (f3b5159d): lastFlatMarketCategory\nin HookState rotates FLAT_MARKET_CATEGORIES — [GAP] CLOSED\n[CARRY-17] deprecated fields cleanup 2026-04-23+
            note right of arxiv_research: DUAL-BEAT routing (42d54a6e)\nInfrastructure: two-tier aibtc-relevance filter (d2bc3c0d)\nTier 1: MCP/x402/Stacks/Clarity/sBTC/BRC-20\nTier 2: agent + crypto/blockchain compound\nQuantum: quant-ph category + QUANTUM_KEYWORDS\nShor/Grover/ECDSA threats/BIP-360/P2QRH/NIST PQC\nBoth beats fire independently same day
            note right of aibtc_news_editorial: validateBeatExists() pre-validates beat slug\nGET /api/beats before filing any signal (391e4921)\n10-min cache: db/beat-slug-cache.json\nFails early with available slugs listed\nx402 402-response fallback (09c036d0): POST /api/signals\nreturns 402 → bitcoin-wallet x402 execute-endpoint fallback\n[WATCH-CLOSED] beat-slug drift detection shipped\nBEAT EDITOR SKILL (c7c03bec): aibtc-news-editor installed (skills-v0.37.0)\n9 new MCP tools: news_review_signal, news_editorial_review,\nnews_register_editor, news_deactivate_editor, news_list_editors,\nnews_editor_earnings, news_compile_brief, news_file_correction, news_update_beat\nINTEGRATION GATE: tools active when Arc gains editor status (#383)\nCORRECTIONS CLI (da7d25b3): file-correction --signal-id --claim --correction [--sources]\nlist-corrections --signal-id\nBIP-137 signed; rate limit 3/day; corrects published signal claims
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
            note right of aibtc_welcome: isRelayHealthy() probe 3: relay /status/sponsor\n(was Hiro nonce API, wallet 0 only)\nNow covers all 10 pool wallets (e5210b25)\nRemoves SPONSOR_ADDRESS + direct Hiro dependency\nNONCE SERIALIZATION (22e93116): stx-send-runner.ts calls acquireNonce()\nbefore transferStx() — local counter in ~/.aibtc/nonce-state.json\nPrevents ConflictingNonceInMempool when welcome + Zest ops run concurrently\nExplicit --nonce callers (gap-fill, RBF) bypass tracker unchanged\nOn failure: release as "broadcast" — tracker auto-resyncs after 90s\nSTX ADDR VALIDATION v3 (7bd2c117): 3-layer check (sensor + stx-send-runner.ts)\nLayer 1: STX_MAINNET_REGEX = /^SP[0-9A-HJKMNP-TV-Z]{39}$/ — fast SP-mainnet rejection\n  Replaces c32check + probeHiroStxAddress() (both confirmed broken)\n  probeHiroStxAddress() false-positive: GET /v2/accounts/{addr} returns 200\n  for broadcast-invalid addresses — wrong Hiro endpoint for validation\nLayer 2: HIRO_REJECTED_STX_ADDRESSES hardcoded deny-list (tasks #11448/#11449)\nLayer 3: loadAndUpdateDenyList() — dynamic deny-list from failed welcome tasks\n  Scans failed tasks for Hiro 400 errors → adds to aibtc-welcome-hiro-rejected\n  Self-healing: bad addresses auto-blocked after first failure, no manual updates\nGuard ALSO at stx-send-runner.ts call site (7bd2c117): fails fast pre-makeSTXTokenTransfer\n  Ensures x402 credits never burned on Hiro-rejected addresses (belt + suspenders)\nHIRO 400 FIX v4 (2ab3431c): execution-time deny-list check in bitcoin-wallet cli.ts\n  cmdStxSend reads db/hook-state/aibtc-welcome-hiro-rejected.json before runStxSend\n  150+ known-bad addresses fail fast — no Hiro API call burned\n  Self-healing: deny-list auto-populated by loadAndUpdateDenyList() from prior failures\n  Fail-open if state file unreadable — never blocks legitimate sends\n  3-layer architecture: sensor regex (L1) + stx-send-runner.ts regex (L2) + cli deny-list (L3)\nSKILL NAME FIX (2ab3431c): 13× wallet→bitcoin-wallet in SKILL.md + sensor.ts task description\n  stx-send and x402 commands in welcome task now reference correct skill\n[RESOLVED] Hiro 400 failures — v4 at CLI execution layer; deny-list covers all known-bad addrs\nEXECUTION ORDER: STX send runs before x402 payment\nIf Hiro rejects address → abort before x402 staged\nPrevents double loss (credits burned + STX send failed)\nRE-ENABLED (0f72a466): sensor disabled 2026-03-21 (71 pending flood)\nRe-enabled 2026-04-10 — 20 days of safeguards now mature:\nBATCH_CAP=3, DAILY_COMPLETED_CAP=10, 24h dedup per-agent\nRelay CB + self-healing + STX pre-validation all in place\nNew agents now detected again after 20-day pause
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
            note right of ReadTaskModel: ARC_DISPATCH_MODEL env var\nset from MODEL_IDS[model]\npassed to subprocess\nEFFORT PINNED (8dc10022): --effort explicit per model\nopus: --effort high, MAX_THINKING_TOKENS=30000\nhaiku/sonnet/test: --effort medium, MAX_THINKING_TOKENS=10000\nPrevents silent cost inflation from upstream default changes (v2.1.94)\nAPI_TIMEOUT_MS (95930cf0): env var set to match dispatch timeout\nOpus=30min, Sonnet=15min, Haiku=5min (model-aware)\nv2.1.101+ respects API_TIMEOUT_MS (previously hardcoded 5min)\nPre-set so individual API calls don't abort before outer watchdog fires
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
        [*] --> CheckGlobalCap: 4/beat/brief cap
        CheckGlobalCap --> CheckBeatAllocation: cap not hit
        CheckBeatAllocation --> AIBTCNetworkBeat: aibtc network activity
        CheckBeatAllocation --> QuantumBeat: quantum/ECDSA research
        AIBTCNetworkBeat --> TaskQueue: File AIBTC Network signal
        QuantumBeat --> TaskQueue: File Quantum signal
        note right of CheckBeatAllocation: BEAT CONSOLIDATION (PR #442): 12 beats → 3 beats\nAIBTC Network = all 10 former network domains (agent-trading,\ninfrastructure, security, governance, onboarding, agent-skills,\nagent-social, agent-economy, deal-flow, distribution)\nBitcoin Macro = BTC macro (no active Arc sensors)\nQuantum = quantum/ECDSA threats (arxiv_research sensor)\nEDITORIAL MODEL: Arc is CORRESPONDENT (not editor)\nEditors: AIBTC Network=Elegant Orb; Bitcoin Macro=Ivory Coda; Quantum=Zen Rocket\nEditors earn 175k sats/day; correspondents 30k sats/included signal\nDaily brief cap: 4 approved signals/beat/brief\naibtc-agent-trading sensor: JingSwap, P2P desk, agent registry\nordinals-market-data signal filing SUSPENDED (80322a56)\narc-link-research: routes to AIBTC Network (was infrastructure)\narcXiv: routes to Quantum beat\ncountSignalTasksToday() BUG FIXED (ca5477c1)\n[CLOSED] flat-market rotation (moot — filing suspended)
    }

    TaskQueue --> DispatchService
    SensorsService --> TaskQueue
    ContentSensors --> SignalAllocation
```

## Sensor Count by Category (2026-04-12T18:47Z)

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
| **Total** | **72** |

*Note: arc-alive-check DELETED (ee328387) — Health: 2→1, sensor count 73→70 (file count). arc-purpose-eval NEW (f1e0a1f6) — 70→71. aibtc-agent-trading NEW (5da9081c) — 68→69. daily-brief-inscribe SKILL.md NEW (f7e9124c) — skill count 103→104.*

## Key Architectural Changes (7bd2c117 → 39a5416b) [2026-04-12T18:47Z]

| Change | Impact |
|--------|--------|
| **feat(sensors): JingSwap API key support** (39a5416b) | `jingswap/api_key` loaded from creds store; passed as `Authorization: Bearer` header to all faktory-dao-backend requests. Module-level `jingswapUnavailable` flag: first 401 sets flag, subsequent calls skip JingSwap entirely (avoids N×401 per run). Graceful fallback to P2P desk + agent registry only. Fixes signal drought caused by API key requirement introduced on faktory-dao-backend. |
| **fix(sensors): P2P flat-market signal boost + 401 handling** (aec9ad29) | When `jingswapUnavailable=true`, flat-market fallback still runs using P2P data. Signal strength boosted 30→45 when P2P has `completed_trades>0 or psbt_swaps>0`; type forced to `p2p-activity` with trade-count implication. Fixes sensor state corruption (`history` array was version 79 with empty history → every run was a "first-run baseline"). History restored; P2P-driven signals now viable even without JingSwap. |
| **fix(sensors): crash fix + signal cap counter generalized** (4d91de01) | `countSignalTasksToday()` in `src/db.ts` simplified from 6 hardcoded beat-specific `LIKE` patterns to 2 generic globs (`LIKE 'File % signal%'` and `LIKE '[MILESTONE] File % signal%'`). Removes dependency on specific beat slugs — future beat additions don't require db.ts changes. Crash fix for sensor runtime error on state access. |
| **fix(sensors): aibtc-repo-maintenance stale issue cleanup** (cee55c34) | New `closeStaleIssueWorkflows()` function. Queries `issue-opened` workflows from `pr-lifecycle` template older than 24h; checks GitHub issue state via `gh issue view --json state`; auto-closes workflow if `CLOSED`. Prevents stale issue-opened workflow accumulation without human intervention. |

## Key Architectural Changes (4bb84aee → 7bd2c117) [2026-04-12T06:45Z]

| Change | Impact |
|--------|--------|
| **fix(aibtc-welcome): STX addr validation v3 — sensor overhaul** | Removed `probeHiroStxAddress()` — confirmed false-positive (GET /v2/accounts/{addr} returns 200 for broadcast-invalid addresses, wrong endpoint). Replaced with `STX_MAINNET_REGEX = /^SP[0-9A-HJKMNP-TV-Z]{39}$/` for fast Layer 1 rejection. Added `loadAndUpdateDenyList()` (Layer 3) — auto-populates dynamic deny-list from failed welcome tasks stored in HookState `aibtc-welcome-hiro-rejected`. Self-healing: bad addresses blocked after first failure. Complements v3 call-site guard. |
| **fix(aibtc-welcome): add mainnet address guard at STX send call site** (7bd2c117) | SP-mainnet regex check added to `stx-send-runner.ts` lines 66–77, immediately before `makeSTXTokenTransfer` call. Belt-and-suspenders: even if sensor validation is bypassed or a queued pre-fix task runs, the call site rejects non-mainnet addresses without burning x402 credits or nonce slots. Root cause history: v1 at sensor time (wrong), v2 in wrong file, v3 at actual call site (correct). Last Hiro 400 failure: task #12246 at 20:28 UTC Apr 11. |
| **fix(loom): add DailyBriefInscriptionMachine to prevent token spiral** (f7e9124c) | New `DailyBriefInscriptionMachine` in `arc-workflows/state-machine.ts`. 8 states with single-state-per-task discipline, context hard cap <2KB, no full brief text in workflow (only dataHash + briefSummary). Confirmation polling spawns a separate scheduled task — never polls inline. Hardened existing InscriptionMachine task descriptions with explicit single-state guards. Root cause of ~1.25–1.8M token spikes in tasks #12193 + #12201: multi-state advancement loading 33K+ chars of brief content per step. New `skills/daily-brief-inscribe/SKILL.md` documents the workflow. |
| **fix(agent-health): lower Loom token spiral threshold 1M→750K** (b618a6e7) | Alert threshold for Loom token spiral detection lowered from 1M to 750K tokens. Earlier detection reduces token waste before the escalation fires. |

## Key Architectural Changes (0f72a466 → 4bb84aee) [2026-04-11T06:45Z]

| Change | Impact |
|--------|--------|
| **chore(sensors): delete arc-alive-check** (ee328387) | Dormant sensor finally removed after 8 consecutive architecture review carries. Superseded by arc-service-health. Sensor count 73→70. |
| **fix(aibtc-welcome): probe-based Hiro address validation** (4bb84aee) | `probeHiroStxAddress()` added as Layer 3 of address validation. Async GET /v2/accounts/{addr} with 5s timeout, fail-open on network error. Catches addresses that pass c32check but fail Hiro pattern check at broadcast. Drop from 135 Hiro 400 failures/period to ~10 (residual pre-fix backlog). |
| **fix(dispatch): API_TIMEOUT_MS model-aware timeout** (95930cf0) | `API_TIMEOUT_MS` env var set in dispatch subprocess env, matching model dispatch timeout (Opus=30min, Sonnet=15min, Haiku=5min). v2.1.101+ respects this var (was hardcoded 5min). Prevents individual API calls from aborting before outer watchdog fires. |

## Key Architectural Changes (a1188d37 → 0f72a466) [2026-04-10T18:50Z]

| Change | Impact |
|--------|--------|
| **fix(aibtc-welcome): re-enable sensor** (0f72a466) | Sensor was disabled 2026-03-21 after a 71-task flood. Re-enabled 2026-04-10 after 20 days of maturing safeguards: BATCH_CAP=3, DAILY_COMPLETED_CAP=10, 24h per-agent dedup, relay CB + self-healing, STX address pre-validation + deny list, execution order fix. New agents are now detected again. All safeguards were already in place from prior commits — this was a one-line enable. |
| **feat(aibtc-news-editorial): file-correction + list-corrections CLI** (da7d25b3) | New CLI commands for filing and listing corrections on published signals. `file-correction --signal-id --claim --correction [--sources]` — BIP-137 signed, rate-limited to 3/day. `list-corrections --signal-id` — reads corrections from API. Enables Arc to correct factual errors in its published signals without re-filing. |
| **BEAT CONSOLIDATION (external PR #442)** | Platform consolidated 12 beats → 3: AIBTC Network (all 10 former network domains), Bitcoin Macro, Quantum. Beat-diversity competition strategy (claim all 12) is now INVALID. Arc is a CORRESPONDENT, not an editor. Editors earn 175k sats/day; correspondents 30k sats/included signal. 4 approved signals/beat/brief cap. |
| **feat(claude-code-releases): applicability report v2.1.100** (6dcdf3e5) | Research report for Claude Code v2.1.100 release. Tracks `--exclude-dynamic-system-prompt-sections` flag (v2.1.98) for prompt caching optimization. Non-architectural; informational. |

## Key Architectural Changes (1611067 → a1188d37) [2026-04-09T06:50Z]

| Change | Impact |
|--------|--------|
| **fix(zest-yield-manager): welcome-task guard** (f99b981b) | Pre-claim check: queries active tasks for `aibtc-welcome` before `claimSensorRun()`. If any welcome tasks are active, returns `"skip"` immediately — interval is preserved, sensor retries on next 1-min timer. Prevents TooMuchChaining: concurrent welcome STX sends saturate the Stacks mempool chain depth, making Zest supply ops fail. Root cause of 15/57 (29%) failures in day-19 retro. |
| **fix(aibtc-welcome): STX address validation + execution order** (b78313ad) | Two-layer STX address validation at sensor level: (1) c32check format/checksum/length, (2) HIRO_REJECTED_STX_ADDRESSES deny list. Invalid addresses skip task creation entirely — no x402 credit burn. Execution order fix: STX transfer runs before x402 payment in dispatch instructions. Addresses 29/57 (57%) failure class from day-19 retro where x402 staged successfully but STX send was rejected post-payment (double loss). |
| **chore(memory): patterns.md consolidation** (4f5ecd18) | 161→142 lines, 10→5 merged patterns. No information loss. |

## Key Architectural Changes (2d7a735a → 1611067) [2026-04-08T18:50Z]

| Change | Impact |
|--------|--------|
| **feat(arc-purpose-eval): data-driven PURPOSE eval sensor** (f1e0a1f6) | New sensor + skill in MemoryMaintenanceSensors. Scores 4 SQL-measurable PURPOSE dimensions (Signal 25%, Ops 20%, Ecosystem 20%, Cost 15%) from `tasks` and `cycle_log` tables. No LLM calls. 720-min interval + date-based dedup. Auto-creates follow-up tasks when scores are low. Creates sonnet eval task for 3 LLM-only dimensions. Sensor count 70→71, skill count 103→104. Complements `arc-strategy-review` by doing quantitative scoring first. |
| **fix(arc-workflows): auto-close automated PR workflows** (46389bb8) | `buildReviewAction()` returned `null` for automated PRs (dependabot, release-please) in `opened` state — meta-sensor would noop indefinitely, creating stuck workflow accumulation. Fix: return `{ transition: 'closed' }` for null-action PRs so meta-sensor auto-advances via `completeWorkflow()`. Fixed 21 stuck automated PR workflows; pr-lifecycle completion rate recovered from ~69%. |
| **fix(agent-health): escape single quotes in queryLoomDb** (16110678) | SSH-executed `bun --eval` script used single-quoted outer argument. SQL literals with single quotes (`datetime('now')`, `status = 'failed'`) broke the shell argument boundary. POSIX `'\''` escaping applied to embedded SQL before shell injection. Agent-health Loom queries now function correctly. |

## Key Architectural Changes (f4b88223 → 2d7a735a) [2026-04-08T07:10Z]

| Change | Impact |
|--------|--------|
| **fix(defi-zest+bitcoin-wallet): nonce serialization** (22e93116, 34e058ab, fa4decf2) | Root cause of day-17–19 ConflictingNonceInMempool cascade: Zest tx-runner and stx-send-runner both fetched nonce from Hiro independently. When a welcome STX send had incremented the local counter but Hiro hadn't confirmed yet, both got nonce N → conflict. Fix: `stx-send-runner.ts` calls `acquireNonce()` before `transferStx()`; `tx-runner.ts` calls `acquireNonce()` and injects `--nonce` into `defi.ts` argv. All STX-sending paths now coordinate via `~/.aibtc/nonce-state.json` file lock. On failure: conservative "broadcast" release + 90s auto-resync from Hiro. Also fixed `account.address` (was `.stxAddress` — undefined → Hiro 400 on every Zest write). |
| **feat(contribution-tags): Phase 1 schema + extraction** (fe033d92) | New `contribution_tags` table in `src/db.ts` with indexes on repo/type/contributor/tagged_at. `src/contribution-tags.ts` adds `extractContributionTagFromText()` + `insertContributionTag()`. `dispatch.ts` PostDispatch phase now parses ` ```contribution-tag ` block from `result_detail` and inserts row. `aibtc-repo-maintenance/AGENT.md` step 8 instructs dispatched agents to emit tags. Enables PR review quality/cost attribution at the repo+type level. |
| **feat(web): /api/contributions endpoints** (2f60e5e3) | Phase 2: `GET /api/contributions?period=day\|week\|month` returns aggregates (by_type, by_repo, by_contributor_type, review_velocity, review_quality, cost). `GET /api/contributions/stream?limit=N` returns last N tagged contributions. `GET /api/status` enhanced with `contributions_today` summary (reviews, features, bugfixes, blocking_issues). |
| **feat(aibtc-news-editor): install beat editor skill** (c7c03bec) | `aibtc-news-editor` skill installed from skills-v0.37.0. 9 MCP tools for agent-news beat editor delegation (news_review_signal, news_editorial_review, news_register_editor, etc.). Integration gate: tools active when Arc gains beat editor status (auditioned for Infrastructure beat, issue #383). Skill count 102→103. |
| **fix(dispatch): pin effort level + thinking token cap** (8dc10022) | v2.1.94 changed upstream default effort from medium→high. Arc was uncapped for opus cycles. Fix: opus gets `--effort high, MAX_THINKING_TOKENS=30000`; haiku/sonnet/test get `--effort medium, MAX_THINKING_TOKENS=10000`. All explicit — future upstream default changes cannot silently inflate cost. |
| **feat(dispatch): sessionTitle in UserPromptSubmit hook** (b1c051e0) | Session title set to `task #{id}: {subject}` via `ARC_TASK_ID`/`ARC_TASK_SUBJECT` env vars. Dispatch logs now show readable task context. |
| **fix(context-review): bypass llms.txt + presentation.html tasks** (4cbfcc4b, 2d7a735a) | `context-review/sensor.ts` now skips keyword analysis for tasks with subject matching `Update llms` or `presentation.html`. Release-note enumeration of BFF skill names triggered false DeFi context alerts. Subject-prefix bypass pattern consistent with existing exclusion logic. |

## Key Architectural Changes (0fee0799 → f4b88223) [2026-04-07T18:37Z]

| Change | Impact |
|--------|--------|
| **fix(arc-link-research): beat slug dev-tools→infrastructure** (f4b88223) | `routeDevToolsSignal()` renamed `routeInfrastructureSignal()`. Signal task subject and CLI commands updated from `dev-tools` → `infrastructure` beat. Added filter: skip links where content couldn't be extracted (`review manually` in takeaways). `SignalAllocation` diagram updated: `DevToolsBeat` → `InfrastructureBeat`. |
| **fix(zest-yield-manager): add defi-zest to supply+claim task skills** (73c09c4d) | Supply and claim tasks were created with `skills: ["zest-yield-manager"]` only — `defi-zest` was missing. The dispatched agent had no Zest protocol context. Fix: `skills: ["zest-yield-manager", "defi-zest"]` for both task types. Self-caught by context-review sensor mid-session (#11233). 7 supply ops pre-fix ran without full context. |
| **fix(arc-workflow-review): PASSIVE_WAITING_STATES guard** | `PASSIVE_WAITING_STATES = new Set(["issue-opened", "changes-requested"])` excluded from 7-day stuck workflow detection. These states are designed to wait indefinitely for external events (a PR to link, a fix push). Without the guard, legitimately-idle workflows fired false-positive stuck alerts on every cycle. |
| **feat(presentation): Tuesday deck updated** (f4b88223, 3ae91a18) | `src/web/presentation.html` updated with research pipeline + ecosystem slides per whoabuddy feedback. Non-architectural. |
| **chore(memory): patterns.md consolidation** (ef90162b) | `memory/patterns.md` condensed 169→127 lines. No information loss; duplicate patterns merged. |

## Key Architectural Changes (5f32865 → 0fee0799) [2026-04-07T07:00Z]

| Change | Impact |
|--------|--------|
| **fix(github-mentions): approved-PR guard** (37645ac8) | Added `arcHasReviewedPR()` helper — calls `gh pr view --json reviews` before creating a task for `@mention`/`team_mention` notifications on watched repos. Skips task creation if `arc0btc` already has any review. Prevents the re-@mention flood class (days 17–18: 30/33 failures were duplicates). Zero overhead when mention is not a PR. |
| **fix(arc-workflows): approved-PR guard + regression block** (4292cef2) | Added `arcHasReview` field to `GithubPR`. GraphQL query now fetches `last: 20 reviews` per PR (batched — no extra network calls). `mapPRStateToWorkflowState()` returns `"approved"` when Arc has any review. Regression guard prevents `approved → opened/review-requested` transitions from new commits. Complementary to github-mentions guard — both sensors can create tasks independently, so both need the gate. |
| **fix(arc-workflows): PR query first→last** (0fee0799) | `pullRequests(first: 50)` → `pullRequests(last: 50)` in GraphQL batch query. Ensures the most recent 50 PRs are included per repo. Previously `first:50` on high-activity repos (>50 PRs) would miss all recent PRs. Silent behavioral correction. |
| **feat(constants): aibtcdev/tx-schemas to watched repos** (2cb79ad2) | `tx-schemas` added to `AIBTC_WATCHED_REPOS`. Propagates monitoring to: `github-mentions`, `aibtc-repo-maintenance`, `arc-workflows`, `arc0btc-security-audit` sensors. tx-schemas is the canonical schema package for x402/relay/inbox payloads — appropriate for watched scope. |

## Key Architectural Changes (bfc0b478 → 24bbee7f) [2026-04-06T06:47Z]

| Change | Impact |
|--------|--------|
| **feat(aibtc-agent-trading): new sensor** (5da9081c) | 2-hour sensor monitoring JingSwap cycle/prices, P2P ordinals desk (ledger.drx4.xyz), and agent registry growth. Files `agent-trading` beat signals using AIBTC-network-native data only. Signal types: `jingswap-cycle`, `jingswap-price`, `p2p-activity`, `agent-growth`. Diversity rotation via `lastSignalType` in HookState. Replaces ordinals-market-data for agent-trading beat. Sensor count 68→69, skill count 100→101. |
| **fix(ordinals-market-data): suspend signal filing** (80322a56) | `SIGNAL_FILING_SUSPENDED = true` — agent-trading beat scope mismatch (beat requires AIBTC-network data, not external CoinGecko/Unisat/mempool). Data collection continues for cross-category context. Agent-trading signal filing fully transferred to `aibtc-agent-trading` sensor. |
| **fix(ordinals-market-data): flat-market category rotation** (f3b5159d) | `lastFlatMarketCategory` added to HookState. `buildFlatMarketSignal()` deprioritizes last-used category — [GAP] from prior audit CLOSED. (Moot now that signal filing is suspended, but correct for future reuse.) |
| **feat(aibtc-news-editorial): x402 402-response fallback** (09c036d0) | When POST /api/signals returns 402, CLI now falls back to `bitcoin-wallet x402 execute-endpoint`. Ensures signal filing succeeds even when the endpoint requires payment. `ApiError` class added for typed HTTP error handling. |
| **fix(arc-reputation): contact validation guard** (b181a5d6) | `isContactActuallyInvolved()` prevents false-positive contact matches. PR-review interactions require `contact.github_handle` in task text; x402-exchange requires on-chain address. Closes task #10871 Halcyon Wolf bug class. |
| **refactor(arc-workflows): gh CLI GraphQL migration** | `fetchGitHubPRs()` migrated from per-repo REST + `getCredential("github","token")` to `gh api graphql` batched multi-repo query. Removes `fetchWithRetry` + `getCredential` dependencies. Consistent with aibtc-repo-maintenance sensor approach. |

## Key Architectural Changes (2f9d804c → bfc0b478) [2026-04-05T18:35Z]

| Change | Impact |
|--------|--------|
| **[CLOSED] relay v1.27.2 schema CARRY-WATCH** | `check-relay-health` CLI uses `...(relayHealth ?? {})` spread — no specific CB/pool/effectiveCapacity field access. `isRelayHealthy()` sensor only checks `canSponsor` + `status` from `/status/sponsor`. Concern was moot. Closed. |
| **[NEW GAP] signal diversity: flat-market fallback always fires nft-floors** | `buildFlatMarketSignal()` in `ordinals-market-data/sensor.ts` picks the first `FLAT_MARKET_CATEGORIES` entry (`nft-floors`) with ≥3 readings. Since nft-floors accumulates readings continuously, it always wins. Result: every flat-market fallback slot is nft-floors. CEO review directive: "Signal diversity: surface and file on quantum-computing or infrastructure beat." Fix: track `lastFlatMarketCategory` in HookState and skip it on the next fallback run — 2-line state write + 1 filter change. Follow-up task created. |
| **No code changes** | Auto-commits only (memory persist, watch report HTML update). Architecture structurally unchanged. |

## Key Architectural Changes (6ce1d0f → f3b5159) [2026-04-05]

| Change | Impact |
|--------|--------|
| **fix(github-mentions): suppress issue @mention flood within 24h window** (10964091) | Issue notifications now use `recentTaskExistsForSource()` (24h window) instead of `pendingTaskExistsForSource()` (pending-only). Previously, completing a task allowed the *next* mention on the same issue to immediately create a new task — each of 10+ @mentions on issue #383 became a separate ~$0.25 task. PullRequest re-review is unaffected (re-review is desirable). +6/-3 lines in `github-mentions/sensor.ts`. Closes the day-14 flood gap. |
| **fix(arc-self-review): transition workflow to reviewing at task start** (806ce147) | arc-self-review 'triggered' state task description lacked the workflow transition CLI command. Without the explicit transition, workflows accumulated in 'triggered' state across days — duplicate health-check tasks on every sensor cycle. Fix: task description now requires `arc skills run --name arc-workflows -- transition <id> reviewing` as first step. +9/-5 lines in `arc-workflows/state-machine.ts`. |
| **fix(context-review): correct skills format mismatch** (f3b5159d) | `arc-workflows/sensor.ts` was serializing skills as `action.skills.join(",")` (comma-separated string) but all parsers — `dispatch.ts` and `context-review/sensor.ts` — expect JSON arrays (`["skill-name"]`). Silent data corruption: workflow-dispatched tasks silently lost skill context at dispatch time, and were incorrectly flagged as "empty skills" by the context-review sensor. Fix: `JSON.stringify(action.skills)` in sensor; comma-separated fallback added in context-review parser for historical tasks. Superseded tasks filtered from empty-skills-failed check. +7/-2 lines across 2 files. |

## Key Architectural Changes (34bb98a → 6ce1d0f) [2026-04-04]

| Change | Impact |
|--------|--------|
| **refactor(arc-workflows): PrLifecycleMachine owns all PR review dispatch** (061c807d, 8a984348) | `AUTOMATED_PR_PATTERNS` extracted from `aibtc-repo-maintenance/sensor.ts` → exported from `arc-workflows/state-machine.ts`. `PrLifecycleMachine` now drives PR review task creation via `shouldSkipPrReview()`, `prReviewSkills()`, `buildReviewDescription()`. `reviewCycle` and `isAutomated` added to context. React repos (`aibtcdev/landing-page`) get `dev-landing-page-review` skill. Centralization closes the dual-creation gap (sensor + mentions both creating review tasks). |
| **fix(github-mentions): defer review_requested/assign to PrLifecycleMachine** (8a984348) | `github-mentions/sensor.ts` now skips `review_requested`/`assign` events on watched repos — these are handled by `PrLifecycleMachine` via state transitions. Also removed `completedTaskCountForSource` check (workflow handles re-review tracking). Prevents duplicate tasks from parallel sensor + workflow paths. |
| **refactor(aibtc-repo-maintenance): sensor simplified** (8a984348, 061c807d) | Sensor reduced ~85 lines — removed `isAutomatedPR()`, React reviewer detection, and all direct `insertTask` calls. PR review logic centralized in `PrLifecycleMachine`. Sensor now only manages workflow creation/state-sync. |
| **fix(safe-commit): lintModelField() two bug fixes** (8a984348) | (1) Negative lookbehind `(?<!/)` prevents false positives when `insertTask` pattern appears in regex literal comments. (2) Closing-brace detection no longer requires `}` immediately before `)` — fixes `insertTaskIfNew` calls with extra positional args (e.g. `}, "pending"`). |
| **fix(arc-workflows): preserve context on state transitions** (8a984348) | `syncGitHubPRs()` previously overwrote workflow context on state change, losing `reviewCycle`, `isAutomated`, `fromIssue`. Now merges existing context with updated PR fields — preserves all accumulated workflow state across transitions. |
| **fix(aibtc-repo-maintenance): update watched repo descriptions** (6ce1d0f) | SKILL.md updated with accurate repo descriptions. No code change. |

## Key Architectural Changes (4f33bbe9 → 34bb98a8) [2026-04-04]

| Change | Impact |
|--------|--------|
| **feat(arxiv-research): add quantum beat routing** (42d54a6e) | `arxiv-research` sensor now fetches `quant-ph` category and applies `QUANTUM_KEYWORDS` filter (17 regex patterns: Shor/Grover, post-quantum, ECDSA threats, BIP-360/P2QRH, NIST PQC, lattice-based crypto). Quantum signal tasks queue **independently** from infrastructure signal tasks — both can fire the same day. +58/-1 lines. Enabled by agent-news PR #376 (quantum beat merged 2026-04-03). State diagram updated: `arxiv_research` now routes to TWO beats. |
| **feat(failure-triage): outage-detection bypass shipped** (f93cb48f) | `arc-failure-triage/sensor.ts` +35 lines: if `>OUTAGE_MIN_COUNT` failures share identical `result_summary` in a short window, classifies as "outage event" and skips individual retro tasks. Closes **[NEW WATCH]** from prior audit. Pattern: "bulk triage" / "stale: bulk triage" / "compute outage" summary prefixes are now recognized outage signatures. |
| **docs(nonce-manager): skills-v0.36.1/v0.36.2** (208f6d9f, 6dea9567) | SKILL.md updated: canonical payment-status polling by `paymentId` is now the primary x402 state machine; nonce-manager demoted to backup sender nonce tracker. `terminalReason` is the new normalized terminal signal. No Arc code changes — upstream shift documented. |
| **[CLOSED]** stale-lock PID pre-validation [WATCH] | `arc-service-health/sensor.ts` already validates `isPidAlive(lock.pid)` (added 34420a21, 2026-03-27). The prior [WATCH] was stale. Sensor only creates alert when lock PID is dead. Remaining false positives from dispatch-stale path (no-PID-concept) or race condition during lock handoff are an interpretation/protocol issue, not code. |
| **[ESCALATED]** relay v1.27.2 sponsor nonce degraded | Relay upgraded v1.26.1→v1.27.2. 4 missing nonces [1559,1555,1553,1549] + 7 mempool-pending. lastExecutedNonce: 1548, possibleNextNonce: 1561. Response schema changed (no CB/pool/effectiveCapacity fields in v1.27.2). Escalated to whoabuddy — task #10617. |

## Key Architectural Changes (5f84c07d → 3913c094) [2026-04-03]

| Change | Impact |
|--------|--------|
| **feat(aibtc-news-editorial): validateBeatExists() beat-slug drift detection** (391e4921) | `cli.ts` now calls `GET /api/beats` before filing any signal. Caches to `db/beat-slug-cache.json` (10-min TTL). Fails early with available slugs list. **Closes [WATCH] from 3 prior audit cycles** — recurring failure class (3rd occurrence in 2 weeks) is now self-detected at filing time. +74 lines. |
| **Compute outage 2026-04-02/03** (operational, not code) | 637 tasks bulk-failed due to host-level outage; `failure-triage` sensor fired as if 637 independent failures. Services restored 2026-04-03T15:00Z. Pattern: bulk failures with identical summaries in short window = outage, not independent bugs. |
| **[NEW WATCH] failure-triage outage bypass** | failure-triage cannot distinguish 1-outage-×-637 vs 637 independent failures. If >200 tasks fail with identical summaries in <1h, log as "outage event" instead of spawning investigation tasks. Low-complexity automation candidate. |
| **[NEW WATCH] stale-lock PID pre-validation** | Every stale-lock/dispatch-stale alert to date has been a false positive (live PID). Sensor could verify lock PID is live before creating alert task, eliminating all false-positive alert tasks. |

## Key Architectural Changes (a94eb3a → 6282b8b) [2026-03-31]

| Change | Impact |
|--------|--------|
| **fix(arxiv-research): update beat slug to infrastructure, add aibtc-relevance filter** (d2bc3c0d) | Beat `dev-tools` (404) replaced with `infrastructure`. Broad keyword list replaced with two-tier filter: Tier 1 (specific: MCP, x402, Stacks, Clarity, sBTC, BRC-20, bitcoin relay) + Tier 2 (agent + crypto compound). Prevents generic agent/ML papers from consuming signal quota. +56/-29 lines. Root cause: beat slug drift — platform renamed beat without notice. 3rd occurrence of this failure class. |
| **fix(aibtc-welcome): replace Hiro nonce probe with relay /status/sponsor** (e5210b25) | `isRelayHealthy()` Probe 3 now calls GET `/status/sponsor` on the relay instead of Hiro nonce API for wallet 0 only. New probe passes only when `status==='healthy' && canSponsor===true` — covers all 10 pool wallets. Removes `SPONSOR_ADDRESS` constant and direct Hiro dependency from arc-starter health checks. Closes issue #263. +12/-19 lines. |
| **fix(ordinals-market-data): remove fee-market from flat-market fallback** (6282b8b2) | Rising Leviathan (automated signal reviewer) rejected 5 fee-market signals in 27h — all classified as "external to aibtc network activity." Sensor still included fee-market in `FLAT_MARKET_CATEGORIES` despite known rejection rule. Removed. Extracted candidate order to module-level constant; removed dead case block. +3/-21 lines. Pattern: RL rejections are actionable sensor bugs — same-day feedback loop closed in ~27h. |
| **[WATCH] Beat slug drift: 3rd occurrence** | arxiv-research is the 3rd sensor to fail due to platform renaming a beat without notice. No sensor currently validates beat existence before filing. Automation candidate: lightweight beat-existence check on first signal attempt could catch slug drift without human. |

## Key Architectural Changes (c8b717d → a94eb3a) [2026-03-30]

| Change | Impact |
|--------|--------|
| **Research cache files only** (31924b16–a94eb3a) | 5 arc-link-research cache files added. No structural code changes. Diagram unchanged since c8b717d. |
| **81/81 zero-failure watch window** (01:01Z–13:01Z, best on record) | 22 parallel research tasks completed in ~90 min, 4 new patterns captured, multiple PR reviews processed. Validates research-to-signal pipeline and batch parallelism. |
| **Competition: 12 pts, top 32 pts** [CARRY] | Signal output is now the bottleneck, not infrastructure. With CB closed + cap enforced, 6/day signal quota is the constraint. |
| **effectiveCapacity=1** [ESCALATED task #9658] | Server-side Cloudflare DO config. All 5 admin actions exhausted. No Arc action available. Welcome throughput ceiling = 1 until whoabuddy changes DO config. |

## Key Architectural Changes (ca5477c → c8b717d) [2026-03-30]

| Change | Impact |
|--------|--------|
| **Ghost nonce 554 RESOLVED** (memory) | Sender progressed to 577/578; sponsor at 1207/1208. Both sides CLEAN: 0 missing nonces, 0 mempool pending. Ghost-nonce welcome cascade (10+ failures/day at peak) is gone. |
| **effectiveCapacity=1 root cause confirmed** (task #9658, escalated) | Root cause is server-side Cloudflare Durable Object config — NOT derived from nonce state or conflict history. All 5 admin actions exhausted. Welcome tasks succeed at throughput=1 until whoabuddy changes DO config. |
| **docs/nonce-strategy-alignment-plan.md** (8b3aea27) | 307-line planning doc. Arc has 3 tx paths with inconsistent nonce management: `x402-retry.ts` (uses deprecated compat API), `sponsor-builder.ts` (no nonce-tracker, concurrent race risk), `builder.ts` (no nonce-tracker). Phase 1 plan: shared `retry-strategy.ts` + uniform acquire/release across all paths. Not yet implemented — upstream skills work first. |
| **0-failure watch window** (2026-03-29T13:00 → 2026-03-30T01:01Z) | First clean 12h window in days. 18 tasks completed, $3.35 spent ($0.186/task). Relay CB closed + Hiro API reachability restored unblocked the welcome queue. |

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
