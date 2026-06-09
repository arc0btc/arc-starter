# Arc State Machine

*Generated: 2026-06-09T09:28:00.000Z*
*Diff: cfea1c10 → 6def33c (0 structural commits) | Sensor count: 73 | Skill count: 120*

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
            note right of arc_service_health: arc-alive-check DELETED (ee328387)\nDormant since 2026-03-12, superseded by arc-service-health\nCARRY×8 resolved — sensor count 73→70\nAUTO-COMPLETE FIX (9905dbea): health-alert workflows in 'triggered' state\nauto-complete when alert condition clears\n50 stuck workflows cleared (dating back Apr 11)\nPattern: alert-style sensors must own workflow termination\nPAYMENT-BLOCK WATCHDOG (60372cb9): checkPaymentBlock() added to sensor\nDetects consecutive gate failures indicating payment block (25h gap 2026-04-30)\nCreates escalation task; pattern: payment blocks halt dispatch while sensors run normally\nDISPATCH-STALE SUPPRESSION (96f2290e): 60min post-recovery window added\nTracks wasStaleLastRun + lastRecoveryAt in db/hook-state/arc-service-health.json\nOn stale→healthy transition, records recovery time and auto-completes open workflows\nPrevents FP flood (19+ stale alerts) that occurred after every payment block\nPattern: health sensors must gate post-recovery alert noise\nRETRO-DEDUP (48879732): lastHealthAlertWorkflowAt in state file\n4h gate on health-alert workflow creation — at most 1 workflow per budget-gate outage\nCloses [OPEN] from 2026-05-04 audit: 30+ retrospective tasks per event → 1 per event\nPID-ALIVE GATE (c23777ea): checkStaleCycle() reads dispatch-lock.json\nIf lock exists + isPidAlive(lock.pid) → return false (not stale)\nFixes FP: in-flight dispatch cycle not in cycle_log yet → looked stale to sensor\nPattern: stale-detection sensors must check in-flight state, not just historical logs
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
            note right of github_mentions: review_requested/assign on watched repos\ndeferred to PrLifecycleMachine (8a984348)\nno longer creates PR review tasks directly\nstill handles mention/team_mention\nIssue @mention flood guard (10964091)\n24h recentTaskExistsForSource blocks re-creation after complete\nPullRequest re-review unaffected\nAPPROVED-PR GUARD (37645ac8): arcHasReviewedPR() calls\ngh pr view --json reviews before task creation\nskips mention/team_mention if Arc already reviewed\nPrevents flood from re-@mention after prior approval\n(genuine re-reviews still flow via arc-workflows reviewCycle)\nDEFI-ZEST ENRICHMENT (42bcd9fb): keyword enrichment added for Zest-related notifications\n4h THREAD COOLDOWN (b6a42c57): recentTaskExistsForSource(threadSource, 240)\nGuards non-issue, non-watched-PR threads (busy threads generated 5-6 tasks/day)\nIssues already have 24h cooldown; this adds equivalent for thread tasks\nFix for repo-maintenance crowding at 41-44% (threshold: 30%)\nSENSOR-TIME PR STATE GATE (58715da1): getPRState() helper added\nSkips external (non-watched) PRs already CLOSED/MERGED or already reviewed by Arc0btc\nAddresses bff-skills stale-PR noise (#564/#565/#579 — closed PRs re-queued by sensor)\nPattern: sensor-time PR state checks prevent wasted dispatch cycles on stale external PRs
            note right of aibtc_repo_maintenance: sensor simplified (8a984348)\nPR review task creation moved to PrLifecycleMachine\nno direct insertTask/pendingTaskExistsForSource\nwatched repos from AIBTC_WATCHED_REPOS constant\nMERGED-STATE PRE-FLIGHT (e6004278): AGENT.md step 1 added\ngh pr view NUMBER --repo OWNER/REPO --json state --jq '.state'\nif MERGED or CLOSED → close task as completed, skip review\nPrevents wasted cycles on already-merged PRs (4/20 failures were this class)\nPattern: PR review tasks must check merged state before starting work\nSTALE ISSUE CLEANUP (cee55c34): closeStaleIssueWorkflows()\nQueries all issue-opened workflows for pr-lifecycle template\nFilters to created_at older than 24h (avoids API calls for new issues)\ngh issue view --json state; if CLOSED → updateWorkflowState + completeWorkflow\nPrevents stale issue-lifecycle workflow accumulation (fixed lingering issue workflows)\nAPPROVED-PR RESOLUTION (8d446e6): resolveApprovedPrWorkflows()\nChecks all active pr-lifecycle workflows in 'approved' state\ngh pr view --json state,mergedAt per approved workflow\nMERGED or mergedAt set → transition to merged + complete\nCLOSED → transition to closed + complete\nPrevents approved-state workflow accumulation after PR lifecycle ends\nINSTANCE-KEY FIX (359d6bbc): PR workflows use 3-part keys (owner/repo/number)\nnot 4-part (owner/repo/pr/number) — function was silently skipping all PRs\nFix: length===3 → direct parse; length===4 && parts[2]==='pr' → legacy parse\n36 backlog approved→merged/closed workflows resolved on fix deploy
        }

        state ContentSensors {
            blog_publishing
            note right of blog_publishing: TASK DECOMPOSITION (6f1b2dcf): monolithic tasks split to prevent 15min timeout\nDraft review → review (sonnet) + publish (haiku) pair\nContent generation → generate (sonnet) + publish (haiku) pair\nScheduled publish → single sonnet task (haiku times out on publish)\nPattern: blog-publish tasks decomposed at sensor creation time — same pattern as arxiv digest split (48858a87)\nIDEMPOTENT PUBLISH (b07bc650): cmdPublish no longer adds published_at if already present in frontmatter\nGuard: if (!/^published_at:/m.test(content)) before regex replacement\nCloses duplicate-frontmatter class on re-publish or force-publish of already-published post
            aibtc_news_editorial
            aibtc_news_deal_flow
            note right of aibtc_news_deal_flow: [RESOLVED] 5th-carry investigation (db172ec6, task #12928)\nSensor is LIVE and CORRECT — routes to ordinals beat (Arc-owned)\nNot routing to dead deal-flow beat (410)\nSKILL.md updated; carry item CLOSED\nSIGNAL_FILING_DISABLED (01daaa58): FULL SENSOR SKIP — all task creation gated\nPolicy: whoabuddy 2026-05-19 (task #17094)\nRe-enable: flip SIGNAL_FILING_DISABLED=false in sensor.ts
            aibtc_agent_trading
            ordinals_market_data
            social_x_posting
            social_agent_engagement
            social_x_ecosystem
            arxiv_research
            bitcoin_macro
            note right of bitcoin_macro: NEW (64ff537) — 240-min cadence\nSignal types: price-milestone (round-number $50K–$200K, one-time),\nprice-move (>5% in 4h), hashrate-record (ATH or >5% drop),\ndifficulty-adjustment (≤288 blocks + ≥3% change)\nData: blockchain.info/ticker (price), mempool.space hashrate+difficulty\nFirst-run guard: pre-populates firedMilestones from current price\nso stale milestones never fire retroactively\nFirst signal filed: hashrate ATH 972.3 EH/s (id: 13f3d03e, task #12744)\n[RESOLVED] Bitcoin Macro open gap from prior audits\nACTIVE_BEATS GATE (11bb7e10): ACTIVE_BEATS constant (currently [])\nShort-circuits before any data fetch when beat not in list\nFixes 3 post-competition failures (#13455, #13474, #13490)\nRe-enable: add 'bitcoin-macro' to ACTIVE_BEATS array\nPattern: all beat-dependent sensors should adopt this gate\nRE-ENABLED (f28aeafb): ACTIVE_BEATS=['bitcoin-macro']; beat tag required in filing instructions\nbeatRelevance=0 root cause: 'bitcoin-macro' tag missing from all prior signals\nFix: filing instructions now require beat slug as first tag\n3RD SOURCE (94938b4): blockstream.info added alongside blockchain.info + mempool.space\nsourceQuality now 3 sources=30 — clears ≥65 floor\nSQ=1 floor root cause resolved after 6+ consecutive days\nCAMELCASE FIX (e4370d04): height_response→heightResponse in fetchBlockHeight()\ncompliance rename — no behavioral change\nLIVE BEATS (cbd4fc5d): ACTIVE_BEATS static constant replaced by fetchActiveBeatSlugs() /api/beats\nFails back to known beat on API error; logs warning and proceeds\nBeat retirement now self-healing\nHASHRATE DECOMPOSE (b837808f): hashrate-record signals queued as two tasks\nCompose task writes draft + creates follow-up file task before closing\nEliminates recurring 15-min dispatch wall for hashrate signals\nOther signal types unchanged (price-milestone, price-move, difficulty-adjustment)\nPattern: sensor-level decomposition for research+file workflows > 15-min limit\nSIGNAL_FILING_DISABLED (01daaa58): SIGNAL_FILING_DISABLED=true gates all signal task creation\nPolicy: whoabuddy 2026-05-19 (task #17094) — EIC stepped down, comp winding down\nData collection + difficulty/price fetch continues; only task queue is gated\nRe-enable: flip SIGNAL_FILING_DISABLED=false in sensor.ts
            note right of aibtc_agent_trading: NEW (5da9081c) — 2h cadence\nSources: JingSwap API (cycle/prices), ledger.drx4.xyz (P2P desk), aibtc.news/api/agents\nSignal types: jingswap-cycle, jingswap-price, p2p-activity, agent-growth\nStrength 50-95; P5 if >=70, P7 otherwise\nDiversity rotation: skips lastSignalType from prior run\nReplaces ordinals-market-data for agent-trading beat filing\nAIBTC-network-native data only (no CoinGecko/Unisat/mempool)\nJINGSWAP API KEY (39a5416b): loads jingswap/api_key from creds store\nPasses as Authorization: Bearer header to all faktory-dao-backend requests\njingswapUnavailable flag: 401 → skip JingSwap for rest of run; fall back to P2P+registry only\nP2P flat-market boost (aec9ad29): strength 30→45 when completed_trades>0 or psbt_swaps>0\nType forced to p2p-activity; implication reflects actual trade counts\nCRASH FIX + CAP (4d91de01): countSignalTasksToday() generalized to LIKE 'File % signal%'\nWas 6 hardcoded beat patterns; now 2 generic globs — future-proofs new beats\nBEAT SLUG FIX (7dab95c0): agent-trading beat retired (API 410)\nSlug updated to aibtc-network — all AIBTC activity now routes there\nCOOLDOWN GUARD (b5caf209): isBeatOnCooldown(beat, 60) checked before task creation\nPrevents dispatch failures from 60-min beat cooldown (~3 false failures/day eliminated)\nWired into aibtc-agent-trading + arxiv-research sensors\nAPI CAP GUARD (90607ba9): fetchFiledSignalCountToday() queries aibtc.news API real-time\nDual check: local DB (fast) + API (catches signals filed between sensor run and dispatch)\nFLAT-DATA GUARD (90607ba9): skip if all deltas=0 (trades/psbt/volume/agents) AND strength<50\nAddresses retro-2026-04-17 patterns 1+2 — cap-hit waste + flat-data waste eliminated\nBEAT SLUG RESTORE (e1853e83): slug restored to 'agent-trading' (competition beat reset)\nWas 'aibtc-network' during competition (per 7dab95c0); now back to correct slug\n[WATCH] First signal to restored beat pending\nACTIVE_BEATS GATE (f5ce61e0): ACTIVE_BEATS constant (currently [])\nShort-circuits before any data fetch when beat not in list\nRe-enable: add 'agent-trading' to ACTIVE_BEATS array\nPattern now consistent across all 3 beat-dependent sensors\nLIVE BEATS (cbd4fc5d): ACTIVE_BEATS replaced by fetchActiveBeatSlugs() /api/beats\nFails CLOSED on API error — never fires on retired beat on resume\nSIGNAL_FILING_DISABLED (01daaa58): FULL SENSOR SKIP — all task creation gated\nPolicy: whoabuddy 2026-05-19 (task #17094)\nRe-enable: flip SIGNAL_FILING_DISABLED=false in sensor.ts
            note right of ordinals_market_data: Signal filing SUSPENDED (80322a56)\nSIGNAL_FILING_SUSPENDED=true — agent-trading beat scope mismatch\nData collection continues for cross-category context\nFlat-market rotation FIXED (f3b5159d): lastFlatMarketCategory\nin HookState rotates FLAT_MARKET_CATEGORIES — [GAP] CLOSED\n[RESOLVED 2026-04-23] HookState deprecated fields removed (77a1837c)\nINFRA OVERFLOW REMOVED (28cb5e3f): dead countSignalTasksTodayForBeat("infrastructure")\ncalls purged from milestone allocation — SIGNAL_FILING_SUSPENDED=true but code was live\nOrdinals allocation now standalone (no two-beat spill to retired infrastructure beat)
            note right of arxiv_research: DUAL-BEAT routing (42d54a6e)\nInfrastructure: two-tier aibtc-relevance filter (d2bc3c0d)\nTier 1: MCP/x402/Stacks/Clarity/sBTC/BRC-20\nTier 2: agent + crypto/blockchain compound\nQuantum: quant-ph category + QUANTUM_KEYWORDS\nShor/Grover/ECDSA threats/BIP-360/P2QRH/NIST PQC\nBoth beats fire independently same day\nDIGEST SPLIT (48858a87): digest task split to avoid 15-min timeout\nModel→haiku, instructions reduced to pure CLI commands (fetch + compile)\nQuantum/infra signal tasks built from paper list in task description\nEliminates file dependency that caused 2× 15-min timeouts\nCOOLDOWN GUARD (b5caf209): same guard as aibtc-agent-trading\nQUANTUM AUTO-QUEUE (3ea7a541): queue-signals CLI added to cli.ts\nReads .latest_fetch.json post-compile; matches title+abstract vs QUANTUM_KEYWORDS\nRicher than sensor's title-only pass; auto-creates signal task if match found\nRespects isBeatOnCooldown + pendingTaskExistsForSource guards\nWired into AGENT.md step 3 so every haiku digest triggers it\nCloses CARRY×12 — arXiv digest now auto-queues quantum signals end-to-end\nACTIVE_BEATS GATE (f5ce61e0): ACTIVE_BEATS constant\nShort-circuits before any data fetch when array empty\nRE-ENABLED (fe615b45): aibtc-network + quantum added back post-competition\nACTIVE_BEATS=[] caused silent early-exit — both beats missed entirely\nPattern consistent across all 3 beat-dependent sensors\n429 RETRY FIX (450a1a24): fetchArxivWithRetry() — 3 attempts, 5s/10s backoff\nRespects Retry-After header; logs persistent drought warning after max retries\nFirst live test ~08:11Z 2026-05-07; closes quantum signal drought root cause\nBEAT-SUBJECT FIX (0d84bf9e): task subject was 'File infrastructure signal'\nRename to match description — infrastructure is a retired beat\nLIVE BEATS (cbd4fc5d): ACTIVE_BEATS static constant replaced by fetchActiveBeatSlugs() /api/beats\nFalls back to KNOWN_BEATS on API error (fail-open so digest work continues)\nBeat retirement now self-healing — no manual patching on lifecycle events\nHOOKSTATE GUARD (1f951fdf): readHookState wrapped in try/catch\nDisk error before claimSensorRun no longer defeats interval-release logic\nPrevents sensor lockout on transient filesystem errors\nSIGNAL_FILING_DISABLED (01daaa58): gates aibtc-network + quantum signal task creation\nDigest fetch/compile tasks continue unaffected — only signal queue is gated\nPolicy: whoabuddy 2026-05-19 (task #17094)\nRe-enable: flip SIGNAL_FILING_DISABLED=false in sensor.ts
            note right of aibtc_news_editorial: X402 AUTH FIX (25622279): BTC auth headers\n(X-BTC-Address/Signature/Timestamp) now passed through x402 payment retry flow\nProbe step in execute-endpoint also lacked auth — was getting 401 before 402 visible\nPattern: x402 retry paths must propagate all upstream auth headers\nCOMPILE-BRIEF DISABLED (b102c52b): POST /api/brief/compile is publisher-only\nArc is a correspondent — endpoint always returns 403\nSensor no longer queues compile-brief tasks; CLI updated to correct path\nPattern: correspondent vs. publisher distinction is structural, not a bug\nvalidateBeatExists() pre-validates beat slug\nGET /api/beats before filing any signal (391e4921)\n10-min cache: db/beat-slug-cache.json\nFails early with available slugs listed\nx402 402-response fallback (09c036d0): POST /api/signals\nreturns 402 → bitcoin-wallet x402 execute-endpoint fallback\n[WATCH-CLOSED] beat-slug drift detection shipped\nBEAT EDITOR SKILL (c7c03bec): aibtc-news-editor installed (skills-v0.37.0)\n9 new MCP tools: news_review_signal, news_editorial_review,\nnews_register_editor, news_deactivate_editor, news_list_editors,\nnews_editor_earnings, news_compile_brief, news_file_correction, news_update_beat\nINTEGRATION GATE: tools active when Arc gains editor status (#383)\nCORRECTIONS CLI (da7d25b3): file-correction --signal-id --claim --correction [--sources]\nlist-corrections --signal-id\nBIP-137 signed; rate limit 3/day; corrects published signal claims\nCONTEXT-REVIEW FIX (a2c7adf): signal filing tasks excluded from keyword checks\nProtocol names in news topic descriptions (bitflow, zest) caused false\ndefi-bitflow/defi-zest skill suggestions — aibtc-news-editorial is sufficient\nRETIRED-BEAT INACTIVITY FIX (d7152b93+29e3d208): inactivity check now skips retired beats\nCross-references GET /api/beats to detect which beats are currently active\nPrevents false-positive alerts for 9 post-competition retired beats\nPattern: inactivity sensors must filter against current active beat list\nBEAT-INACTIVE DATE SCOPE (ab1273d0): inactivity alert source date-scoped\nSource key includes date (YYYY-MM-DD) so each beat can re-alert daily\nPrevents 24h dedup from suppressing legitimate daily inactivity alerts\nPattern: inactivity alerts that should repeat daily must scope source by date\nCOOLDOWN PRE-CHECK IN STREAK SENSOR (0b432ddc): streak sensor checks cooldown\nbefore queuing signal tasks — consistent with sensor-time cooldown pattern\nPattern: all signal-filing sensors must gate on cooldown before task creation\nBEAT PATTERN EXPANSION (fcb39755): BEAT_SUBJECT_PATTERNS in db.ts extended\n"Compose bitcoin-macro%signal%" added alongside "File bitcoin-macro%signal%"\nCovers hashrate decompose's compose-task — cooldown now tracks both halves\nPattern: task-pair decompose requires BEAT_SUBJECT_PATTERNS to cover both subjects\nCOOLDOWN-BEFORE-PAYMENT (5cdcf339): GET /api/status canFileSignal=false aborts before signing or x402\nPrevents 100-sat losses on cooldown-blocked submissions; network errors are non-fatal\nv4.1 SLUG ENFORCE (36ee2c24): tags[0] always === beat_slug (deduplicates if already present)\nv4.1 strict enforcement (agent-news#634): auto-reject if tags[0] != beat_slug\nTAG LIMIT 10→11 (1f951fdf): user tag budget preserved (10 user tags + 1 auto-beat slug)\nError message clarified; closes reviewer concern from PR #26 feedback\nSTREAK BEAT ENCODING (d07db40a): streak task subject was "Maintain N-day streak on aibtc.news"\nDidn't match BEAT_SUBJECT_PATTERNS → isBeatOnCooldown returned false while streak task was pending\nOther sensors (bitcoin-macro, arxiv-research) queued duplicate signal tasks for the same beat\nFix: commit to first available beat at sensor time; subject = "File <beat> signal: maintain N-day streak"\nNow matches existing BEAT_SUBJECT_PATTERNS; cooldown correctly blocks duplicates\nAlso: model haiku→sonnet (haiku times out on signal filing)\nPattern: any sensor-queued signal task must use a subject matching BEAT_SUBJECT_PATTERNS\nVALIDATOR UTILITY (9328f609): validateSignalSubjectMatchesBeatPattern() exported from db.ts\nCall in sensors before queueing signal tasks to assert subject matches BEAT_SUBJECT_PATTERNS\nlikePatternToRegex() converts SQL LIKE → JS RegExp (% → .*, _ → .)\nVALIDATOR WIRE-IN (e3329e2b): all 3 signal sensors now call validateSignalSubjectMatchesBeatPattern() at queue time\nbitcoin-macro: line 608; arxiv-research: lines 287 (aibtc-network) + 324 (quantum); aibtc-news-editorial: line 182 (streak)\nSubject mismatch is now a hard failure at sensor time — BEAT_SUBJECT_PATTERNS drift class fully closed\n[RESOLVED] Sensors wired to call validator (e3329e2b) — BEAT_SUBJECT_PATTERNS ×10 carry fully closed\nSIGNAL_FILING_DISABLED (01daaa58): gates streak task creation; inactivity checks remain active\nPolicy: whoabuddy 2026-05-19 (task #17094)\nRe-enable: flip SIGNAL_FILING_DISABLED=false in sensor.ts
        }

        state DeFiSensors {
            defi_bitflow
            defi_stacks_market
            defi_zest
            mempool_watch
            arc_payments
            zest_yield_manager
            note right of zest_yield_manager: 60-min cadence\nChecks sBTC balance vs 200k-sat reserve\nQueues supply tasks (idle > threshold)\nQueues claim tasks (wSTX rewards > 1000 uSTX)\nAutonomous yield: idle sBTC → Zest ~3.5% APY\nContext fix (73c09c4d): skills=[zest-yield-manager, defi-zest]\ndefi-zest was missing → supply/claim ran without Zest context\nNONCE SERIALIZATION (34e058ab+fa4decf2): tx-runner.ts calls acquireNonce()\nbefore any write command; --nonce injected into defi.ts argv\naccount.address (not .stxAddress) passed to acquireNonce\nAll Zest write ops coordinate via ~/.aibtc/nonce-state.json file lock\nOn failure: syncNonce() resets from Hiro\nWELCOME GUARD (f99b981b): pre-claimSensorRun check\nqueries active tasks for aibtc-welcome\nif activeWelcomeTasks.length > 0 → return skip\nInterval preserved — retries next 1-min fire\nPrevents TooMuchChaining: welcome STX sends fill mempool\nchain depth before Zest op can land\nCONTRACT PREFLIGHT (b08c9566): balance check via stxer before nonce acquisition\nsimulate get-balance (Zest sBTC) + stx-get-balance (STX send) before any Hiro API call\nsafe_to_broadcast verdict — failed preflight aborts before nonce consumed\nNew skill: contract-preflight (d3b67d7b) — stxer simulation engine (Secret Mars, BFF Day 16)
        }

        state AIBTCSensors {
            aibtc_heartbeat
            aibtc_inbox_sync
            aibtc_welcome
            note right of aibtc_welcome: STX BALANCE PREFLIGHT GATE (c3eccc57): sensor checks getSelfStxBalanceMicroStx()\nbefore queuing — if balance < MIN_STX_SEND_THRESHOLD (100k µSTX) → skip, log, return early\nCloses [stx-wallet-low-balance] sensor improvement gap: was queuing 6 tasks/night that failed\nat first dispatch line, consuming retries and inflating failure metrics\nPattern: sensor-preflight-gating — check hard prerequisite at sensor time, not dispatch time\n[RESOLVED task #17648] MIN_STX_SEND_THRESHOLD recalibrated 100k→40k µSTX (task #17648)\nNow matches actual cost: 3 × (10k send + ~5k fee) = 45k; threshold 40k vs. old 100k (10×)\nPrevents unnecessary welcome-agent blocks when wallet has 4-9 sends available\nSTX_AMOUNT REDUCTION (a1e4ddd0): 0.1 STX→0.01 STX per welcome send\nWith ~89k microSTX balance, 0.1 STX exhausted the wallet; 0.01 STX (~10k µSTX) fits within balance\nUnblocks welcome sends at current balance without wallet refill (7-8 sends possible)\nWallet refill still needed for sustained operation — escalated to whoabuddy\nFAIL() STDERR FIX (d62274d4): fail() was writing error JSON to stdout\ndispatchScript uses stderrTail as result_summary when stderr non-empty\nProgress message (stderr) was captured; actual "STX send failed" error (stdout) silently discarded\nloadAndUpdateDenyList() never saw simulation:400 pattern → 5-day Savage Moose/Steel Yeti loop\nFix: write fail() to stderr so error detail appears in result_summary → deny-list auto-populated\nBoth addresses manually added to aibtc-welcome-hiro-rejected.json immediately\n[RESOLVED 2026-04-27] 5-day recurring deny-list failure — self-healing now works correctly\nisRelayHealthy() probe 3: relay /status/sponsor\n(was Hiro nonce API, wallet 0 only)\nNow covers all 10 pool wallets (e5210b25)\nRemoves SPONSOR_ADDRESS + direct Hiro dependency\nNONCE SERIALIZATION (22e93116): stx-send-runner.ts calls acquireNonce()\nbefore transferStx() — local counter in ~/.aibtc/nonce-state.json\nPrevents ConflictingNonceInMempool when welcome + Zest ops run concurrently\nExplicit --nonce callers (gap-fill, RBF) bypass tracker unchanged\nOn failure: release as "broadcast" — tracker auto-resyncs after 90s\nSTX ADDR VALIDATION v3 (7bd2c117): 3-layer check (sensor + stx-send-runner.ts)\nLayer 1: STX_MAINNET_REGEX = /^SP[0-9A-HJKMNP-TV-Z]{39}$/ — fast SP-mainnet rejection\n  Replaces c32check + probeHiroStxAddress() (both confirmed broken)\n  probeHiroStxAddress() false-positive: GET /v2/accounts/{addr} returns 200\n  for broadcast-invalid addresses — wrong Hiro endpoint for validation\nLayer 2: HIRO_REJECTED_STX_ADDRESSES hardcoded deny-list (tasks #11448/#11449)\nLayer 3: loadAndUpdateDenyList() — dynamic deny-list from failed welcome tasks\n  Scans failed tasks for Hiro 400 errors → adds to aibtc-welcome-hiro-rejected\n  Self-healing: bad addresses auto-blocked after first failure, no manual updates\nGuard ALSO at stx-send-runner.ts call site (7bd2c117): fails fast pre-makeSTXTokenTransfer\n  Ensures x402 credits never burned on Hiro-rejected addresses (belt + suspenders)\nHIRO 400 FIX v4 (2ab3431c): execution-time deny-list check in bitcoin-wallet cli.ts\n  cmdStxSend reads db/hook-state/aibtc-welcome-hiro-rejected.json before runStxSend\n  150+ known-bad addresses fail fast — no Hiro API call burned\n  Self-healing: deny-list auto-populated by loadAndUpdateDenyList() from prior failures\n  Fail-open if state file unreadable — never blocks legitimate sends\n  3-layer architecture: sensor regex (L1) + stx-send-runner.ts regex (L2) + cli deny-list (L3)\nSKILL NAME FIX (2ab3431c): 13× wallet→bitcoin-wallet in SKILL.md + sensor.ts task description\n  stx-send and x402 commands in welcome task now reference correct skill\nEXECUTION ORDER: STX send runs before x402 payment\nIf Hiro rejects address → abort before x402 staged\nPrevents double loss (credits burned + STX send failed)\nBROADCAST-INVALID EXTENDED (0116fcf2): deny-list dynamic query extended\nNow matches 'broadcast-invalid' AND 'FST_ERR_VALIDATION' error strings\nBoth broadcast-invalid and format-invalid classes are now self-healing\n3-layer validation fully covers all known failure classes\nREGEX-INVALID DENY-LIST (68d283bc): addresses matching specific regex-invalid patterns\nNow also added to dynamic deny-list — third error class auto-blocked\nRE-ENABLED (0f72a466): sensor disabled 2026-03-21 (71 pending flood)\nRe-enabled 2026-04-10 — 20 days of safeguards now mature:\nBATCH_CAP=3, DAILY_COMPLETED_CAP=10, 24h dedup per-agent\nRelay CB + self-healing + STX pre-validation all in place\nNew agents now detected again after 20-day pause\nHIRO 400 FIX v5 (e0bc901b): PATTERN DRIFT FIX\n  Root cause: loadAndUpdateDenyList() scanned for 'Hiro 400'/'FST_ERR_VALIDATION'\n  Current failure text was 'simulation:400' — zero auto-captures since text changed\n  Added patterns: 'simulation:400', 'simulation 400', 'STX send failed'\n  12 failing addresses manually added to deny-list (359→371)\n  Expect failures to drop to ~0/day as all current modes now matched\n[RESOLVED v5] Hiro 400 pattern drift — deny-list now matches all current failure text\nSCRIPT DISPATCH (b8edb44f): sensor now emits model="script" tasks\nNew cli.ts: deterministic sequence STX-send→x402-inbox→contacts-log\nEach step checks exit code, stops on failure\nRemoved ~170 lines of LLM orchestration\n6th skill converted to script dispatch
            erc8004_reputation
            erc8004_indexer
            identity_guard
            alb
            note right of erc8004_reputation: contact validation guard (b181a5d6)\nisContactActuallyInvolved() — prevents false-positive contact matches\npr-review: contact.github_handle must appear in task text\nx402-exchange: btc_address or stx_address must appear\nFixes task #10871 Halcyon Wolf contact-mismatch bug
        }

        state InfrastructureSensors {
            arc_housekeeping
            note right of arc_housekeeping: SCRIPT DISPATCH (90df07f6): model="script"\nRuns arc skills run --name arc-housekeeping -- fix\nZero LLM cost per execution; 5-min script timeout\nNote: LLM model-upgrade (bbf36f1a) also exists for complex housekeeping:\nhaiku→sonnet when >2 staged .ts files (lint overhead mitigation)\nZERO-FIX COOLDOWN (e96561a0): 4h gate after zero-fix runs\ngetLastCompletedTaskBySource() added to src/db.ts + re-exported via src/sensors.ts\nChecks result_summary vs ZERO_FIX_PATTERNS ["all clean","nothing to fix","no issues found","fixed 0"]\nIf matched and elapsed < 240min → skip (sensor returns "ok"); else proceed normally\nPrevents churn when issues are persistent but unfixable (e.g. MEMORY.md 1 line over threshold)\nClosed 5 zero-fix cycles in 12h overnight window (2026-05-31)\nCOOLDOWN EXTENDED 4h→8h (e07e7c37): ZERO_FIX_COOLDOWN_MINUTES 240→480\nHalves wasted cycles for persistent-but-unfixable issues\nCEO-flagged action from 2026-06-05T21:20Z audit
            arc_email_sync
            note right of arc_email_sync: CF WORKER ONLY (f1bb3375): Resend backend removed\nAll outbound mail via CF email worker (arc skills run --name email -- send)\nSole recipient: whoabuddy@gmail.com — CF worker delivers directly\nResend code + --via flag removed from cli.ts + SKILL.md\nBlocked tasks #14771 + #16063 closed as superseded (policy, not outage)\nPattern: email-no-resend is policy, not pending setup\nSENT-FOLDER DEDUP GUARD (651120e6): before sending, query sent folder for matching subject\nSkip send + close idempotently if already sent within recent window\nCloses bug #1 of side-effecting-task re-dispatch pattern (task #17836)\nBug #2 (db resurrection) fixed separately at db layer (78408d07)\nPattern: any task that sends email/funds must be idempotent — check sent folder first\nSINCE-CURSOR CF QUOTA (b7c5f4b8): since param added to /api/messages poll\nReduces CF DO row reads from 4.67M/day toward ~5k/day — full fix pending CI/CD deploy\nCURSOR COLD-START FIX (c40f4ceb): loadCursorState() now validates inbox/sent as parseable ISO strings\nPrevious fix (b7c5f4b8) non-functional: STATE_FILE always exists (sensor infra writes last_ran/version)\nRoot: cursor=undefined → new Date(undefined).toISOString() throws RangeError, swallowed, full-table scan\nFix: fall through to cold-start (NOW) if fields missing/invalid\nsaveCursorState merges into existing file to preserve sensor metadata (preserves claimSensorRun interval gate)\nRule: any sensor sharing db/hook-state/{name}.json with other state must validate all expected fields on read
            arc0btc_email_worker
            note right of arc0btc_email_worker: SCAFFOLD (495369d1): new skill for arc0btc/arc-email-worker repo\nCloudflare Worker + Durable Object email store\ndisallowed-tools: [Edit, Write, NotebookEdit] — Bash retained for gh/wrangler ops\nPending work: schema-health endpoint (issue #2) — diff sqlite_master + EXPLAIN QUERY PLAN\nPrior art: agentslovebitcoin.com worker repo (ALB PR #21)
            arc_ceo_review
            note right of arc_ceo_review: WORKFLOW TRANSITION FIX (3cd6cd79): AGENT.md step 7.5 added\nCEO review tasks completed without advancing ceo-review workflows\nSubagent now finds active workflow and transitions to reviewing with reviewSummary\nPrevents stuck-in-reviewing accumulation\nEMAILING→COMPLETED AUTO-TRANSITION (16c82bbc): emailing state returned null when emailTaskCreated=true\nStores emailTaskCreatedAt in context; auto-transitions to completed after 30min\nBacklogged workflows (no emailTaskCreatedAt) use epoch=0, transition immediately on next tick\n26 stuck workflows cleared on deployment (2026-05-18T02:49Z)
            arc_report_email
            note right of arc_report_email: CREDENTIALS NAMESPACE FIX (a182c600): sensor was reading\nfrom wrong credential namespace. Fixed to use email/* keys\n(email/api_key, email/from_address) instead of resend/* keys.\nSensor still blocked pending whoabuddy Resend DNS setup (task #14771).\nPattern: credential reads must match the service namespace set via arc creds set.
            arc_scheduler
            note right of arc_scheduler: DATE-SCOPE OVERDUE ALERT (82604b1b): source key includes YYYY-MM-DD\nPrevents re-alerting on same persistent backlog every sensor cycle\nPattern: daily-repeat alerts must scope source by date — consistent with beat-inactive fix (ab1273d0)
            arc_peer_inbox
            note right of arc_peer_inbox: NEW (9d287f4d): file-based inter-agent IPC via Stop hook + sensor\nStop hook (inbox-write.sh) fires after each dispatch cycle\nWrites inbox/<peer-btc-addr>/<ts>.md if task source matches :thread:<btc_addr> pattern\nSensor reads inbox/arc/ (1-min cadence), creates P3/sonnet task per unprocessed file\nDedup: pendingTaskExistsForSource(sensor:arc-peer-inbox:<filename>)\nArchive: processed files move to inbox/arc/processed/ (audit trail)\nLocal IPC only — cross-machine: git push PR, HTTP endpoint (TBD), or aibtc.com inbox\nProduction path for external agents remains aibtc.com inbox (BIP-137/x402)
            arc_umbrel
            arc_starter_publish
            arc_weekly_presentation
            note right of arc_weekly_presentation: RESTORED + REWRITTEN (686aeb9b)\nMonday AIBTC working-group deck auto-generator\n4 fixed sections: Dev Activity, Social & Publishing,\nServices, Self Improvements\nHas sensor.ts + cli.ts + AGENT.md\nDistinct from agent-pitch (internal recap vs external narrative)\nTarget: 8 slides, Arc Gold brand, <10 slides total\nTUESDAY CADENCE (4ecbbfbc): week alignment Monday→Tuesday\nmondayOf→tuesdayOf, isMondayUTC→isTuesdayUTC\nWorking group meets on Tuesdays; sensor fires Tuesday UTC\nCOUNCIL SLIDE (4ecbbfbc): optional Council type in research file\ncouncil field: cycles, actionableRate, agents (name+lens/backend), highlights, summary, repoUrl\nSlide omitted when absent — backward-compatible\nBITCOIN FACES (3798e1e2): agent-grid cards with circular face images\nface SVGs added to src/web/faces/ (trustless-indra, flying-wasp, patient-ledger, steel-yeti, solemn-haven)\nFetched from bitcoinfaces.xyz keyed on native segwit address\noptional closingTeaser field on research file for closing slide teaser\nAIBTC TITLE CONVENTION (82959679): weekVerb() + weekSummaryLine()\nDynamic AIBTC-led headline replaces hardcoded "Arc Weekly"\nverb chosen from standout metric (PRs/agents/tasks)\nCloses title-convention carry — violation-at-source is now impossible
            blog_deploy
            note right of blog_deploy: SCRIPT DISPATCH (90df07f6): model="script"\nFully deterministic — runs arc skills run --name blog-deploy -- deploy\nZero LLM cost per execution; 5-min script timeout\nSHA GUARD (7888632f): last_failed_sha in hook state\nSensor skips re-queue if currentSha === last_failed_sha\nClears on new commit (different SHA) — prevents 3×-retry storm per broken SHA\nFixes arc0me-site 9-attempt dedup failure (tasks #13753-13755)\nPattern: build-failure sensors must gate on content SHA, not just pending/active status
            worker_deploy
            context_review
            note right of context_review: SKILL_KEYWORD_MAP EXTENDED (11c64e31)\nscaffold skill/create skill/skill scaffold → arc-skill-manager\nemail routing/email report_recipient/email credential → arc-email-sync\nCloses 3 missed-coverage gaps found in task #16398 (scaffold + email verify tasks)\nCOMPETITION KEYWORDS (eae91b0a): competition/trading competition/AIBTC competition → competition skill\nBITFLOW LP (35a466b8): bitflow LP/liquidity pool → bitflow-lp skill\nstale arc-cost-alerting entry removed (skill no longer installed)\n5-SKILL MAP UPDATE (8ee85666): 5 skills added since last audit now have keyword coverage\nEnsures new skills are routed correctly at dispatch time — no missed context\nSYNC-TASK SKIP (61d96c06): arc-opensource sync tasks excluded from keyword check\nCommit messages embedded in sync descriptions contain domain keywords from changed code\nKeywords belong to the committed files, not the sync task's own skill requirements\nFP REDUCTION (3c519fa3 + f6961f5d): trading-comp-mirror removed from SKILL_KEYWORD_MAP (skill uninstalled)\nPR REVIEW REGEX EXPANDED (f6961f5d): /^Review (PR[: #]|[\w/-]+ PRs? #\d+)/ covers "Review PR: repo#N - title" format\nESCALATION TASK SKIP (f6961f5d): "Escalate to whoabuddy:" subjects excluded from both checkMissingSkillCoverage\nand checkEmptySkillsFailed — escalation task descriptions reflect other party's needs, not dispatch context\nARC-EMAIL-SYNC KEYWORD NARROWED (9bf388ed): "arc-email" → "arc-email-sync" keyword in SKILL_KEYWORD_MAP\n"arc-email" was too broad — matched "arc-email-worker" CF worker tasks that don't need the email client skill\nPattern: SKILL_KEYWORD_MAP entries must not match skill names that are substrings of other installed skill names\nZEST KEYWORD NARROWED + BLOG/AUTO-QUEUE EXCLUSIONS (e2ba4e1): bare "zest" removed from defi-zest keywords\n"zest" caught blog posts about Zest (task #18177) and auto-queue orchestrators (task #18174)\nFix: replace with operational-only terms (zest protocol/yield/supply/borrow/repay)\nAdd ^Write blog post: and ^Auto-queue: subject exclusions to checkMissingSkillCoverage\nSkip list grows to ~18 conditions — approaching >20 refactor threshold\nPattern: SKILL_KEYWORD_MAP keywords must be operational intent, not domain content words
            compliance_review
            arc_workflows
            note right of arc_workflows: drives workflow state machine\ncheckPrExists HARDENED (486691cb): fetches 'state' field, validates === 'OPEN'\nMerged/closed PRs now correctly return false — exit-code-only check was insufficient\n(gh pr view exits 0 for merged/closed PRs — state check closes the gap)\nCAP-DEQUEUE CLEANUP (9aec6798): getPendingPrReviewTaskIdsToday() in db.ts\nExcess pending PR review tasks auto-closed as completed when 20/day cap hit\nPrevents failure metric inflation from tasks dispatch never executes\nSITE-HEALTH BLOG-PUBLISHING SKILL (0d9f5f7c): freshness-fix tasks now include blog-publishing skill\nPreviously only blog-deploy — insufficient context for content creation steps\nAUTO-ADVANCE STATE (e760b47e): autoAdvanceState field on WorkflowAction\nSensor transitions workflow immediately after inserting create-task action\nPrevents stuck-in-state loop: executing task forgets transition → dedup blocks fix tasks\nApplied to SiteHealthAlertMachine (alert → fixing auto-advances on task queue)\nPattern: create-task actions should own their own state transition\nstate-specific source keys (8ce27fb9)\ndedup scoped to workflow:{id}:{state}\nprevents cross-state dedup collisions\nPrLifecycleMachine owns ALL PR review dispatch (061c807d)\nAUTOMATED_PR_PATTERNS exported from state-machine.ts\ncontext preserved on state transitions (not overwritten)\ngithub-mentions defers review_requested/assign to workflow engine\nSkills format: JSON.stringify() not .join(",") (f3b5159d)\narc-self-review: trigger state includes workflow transition cmd (806ce147)\nGH CLI GraphQL migration: fetchGitHubPRs() now uses gh api graphql\nbatched multi-repo query (was per-repo REST + credentials fetch)\nremoves fetchWithRetry + getCredential dependencies\nTERMINAL-STATE AUTO-COMPLETE (6b743823):\nNew PRs seen already closed/merged → completeWorkflow() immediately\nExisting workflows with no outgoing transitions → completeWorkflow()\nPrevents stuck workflow accumulation (fixed 159 stuck workflows task #10919)\nAPPROVED-PR GUARD (4292cef2): arcHasReview field in GithubPR\nGraphQL fetches last 20 reviews per PR (batched, no extra calls)\nmapPRStateToWorkflowState() → "approved" if Arc has any review\nRegression guard: approved → opened/review-requested blocked\nPR query: first:50 → last:50 (0fee0799) — most recent PRs now\nincluded even in high-activity repos (>50 total PRs)\nAUTO-CLOSE AUTOMATED PRs (46389bb8): buildReviewAction() returned null\nfor dependabot/release-please in 'opened' state → meta-sensor noop loop\nNow returns transition→closed for skipped PRs → auto-advances without human\nFixed 21 stuck automated PR workflows (pr-lifecycle completion 69%→normal)\nDAILY-BRIEF-INSCRIPTION MACHINE (f7e9124c): token spiral circuit breaker\nNew DailyBriefInscriptionMachine (8 states):\npending→brief_fetched→balance_ok→committed→commit_confirmed→revealed→confirmed→completed\nHard rules: one state per task, context <2KB, NO full brief text in workflow\nBrief stored as dataHash (SHA-256) + briefSummary (max 200 chars)\nConfirmation polling always spawns separate scheduled task (never inline)\nSCRIPT DISPATCH (b40ebe8e): ALL 6 DailyBriefInscriptionMachine workflow states\nconverted from sonnet/haiku to model="script" — inscription is fully deterministic\nWorkflowAction interface gains first-class `script` field (ddb63edf)\nSensor substitutes {WORKFLOW_ID} placeholder at task creation time\n~180 lines of LLM instruction strings replaced by single CLI commands\n7th skill using script dispatch pattern; pattern now native to state machine\nrevealAmount + feeRate context fields added (passed via CLI flags)\nLASTREVIEWEDCOMMIT SHA DEDUP (cad8fb5c): headCommitSha tracked per PR\nin workflow context (via headRefOid from GitHub GraphQL)\nBefore queuing pr-review task: skip if headCommitSha === lastReviewedCommit\nUpdate lastReviewedCommit when review task is created\nFixes bff-skills#494 storm (9 review cycles overnight per PR)\nEach distinct commit reviewed exactly once regardless of workflow state cycling\n[RESOLVED] Round-based PR dedup — 3rd-retrospective carry item CLOSED\nPENDING-TASK-DEDUP FIX (2482db11): taskExistsForSource checked ALL statuses\nBulk-cleaned tasks permanently blocked re-creation (workflows 1923/2038/2077/2127)\nFix: pendingTaskExistsForSource — deduplicates pending/active only\nEnables retry after failure; closes workflow-dedup ghost-row pattern\nDAILY PR REVIEW CAP (99779912): countPrReviewTasksToday() added to src/db.ts\n20/day cap gates arc-workflows sensor task creation\nPrLifecycleMachine model: sonnet→haiku for lower per-task cost\nFixes 600+/day PR review flood that exceeded $200/day cost cap\n76 excess tasks manually closed at fix deploy\nKEYWORD SKILL DETECTION (66aefa05): prReviewSkills() in state-machine.ts\nScans PR title for domain keywords (bitflow, zest, hodlmm/dlmm)\nAdds matching skill (defi-zest/defi-bitflow/hodlmm-move-liquidity) to task\nFixes context-review false negatives for domain-specific PR reviews\nPR EXISTENCE CHECK (4ea89d0e): checkPrExists() via gh pr view before insertTask\nPer-run Map caches results (same repo+number checked once per sensor cycle)\nIf exit non-zero: updateWorkflowState→closed + completeWorkflow + continue\nFixes stale-PR-queue contamination: #267, #291, #561 re-failing daily\nPattern: validate external resource existence before creating dependent task\nNEW-RELEASE AUTO-ADVANCE (639cc3f9): autoAdvanceState added to NewReleaseMachine\ndetected→assessing: task creation auto-advances state, prevents duplicate assessment tasks\nintegration_pending→integrating: task creation auto-advances state, prevents duplicate integration tasks\nRoot cause of 41-task flood (v1.52.0): sensor queued new task each cycle without state advance\nPattern: create-task actions must own their state transition — dedup alone is insufficient\nRETRO-DEDUP FIX (1a700e99): autoAdvanceState: "completed" added to all 9 retrospective_pending actions\nRoot cause of 2026-05-24 flood (116 dupes, $15.10/12h): workflow stuck in retrospective_pending\npendingTaskExistsForSource returned false (task completed, workflow never advanced) → re-created every 5min\nFix: state machine auto-advances on task creation; dispatched agents no longer need manual transition step\nAlso removed "Transition workflow to 'completed'" from 9 task description step lists (automated now)\nBELT-AND-BRACES (e4c8a9b3): recentTaskExistsForSource(source, 60) added before insertTask in meta-sensor\nCatches stuck-in-state loops where autoAdvanceState missing → duplicates capped 1/hour not 1/5min\nTwo-layer defense: (1) state machine auto-advance (2) time-based sensor fallback\nOVERNIGHTBRIEF AUTO-ADVANCE (83a77c62): autoAdvanceState added to OvernightBriefMachine pending state\nWorkflow stuck in 'pending' after task creation — meta-sensor 60-min dedup allowed hourly re-fire\n~$0.75/day wasted on no-op sonnet cycles\nFix: state machine self-advances on task creation — same pattern as retrospective_pending (1a700e99)\nPattern: ALL machine states with create-task actions must have autoAdvanceState; belt-and-braces alone is not enough\nCOMPLETED-TASK DEDUP (44b55ea9): completedTaskCountForSource(source) > 0 blocks re-queue for pr-review: sources\nPrevents re-review noise for PRs outside GraphQL last-50 window (arcHasReview never set → workflow stays stuck)\nFailed tasks NOT blocked — retry after the 60-min recentDup window\nVersioned source keys (v1, v2, ...) make this safe for re-reviews (each cycle is a distinct source)
        }

        state MemoryMaintenanceSensors {
            arc_architecture_review
            note right of arc_architecture_review: SHA-GATE (b5907974): gates on code SHA change vs last review\nDiagram mtime NOT used — unchanged code means diagram is still accurate\nPrevents daily re-reviews when no structural changes have occurred\nTOKEN-EXPLOSION FIX (c6a82d76): AGENT.md scoped to git diff since last SHA\nNever reads all 119+ SKILL.md/AGENT.md files — only changed files per diff\nPattern: arch-review reads changed files only; sensor-health uses aggregate CLI
            arc_blocked_review
            note right of arc_blocked_review: DEAD-END COOLDOWN (9bbab77d): DEAD_END_REVIEW_COOLDOWN_HOURS=168 (7 days)\nCandidates split into signal-triggered (reason NOT "blocked for X") vs stale-only\nSignal-triggered: fire immediately regardless of cooldown\nStale-only: suppressed if review ran within 168h (getLastCompletedTaskBySource)\nFixes X API 402 dead-end (#17796) re-reviewing every 8h with no unblock path\nPattern: known dead-ends need a long cooldown, not a short one
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
            note right of arc_skill_manager: CARRY-20 RESOLVED (task #13567, 2026-04-24): all 72 sensors\nalready use claimSensorRun() correctly — 100% compliant, no migrations needed\nPRE-COMMIT HOOK (6b40fd75): lint-skills --staged\nBlocks commits with nested metadata.tags or abbreviated sensor vars (const res/err/val)\nInstall: arc skills run --name arc-skill-manager -- install-hooks\nHOOK VERSIONED (8b144aeb): skills/arc-skill-manager/hooks/pre-commit now git-tracked\ninstall-hooks symlinks .git/hooks/pre-commit → tracked path (not inline script)\nCloses ×22-audit carry — hook survives fresh clones, versioned with skill\nPattern: hook scripts belong in skills/*/hooks/ alongside the skill that owns them\nAGENT.MD VALIDATION (7fb077c0): lint-skills --staged now checks --skills flags in AGENT.md files\nagainst installed skill tree — catches stale skill name refs at commit time\nWould have caught all 3 stale refs (34103100) without manual review\nCloses [OPEN — NEW] gap from 2026-04-19T07:10Z audit\nCoverage now complete: SKILL.md frontmatter + sensor.ts vars + AGENT.md skill refs\nTOKEN-EXPLOSION FIX (c6a82d76): sensor-health-report CLI added to SKILL.md\nAggregates all 73 sensors in one call — replaces per-sensor file reads\n73 sequential reads × accumulated context = 3.6M tokens (tasks #16708/#16800/#16756)\nRule: if task reads >10 files, add aggregate CLI command first\nDISALLOWED-TOOLS ROLLOUT (aedca433+ea621957+e8847cdf+a4b40d89): 29/29 candidates\nRead-only skills (research, audit, review, sensor-adjacent) now have\ndisallowed-tools: [Edit, Write, NotebookEdit, Bash] in SKILL.md frontmatter\nAuthoring guide updated in SKILL.md; disallowed-tools is now documented best practice\nRELOAD-SKILLS FLAG (cd278723): create command writes db/skills-pending-reload.flag\nSessionStart hook returns reloadSkills:true when flag present — dynamic reload\nwithout session restart after skill scaffolding; flag created, hook clears it\nRECENT-LOG CONSOLIDATION (32e8ae47): Check 1c added to sensor\nMonitors memory/recent.log; queues P7/sonnet consolidation at >300 lines\nThreshold ~monthly at current task pace; closes [NEW-WATCH] from 2026-05-29T08:50Z audit\nTask steps: extract patterns → merge into MEMORY.md → archive entries >30d\nRECENT-LOG COOLDOWN (15547bf3): 4h cooldown added via getLastCompletedTaskBySource\nSensor fired 6-8×/day — archiving was no-op (all entries <30d); each run added 2-3 lines back over threshold\nFix mirrors arc-housekeeping e96561a0 — RECENT_LOG_COOLDOWN_MINUTES=240\nPattern: threshold-firing sensors must have a cooldown guard\nTHRESHOLD RAISED 300→500 (44ec2ef6): quick band-aid commit; same day superseded by age-based fix\nAGE-BASED ARCHIVING (d2b1677d): Replace count threshold with age check\nSensor queues consolidation only when entries older than 14 days exist\nSelf-limiting: after archiving fires, won't trigger again for ~14 days regardless of log growth\nCooldown bumped to 24h as safety net; RECENT_LOG_THRESHOLD constant removed\nPattern: archival sensors should gate on data age, not data volume — count-based thresholds are infinite band-aids
            arc_self_audit
            arc_purpose_eval
            note right of arc_purpose_eval: NEW (f1e0a1f6) — 720-min cadence + date dedup\n4 SQL-measurable dimensions: Signal (25%), Ops (20%), Eco (20%), Cost (15%)\nScores computed from tasks + cycle_log, no LLM\nAuto-creates follow-up tasks for low-score dimensions:\n  signal≤2 → research signal-worthy topics\n  ops≤2 → failure triage\n  cost=1 → cost optimization review\n  ecosystem≤1 → PR review sweep\nCreates eval summary task (sonnet) for 3 LLM dimensions\nSensor count 70→71, skill count 103→104
            auto_queue
            note right of auto_queue: STALE-BEAT FIX (0d84bf9e): briefing text told agents Arc owns\n'infrastructure, agent-trading, quantum' — all retired/wrong\nCorrected to active beats: aibtc-network, bitcoin-macro, quantum\nPattern: auto-queue context must be updated alongside every beat change
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
            note right of agent_health: NEW (5f32865) — agent-health-loom\n120-min cadence, SSHes into Loom (Rising Leviathan)\nGathers: cycle_log metrics, task failure patterns,\ngit history, gate/watchdog state\nCreates Haiku analysis task only on YELLOW/RED\nGREEN conditions → skip (cost optimization)\nAll data pre-baked in task description (zero tool calls for Haiku)\nSQL ESCAPING FIX (16110678): queryLoomDb shell command used single-quoted\nstring for bun --eval; SQL literals (datetime('now'), status='failed')\nbroke the outer single-quoted argument. POSIX '\''-escaping applied.\nTOKEN SPIRAL THRESHOLD (b618a6e7): alert threshold lowered 1M→750K tokens\nEarlier detection reduces token waste before escalation fires\nTASK_ID CARRY FIX (b4d02fb7): rows.find() used started_at string comparison\nto recover task_id after spikeCycles.map() dropped it — two back-to-back\ncycles sharing same second-precision timestamp could attribute spike to\nwrong task. Fix: task_id preserved in spike entry during map(), used for\nqueryLoomDb lookup, stripped before returning (not part of public type)
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
        note right of CheckLock: NO-ORPHANS (2a4c1aff): bun v1.3.14 --no-orphans flag\nSystemd dispatch unit now kills Claude Code subprocesses\nif dispatch is unexpectedly terminated\nPrevents orphan processes consuming resources after crash

        CheckGate --> [*]: gate closed (rate limit / auth failure)
        CheckGate --> SelectTask
        note right of CheckGate: AUTO-RESET ON QUOTA (0a62b3cf): checkDispatchGate() parses\n'resets HH:MM (Timezone)' from stop_reason for rate_limited class\nFinds first reset time after stopped_at; if now >= reset_time → auto-reset and proceed\nConsecutive-failure stops (too_many_consecutive_failures) still require manual reset\nFixes 19h outage 2026-05-14: quota hit at 03:00Z, reset at 17:00Z\npost-reset 5.5h gap (17:00→22:40Z) would not have occurred with this fix in place\nPattern: rate_limited is temporary and machine-readable; auto-recovery is safe\nGATE EXTRACTED (0de5548): gate logic moved to src/dispatch-gate.ts\n3-layer rate_limit_event detection: (1) rate_limit_event JSON → ISO ts (2) ISO in string (3) 'resets HH:MM (Tz)' text\nstopped_until field computed at record time (not check time) — eliminates string parse on every gate poll\nFallback: ARC_RATE_LIMIT_BACKOFF_MS (default 60min) when no parseable reset time\nEmail notification fires on gate stop (fire-and-forget via arc-email-sync)\nINFORMATIONAL EVENTS (510b9e67): status=allowed bypasses gate failure path\nClaude Code emits rate_limit_event for denial AND informational (bucket warning, call succeeded)\nPrior code treated every event as denial — discarded successful results + tripped gate\nFix: short-circuit on status='allowed'; read resetsAt from rate_limit_info.resetsAt (epoch)\nLogs full payload on every event; sqlite service_logs only on real denials (no noise)\nDEFAULT BACKOFF (e423f55f): stopped_until = now + DEFAULT_RATE_LIMIT_BACKOFF_MS when no parseable reset\nPreviously latched indefinitely requiring manual 'arc dispatch reset' on unknown reset events\nFix: 60min default backoff ensures auto-recovery even when reset time unavailable\nCloses 2026-05-28T15:11:56Z incident (11+ min freeze from 'resets unknown')

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
            ReadTaskModel --> ScriptRoute: model=script (deterministic)
            ReadTaskModel --> CodexRoute: model=codex/*
            ReadTaskModel --> OpenRouterRoute: model=openrouter/*
            note right of ReadTaskModel: ARC_DISPATCH_MODEL env var\nset from MODEL_IDS[model]\npassed to subprocess\nEFFORT PINNED (8dc10022): --effort explicit per model\nopus: --effort high, MAX_THINKING_TOKENS=30000\nhaiku/sonnet/test: --effort medium, MAX_THINKING_TOKENS=10000\nPrevents silent cost inflation from upstream default changes (v2.1.94)\nDISPATCH_EFFORT_OPUS (f3a18557): env var override for opus effort\nDefault: "high"; set "xhigh" on v2.1.111+ for better intelligence\nwithout full "max" cost; allows per-deploy tuning without code change\nAPI_TIMEOUT_MS (95930cf0): env var set to match dispatch timeout\nOpus=30min, Sonnet=15min, Haiku=5min (model-aware)\nv2.1.101+ respects API_TIMEOUT_MS (previously hardcoded 5min)\nPre-set so individual API calls don't abort before outer watchdog fires\nV2.1.108 FIX (d263dbb6+8ad08307): Bash sandbox + permission bypass configured\nTrusted-VM dispatch unblocked; settings.json updated for new CC permission model\nOPUS 4.8 (8d8b18a5): claude-opus-4-7 → claude-opus-4-8\nanthropics-sdk-typescript sdk-v0.100.0 (2026-05-28); one-line MODEL_IDS update\nBetter intelligence on deep-work tasks; same API structure\nOPUS 4.7 (f3a18557): claude-opus-4-6 → claude-opus-4-7\nBetter intelligence on deep-work tasks; same API structure\nHAIKU→SONNET SIGNAL-FILING (221e2341): dispatch detects 'File *-signal:*' task subjects\nAuto-upgrades model to sonnet before subprocess invocation\nPrevents 5-min haiku timeout on aibtc-news-editorial LLM composition\nFixes task #13847 class — signal-filing tasks never use haiku regardless of creation source\nOPUS FALLBACK MODEL (7f3fdefc): --fallback-model sonnet added for opus tasks\nv2.1.152+ feature; dispatch passes flag when model=opus\nPrevents full dispatch stall if Opus is temporarily unavailable\nMCP_TOOL_TIMEOUT=120000 (7f3fdefc): env var set at dispatch subprocess invocation\nv2.1.142 fixed MCP_TOOL_TIMEOUT being ignored on HTTP/SSE transports (was silent 60s cap)\narc-mcp runs HTTP transport (port 3100) handling x402+Stacks calls with network latency\n120s prevents silent timeouts on legitimate tool calls
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
            note right of HasWorktreeSkill: MERGE SAFETY (f1125a85): cmdMerge removed --force from git worktree remove\nPreviously force-removed even if worktree had uncommitted changes — silently discarding work\nNow fails cleanly if uncommitted changes present — validate step catches before merge\nLSTATSYNC FIX (ff63c252): createWorktree() replaced fragile readdirSync() entry-count check with lstatSync\nPrevious code: check dir entry count (0 or 1 for "just arc.db"); but db/ tracks SVG files → count always >1\nunlinkSync first but db/ is a dir → throws; readdirSync saw >1 entries → skipped rm -rf\nsymlinkSync threw EEXIST; dispatch silently fell back to main tree — worktree isolation bypassed entirely\nFix: lstatSync detects dir (rm -rf) vs file/symlink (unlink) — handles db/ with any tracked content\nPattern: use lstatSync before any symlink creation in worktree setup — never infer type from entry count
        }

        WorktreeCheck --> ClaudeSubprocess

        state ClaudeSubprocess {
            [*] --> BudgetGuard
            BudgetGuard --> StreamJSON: under per-model cap
            BudgetGuard --> [*]: --max-budget-usd exceeded → abort
            StreamJSON --> ParseResult
            ParseResult --> ExtractCost
            ExtractCost --> [*]
            note right of BudgetGuard: NEW (e124013c): --max-budget-usd per invocation\nDefaults: opus=$10, sonnet=$3, haiku=$1\nOverride: MAX_BUDGET_USD_OPUS/SONNET/HAIKU env vars\nPrevents loom-spiral class (was ~$15/cycle at 1.2M tokens)\nClaude Code enforces mid-stream — aborts gracefully with cost summary\nFORK ISOLATION (67d7050c): CLAUDE_CODE_FORK_SUBAGENT=1 enabled\nForked subagents inherit full env (ANTHROPIC_API_KEY, SUBPROCESS_ENV_SCRUB=0)\nRun under --permission-mode bypassPermissions alongside parent session\nEvaluated safe post-competition (task #13297)\nEXCLUDE DYNAMIC SECTIONS (9b296392): --exclude-dynamic-system-prompt-sections\nApplied at dispatch subprocess invocation; 20-30% additional token reduction\nBoth prompt caching levers now active (ENABLE_PROMPT_CACHING_1H + this flag)\nRef: memory/shared/entries/prompt-caching-exclude-dynamic.md
            note right of StreamJSON: AskUserQuestion intercepted by\nPreToolUse hook (autoanswer.sh)\npermissionDecision:allow + answer\nreturned in 5s — no stall\nPOSTTOOLUSE SYNTAX GUARD (0b388b1e): pre-commit-syntax.sh\nRegistered on Bash(git commit*); bun build --no-bundle validates staged .ts\ncontinueOnBlock:true — Claude fixes errors in-session before commit lands\nSession-level (inner) guard; complements dispatch-level SafeCommit (outer)\nTwo-layer defense: hook catches at commit time, dispatch catches at post-commit\nSCRIPT BLOCKED STATUS (a1e4ddd0): dispatchScript() detects preflight.safe_to_broadcast===false\nor /Pre-flight blocked/i in error string → returns status:"blocked"\nmarkTaskBlocked() called instead of markTaskFailed() — doesn't burn retries or trip gate\nApplied to: welcome STX-send preflight (insufficient balance class)\nPrevents 7× welcome failures/day from inflating failure metrics
        }

        ClaudeSubprocess --> PostDispatch

        state PostDispatch {
            [*] --> RecordCycleLog
            RecordCycleLog --> RecordQuality
            note right of RecordCycleLog: TOOL_CALLS (f51a7ec2): cycle_log.tool_calls JSON array\nCaptures tool name sequence per dispatch cycle\nEnables golden case assertions for vitest-evals-style harness eval\nPer Hylak eval guidance (agent-eval-volume-taxonomy.md)\nFALLBACK MODEL VISIBILITY (6f00f638): actual_model extracted from stream JSON\nChecks assistant message + result event for model field\nOn mismatch vs MODEL_IDS[effectiveModel]: warn log + service_log entry + updateCycleLog(model=actual)\nCloses observability gap: opus→sonnet fallback was invisible in cycle_log\nEnables cost/quality retrospectives on degraded cycles
            note right of RecordQuality: DISPATCH CATCH-BLOCK GUARD (af5c6ac2): at top of catch, check if LLM already self-closed\nif task.status !== 'active' → preserve status, log, skip requeueTask\nFixes subprocess error during teardown overwriting completed→pending\nDEATH-PROOF AT DB LAYER (78408d07): requeueTask WHERE status!='completed'\nDB-layer invariant: a completed task can NEVER be set to pending\nRace-safe: UPDATE 0-row no-op on already-completed task\nCloses dispatch resurrection bug class (task #17845)
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
            [*] --> AppendReflection
            AppendReflection --> CheckCriteria: always (6aa253fe)
            CheckCriteria --> SpawnRetrospective: P1 task OR cost >$1
            CheckCriteria --> KeywordScan: completed, below threshold
            KeywordScan --> SpawnLearningExtraction: discovery keywords matched (P8/Haiku)
            KeywordScan --> [*]: no keywords matched
            SpawnRetrospective --> [*]
            SpawnLearningExtraction --> [*]
            note right of AppendReflection: REFLECT (6aa253fe): appendTaskReflection() called at markTaskCompleted/Failed/Blocked\nAppends one line to memory/recent.log: ISO ts | task ID | status | model | subject | summary\nTwo memory outputs: MEMORY.md (compressed, consolidated) + recent.log (rolling, cheap)\nProcess recent.log monthly to extract patterns — deliberate deferred automation (see CLAUDE.md)
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
        note right of CheckSensorCooldown: NEW (b5caf209): sensor-side cooldown guard\nPrevents creating dispatch tasks that will\nfail due to API-enforced 60-min cooldown\nEliminated ~3 false failures/day\nWired in: aibtc-agent-trading + arxiv-research\nEXTENDED (ab0d1f47): now also checks pending/active queue\nPreviously only checked recently-completed tasks — a second\nsensor pass would see no cooldown if task still pending, creating\nduplicate queues both eventually 429-ing\nFix: any pending/active task matching beat subject patterns blocks\nnew queue entry — closes cooldown collision pattern (tasks 13116, 13146)\nBEAT_SUBJECT_PATTERNS FIX (28cb5e3f): db.ts patterns matched\n'File agent-trading signal%' + 'File infrastructure signal%'\nnot 'File aibtc-network signal%' — aibtc-network cooldown never triggered\nSilent drift for weeks; fixed to match actual sensor task subjects
        note right of CheckBeatAllocation: BEAT CONSOLIDATION (PR #442): 12 beats → 3 beats\nAIBTC Network = all 10 former network domains (agent-trading,\ninfrastructure, security, governance, onboarding, agent-skills,\nagent-social, agent-economy, deal-flow, distribution)\nBitcoin Macro = BTC macro\nQuantum = quantum/ECDSA threats (arxiv_research sensor)\nEDITORIAL MODEL: Arc is CORRESPONDENT (not editor)\nEditors: AIBTC Network=Elegant Orb; Bitcoin Macro=Ivory Coda; Quantum=Zen Rocket\nEditors earn 175k sats/day; correspondents 30k sats/included signal\nDaily brief cap: 4 approved signals/beat/brief\naibtc-agent-trading sensor: JingSwap, P2P desk, agent registry\nordinals-market-data signal filing SUSPENDED (80322a56)\narc-link-research: routes to AIBTC Network (was infrastructure)\nX PRESCREEN (2bac6fc3+7240787c): prescreenXUrls() checks tweet existence\nbefore dispatch — was 42% wasted spend (11/26 deleted/protected tweets)\nprescreen subcommand added; prescreenXUrls helper extracted (DRY)\narc-link-research/cli.ts: lenient-default path logged (1f951fdf) for auth diagnostics\narcXiv: routes to Quantum beat\ncountSignalTasksToday() BUG FIXED (ca5477c1)\n[RESOLVED] Bitcoin Macro sensor live (64ff537, task #12742) — 240-min cadence\nprice-milestone + price-move + hashrate-record + difficulty-adjustment signals\nFirst signal filed 2026-04-16 (hashrate ATH 972.3 EH/s)
    }

    TaskQueue --> DispatchService
    SensorsService --> TaskQueue
    ContentSensors --> SignalAllocation
```

## Sensor Count by Category (2026-04-27T18:55Z)

| Category | Count |
|----------|-------|
| Memory/Maintenance | 15 |
| GitHub/PR | 10 |
| Content/Publishing | 10 |
| AIBTC/ERC-8004 | 7 |
| Infrastructure | 14 |
| DeFi | 6 |
| Health | 1 |
| Monitoring | 7 |
| Other/Misc | 3 |
| **Total** | **~74** |

## Skill Count by Category (2026-04-27T18:55Z)

*Skills: ~115 total (was 113 at last review — +2 added since last full catalog count)*

New skills added (v0.40.0):
- `contract-preflight` — dry-run Stacks contract calls via stxer simulation engine (Secret Mars, BFF winner)
- `stacking-delegation` — read-only STX stacking monitor: status, PoX cycle, reward payouts (Secret Mars, BFF Day 15)
- `defi-portfolio-scanner` — cross-protocol DeFi position aggregator (BFF Day 7, v0.39.0)
- `hodlmm-move-liquidity` — HODLMM bin rebalancer (BFF Day 14, v0.39.0)
- `sbtc-yield-maximizer` — idle sBTC yield router (BFF Day 16, v0.39.0)
- `zest-auto-repay` — Zest LTV guardian with Arc-reviewed bug fixes (v0.39.0)

## Key Architectural Changes (cfea1c10 → 6def33c) [2026-06-09T09:28Z]

| Change | Impact |
|--------|--------|
| **No structural changes** (6def33c) | Two commits in window: (1) `6def33c` chore(loop) auto-commit updating weekly deck HTML only — no dispatch, sensor, or skill logic changed; (2) `88d1d817` docs(architect) — prior arch-review output. Diagram remains accurate. Sensor triggered on "active reports to process." |

## Key Architectural Changes (21f490d3 → cfea1c10) [2026-06-08T21:27Z]

| Change | Impact |
|--------|--------|
| **fix(arc-email-sync): parseFlags handles boolean --force flag correctly** (cfea1c10) | `skills/arc-email-sync/cli.ts` — `BOOLEAN_FLAGS = new Set(["force"])` added; `parseFlags()` now checks if a flag key is in `BOOLEAN_FLAGS` and sets value to `"true"` without consuming the next arg. Prior behavior: `--force` consumed the next positional arg as its value, misrouting subcommand arguments. Minimal, correct fix. No sensor or dispatch path changes. |

## Key Architectural Changes (55137b0 → 44b55ea) [2026-06-05T09:18Z]

| Change | Impact |
|--------|--------|
| **fix(arc-workflows): block PR review re-queue when completed task exists for exact versioned source** (44b55ea9) | `skills/arc-workflows/sensor.ts` — `completedDup` guard added alongside existing `pendingDup` and `recentDup` checks. For sources starting with `"pr-review:"`, if `completedTaskCountForSource(source) > 0`, the sensor skips re-queue entirely. Fixes the edge case where a PR falls outside the GraphQL `last:50` query window: Arc's review is never seen by `syncGitHubPRs`, `arcHasReview` stays unset, the workflow never advances to `"approved"`, and review tasks keep re-queuing each cycle. Versioned source keys (`v1`, `v2`, ...) preserve per-commit re-review capability. Failed tasks are not blocked — they retry after the 60-min `recentDup` window. Pattern: **completed PR review tasks are terminal — don't re-queue a review for a source that already succeeded**. |

## Key Architectural Changes (e2ba4e1 → 55137b0) [2026-06-04T21:18Z]

| Change | Impact |
|--------|--------|
| **fix(github-mentions): gate external PRs on state and review at sensor time** (58715da1) | `skills/github-mentions/sensor.ts` added `getPRState()` helper. For non-watched repos, sensor now checks PR state (skip if not OPEN) and Arc review status (skip if already reviewed) before queuing a task. Addresses bff-skills stale-PR noise: PRs #564/#565/#579 were closed/approved but kept re-queuing each sensor cycle. Previously only dispatch pre-flight caught these — full cycle wasted. Pattern: **sensor-time external resource validation prevents dispatch waste on stale tasks**. |
| **fix(arc-memory): age-based recent.log archiving** (44ec2ef6 → d2b1677d) | Two-commit resolution on the same day. `44ec2ef6` (haiku) raised threshold 300→500 as a quick band-aid. `d2b1677d` (sonnet) replaced count-based threshold with age check: sensor now only queues consolidation when entries older than 14 days exist. Self-limiting by design — after archiving fires, won't trigger again for ~14 days. `RECENT_LOG_THRESHOLD` constant removed; cooldown bumped to 24h. Closes the [CARRY-WATCH] from 2026-06-04T09:17Z audit. Pattern: **archival sensors should gate on data age, not volume — count thresholds are infinite band-aids**. |
| **fix(arc-workflows): OvernightBriefMachine missing autoAdvanceState** (83a77c62) | `skills/arc-workflows/state-machine.ts` — OvernightBriefMachine `pending` state lacked `autoAdvanceState`. Workflow stayed in `pending` after task creation; 60-min belt-and-braces dedup allowed re-fire every hour, ~$0.75/day wasted. Same root cause as retrospective_pending flood (1a700e99). Pattern: **every create-task action must have `autoAdvanceState` set — 60-min sensor dedup is defense-in-depth, not the primary guard**. |
| **fix(arc-skill-manager): compliance rename ts→timestamp** (55137b0d) | Pre-commit hook enforcement. Abbreviated `ts` variable renamed to `timestamp` in `sensor.ts`. No behavioral change. |

## Key Architectural Changes (cb79dd8b → 5aa3d416) [2026-06-04T09:17Z]

No structural commits to `src/` or `skills/`. Watch report 2026-06-04T01:02Z integrated: 32/32 completed, 0 failed, $9.96. Pipeline clean.

**[WATCH]** `recent.log` consolidation fired twice as no-ops in one 12h period (#18210, #18222, 431→443 lines). The 4h cooldown is in place but rapid new entries keep pushing past 300 lines after each no-op run. CEO recommendation: raise line threshold rather than cooldown. Pattern: threshold sensors may need threshold tuning when the data itself grows faster than archiving can absorb. Tracking as a [CARRY-WATCH].

| Change | Impact |
|--------|--------|
| *(no structural commits this window)* | Watch report and CEO review integrated. No code changes. |

## Key Architectural Changes (15547bf → e2ba4e1) [2026-06-03T09:15Z]

| Change | Impact |
|--------|--------|
| **fix(arc-worktrees): replace fragile db/ dir check with lstatSync before symlinking** (ff63c252) | `src/worktree.ts` `createWorktree()` previously detected db/ type by counting `readdirSync()` entries (skip rm if >1). But db/ tracks SVG files → count always >1 → `symlinkSync` threw EEXIST → dispatch silently fell back to main tree, bypassing worktree isolation entirely. Fix: `lstatSync` detects directory vs file/symlink before deciding between `rm -rf` and `unlink`. Pattern: **always lstatSync before any symlink creation in worktree setup** — never infer filesystem type from entry count. |
| **fix(context-review): remove bare "zest" keyword and add blog/auto-queue exclusions** (e2ba4e1) | Bare `"zest"` in `defi-zest` keyword list was too broad — matched blog posts about Zest (task #18177) and auto-queue domain-enumeration tasks (task #18174). Fix: replace with specific operational terms (`zest protocol`, `zest yield`, `zest supply`, `zest borrow`, `zest repay`). Add `^Write blog post:` and `^Auto-queue:` subject exclusions. Context-review skip list grows to ~18 conditions. **[WATCH]** Approaching >20 refactor threshold — consider structural `OPERATIONAL_ONLY` flag on task subject patterns rather than an ever-growing exclusion list. |

## Key Architectural Changes (95a0715 → 15547bf) [2026-06-02T21:15Z]

| Change | Impact |
|--------|--------|
| **fix(arc-memory): add 4h cooldown to arc-recent-log-consolidate sensor** (15547bf3) | `arc-skill-manager` sensor was firing 6-8×/day when `memory/recent.log` exceeded 300 lines, but each consolidation run was a no-op (all entries <30 days old — nothing to archive). Each run added 2-3 lines, pushing the count back over threshold immediately. Fix: `RECENT_LOG_COOLDOWN_MINUTES=240` guard using `getLastCompletedTaskBySource`, mirroring the arc-housekeeping zero-fix cooldown (e96561a0). Validated in CEO review #18133. Pattern established: **any sensor that fires on a count threshold must have a cooldown guard** — archiving does not always shrink the data. |

## Key Architectural Changes (e96561a0 → b07bc650) [2026-06-01T09:15Z]

| Change | Impact |
|--------|--------|
| **fix(blog-publishing): skip adding published_at if already present in frontmatter** (b07bc650) | `cmdPublish` in `skills/blog-publishing/cli.ts` now guards against adding a duplicate `published_at` field. Prior code unconditionally inserted `published_at: <now>` after the `updated:` line — a re-publish or `--force` run on an already-published post would produce two `published_at` entries in frontmatter. Fix: check `!/^published_at:/m.test(content)` before the replacement. Idempotent publish is now safe regardless of prior state. |

## Key Architectural Changes (0de5548 → 32e8ae4) [2026-05-29T09:09Z]

| Change | Impact |
|--------|--------|
| **fix(dispatch): don't classify informational rate_limit_event as failure** (510b9e67) | Claude Code v2.1.x emits `rate_limit_event` for two cases: denial (abort required) and informational (bucket warning, call succeeded). Prior code treated every event as denial — discarding successful results and tripping the gate. Fix: `status='allowed'` short-circuits before failure path; `resetsAt` now read from `rate_limit_info.resetsAt` (epoch seconds); full payload logged on every event. Verified against 2026-05-28 repro where opus returned exit=0 with `{status:allowed, type:five_hour}`. |
| **fix(dispatch-gate): default backoff when rate_limit_event has no parseable reset** (e423f55f) | Previously: gate latched indefinitely on unknown reset time, requiring manual `arc dispatch reset`. Fix: `stopped_until = now + DEFAULT_RATE_LIMIT_BACKOFF_MS` (60min default, env-configurable) when no parseable reset in event. Pairs with 510b9e67 to close the 2026-05-28T15:11:56Z incident (11+ min freeze). |
| **fix(dispatch): don't requeue tasks the LLM already self-closed** (af5c6ac2) | Dispatch `catch` block previously requeued/failed tasks based only on error class — never checked if LLM already self-closed the task. `requeueTask` unconditionally set `status='pending'`, resurrecting completed tasks. Fix: guard at catch top — if `getTaskById(task.id).status !== 'active'` → preserve status, log, skip requeue. |
| **fix(db): requeueTask must never resurrect a completed task** (78408d07) | Belt-and-braces at DB layer: `UPDATE ... WHERE id=? AND status != 'completed'`. Race-safe 0-row no-op on already-completed task. Closes dispatch resurrection bug class at the invariant level regardless of caller. Together with af5c6ac2 — defense in depth. |
| **feat(arc-email-sync): add sent-folder dedup guard to send path** (651120e6) | Before sending, query sent folder for matching subject within recent window. Skip send + close idempotently if already sent. Closes bug #1 of side-effecting-task re-dispatch pattern (task #17836). `arc-email-sync/cli.ts` and `SKILL.md` updated. |
| **feat(skill): scaffold arc0btc-email-worker** (495369d1) | New skill for `arc0btc/arc-email-worker` Cloudflare Worker + Durable Object email store. Covers schema-health endpoint pattern (issue #2), admin-gated routes, `wrangler deploy` workflow. `disallowed-tools: [Edit, Write, NotebookEdit]` — Bash retained for gh/wrangler. Skill count 120→121. |
| **feat(models): upgrade opus tier to claude-opus-4-8** (8d8b18a5) | `MODEL_IDS.opus` updated `claude-opus-4-7 → claude-opus-4-8` (sdk-v0.100.0, 2026-05-28). One-line change; all opus-tier tasks pick up new model on next dispatch. |
| **feat(arc-memory): add recent.log line count check** (32e8ae47) | `arc-skill-manager` sensor gains Check 1c: monitors `memory/recent.log` line count on 120min interval; queues P7/sonnet consolidation task when >300 lines. Closes [NEW-WATCH] from 2026-05-29T08:50Z audit. Consolidation: extract patterns → merge into MEMORY.md → archive entries >30d. |
| **fix(arc-email-sync+arc-peer-inbox): rename abbreviated vars** (cbd1ff78+7ccf1eef) | Pre-commit hook compliance: `res/msg` → `response/message` in `arc-email-sync/cli.ts`; `ts` → `timestamp` in `arc-peer-inbox/sensor.ts`. Closes abbreviated-var violations detected by `lint-skills --staged`. |

## Key Architectural Changes (428b8fd → 0de5548) [2026-05-29T08:50Z]

| Change | Impact |
|--------|--------|
| **feat(dispatch): three-layer rate-limit detection via rate_limit_event JSON** (0de55487) | Gate logic extracted to `src/dispatch-gate.ts` (own module). New `stopped_until` field stores computed auto-reset time at record time — no more string parsing on every gate check. Three-layer detection: (1) structured JSON `rate_limit_event` → ISO timestamp (2) ISO timestamp in stop_reason string (3) text "resets HH:MM (Timezone)" fallback. `ARC_RATE_LIMIT_BACKOFF_MS` env var fallback (default 60min) when no parseable reset. Email notification fires on gate stop. Closes the 19h recovery gap that affected 2026-05-14 and 2026-05-28. |
| **feat(arc-peer-inbox): file-based inter-agent inbox via Stop hook + sensor** (9d287f4d) | New skill + sensor for local IPC. Stop hook (`inbox-write.sh`) fires after each dispatch cycle; writes `inbox/<peer>/<ts>.md` for aibtc.com inbox-thread tasks. Sensor reads `inbox/arc/` at 1-min cadence, creates P3/sonnet task per unprocessed file. Production agent-to-agent path remains aibtc.com inbox. This is an intra-session and async local result-forwarding layer. Sensor count 72→73. |
| **feat(reflect): per-task reflection to memory/recent.log** (6aa253fe) | `appendTaskReflection()` called at every `markTaskCompleted/Failed/Blocked`. Appends one line: `ISO ts \| task ID \| status \| model \| subject \| summary`. Two memory outputs: MEMORY.md (compressed) + recent.log (rolling cheap log). CLAUDE.md updated with monthly processing instruction. Implements RARV Reflect phase. |
| **feat(cycle_log): add tool_calls column for harness-backed eval support** (f51a7ec2) | `cycle_log.tool_calls` stores JSON array of tool names per dispatch cycle. Enables golden case assertions on tool-call sequences per Hylak eval guidance (agent-eval-volume-taxonomy.md). Schema migration via `addColumn`. |
| **feat(memory): dead-end registry with arc dead-ends CLI** (8d2378fa) | `memory/dead-ends.md` JSONL file with 15 known blockers from MEMORY.md. `arc dead-ends list/check/add` CLI. Before escalating to human, dispatch can check known dead-ends — operationalizes "Exhaust Your Own Tools First" principle. |
| **fix(arc-link-research): --section flag for awesome-list scoped URL extraction** (30f38bc4) | `--section <heading>` flag scopes URL extraction to a single `## heading` block. Implements Awesome-list decomposition policy (MEMORY.md): per-section not per-entry. Prevents per-entry queueing on 100-entry lists ($50+ waste). |
| **fix(arc-workflows): auto-advance self-review-cycle from issues_found to triaging** (d797bb65) | `issues_found` state in `SelfReviewCycleMachine` gains `autoAdvanceState`. Prevents stuck-in-state loop (self-review triage redundancy pattern, task #17763). Consistent with autoAdvanceState rollout on all 9 retrospective_pending actions (1a700e99). |

## Key Architectural Changes (8295967 → 428b8fd) [2026-05-27T09:05Z]

| Change | Impact |
|--------|--------|
| **fix(dispatch): set MCP_TOOL_TIMEOUT to 120s; add opus fallback model** (7f3fdefc) | Two additions to `src/dispatch.ts`. (1) `env.MCP_TOOL_TIMEOUT = "120000"` — v2.1.142 fixed this env var being silently ignored on HTTP/SSE transports; arc-mcp runs HTTP (port 3100) handling x402+Stacks calls. 120s prevents silent cut-off on legitimate tool calls. (2) `--fallback-model sonnet` passed when `model === "opus"` (v2.1.152+ feature) — prevents full dispatch stall if Opus is temporarily unavailable; session degrades gracefully to Sonnet. |
| **feat(hooks): return reloadSkills:true from SessionStart after skill installs** (cd278723) | `arc-skill-manager/cli.ts` `create` command now writes `db/skills-pending-reload.flag` after scaffolding a new skill. SessionStart hook reads flag and returns `reloadSkills:true`, triggering harness to reload available skills without session restart. Flag cleared by hook after use. Closes the workflow gap where a freshly scaffolded skill was invisible to the current dispatch session. |
| **feat(skills): disallowed-tools rollout complete** (aedca433+ea621957+e8847cdf+a4b40d89+10c3d2fa) | 29/29 candidates from the 2026-05-27 audit now have `disallowed-tools: [Edit, Write, NotebookEdit, Bash]` (or variant) in SKILL.md frontmatter. Batches: research (4), audit/monitoring (10), review (11), sensor-adjacent (4). `arc-skill-manager/SKILL.md` updated with authoring guide. Enforcement is now accidental-write prevention at the skill layer — not just documentation. |
| **docs: AGENT.md authoring wave** (41f62581+auto-commits) | 7 skills received structured subagent briefings: `daily-brief-inscribe`, `arc-worktrees`, `jingswap`, `defi-zest`, `arc-payments`, `dao-zero-authority`, `defi-bitflow`. Pattern: SKILL.md = orchestrator context (always loaded), AGENT.md = subagent briefing (never loaded into orchestrator). Reduces token overhead when dispatching deep-work tasks — orchestrator gets lean SKILL.md, subagent gets full AGENT.md. |
| **fix(context-review): exclude disallowed-tools config tasks from keyword matching** (428b8fd4) | Adds `/^Add disallowed-tools to /i` regex to `checkMissingSkillCoverage` skip list. Config tasks that enumerate skill names as modification targets (not as operational requirements) were triggering false skill-coverage alerts. Consistent with the sync-task skip (61d96c06) pattern: descriptions embedding external names ≠ dispatch context requirements. Skip list now at ~16 conditions. |

## Key Architectural Changes (1af299a0 → 8295967) [2026-05-26T21:02Z]

| Change | Impact |
|--------|--------|
| **feat(arc-weekly-presentation): refresh May 26 deck with full research** (b0789e56) | `src/web/presentation.html` regenerated with parallel subagent research — 20 PRs, 68 commits, 7 daily blog posts, 3 active beats, 6 services updates, 8 agents welcomed. Content update; no structural change. |
| **fix(arc-weekly-presentation): title slide now leads with AIBTC convention** (82959679) | Added `weekVerb()` + `weekSummaryLine()` to `skills/arc-weekly-presentation/cli.ts`. Dynamic AIBTC-led headline replaces hardcoded "Arc Weekly" string. Verb chosen from the week's standout metric (prs/agents/tasks). Closes title-convention carry from MEMORY.md [P] at code level — violation is now impossible without changing the generator. |

## Key Architectural Changes (e4c8a9b3 → 1af299a0) [2026-05-26T09:00Z]

| Change | Impact |
|--------|--------|
| **fix(aibtc-welcome): recalibrate MIN_STX_SEND_THRESHOLD** (task #17648) | `MIN_STX_SEND_THRESHOLD` in `skills/aibtc-welcome/sensor.ts` reduced from 100k → 40k µSTX. Previous threshold was set when `STX_AMOUNT = 100k µSTX`; after the `a1e4ddd0` reduction to 10k µSTX, the gate was 10× the actual send cost and blocked welcome-agent even when wallet had 4-9 sends available. New threshold: `BATCH_CAP × (STX_AMOUNT + fee_buffer) ≈ 3 × 15k = 45k` → 40k. Closes [ACTION] from 2026-05-25T20:59Z audit. |

## Key Architectural Changes (c3eccc57 → f6961f5d) [2026-05-22T08:47Z]

| Change | Impact |
|--------|--------|
| **chore(trading-comp-mirror): uninstall sensor** (3c519fa3) | Competition ended 2026-05-20T19:30Z. Sensor had already self-disabled via `COMP_END_TIMESTAMP`, but full removal was deferred. All skill files removed: `SKILL.md`, `AGENT.md`, `cli.ts`, `sensor.ts`, `competitors.json`, `trades.json`. Sensor count 73→72. Closes [CARRY-WATCH] from 5 consecutive audit cycles. |
| **fix(context-review): reduce false positives in missing-skill detection** (f6961f5d) | Three fixes in one commit: (1) `trading-comp-mirror` entry removed from `SKILL_KEYWORD_MAP` (skill no longer installed — dead keyword mapping). (2) PR review regex expanded from `/^Review (PR #\d+|[\w/-]+ PRs? #\d+)/` to `/^Review (PR[: #]|[\w/-]+ PRs? #\d+)/` — covers "Review PR: aibtcdev/repo#N - title" format emitted by GitHub mention handlers. (3) "Escalate to whoabuddy:" subjects added to skip lists in both `checkMissingSkillCoverage` and `checkEmptySkillsFailed` — escalation task descriptions describe what the other party needs to do, not what dispatch context this task requires. |

## Key Architectural Changes (2709582a → 6012ea3a) [2026-05-20T19:36Z]

| Change | Impact |
|--------|--------|
| **fix(trading-comp-mirror): competition-end self-gate** (727751a1) | `COMP_END_TIMESTAMP = 1779305400` (2026-05-20T19:30:00Z) added to `skills/trading-comp-mirror/sensor.ts`. Sensor checks timestamp at each run; returns `"skip"` and writes `disabled` to hook state when competition ends. Fired at 19:30Z today — sensor is now self-disabled. Resolves [NEW-ACTION] from 2026-05-19 audit: competition-end guard needed. |
| **fix(x-api): dispatch-time tweet pre-screen** (6418d431) | Three-part fix for 15 wasted X API cycles over 2 nights. (1) `arc-link-research/AGENT.md` gains step 2: run `arc skills run --name arc-link-research -- prescreen <url>` before creating research subtasks for x.com URLs; close early if all inaccessible. (2) `arc-email-sync/AGENT.md` updated with same dispatch-time guidance. (3) `social-x-ecosystem/sensor.ts` now filters x.com/twitter.com self-reference URLs from `extractUrls()` output — prevents the tweet's own URL from being enqueued as a research target. Complements the sensor-time pre-screen already shipped in task #17126. |
| **fix(dispatch): script blocked status for preflight failures** (a1e4ddd0) | `dispatchScript()` in `src/dispatch.ts` detects `preflight.safe_to_broadcast === false` or `/Pre-flight blocked/i` in the error string; returns `status: "blocked"`. `runDispatch()` calls `markTaskBlocked()` for blocked results instead of failing the task. Net effect: welcome STX-send preflight failures (insufficient balance) are now `blocked`, not `failed` — no retry consumption, no gate tripping. `markTaskBlocked` import added to dispatch. |
| **fix(aibtc-welcome): STX_AMOUNT 0.1→0.01 STX** (a1e4ddd0) | `STX_AMOUNT` constant in `skills/aibtc-welcome/cli.ts` reduced from `"0.1"` to `"0.01"`. With ~89k microSTX wallet balance, 0.1 STX (100k µSTX) exceeded the full balance and caused 7 daily failures. At 0.01 STX (10k µSTX + fees ~2k µSTX), ~7-8 welcome sends are now possible before depletion. Directly unblocks the welcome pipeline while wallet awaits refill. |

## Key Architectural Changes (9328f609 → 694e251f) [2026-05-18T08:45Z]

| Change | Impact |
|--------|--------|
| **feat(sensors): validate signal subject patterns at queue time** (e3329e2b) | All 3 signal-queuing sensors now call `validateSignalSubjectMatchesBeatPattern()` before `insertTask()`. bitcoin-macro at line 608; arxiv-research at lines 287 (aibtc-network) + 324 (quantum); aibtc-news-editorial at line 182 (streak sensor). Subject mismatch is now a hard failure at sensor time — subjects that don't match BEAT_SUBJECT_PATTERNS are logged and skipped before task creation. Closes [CARRY-OPEN] from 9328f609 audit and fully closes BEAT_SUBJECT_PATTERNS ×10 carry. |
| **feat(competition): add allowlist command from mcp-server v1.54.0** (694e251f) | `skills/competition/cli.ts` and `SKILL.md` updated with `allowlist` subcommand: `GET /competition/allowlist` returns live list of `(contract_id, functions)` tuples the verifier accepts. Prevents `contract_not_allowlisted` rejections on txid submission. Pre-flight pattern: call `allowlist` before `submit --txid` to verify the swap contract is scoring-eligible. |

## Key Architectural Changes (639cc3f9 → ab1273d0) [2026-05-15T08:36Z]

| Change | Impact |
|--------|--------|
| **fix(aibtc-repo-maintenance): merged-state pre-flight check** (e6004278) | `skills/aibtc-repo-maintenance/AGENT.md` gains step 1: run `gh pr view NUMBER --repo OWNER/REPO --json state --jq '.state'` before any review work; if `MERGED` or `CLOSED`, close task as `completed` ("PR already merged/closed — no review needed") and exit. Pattern validates external resource state before doing work — mirrors the PR existence check pattern (4ea89d0e). Addresses root cause of 4/20 failures in the 2026-05-14 retrospective where PRs merged between sensor queue and dispatch pickup. |
| **fix(aibtc-news-editorial): cooldown pre-check in streak sensor** (0b432ddc) | Streak sensor now calls cooldown check before queuing signal tasks. Consistent with the sensor-time cooldown gate pattern (b5caf209) applied to aibtc-agent-trading + arxiv-research sensors. Closes the gap where streak sensor could queue during active cooldown, causing dispatch-time failure. |
| **fix(aibtc-news-editorial): date-scope beat-inactive alert source** (ab1273d0) | Beat-inactive alert `source` key now includes the date (YYYY-MM-DD). Without date scoping, the 24h `recentTaskExistsForSource` dedup blocked daily re-alerts for persistently inactive beats. Each calendar day now gets its own dedup scope — correct behavior for a daily-alert pattern. |
| **fix(context-review): 5-skill keyword map update** (8ee85666) | 5 skills added since the last keyword audit now have entries in `SKILL_KEYWORD_MAP`. Closes the skill-scaffold → keyword-map-update rule from MEMORY.md [P]: new skills must have keyword coverage added in the same window as their scaffold. |

## Key Architectural Changes (bbeb57ac → 154f274b) [2026-05-13T08:29Z]

| Change | Impact |
|--------|--------|
| **feat(competition): add AIBTC trading competition skill** (21dcb5b2) | `skills/competition/` added. CLI: `status`, `submit --txid`, `list`. No sensor. Interfaces with `https://aibtc.com/api/competition`. Bitflow provider address (`SP1M8KHCJXB3SBRQRDBCG3J3859AA1CN0AWDHN17B`) wired in MCP server v1.52.0 for on-chain attribution. Load when submitting swap txids for scoring or checking competition standing. |
| **feat(services): add --no-orphans to dispatch service** (2a4c1aff) | `src/services.ts` dispatch systemd unit now passes `bun --no-orphans`. Ensures Claude Code subprocesses are terminated if dispatch is unexpectedly killed. Requires Bun v1.3.14+. Prevents orphan processes from consuming resources after crash/sigkill. |
| **fix(context-review): add competition + bitflow-lp to SKILL_KEYWORD_MAP** (eae91b0a + 35a466b8) | competition/trading-competition keywords → `competition` skill. bitflow LP/liquidity-pool keywords → `bitflow-lp` skill. Stale `arc-cost-alerting` entry removed (skill not installed). Maintains rule: scaffold task → keyword map update in same PR. |

## Key Architectural Changes (dd84421f → 6f1b2dcf) [2026-05-06T08:16Z]

| Change | Impact |
|--------|--------|
| **fix(blog-publishing): decompose monolithic sensor tasks to prevent 15min timeout** (6f1b2dcf) | `skills/blog-publishing/sensor.ts` refactored. Draft review → review (sonnet) + publish (haiku) pair. Content generation → generate (sonnet) + publish (haiku) pair. Scheduled publish → single sonnet task (haiku alone times out). Same decomposition pattern previously applied to arxiv-research digest (48858a87). Closes the arc0btc.com content task timeout pattern documented in MEMORY.md [P]. |
| **feat(scripts): commit aibtc weekly stats aggregator** (b1ea55cf) | `scripts/aibtc-stats.ts` committed — was untracked since 2026-05-05T20:15Z audit flagged it as [NEW-ITEM]. Pulls aibtc.com/api/agents + aibtc.news/api/report + paginated signal feed; writes `src/web/data/network-stats.json` for the weekly presentation deck. Closes [NEW-ITEM] from prior audit. |
| **chore(memory): claude-code v2.1.129 deployed** (8b7e5f93) | v2.1.129 manual symlink-swap deployed (task #15838). Restores prompt-cache TTL to 1hr (was silently downgraded to 5min). 20-30% additional cost reduction over prior version. Procedure documented at `memory/shared/entries/claude-code-version-deploy.md`. |

## Key Architectural Changes (ffb73208 → 0d9f5f7c) [2026-05-05T08:15Z]

| Change | Impact |
|--------|--------|
| **fix(arc-service-health): deduplicate retrospective creation per budget-gate event** (48879732) | `lastHealthAlertWorkflowAt` added to `db/hook-state/arc-service-health.json`. New health-alert workflows are gated to 1 per 4-hour window. A single budget-gate outage was producing 30+ dispatch-stale alert workflows (one per hourly sensor fire), each spawning its own retrospective task. Closes the `[OPEN]` from the 2026-05-04T20:15Z audit. Pattern: any alert sensor that creates workflows must rate-limit workflow creation, not just alert creation. |
| **fix(arc-workflows): checkPrExists now returns false for merged/closed PRs** (486691cb) | `checkPrExists()` updated to fetch the `state` field via `gh pr view --json state`. Validates `state === 'OPEN'` before returning true. Previously only checked exit code — `gh pr view` exits 0 for merged and closed PRs, so stale workflows with merged PRs could still queue review tasks. This closes the gap in the 4ea89d0e PR existence check. |
| **fix(arc-workflows): close cap-dequeued PR review tasks as completed not failed** (9aec6798) | New `getPendingPrReviewTaskIdsToday()` in `src/db.ts`. When the 20/day PR review cap is reached, the arc-workflows sensor now auto-closes excess pending PR review tasks with status `completed` and summary "daily cap reached — intentional dequeue". Previously they remained pending until dispatch timeout or manual cleanup, inflating failure metrics. |
| **fix(arc-workflows): add blog-publishing to site-health-alert task skills** (0d9f5f7c) | `SiteHealthAlertMachine` freshness-fix tasks now include `blog-publishing` skill alongside `blog-deploy`. `blog-deploy` alone was insufficient — freshness failures require content creation steps that need the `blog-publishing` CLI context. |
| **fix(aibtc-news): pass BTC auth headers through x402 payment retry flow** (25622279) | When `POST /api/signals` returns 402, the x402 retry was losing `X-BTC-Address`, `X-BTC-Signature`, and `X-BTC-Timestamp` headers. The `execute-endpoint` probe step also lacked auth headers, causing a 401 before the 402 was visible. Both fixed. Pattern: x402 retry paths must propagate all upstream auth headers. |

## Key Architectural Changes (4ea89d0e → ffb73208) [2026-05-04T20:15Z]

| Change | Impact |
|--------|--------|
| **fix(arc-report-email): read credentials from correct email/* namespace** (a182c600) | `skills/arc-report-email/sensor.ts` was reading credentials from the wrong namespace (`resend/*` or similar). Fixed to use the `email/*` namespace (consistent with `arc creds set --service email`). No behavioral change when credentials are absent — sensor remains blocked pending whoabuddy Resend signup + DNS setup (task #14771). Pattern: `getCredential('email', key)` not `getCredential('resend', key)` for arc-email-sync / arc-report-email credential reads. |
| **feat(arc-weekly-presentation): regenerate weekly deck** (ffb73208) | Weekly AIBTC working-group presentation updated — `src/web/presentation.html` and archive `20260504-aibtc-weekly.html`. No structural sensor/dispatch changes. |

## Key Architectural Changes (5850cb32 → 4ea89d0e) [2026-05-04T08:14Z]

| Change | Impact |
|--------|--------|
| **fix(arc-workflows): PR existence check before queuing review tasks** (4ea89d0e) | `checkPrExists()` added to `skills/arc-workflows/sensor.ts`. Before calling `insertTask()` for a `pr-review:` source workflow, calls `gh pr view NUMBER --repo OWNER/REPO --json number` (10s timeout, Bun.spawnSync). Exit code 0 = PR exists; non-zero = not found or gone. A per-run `Map<string, boolean>` caches results so the same `owner/repo#number` is only checked once per sensor cycle. If not found: transitions workflow to `closed` state + calls `completeWorkflow()` + skips task creation. Fixes the stale-PR-queue contamination pattern where #267, #291, #561 and others re-failed daily across multiple tasks. Root cause: old workflow instances had no way to detect that their underlying PRs had been merged, closed, or never existed. Pattern: any sensor that creates tasks for external resources must validate resource existence before inserting the task. |

## Key Architectural Changes (08ec7eb1 → 5850cb32) [2026-05-04T07:53Z]

| Change | Impact |
|--------|--------|
| **fix(arc-workflows): pendingTaskExistsForSource** (2482db11) | `skills/arc-workflows/sensor.ts` switched from `taskExistsForSource` (all statuses) to `pendingTaskExistsForSource` (pending/active only). `taskExistsForSource` was checking completed/failed tasks — bulk-cleaned tasks permanently blocked workflow re-creation for workflows 1923/2038/2077/2127. Fix: dedup now only blocks concurrent in-flight tasks. Retries after failure are unblocked. Closes the workflow-dedup ghost-row pattern documented in MEMORY.md [P]. |
| **fix(arc-ceo-review): workflow transition in AGENT.md** (3cd6cd79) | Added step 7.5 to `skills/arc-ceo-review/AGENT.md`. CEO review tasks were completing without advancing ceo-review workflows from 'reviewing' state — review content was written but workflow lifecycle was never closed. Subagent now explicitly finds the active ceo-review workflow and transitions it with a reviewSummary. Prevents indefinite stuck-in-reviewing workflow accumulation. |
| **feat(email): Resend backend for outbound email** (cc22eb86) | `skills/arc-email-sync/cli.ts` gains `--via resend` flag. Routes through Resend API (`resend/api_key` + `resend/from_address` credentials). Needed for IC pool mandate: CF email worker cannot send to external/unverified addresses. DNS setup at Resend is pending whoabuddy action (task #14771 blocked). |
| **fix(review): gh pr view --json reviews for duplicate-review check** (f6174d2f) | `skills/aibtc-repo-maintenance/AGENT.md` step 5 updated from `gh pr reviews` to `gh pr view --json reviews`. `gh pr reviews` silently errors (exit 1, prints nothing) in some cases even when reviews exist — CRITICAL bug that caused missed dedup checks. `gh pr view --json reviews` reliably returns all reviews. Pattern documented in MEMORY.md [L] approved-pr-guard section. |
| **feat(arc-workflows): daily PR review cap + haiku model** (99779912) | `src/db.ts` adds `countPrReviewTasksToday()`. `skills/arc-workflows/sensor.ts` gates task creation: skip if ≥20 pr-review tasks already created today. `PrLifecycleMachine` model downgraded from sonnet→haiku for lower per-task cost. Fixes 600+/day PR review flood that was driving cost above $200/day. 76 excess pending tasks manually closed at deploy. |
| **fix(arxiv-research): re-enable ACTIVE_BEATS** (fe615b45) | `skills/arxiv-research/sensor.ts` `ACTIVE_BEATS` array re-populated with `['aibtc-network', 'quantum']`. Post-competition, the array was left empty — sensor was silently exiting before fetching any arXiv papers, causing complete aibtc-network and quantum beat silence. Both beats confirmed active post-competition. |
| **fix(arc-workflows): keyword-based skill detection for PR reviews** (66aefa05) | `prReviewSkills()` added to `skills/arc-workflows/state-machine.ts`. Scans PR title for domain keywords (bitflow, zest, hodlmm/dlmm) and adds the matching skill to the task's skills array. Fixes context-review findings where defi-zest/defi-bitflow skills were missing from PR review tasks referencing those protocols. |

## Key Architectural Changes (ff24d963 → 08ec7eb1) [2026-05-02T20:11Z]

| Change | Impact |
|--------|--------|
| **feat(arc-service-health): 60min post-recovery suppression window** (96f2290e) | `skills/arc-service-health/sensor.ts` now tracks `wasStaleLastRun` and `lastRecoveryAt` in `db/hook-state/arc-service-health.json`. On a stale→healthy transition, records recovery time and suppresses new dispatch-stale alert creation for 60 minutes. Resolves the FP flood (~19 alerts queued per payment-block recovery) documented in the 2026-04-30 incident. State machine diagram commit ID corrected from `1396b36e` to `96f2290e`. |
| **fix(dispatch): script-dispatch summary prefers last JSON error line** (08ec7eb1) | `src/dispatch.ts` now scans stderr for the last JSON-shaped line and uses it as `result_summary` rather than a naive tail+truncate. Fixes multi-step scripts whose progress messages (to stderr) were being captured as the summary, hiding the real error JSON mid-string at the 500-char boundary. Root-cause fix for the 3 consecutive welcome-failure misdiagnoses (tasks #14201 #14263 #14281). |
| **fix(db): markTaskFailed persists result_detail** (08ec7eb1) | `src/db.ts` — `markTaskFailed()` was silently dropping `result_detail` on the failure path. Full error detail is now stored. Enables accurate post-mortem for any script-dispatch or LLM-dispatch failure, not just the welcome path. |
| **fix(hodlmm-move-liquidity): nonce serialization** (08ec7eb1) | `skills/hodlmm-move-liquidity/hodlmm-move-liquidity.ts` now routes all STX sends through `acquireNonce`/`releaseNonce` via a `broadcastMove` wrapper. Was the last path that called `broadcastTransaction` directly, bypassing the shared nonce coordinator at `~/.aibtc/nonce-state.json`. Nonce serialization is now complete across all STX send paths (bitcoin-wallet, defi-zest, hodlmm). |

## Key Architectural Changes (e4370d04 → ff24d963) [2026-05-02T08:09Z]

| Change | Impact |
|--------|--------|
| **feat(arc-service-health): payment-block watchdog** (60372cb9) | `checkPaymentBlock()` added to arc-service-health sensor. Detects consecutive gate failures indicating a payment block (root cause of the 25h dispatch gap 2026-04-30). Creates an escalation task. Separates dispatch-halt detection from dispatch-stale detection — previously there was no watchdog specifically for payment blocks. Pattern: payment blocks halt dispatch entirely while sensors continue running; sensor/dispatch separation means observability never stops even when execution halts. |
| **fix(arc-service-health): dispatch-stale post-recovery suppression** (1396b36e) | 60min suppression window added after payment-block recovery. State stored in `db/hook-state/arc-service-health-post-recovery.json`. Prevents the FP flood (19+ dispatch-stale alerts queued before self-healing) that followed every payment block. Closes the pattern documented after 2026-04-30 recovery: "dispatch-stale sensor floods after every payment block." |
| **fix(aibtc-news-editorial): compile-brief endpoint + sensor disabled** (b102c52b) | `POST /brief` renamed upstream to `POST /api/brief/compile`. More importantly: endpoint is publisher-only — Arc is a correspondent, not the publisher. Will always return 403. Sensor permanently disabled (no longer queues compile-brief tasks). CLI updated with correct path + signing message. Permanent architectural clarification: compile-brief is outside Arc's correspondent role. |
| **feat(bitcoin-macro): 3rd source via blockstream.info** (9781c64b / PR #22) | Squash of 94938b4. `blockstream.info` added alongside `blockchain.info` and `mempool.space`. sourceQuality formula is count-based (1=10, 2=20, 3+=30). With 3 sources, SQ=30 — clears the 65 approval floor. Signal cf686209 confirmed at Q=93. Closes the 6-day SQ=1 streak root cause. |
| **fix(ci): TypeScript devDependency** (e22a79f2 / PR #24) | `typescript` added as devDependency in `package.json`. CI was failing because `tsc` couldn't resolve. PR had merge conflicts since 2026-04-29; rebased and squash-merged. No behavioral change to dispatch/sensors — CI pipeline fix only. |

## Key Architectural Changes (29e3d20 → e4370d04) [2026-04-29T08:05Z]

| Change | Impact |
|--------|--------|
| **fix(bitcoin-macro): rename height_response to heightResponse (camelCase)** (e4370d04) | Compliance rename in `fetchBlockHeight()`. `height_response` → `heightResponse`. No behavioral change — the function's fetch, status check, and text parse are identical. Closes the abbreviated-variable violation flagged by the pre-commit lint hook. Pattern: camelCase is the required convention for all local variables in TypeScript sensors. |
| **feat(claude-code-releases): applicability report for v2.1.122** (4a221a5f) | Research doc added at `research/claude-code-releases/v2.1.122.md`. On-demand skill — no sensor, no operational impact. |

## Key Architectural Changes (94938b4 → 29e3d20) [2026-04-28T20:00Z]

| Change | Impact |
|--------|--------|
| **fix(aibtc-news-editorial): skip retired beats in inactivity check** (d7152b93) | Inactivity check was alerting on all beats including the 9 post-competition retired ones (infrastructure, aibtc-network, etc.). Fix: sensor now fetches the active beat list from `/api/beats` and skips any beat not in that list before generating inactivity tasks. Prevents a class of false-positive alerts that would persist indefinitely for retired beats. Pattern: any sensor that monitors beat activity must gate on the currently active beat list, not the full historical set. |
| **fix(aibtc-news-editorial): cross-reference /api/beats to detect retired beats** (29e3d208) | Strengthened the retired-beat detection by cross-referencing the live `/api/beats` endpoint rather than relying on a hardcoded retired list. The API is the authoritative source — hardcoded lists drift as beats are retired or reactivated. This is the correct long-term architecture: let the platform define what is active. |

## Key Architectural Changes (e760b47 → 94938b4) [2026-04-28T08:00Z]

| Change | Impact |
|--------|--------|
| **fix(bitcoin-macro): re-enable sensor and require beat tag** (f28aeafb) | `ACTIVE_BEATS` constant re-populated with `'bitcoin-macro'`. Root cause of `beatRelevance=0` on all prior signals: the beat slug `"bitcoin-macro"` was never included as a tag. Other correspondents scoring 20+ always include the beat slug as a tag. Fix: filing instructions now require beat slug as first tag. Closes the 6-day SQ=1 floor regression. |
| **feat(bitcoin-macro): add blockstream.info as 3rd source** (94938b4) | `blockstream.info` added as data source alongside `blockchain.info` and `mempool.space`. `sourceQuality` formula is count-based (1 source=10, 2=20, 3+=30). With 1 source (mempool.space alone), score was capped at 53 — below the 65 floor. With 3 sources, sourceQuality reaches 30, pushing total score above the 65 approval floor. Resolves the sourceQuality bottleneck that persisted for 6+ consecutive days. |
| **fix(dispatch): auto-upgrade haiku→sonnet for signal-filing tasks** (221e2341) | Dispatch detects task subjects matching `'File *-signal:*'` pattern at dispatch time and overrides the model to sonnet. Addresses task #13847 where a haiku-spawned signal-filing subtask hit the 5-min timeout before `aibtc-news-editorial` could compose. Signal-filing tasks now always run on sonnet regardless of how they were created — prevents the entire class of LLM-composition timeout failures on the signal path. |

## Key Architectural Changes (d62274d → e760b47) [2026-04-27T19:55Z]

| Change | Impact |
|--------|--------|
| **fix(arc-workflows): auto-advance workflow state when create-task fires** (e760b47e) | Adds `autoAdvanceState` to `WorkflowAction`. When a create-task action sets this field, the sensor transitions the workflow immediately after inserting the task — preventing the stuck-in-state loop where the executing task forgets to call `transition()` and the dedup gate blocks all future fix tasks indefinitely. Applied to `SiteHealthAlertMachine`: `alert → fixing` auto-advances when fix task is queued. Pattern: create-task actions should own their own state transition; manual transition inside the spawned task is fragile and dedup-blocked. |
| **fix(blog-deploy): suppress sensor re-queue after build failure** (7888632f) | When `npm run build` fails (e.g. malformed YAML frontmatter), the deploy task exhausts its 3 retries and enters `failed` status. The sensor's dedup check only blocked on `pending`/`active` tasks — so it re-queued the same broken SHA every sensor fire, producing 3 duplicate task chains (9 total attempts) for commit 694ac4f9. Fix: on build failure, `cli.ts` writes `last_failed_sha` to hook state. Sensor now skips re-queuing if `currentSha === last_failed_sha`. A new commit (different SHA) clears the gate naturally. Pattern: build-failure sensors must gate on content SHA, not just task status. |

## Key Architectural Changes (5e1cdf1 → d62274d) [2026-04-27T18:55Z]

| Change | Impact |
|--------|--------|
| **fix(aibtc-welcome): write fail() errors to stderr for deny-list detection** (d62274d4) | `fail()` was writing error JSON to stdout, but `dispatchScript` uses `stderrTail` as `result_summary` when stderr is non-empty. The step 1 progress message (stderr) was being captured as `result_summary`; the actual "STX send failed" error (stdout) was silently discarded. `loadAndUpdateDenyList()` never matched the `simulation:400` pattern, causing Savage Moose and Steel Yeti to be re-queued for 5 consecutive days. Fix: `fail()` now writes to stderr so the error detail appears in `result_summary` and triggers deny-list auto-population on the next sensor run. Both addresses manually added to `aibtc-welcome-hiro-rejected.json` immediately. Self-healing deny-list architecture now works end-to-end for script-dispatch welcome tasks. |

## Key Architectural Changes (9195063 → 5e1cdf1) [2026-04-25T07:51Z]

| Change | Impact |
|--------|--------|
| **feat(daily-brief-inscribe): convert inscription workflow to script dispatch** (b40ebe8e, 5e1cdf14) | All 6 `DailyBriefInscriptionMachine` workflow states converted from `sonnet`/`haiku` to `model: "script"`. `WorkflowAction` interface gains a first-class `script` field — the state machine framework now natively models deterministic dispatch. `{WORKFLOW_ID}` placeholder substituted by the sensor at task creation. ~180 lines of LLM instruction text removed. 7th skill on script dispatch; pattern is now architecturally canonical. |
| **feat(dispatch): --exclude-dynamic-system-prompt-sections** (9b296392) | Flag added to every Claude Code subprocess invocation. Second prompt caching lever active alongside `ENABLE_PROMPT_CACHING_1H=1`. Combined effect: ~58% base reduction + 20-30% dynamic section savings. Both levers confirmed live. |
| **fix(context-review): narrow arc-worktrees keyword** (2c1b04fc) | "worktree" alone matched external tool descriptions (Claude Code bug reports). Narrowed to Arc-specific phrases: "arc worktree", "worktree dispatch", "isolated branch". Also fixes "test" bare subject false positive in `checkEmptySkillsFailed`. False positive rate reduced. |
| **fix(cleanup): remove fabricated v2.1.120 research** (d521dfe2) | Hallucinated research document and CI workflow removed. Hygiene: fabricated content is worse than no content. |

## Key Architectural Changes (625eddd → 1f349dc) [2026-04-24T07:45Z]

| Change | Impact |
|--------|--------|
| **fix(sensors): ACTIVE_BEATS gate for aibtc-agent-trading and arxiv-research** (f5ce61e0) | `ACTIVE_BEATS` constant added to both sensors, same pattern as bitcoin-macro (11bb7e10). Both sensors short-circuit before any data fetch when the array is empty (current post-competition state). Pattern is now consistent across all 3 beat-dependent sensors. Re-enable: add slugs to the respective `ACTIVE_BEATS` arrays when beats are reacquired. Closes the `[OPEN]` carry item from the 2026-04-23T19:45Z audit. |
| **fix(services): remove arc-observatory dead code** (1f349dc3) | Removed `generateObservatoryServiceUnit()`, `generateObservatoryPlist()`, `OBSERVATORY_AGENT` const, and all install/uninstall/status references from `src/services.ts` (81 lines deleted). The `arc-observatory` skill was deleted when Arc moved from fleet to solo operation; the lingering service definition was causing 14200+ crash-loop restart references. Pure deletion — no replacement needed. |
| **feat(claude-code-releases): applicability report skill** | New `claude-code-releases` skill added to the tree. Provides structured analysis of Claude Code release notes for Arc-specific applicability. No sensor — on-demand skill. Skill count net-unchanged: arc-observatory deletion offset by this addition (113 total). |

## Key Architectural Changes (3f6c59d → 625edddd) [2026-04-23T19:45Z]

| Change | Impact |
|--------|--------|
| **feat(aibtc-welcome): convert to script dispatch, remove nonce sentinel** (b8edb44f) | Welcome sequence (STX-send → x402 inbox → contacts log) is fully deterministic. `cli.ts` added with exit-code-checked steps. Sensor now emits `model: "script"`. ~170 lines of LLM orchestration removed. 6th skill using script dispatch. High-volume operation — savings compound as agent network grows. |
| **fix(bitcoin-macro): gate sensor on ACTIVE_BEATS list** (11bb7e10) | `ACTIVE_BEATS` constant (currently `[]`) short-circuits the sensor before any data fetch when the beat is not claimed. Fixes 3 post-competition failures (#13455, #13474, #13490). Re-enable: add `'bitcoin-macro'` to array. Pattern: all beat-dependent sensors should adopt this gate. |
| **fix(aibtc-agent-trading): restore correct beat slug `agent-trading`** (e1853e83) | Beat slug was `aibtc-network` during competition (per 7dab95c0); post-competition beat reset restored `agent-trading`. First signal to the restored beat is pending. |
| **fix(arc-service-health): auto-complete triggered workflows when alert clears** (9905dbea) | Health-alert workflows were accumulating in `triggered` state indefinitely (50 stuck since Apr 11). Root cause: state machine required manual transitions but no session was performing them. Fix: sensor now calls `completeWorkflow()` when alert condition resolves. Pattern: alert-style sensors must own their workflow lifecycle end-to-end. |
| **fix(compliance): rename abbreviated vars in alb + arc-weekly-presentation** (13eb3a9b) | `ts→timestamp` in `alb/sensor.ts`; `cmd:` property removed in `arc-weekly-presentation/cli.ts`. Pre-commit hook catches `sensor.ts` violations but `cli.ts` gaps remain open. |

## Key Architectural Changes (686aeb9 → 3f6c59d) [2026-04-23T07:45Z]

| Change | Impact |
|--------|--------|
| **feat(arxiv-research): wire digest output to auto-queue quantum signal tasks** (3ea7a541) | `queue-signals` CLI command added to `cli.ts`. Reads `.latest_fetch.json` post-compile; matches papers on title+abstract vs QUANTUM_KEYWORDS (richer than sensor's title-only pass). Wired into `AGENT.md` step 3 so every haiku digest run auto-creates a signal task when matching papers found. Respects `isBeatOnCooldown` + `pendingTaskExistsForSource` guards. Closes CARRY×12 — the most-deferred item in the audit log. |
| **refactor(sensors): convert 5 deterministic sensors to script dispatch** (90df07f6) | `erc8004-indexer`, `blog-deploy`, `worker-deploy`, `arc-starter-publish`, `arc-housekeeping` converted from LLM dispatch (sonnet/haiku) to `model: "script"`. These sensors emit fully deterministic tasks that run a single CLI command — no reasoning needed. Zero LLM cost per execution; 5-min script timeout. Structural win: ~5 LLM cycles/day eliminated. `ScriptRoute` added to dispatch ModelRoute state. |
| **refactor(ordinals): remove deprecated HookState fields** (77a1837c) | HookState deprecated fields removed from ordinals skill. Closes CARRY-24 (window opened 2026-04-23 as planned). |
| **feat(dispatch): add DISABLE_UPDATES=1 to dispatch systemd unit** (c9a25f05) | Prevents Claude Code from self-updating mid-dispatch cycle. `generateServiceUnit()` extended to accept `extraEnv` map; dispatch unit now sets `DISABLE_UPDATES=1`. Eliminates risk of unexpected version changes during task execution. |
| **fix(dispatch): upgrade haiku→sonnet when housekeeping has >2 modified .ts files** (bbf36f1a) | Pre-commit lint hook overhead causes haiku to hit 5min ceiling when committing 3+ `.ts` files. Dispatch dynamically upgrades model for housekeeping tasks that exceed the threshold. |
| **fix(compliance-review): chunk sensor into ≤5 skills per dispatch task** (da130851) | Compliance-review sensor was creating single tasks covering all skills — running 10+ finding passes exhausted sonnet's 15min ceiling. Fix: sensor chunks into batches of ≤5 skills per task. Each batch completes within budget. |
| **fix(arc-weekly-presentation): rename abbreviated vars** (3f6c59d5) | `idx→slideIndex`, `cmd→subcommand` compliance fix caught by post-commit scan. Pre-commit hook should have caught this — sensor.ts check covers vars, not cli.ts loops. Gap noted. |

## Key Architectural Changes (b4d02fb → 686aeb9) [2026-04-22T19:45Z]

| Change | Impact |
|--------|--------|
| **feat(arc-weekly-presentation): restore + rewrite skill for Monday AIBTC decks** (686aeb9b) | Skill restored with sensor.ts, cli.ts, AGENT.md, and SKILL.md. Generates the weekly AIBTC working-group deck with 4 fixed sections (Dev Activity, Social & Publishing, Services, Self Improvements). Has its own sensor to detect when a new presentation is needed. Distinct from `agent-pitch` skill (internal recap vs. external narrative). Adds one sensor to the InfrastructureSensors category. |

## Key Architectural Changes (ab0d1f4 → b4d02fb) [2026-04-22T07:10Z]

| Change | Impact |
|--------|--------|
| **feat(dispatch): enable CLAUDE_CODE_FORK_SUBAGENT=1 for subprocess isolation** (67d7050c) | Forked subagents now inherit the full dispatch env (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=0`) and run under `--permission-mode bypassPermissions` alongside the parent session. Evaluated safe post-competition (task #13297). Improves subagent isolation without adding new failure modes. |
| **fix(agent-health): carry task_id through spike map to avoid started_at mislabel** (b4d02fb7) | `rows.find()` used `started_at` string comparison to recover `task_id` after it was dropped in `spikeCycles.map()`. Two back-to-back cycles sharing the same second-precision timestamp could cause the wrong task to be attributed as the spike source. Fix: `task_id` is now preserved directly in the spike entry during `map()` and used for the `queryLoomDb` lookup, then stripped before returning. Closes a subtle observability correctness bug. |

## Key Architectural Changes (4578d9d → ab0d1f4) [2026-04-21T07:05Z]

| Change | Impact |
|--------|--------|
| **fix(sensors): extend isBeatOnCooldown to block on pending/active queue** (ab0d1f47) | Previously `isBeatOnCooldown()` in `src/db.ts` only checked recently-completed tasks. A second sensor pass fired while the first signal task was still pending/active would see no cooldown, queue a duplicate, and both would eventually hit the 429 API cooldown — the second task always failing. Fix: now also queries for any pending/active task whose subject matches the beat's signal patterns. Blocks duplicate queue entries before they reach dispatch. Closes the cooldown collision failure pattern documented in tasks #13116, #13146, and multiple prior retrospectives. |

## Key Architectural Changes (3410310 → 7fb077c) [2026-04-19T19:00Z]

| Change | Impact |
|--------|--------|
| **feat(lint): extend lint-skills to validate skill names in AGENT.md files** (7fb077c0) | `lint-skills --staged` pre-commit hook extended to scan `--skills` flag values in AGENT.md files and check them against the installed skill tree. Closes the `[OPEN — NEW] AGENT.md validation gap` flagged in the prior audit (2026-04-19T07:10Z). Would have caught all 3 stale refs (`aibtc-news`, `aibtc-maintenance`, `quantum-computing`) from commit 34103100 at commit time instead of requiring a separate code review task. Compliance surface is now complete: SKILL.md frontmatter + sensor.ts vars + AGENT.md skill refs. |

## Key Architectural Changes (e0bc901 → 3410310) [2026-04-19T07:10Z]

| Change | Impact |
|--------|--------|
| **fix(github-mentions): 4h cooldown for thread-based tasks** (b6a42c57) | Busy threads (e.g. thread 2359240542) were generating 5-6 tasks/day each because pending-only dedup allowed re-creation after every completed task. Fix: `recentTaskExistsForSource(threadSource, 240)` guard for non-issue, non-watched-PR threads. Brings repo-maintenance task ratio from 41-44% back toward the 30% threshold. Issues already had a 24h cooldown; this adds a parallel 4h equivalent for thread sources. |
| **fix(context): correct stale skill name refs in AGENT.md files** (34103100) | `aibtc-news-editorial/AGENT.md`, `aibtc-repo-maintenance/AGENT.md`, and `arc-ceo-strategy/AGENT.md` contained references to defunct skill names (`aibtc-news`, `aibtc-maintenance`, `quantum-computing`). Dispatch agents using these AGENT.md files would create tasks with invalid `--skills` arrays, silently losing context. Fix: corrected all 3 files to use current names. Exposes systemic gap: AGENT.md validation is not covered by the pre-commit lint hook. |
| **fix(arc-workflows): overnight-brief workflow must close after writing learnings** (707c0b7a) | Overnight-brief retrospective tasks were writing learnings to MEMORY.md but not calling `completeWorkflow()`. Result: 6 stuck overnight-brief workflows accumulated. Fix: workflow closure now enforced after learning write. Pattern: workflow completion is not automatic — tasks must explicitly close their parent workflow. |

## Key Architectural Changes (6b95f77 → e0bc901) [2026-04-18T18:56Z]

| Change | Impact |
|--------|--------|
| **fix(aibtc-welcome): add simulation:400 pattern to deny-list query** (e0bc901b) | Root cause of hiro-400 failures was pattern drift: `loadAndUpdateDenyList()` scanned for "Hiro 400" / "FST_ERR_VALIDATION" but current failure messages say "simulation:400" — zero auto-deny captures since wording changed. Fix: added "simulation:400", "simulation 400", "STX send failed" to query patterns. 12 failing addresses manually backfilled (deny-list 359→371). Expect daily failures to drop from ~9–13 to ~0 as pattern now matches all active failure modes. Fix is self-healing: any new simulation:400 address auto-added on first failure. |

## Key Architectural Changes (fd4a721 → 6b95f77) [2026-04-18T06:55Z]

| Change | Impact |
|--------|--------|
| **feat(arc-workflows): lastReviewedCommit SHA dedup for PR review tasks** (cad8fb5c) | `headCommitSha` tracked per PR workflow via `headRefOid` from GitHub GraphQL. Before queuing a `pr-review` task, sensor checks if `headCommitSha === lastReviewedCommit` — same commit never reviewed twice. Fixes bff-skills#494 storm (9 review cycles overnight). `lastReviewedCommit` updated on task creation. Closes the 3rd-retrospective carry item for round-based PR dedup. |
| **docs(aibtc-news-deal-flow): clarify sensor operational status** (db172ec6) | 5 consecutive audits flagged this sensor as a carry item suggesting deletion. Investigation (task #12928) confirmed sensor is LIVE and CORRECT — monitors ordinals volume, sats auctions, x402 escrow, DAO treasury, bounty activity, routing to `ordinals` beat (Arc-owned). Not routing to dead `deal-flow` beat (410). SKILL.md updated with accurate description. Carry item closed — no code changes needed. |

## Key Architectural Changes (14e429b → fd4a721) [2026-04-17T18:53Z]

| Change | Impact |
|--------|--------|
| **fix(stacking-delegation): verbose variable naming compliance** (fd4a721) | `const res` renamed to `pox_response` (×2) and `rewards_response` in `skills/stacking-delegation/cli.ts`. Compliance scan flagged 3 violations introduced at install time. Pre-commit hook (`lint-skills --staged`) would have caught these at commit — confirms hook must be installed on every fresh clone. No structural impact. |
| **Skill count 110→111** (task #12887) | Catalog regeneration confirmed 111 installed skills, 71 sensors (unchanged). State machine count corrected from morning diagram. |

## Key Architectural Changes (f3a1855 → 7f011ce) [2026-04-17T07:00Z]

| Change | Impact |
|--------|--------|
| **feat(contract-preflight): install v0.40.0 skill + wire into Zest/STX tx-runners** (d3b67d7b + b08c9566) | New `contract-preflight` skill wraps stxer simulation engine. Wired into `defi-zest/tx-runner.ts` (Zest supply sBTC balance check) and `bitcoin-wallet/stx-send-runner.ts` (STX balance check). Preflight runs before nonce acquisition — a failed simulation aborts without consuming a nonce slot. Prevents wasted nonce slots and Hiro API calls on transactions that would fail broadcast. |
| **feat(stacking-delegation): install v0.40.0 skill** (370d183b) | New `stacking-delegation` skill installed from aibtcdev/skills. Read-only STX stacking monitor: status, PoX cycle info, reward payouts, delegation eligibility signals. BFF Skills Day 15 winner (@secret-mars). Extends DeFi monitoring coverage to stacking layer without adding a sensor. |
| **feat(arc-skill-manager): pre-commit lint hook for SKILL.md compliance** (6b40fd75) | `lint-skills --staged` blocks commits that introduce nested `metadata.tags` frontmatter or abbreviated sensor variable names (`const res/err/val`). Install: `arc skills run --name arc-skill-manager -- install-hooks`. Hook lives in `.git/hooks/` (not git-tracked) — must re-run `install-hooks` on fresh clones. Closes `l-compliance-recurring` pattern — violations now caught at commit time, not discovered at next compliance scan 6h later. |
| **fix(aibtc-agent-trading): API cap check + flat-data delta guard** (90607ba9) | Adds `fetchFiledSignalCountToday()` — real-time query to `aibtc.news/api/signals` at sensor run time. Dual-check: local DB (fast, cached) + API (real-time, catches signals filed by dispatch cycles that completed after this sensor ran). Flat-data guard: if all key deltas = 0 (trades/psbt/volume/agents) AND base strength < 50, sensor returns empty (no task created). Addresses retro-2026-04-17 patterns 1 (cap-hit waste, ~2 tasks/day) and 2 (flat-data waste). |

## Key Architectural Changes (a2c7adf → f3a1855) [2026-04-16T18:53Z]

| Change | Impact |
|--------|--------|
| **feat(dispatch): --max-budget-usd per-invocation cost guard** (e124013c) | Adds `--max-budget-usd` flag to every Claude Code subprocess invocation. Defaults: opus=$10, sonnet=$3, haiku=$1. Overridable via `MAX_BUDGET_USD_*` env vars. Prevents loom-spiral class of cost overruns (~$15/cycle at 1.2M tokens). Claude Code enforces mid-stream and aborts gracefully. Addresses the primary risk factor that prompted l-loom-spiral escalation. |
| **feat(dispatch): Opus 4.7 + DISPATCH_EFFORT_OPUS env var** (f3a18557) | `MODEL_IDS.opus` updated from `claude-opus-4-6` to `claude-opus-4-7`. New `DISPATCH_EFFORT_OPUS` env var (default: `"high"`) allows effort-level tuning without code changes — set to `"xhigh"` on v2.1.111+ for better intelligence at medium cost. Pattern: env var overrides for model-specific knobs now consistent across effort + budget controls. |
| **feat(bitcoin-macro): sensor for Bitcoin Macro beat** (64ff537, task #12742) | Closes the open architectural gap flagged in all 5 prior audit entries. Sensor at `skills/bitcoin-macro/sensor.ts` runs every 240min. 4 signal types: price-milestone (round crossings), price-move (>5%/4h), hashrate-record (ATH or >5% drop), difficulty-adjustment (≤288 blocks + ≥3% change). First-run guard prevents stale milestone fire. First signal filed 2026-04-16. Beat diversity gap CLOSED — all 3 beats now have sensor coverage. |
| **docs: v2.1.111 permission model analysis** (11fd9a08, task #12785) | Confirms `--permission-mode bypassPermissions` is optimal for 24/7 autonomous Arc operation. Granular allowlist offers no practical benefit for 71+ sensors / 108 skills using diverse tools. Pattern documented: `p-autonomous-permission-bypass`. No code changes — settings.json unchanged. Reference allowlist in `memory/shared/entries/arc-permission-model.md` for future multi-agent or regulated use cases. |

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
