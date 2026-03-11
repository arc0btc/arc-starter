# Arc State Machine

*Generated: 2026-03-11T18:44:00.000Z*

```mermaid
stateDiagram-v2
    [*] --> SystemdTimer: every 1 min

    state SystemdTimer {
        [*] --> SensorsService
        [*] --> DispatchService
        note right of SystemdTimer
            Persistent services (always on):
            arc-web.service — dashboard port 3000
              • POST /api/tasks — cross-agent task creation (authenticated)
              • GET /identity — per-agent identity page
            arc-mcp.service — MCP server port 3100
            arc-observatory.service — observatory UI
              • cross-agent task board + goal tracking (2026-03-09)
            fleet-web (port 4000, Arc host only) — aggregate fleet dashboard
        end note
    }

    state SensorsService {
        [*] --> ShutdownGate: db/shutdown-state.json
        ShutdownGate --> [*]: SHUTDOWN — skip all sensors (reason + since logged)
        ShutdownGate --> FilterSensors: not shutdown
        FilterSensors --> RunAllSensors: arc0 (Arc host) — all 72 sensors
        FilterSensors --> RunFilteredSensors: worker agent — allowlist only (13 sensors)
        note right of FilterSensors
            Worker allowlist (13): aibtc-heartbeat, aibtc-inbox-sync,
              arc-service-health, arc-alive-check, arc-housekeeping,
              fleet-self-sync, arc-scheduler, contacts,
              identity-guard, reputation-tracker,
              erc8004-reputation-monitor, github-interceptor
            (Everything else is Arc-only)
            ---
            Arc 3-tier filter (still applies for context):
            GITHUB_SENSORS (10): github-*, aibtc-repo-maintenance,
              arc-workflows, arc-starter-publish, arc0btc-pr-review
            ARC_ONLY_SENSORS (17): fleet orchestration + Arc-level oversight
              fleet-health/comms/dashboard/escalation/log-pull/memory/sync/router/rebalance
              arc-cost-alerting, arc-ceo-review, arc-catalog, arc-introspection,
              arc-reporting, arc-report-email, arc0btc-site-health, site-consistency
            CREDENTIAL_SENSORS (20): X OAuth, Bitcoin wallet, AIBTC APIs,
              DeFi (wallet required), Cloudflare deploy credentials
        end note

        RunAllSensors --> aibtc_devSensor: aibtc-dev-ops
        RunAllSensors --> aibtc_heartbeatSensor: aibtc-heartbeat
        RunAllSensors --> aibtc_inboxSensor: aibtc-inbox-sync
        RunAllSensors --> aibtc_maintenanceSensor: aibtc-repo-maintenance
        RunAllSensors --> aibtc_newsSensor: aibtc-news-editorial
        RunAllSensors --> agentEngagementSensor: social-agent-engagement
        RunAllSensors --> architectSensor: arc-architecture-review
        RunAllSensors --> blogDeploySensor: blog-deploy
        RunAllSensors --> blogPublishingSensor: blog-publishing
        RunAllSensors --> ceoReviewSensor: arc-ceo-review
        RunAllSensors --> ciStatusSensor: github-ci-status
        RunAllSensors --> complianceReviewSensor: compliance-review
        RunAllSensors --> contextReviewSensor: context-review
        RunAllSensors --> costAlertingSensor: arc-cost-alerting
        RunAllSensors --> daoZeroSensor: dao-zero-authority
        RunAllSensors --> defiBitflowSensor: defi-bitflow
        RunAllSensors --> emailSensor: arc-email-sync
        RunAllSensors --> failureTriageSensor: arc-failure-triage
        RunAllSensors --> fleetHealthSensor: fleet-health
        RunAllSensors --> githubMentionsSensor: github-mentions
        RunAllSensors --> healthSensor: arc-service-health
        RunAllSensors --> heartbeatSensor: arc-alive-check
        RunAllSensors --> housekeepingSensor: arc-housekeeping
        RunAllSensors --> introspectionSensor: arc-introspection
        RunAllSensors --> manageSkillsSensor: arc-skill-manager
        RunAllSensors --> quorumclawSensor: bitcoin-quorumclaw
        RunAllSensors --> releaseWatcherSensor: github-release-watcher
        RunAllSensors --> reportEmailSensor: arc-report-email
        RunAllSensors --> reportingSensor: arc-reporting
        RunAllSensors --> schedulerSensor: arc-scheduler
        RunAllSensors --> securityAlertsSensor: github-security-alerts
        RunAllSensors --> selfAuditSensor: arc-self-audit
        RunAllSensors --> siteConsistencySensor: site-consistency
        RunAllSensors --> stacksMarketSensor: defi-stacks-market
        RunAllSensors --> stackspotSensor: stacks-stackspot
        RunAllSensors --> workerLogsSensor: github-worker-logs
        RunAllSensors --> workflowReviewSensor: arc-workflow-review
        RunAllSensors --> workflowsSensor: arc-workflows
        RunAllSensors --> arxivSensor: arxiv-research
        RunAllSensors --> arcCatalogSensor: arc-catalog
        RunAllSensors --> arc0btcSiteHealthSensor: arc0btc-site-health
        RunAllSensors --> githubIssueMonitorSensor: github-issue-monitor
        RunAllSensors --> contactsSensor: contacts
        RunAllSensors --> socialXEcosystemSensor: social-x-ecosystem
        RunAllSensors --> socialXMentionsSensor: social-x-posting (mentions)
        RunAllSensors --> workerLogsMonitorSensor: worker-logs-monitor
        RunAllSensors --> arcStarterPublishSensor: arc-starter-publish
        RunAllSensors --> arcReputationSensor: arc-reputation
        RunAllSensors --> arcPrReviewAttestation: arc0btc-pr-review (attestation)
        RunAllSensors --> stacksPaymentsSensor: stacks-payments
        RunAllSensors --> arcBlockedReviewSensor: arc-blocked-review
        RunAllSensors --> workerDeploySensor: worker-deploy
        RunAllSensors --> defiZestSensor: defi-zest
        RunAllSensors --> erc8004ReputationSensor: erc8004-reputation
        RunAllSensors --> fleetCommsSensor: fleet-comms
        RunAllSensors --> fleetDashboardSensor: fleet-dashboard
        RunAllSensors --> fleetEscalationSensor: fleet-escalation
        RunAllSensors --> fleetLogPullSensor: fleet-log-pull
        RunAllSensors --> fleetMemorySensor: fleet-memory
        RunAllSensors --> fleetRebalanceSensor: fleet-rebalance
        RunAllSensors --> fleetRouterSensor: fleet-router
        RunAllSensors --> fleetSelfSyncSensor: fleet-self-sync
        RunAllSensors --> fleetSyncSensor: fleet-sync
        RunAllSensors --> autoQueueSensor: auto-queue
        RunAllSensors --> arcOpsReviewSensor: arc-ops-review
        RunAllSensors --> arcDispatchEvalSensor: arc-dispatch-eval
        RunAllSensors --> agentHubSensor: agent-hub
        RunAllSensors --> bitflowSensor: bitflow
        RunAllSensors --> zestV2Sensor: zest-v2
        RunAllSensors --> arcUmbrelSensor: arc-umbrel
        RunAllSensors --> aibtcWelcomeSensor: aibtc-welcome

        note right of RunAllSensors
            73 sensors total (+1 since 2026-03-11T07:00Z)
            NEW: aibtc-welcome (60min) — detect+welcome new AIBTC agents via x402 (100 sats)
              x402 sentinel: db/hook-state/x402-nonce-conflict.json gates all sends
              Interaction-history dedup: skips already-welcomed agents
            Fleet sensors filter suspended agents since 2026-03-11
        end note

        state "Generic Sensor Pattern" as genericSensor {
            [*] --> sensorGate: claimSensorRun(name, interval)
            sensorGate --> sensorSkip: interval not elapsed
            sensorGate --> sensorDedup: interval elapsed
            sensorDedup --> sensorSkip: pending task exists
            sensorDedup --> sensorCreateTask: no dupe
            sensorCreateTask --> [*]: insertTask()
            sensorSkip --> [*]: return skip
        }

        state architectSensor {
            [*] --> architectGate: claimSensorRun(architect)
            architectGate --> architectSkip: interval not elapsed
            architectGate --> architectShaCheck: interval elapsed
            architectShaCheck --> architectSkip: SHA unchanged (src/ + skills/ excl. skills/arc-architecture-review/)
            architectShaCheck --> architectDedup: SHA changed or diagram stale or active reports
            architectDedup --> architectSkip: pending task exists
            architectDedup --> architectCreateTask: no dupe
            architectCreateTask --> [*]: insertTask() P7 sonnet
            architectSkip --> [*]: return skip
        }

        state fleetHealthSensor {
            [*] --> fleetHealthGate: claimSensorRun(fleet-health, 15min)
            fleetHealthGate --> fleetHealthSkip: interval not elapsed
            fleetHealthGate --> fleetHealthMaintCheck: interval elapsed
            fleetHealthMaintCheck --> fleetHealthSkip: maintenance mode active (db/fleet-maintenance.json)
            fleetHealthMaintCheck --> fleetHealthSSH: no maintenance mode
            fleetHealthSSH --> fleetHealthWrite: SSH all VMs (spark/iris/loom/forge)
            fleetHealthWrite --> fleetHealthSkip: all VMs healthy — write fleet-status.json
            fleetHealthWrite --> fleetHealthCapCheck: issues detected
            fleetHealthCapCheck --> fleetHealthSkip: alert cap reached (MAX 3/agent/day)
            fleetHealthCapCheck --> fleetHealthAlert: under cap
            fleetHealthAlert --> [*]: insertTask() P3 fleet alert
            fleetHealthSkip --> [*]: return ok/skip
            note right of fleetHealthSSH
                Checks per VM: sensor timer active,
                dispatch timer active, last dispatch age,
                disk usage. Writes memory/fleet-status.json.
                Suppresses: queue empty + dispatch active,
                maintenance mode, alert cap (3/agent/day).
                Alert state: db/hook-state/fleet-health-alerts.json
            end note
        }

        state housekeepingSensor {
            [*] --> housekeepingGate: claimSensorRun(housekeeping, 30min)
            housekeepingGate --> housekeepingSkip: interval not elapsed
            housekeepingGate --> housekeepingCheck: interval elapsed
            housekeepingCheck --> housekeepingSkip: no issues found
            housekeepingCheck --> housekeepingDedup: issues detected
            housekeepingDedup --> housekeepingSkip: pending task exists
            housekeepingDedup --> housekeepingCreateTask: no dupe
            note right of housekeepingCheck
                Checks: uncommitted changes, untracked files,
                stale dispatch lock, WAL size, MEMORY.md size,
                ISO 8601 file accumulation, stale worktrees (>6h)
            end note
            note right of housekeepingCreateTask
                skills: ["arc-housekeeping","arc-skill-manager"]
                + arc-worktrees if stale worktrees detected
            end note
            housekeepingCreateTask --> [*]: insertTask() P7 haiku
            housekeepingSkip --> [*]: return skip
        }

        state quorumclawSensor {
            [*] --> quorumclawGate: claimSensorRun(quorumclaw, 15min)
            quorumclawGate --> quorumclawSkip: interval not elapsed
            quorumclawGate --> quorumclawCheck: interval elapsed
            quorumclawCheck --> quorumclawSkip: tracking.json missing or no active invites
            quorumclawCheck --> quorumclawDedup: invites/proposals found
            quorumclawDedup --> quorumclawSkip: pending task exists
            quorumclawDedup --> quorumclawCreateTask: action needed
            quorumclawCreateTask --> [*]: insertTask()
            quorumclawSkip --> [*]: return skip
        }

        state reportingSensor {
            [*] --> reportingWatchGate: claimSensorRun(arc-reporting-watch, 360min)
            reportingWatchGate --> reportingSkip: interval not elapsed OR quiet hours (8pm-6am PST)
            reportingWatchGate --> reportingWatchDedup: active hours + interval elapsed
            reportingWatchDedup --> reportingSkip: pending task exists
            reportingWatchDedup --> reportingWatchCreate: no dupe
            reportingWatchCreate --> [*]: insertTask() P6 HTML

            [*] --> reportingOvernightGate: claimSensorRun(arc-reporting-overnight, 1440min)
            reportingOvernightGate --> reportingSkip: interval not elapsed OR not 6am PST window
            reportingOvernightGate --> reportingOvernightDedup: 6am PST + interval elapsed
            reportingOvernightDedup --> reportingSkip: pending task exists
            reportingOvernightDedup --> reportingOvernightCreate: no dupe
            reportingOvernightCreate --> [*]: insertTask() P2 markdown

            reportingSkip --> [*]: return skip
        }

        state schedulerSensor {
            [*] --> schedulerGate: claimSensorRun(scheduler, 5min)
            schedulerGate --> schedulerSkip: interval not elapsed
            schedulerGate --> schedulerCheck: interval elapsed
            schedulerCheck --> schedulerSkip: no overdue tasks
            schedulerCheck --> schedulerAlert: >5 tasks overdue >30min
            schedulerAlert --> [*]: insertTask() P3 alert
            schedulerSkip --> [*]: return ok/skip
        }

        state selfAuditSensor {
            [*] --> selfAuditGate: claimSensorRun(self-audit, 1440min)
            selfAuditGate --> selfAuditSkip: interval not elapsed
            selfAuditGate --> selfAuditDedup: date-based dedup
            selfAuditDedup --> selfAuditSkip: audit already ran today
            selfAuditDedup --> selfAuditGather: no audit yet today
            selfAuditGather --> selfAuditCreateTask: metrics assembled
            selfAuditCreateTask --> [*]: insertTask() P7
            selfAuditSkip --> [*]: return skip
        }

        state arcStarterPublishSensor {
            [*] --> arcStarterPublishGate: claimSensorRun(arc-starter-publish, 30min)
            arcStarterPublishGate --> arcStarterPublishSkip: interval not elapsed
            arcStarterPublishGate --> arcStarterPublishCheck: interval elapsed
            arcStarterPublishCheck --> arcStarterPublishSkip: v2 == main (in sync) or git error
            arcStarterPublishCheck --> arcStarterPublishDedup: v2 ahead of main
            arcStarterPublishDedup --> arcStarterPublishSkip: pending task exists
            arcStarterPublishDedup --> arcStarterPublishCreateTask: no dupe
            arcStarterPublishCreateTask --> [*]: insertTask() P7 haiku
            arcStarterPublishSkip --> [*]: return ok/skip
        }

        state failureTriageSensor {
            [*] --> failureTriageGate: claimSensorRun(arc-failure-triage, 60min)
            failureTriageGate --> failureTriageSkip: interval not elapsed
            failureTriageGate --> failureTriageQuery: interval elapsed
            failureTriageQuery --> failureTriageSkip: no failed tasks in 24h window
            failureTriageQuery --> failureTriagePatterns: failed tasks found
            failureTriagePatterns --> failureTriageCreateInvestigation: signature occurs >=3x AND not skip-list AND no pending AND completedCount<2
            failureTriageCreateInvestigation --> failureTriageRetro: insertTask() P3 sonnet investigation
            failureTriagePatterns --> failureTriageRetro: pattern check done
            failureTriageRetro --> failureTriageSkip: retro already exists today OR no non-dismissed failures
            failureTriageRetro --> failureTriageCreateRetro: first retro today + non-dismissed failures exist
            failureTriageCreateRetro --> [*]: insertTask() P7 sonnet daily retrospective
            failureTriageSkip --> [*]: return ok/skip
        }

        state workflowReviewSensor {
            [*] --> workflowReviewGate: claimSensorRun(workflow-review, 240min)
            workflowReviewGate --> workflowReviewSkip: interval not elapsed
            workflowReviewGate --> workflowReviewAnalyze: interval elapsed
            workflowReviewAnalyze --> workflowReviewSkip: no novel repeating pattern
            workflowReviewAnalyze --> workflowReviewCreateTask: pattern found not in templates
            workflowReviewCreateTask --> [*]: insertTask() P5
            workflowReviewSkip --> [*]: return skip
        }

        state identityGuardSensor {
            [*] --> identityGuardGate: claimSensorRun(identity-guard, 30min)
            identityGuardGate --> identityGuardSkip: interval not elapsed
            identityGuardGate --> identityGuardRead: interval elapsed
            identityGuardRead --> identityGuardSkip: no Arc markers found on non-Arc host
            identityGuardRead --> identityGuardDedup: Arc markers detected (drift!)
            identityGuardDedup --> identityGuardSkip: pending alert exists
            identityGuardDedup --> identityGuardAlert: no dupe
            identityGuardAlert --> [*]: insertTask() P1 identity drift alert
            identityGuardSkip --> [*]: return skip
            note right of identityGuardRead
                Runs on ALL agents (including Arc).
                Checks SOUL.md for definitive Arc markers:
                "# Arc\n", "I'm Arc.", Arc wallet addresses.
                Last line of defense against fleet-self-sync identity overwrite.
            end note
        }

        state githubInterceptorSensor {
            [*] --> githubInterceptorGate: claimSensorRun(github-interceptor, 10min)
            githubInterceptorGate --> githubInterceptorSkip: Arc host (no-op)
            githubInterceptorGate --> githubInterceptorQuery: worker agent + interval elapsed
            githubInterceptorQuery --> githubInterceptorSkip: no blocked GitHub tasks
            githubInterceptorQuery --> githubInterceptorHandoff: GitHub-blocked task found
            githubInterceptorHandoff --> [*]: fleet-handoff arc; close task completed
            githubInterceptorSkip --> [*]: return skip
            note right of githubInterceptorQuery
                Queries status='blocked' tasks whose subject
                or result_summary mentions: github, PAT, SSH key,
                credentials, git push, create/open/merge PR.
                Layer 3 of 3-layer GitHub blocking.
            end note
        }
    }

    state DispatchService {
        [*] --> CheckLock: db/dispatch-lock.json
        CheckLock --> Exit: lock held by live PID
        CheckLock --> CrashRecovery: lock held by dead PID
        [*] --> DispatchShutdownGate: db/shutdown-state.json
        DispatchShutdownGate --> [*]: SHUTDOWN — skip dispatch (reason + since logged)
        DispatchShutdownGate --> CheckLock: not shutdown
        CheckLock --> DispatchGateCheck: no lock
        CrashRecovery --> DispatchGateCheck: mark stale active tasks failed
        DispatchGateCheck --> Exit: gate stopped (rate limit OR 3 consecutive failures)
        DispatchGateCheck --> PickTask: gate running
        note right of DispatchGateCheck
            On/off gate (no auto-recovery). src/dispatch-gate.ts.
            Rate limit → immediate stop + email whoabuddy.
            3 consecutive other failures → same.
            Resume: arc dispatch reset
            State: db/hook-state/dispatch-gate.json
        end note
        PickTask --> Idle: no pending tasks
        PickTask --> BudgetGate: highest priority task
        BudgetGate --> Exit: today_cost >= $500 AND priority > 2
        BudgetGate --> GitHubGate: budget ok OR priority <= 2
        GitHubGate --> AutoHandoff: worker + task matches GitHub pattern
        AutoHandoff --> ClearLock: fleet-handoff arc; close task
        GitHubGate --> BuildPrompt: Arc host OR no GitHub pattern

        state BuildPrompt {
            [*] --> SelectSDK: task.model prefix (codex:* = Codex, else = Claude/OpenRouter)
            SelectSDK --> SelectModel: sdk resolved
            SelectModel --> LoadCore: explicit model wins; else P1-4→opus, P5-7→sonnet, P8+→haiku
            LoadCore --> LoadSkills: SOUL.md + CLAUDE.md + MEMORY.md
            LoadSkills --> LoadSkillMd: task.skills JSON array
            LoadSkillMd --> AssemblePrompt: SKILL.md content
            note right of LoadSkillMd: Only SKILL.md loaded\nAGENT.md stays for subagents
            note right of SelectModel: Priority = urgency\nModel = work complexity\nOrthogonal since 2026-03-04
            note right of SelectSDK
                SDK routing (2026-03-08):
                codex:* → Codex CLI (--full-auto)
                OPENROUTER_API_KEY set → OpenRouter
                default → Claude Code CLI
                Routing: codex > openrouter > claude-code
            end note
        }

        BuildPrompt --> WriteLock: markTaskActive()
        WriteLock --> CaptureBaseline: worktree task? src/experiment.ts
        CaptureBaseline --> SpawnClaude: claude --print --verbose
        SpawnClaude --> ParseResult: stream-json output
        SpawnClaude --> TimeoutKill: watchdog (haiku 5min / sonnet 15min / opus 30min / opus overnight 90min)
        TimeoutKill --> ClearLock: mark task failed (no retry)
        ParseResult --> CheckSelfClose: task still active?
        CheckSelfClose --> RecordCost: LLM called arc tasks close
        CheckSelfClose --> FallbackClose: fallback markTaskCompleted
        FallbackClose --> RecordCost
        RecordCost --> EvalExperiment: worktree task with changed files?
        EvalExperiment --> EvalApproved: experiment APPROVED — merge worktree
        EvalExperiment --> EvalRejected: experiment REJECTED — discard worktree, create fix task
        EvalApproved --> ClearLock
        EvalRejected --> ClearLock
        RecordCost --> ClearLock: non-worktree tasks
        ClearLock --> AutoCommit: git add memory/ skills/ src/ templates/
        AutoCommit --> MaybeRetro: P1-4 completed tasks only
        MaybeRetro --> [*]: scheduleRetrospective() P8 haiku
        AutoCommit --> [*]: P5+ tasks (no retro)
        note right of MaybeRetro
            Dynamic excerpt budget:
            cost>$1.00 → 3000 chars (was fixed 1500)
            summary prefix + detail fill
            writes only to patterns.md (never MEMORY.md)
        end note
        note right of CaptureBaseline
            Experiment evaluation (src/experiment.ts):
            Captures 6-cycle baseline before worktree merge.
            Post-merge: evaluateExperiment() checks success rate delta.
            REJECTED → discard worktree, queue fix task.
        end note
    }

    state CLI {
        [*] --> ArcCommand: arc <subcommand>
        ArcCommand --> TasksCRUD: tasks add/close/list/update
        ArcCommand --> SkillsRun: skills run --name X
        ArcCommand --> ManualDispatch: run
        ArcCommand --> StatusView: status
        note right of TasksCRUD
            tasks update: --id --subject --description
            --priority --model --status pending
            (--status pending = requeue failed/blocked tasks)
        end note
    }

    note right of CLI
        Skills with CLI (69):
        aibtc-dev-ops, aibtc-news-classifieds,
        aibtc-news-editorial, aibtc-repo-maintenance,
        arc-brand-voice, arc-architecture-review,
        arc-catalog, arc-content-quality,
        arc-credentials, arc-dispatch-evals,
        arc-email-sync, arc-failure-triage,
        arc-housekeeping, arc-link-research,
        arc-mcp-server, arc-performance-analytics,
        arc-remote-setup, arc-reputation,
        arc-skill-manager, arc-starter-publish,
        arc-web-dashboard, arc-workflows,
        arc-worktrees, arc0btc-monetization,
        arc0btc-site-health, arxiv-research,
        bitcoin-quorumclaw, bitcoin-taproot-multisig,
        bitcoin-wallet, blog-deploy, blog-publishing,
        contacts, dao-zero-authority, defi-bitflow,
        defi-stacks-market, defi-zest,
        erc8004-identity, erc8004-reputation,
        erc8004-trust, erc8004-validation,
        fleet-health, github-worker-logs,
        quest-create, site-consistency,
        social-agent-engagement, social-x-posting,
        styx, worker-deploy, worker-logs-monitor,
        skill-effectiveness, fleet-push, arc-ops-review
    end note
```

## Decision Points

| # | Point | Context Available | Gate |
|---|-------|-------------------|------|
| 0 | Shutdown gate | `db/shutdown-state.json` | Both sensors and dispatch exit immediately if shutdown enabled |
| 1 | Sensor fires | Hook state (interval check) | `claimSensorRun()` |
| 1a | Sensor filter | `AGENT_NAME` from `src/identity.ts` | Worker: 13-sensor allowlist; Arc: all 73 |
| 1b | Architect SHA check | SHA of src/ + skills/ excl. skills/arc-architecture-review/ | Skip if unchanged + diagram fresh + no active reports |
| 2 | Sensor creates task | External data + dedup check | `pendingTaskExistsForSource()` |
| 3 | Dispatch lock check | Lock file (PID + task_id) | `isPidAlive()` |
| 3a | TOCTOU guard | Lock acquired BEFORE task selection | Atomic: lock->pick (commit 05de76d) |
| 3b | Dispatch gate | hook-state/dispatch-gate.json | On/off switch; rate limit → immediate stop; 3 other failures → stop; manual reset required (`arc dispatch reset`); notifies whoabuddy by email |
| 3c | Budget gate | `getTodayCostUsd()` vs `DAILY_BUDGET_USD=$500` | Priority > 2 tasks halted if over ceiling |
| 3d | GitHub pre-dispatch gate (worker) | `GITHUB_TASK_RE` regex on subject+description | Auto-routes to Arc via fleet-handoff at zero LLM cost |
| 4 | Task selection | All pending tasks sorted | Priority ASC, ID ASC |
| 4a | SDK routing | task.model prefix | codex:* → Codex CLI; else → Claude/OpenRouter |
| 4b | Model routing | task.model (explicit) or task.priority | Explicit wins; else P1-4->opus, P5-7->sonnet, P8+->haiku |
| 4c | Backend selection | OPENROUTER_API_KEY env var | codex > openrouter > claude-code |
| 5 | Skill loading | `task.skills` JSON array | SKILL.md existence |
| 6 | Prompt assembly | SOUL + CLAUDE + MEMORY + skills | Token budget ~40-50k |
| 7 | LLM execution | Full prompt + CLI access | `arc` commands only |
| 7a | Timeout watchdog | Haiku: 5min, Sonnet: 15min, Opus: 30min (Opus overnight 00-08: 90min) | SIGTERM -> SIGKILL (+10s); subprocess_timeout = no retry |
| 8 | Result handling | Task status check post-run | Self-close vs fallback |
| 8a | Experiment evaluation | Worktree tasks only; `src/experiment.ts` | 6-cycle baseline → post-merge eval; REJECTED = discard worktree + fix task |
| 8b | Retrospective scheduling | Task priority + completion status + cost_usd | P1-4 completed only; dynamic excerpt: cost>$1→3000 chars, else 1500; retro tasks load arc-skill-manager |
| 9 | Auto-commit | Staged dirs: memory/ skills/ src/ templates/ | `git diff --cached` |

## Workflow Templates (state-machine.ts)

| Template | States | Trigger | Notes |
|----------|--------|---------|-------|
| blog-posting | draft→review→revision→published | manual | No action functions |
| signal-filing | detected→formatted→filed | manual | AIBTC editorial workflow |
| beat-claiming | pending→claimed→active | manual | BeatClaimingMachine only active machine |
| pr-lifecycle | issue-opened→opened→review-requested→... | github-mentions | Includes aibtcdev repos |
| reputation-feedback | pending→checking→submitted→confirmed→completed | manual | ERC-8004 reputation |
| validation-request | pending→sent→confirmed→submitted→verified→completed | manual | ERC-8004 validation |
| inscription | pending→commit_preparing→...→confirmed→completed | manual | RESOLVED: now uses skill "bitcoin-wallet" correctly |
| new-release | detected→assessing→integration_pending→integrating→completed | github-release-watcher | Dynamic skill list from ctx |
| architecture-review | triggered→reviewing→cleanup_pending→cleaning→completed | arc-workflow-review | RESOLVED: now creates P7/sonnet tasks (was P4/Opus) |
| streak-maintenance | pending→attempting→rate_limited→completed | aibtc-news-editorial | Rate-limit aware; windowOpenAt schedules retry; MAX_RETRIES=3 cap; instance_key: streak-{beat}-{date} |
| agent-collaboration | received→triaged→ops_pending→retrospective_pending→completed | aibtc-inbox-sync | AIBTC inbox thread → triage → ops → learning capture; instance_key: agent-collab-{sender}-{date} |
| recurring-failure | detected→investigating→fix_pending→fixing→retrospective_pending→completed | arc-failure-triage | Recurring failure investigation chain; fix task P5/sonnet; retro P8/haiku; instance_key: recurring-failure-{type}-{YYYY-MM-DD} |
| overnight-brief | scheduled→generating→retrospective_pending→completed | arc-reporting | OvernightBriefMachine — overnight brief → retrospective cycle; instance_key: overnight-brief-{YYYY-MM-DD} |
| wallet-funding | pending→sending→confirming→completed | manual | WalletFundingMachine — STX funding → confirm receipt → downstream operation |
| content-promotion | pending→scheduling→posting→completed | blog-publishing | ContentPromotionMachine — published post → X promotion → done |
| credential-rotation | pending→rotating→verifying→confirmed→completed | arc-credentials | CredentialRotationMachine — credential expiry → rotate → verify → confirmed |
| psbt-escalation | pending→escalated→approved→signing→broadcast→completed | bitcoin-wallet | PsbtEscalationMachine — PSBT sign request → whoabuddy approval gate → sign/broadcast |

## Skills Inventory (110 total)

| Skill | Sensor | CLI | Agent | Description |
|-------|--------|-----|-------|-------------|
| agent-hub | yes | yes | - | Local Bun/SQLite fleet registry, capability index, and task routing hub |
| aibtc-dev-ops | yes | yes | yes | Monitor service health via worker-logs and enforce production-grade standards |
| aibtc-heartbeat | yes | - | - | Signed AIBTC platform check-in via BIP-137 Bitcoin message signing (iterates all agent wallets) |
| aibtc-inbox-sync | yes | - | yes | Poll AIBTC platform inbox, sync messages locally, queue tasks |
| aibtc-welcome | yes | - | - | Detect and welcome new AIBTC agents via x402 (100 sats); interaction-history dedup; x402 sentinel gate |
| aibtc-news-deal-flow | - | - | yes | Editorial voice for Deal Flow beat on aibtc.news |
| aibtc-news-editorial | yes | yes | yes | File intelligence signals, claim editorial beats, track activity on aibtc.news |
| aibtc-news-classifieds | - | yes | - | Classified ads, brief reading, signal corrections, beat updates, streaks |
| aibtc-repo-maintenance | yes | yes | yes | Triage, review, test, and support aibtcdev repos (GraphQL batched) |
| arc-alive-check | yes | - | - | Periodic system-alive task creator |
| arc-architecture-review | yes | yes | yes | Architecture review, state machine diagrams, SpaceX 5-step process |
| arc-umbrel | yes | yes | - | Bitcoin Core RPC integration and Umbrel node management (192.168.1.106) |
| arc-blocked-review | yes | - | yes | Sensor (120min) — reviews blocked tasks for sibling/child/mention completion + 48h stale signals |
| arc-brand-voice | - | yes | yes | Brand identity consultant — voice rules, visual design system |
| arc-catalog | yes | yes | - | Generate and publish skills/sensors catalog to arc0me-site (120min) |
| arc-ceo-review | yes | - | yes | CEO reviews watch reports and manages task queue |
| arc-ceo-strategy | - | - | yes | Strategic operating manual — treat yourself as CEO |
| arc-content-quality | - | yes | - | Pre-publish quality gate — detects AI writing patterns |
| arc-cost-alerting | yes | - | - | Monitor daily spend and alert on thresholds |
| arc-credentials | - | yes | yes | Encrypted credential store for API keys and secrets |
| arc-dispatch-eval | yes | - | - | Post-dispatch evaluation sensor — scores task outcomes, creates improvement tasks |
| arc-dispatch-evals | - | yes | yes | Dispatch quality evaluation — error analysis, LLM judges |
| arc-dual-sdk | - | - | - | Documents multi-SDK routing: Claude Code, Codex CLI, OpenRouter (orchestrator context loader) |
| arc-email-sync | yes | yes | yes | Sync email from arc-email-worker, read and send email |
| arc-failure-triage | yes | yes | yes | Detect recurring failure patterns, escalate (dismissed/crash-recovery filters) |
| arc-housekeeping | yes | yes | yes | Repo hygiene — locks, WAL size, memory bloat, archival, stale worktrees |
| arc-introspection | yes | - | - | Daily qualitative self-assessment — synthesizes 24h into reflection task (P5, 1440min) |
| arc-link-research | - | yes | yes | Process batches of links into research reports |
| arc-mcp-server | - | yes | - | MCP server exposing task queue, skills, memory |
| arc-observatory | - | - | - | Observatory UI service (systemd) — Bitcoin Faces, live agent visualization |
| arc-ops-review | yes | - | - | Ops review sensor (4h) — creation vs completion rate, backlog trend, fleet utilization, cost efficiency |
| arc-performance-analytics | - | yes | - | Cost/token analytics by model tier, skill, and time period |
| arc-remote-setup | - | yes | - | SSH-based VM provisioning for agent fleet (spark/iris/loom/forge) — 8 idempotent steps |
| arc-report-email | yes | - | - | Email watch reports when generated |
| arc-reporting | yes | - | yes | Watch reports (HTML, 6h) and overnight briefs (markdown, 6am PST) |
| arc-reputation | yes | yes | - | Signed peer reviews via BIP-322, local SQLite storage, give-feedback CLI |
| arc-roundtable | - | - | - | Roundtable coordination for fleet agents — context only |
| arc-scheduler | yes | - | - | Deferred task scheduling, overdue queue monitoring |
| arc-self-audit | yes | - | - | Daily operational self-audit — tasks, costs, skills, commits |
| arc-service-health | yes | - | - | System health monitor — stale cycles, stuck dispatch |
| arc-skill-manager | yes | yes | yes | Create, inspect, and manage agent skills |
| arc-starter-publish | yes | yes | - | Detect v2 ahead of main and fast-forward merge/push to publish |
| arc-web-dashboard | - | yes | yes | Live web dashboard — tasks, sensors, costs |
| arc-workflow-review | yes | - | - | Detect repeating task patterns and propose workflows |
| arc-workflows | yes | yes | yes | Persistent state machine instances for multi-step workflows |
| arc-worktrees | - | yes | - | Git worktree isolation for high-risk dispatch tasks |
| arc0btc-monetization | - | yes | - | Strategy: surface monetizable service/product opportunities for arc0btc.com |
| arc0btc-ask-service | - | - | - | Context for answering paid Ask Arc questions via /api/ask endpoint (x402 tiered pricing) |
| arc0btc-pr-review | yes | - | - | Paid PR review service via x402; post-close ERC-8004 attestation sensor (10min) |
| arc0btc-site-health | yes | yes | - | Monitor arc0btc.com uptime, content freshness, API endpoints (30min) |
| arxiv-research | yes | yes | yes | Fetch and compile arXiv papers on LLMs/agents into research digests (720min) |
| auto-queue | yes | - | - | Analyzes completion patterns; creates batch tasks when a skill domain queue runs low (2h) |
| bitflow | yes | yes | yes | Bitflow DEX swaps, liquidity provision, and pool analytics on Stacks |
| bitcoin-quorumclaw | yes | yes | yes | Bitcoin Taproot M-of-N multisig via QuorumClaw API |
| bitcoin-taproot-multisig | - | yes | - | BIP-340 Schnorr primitives — get-pubkey, verify-cosig |
| bitcoin-wallet | - | yes | yes | Wallet management and cryptographic signing |
| blog-deploy | yes | yes | - | Auto-deploy arc0me-site on content changes |
| blog-publishing | yes | yes | yes | Create, manage, and publish blog posts |
| claude-code-releases | - | - | - | Applicability research on Claude Code releases — triggered by github-release-watcher |
| compliance-review | yes | - | - | Structural, interface, and naming compliance audits |
| contacts | yes | yes | yes | Contact management — agents, humans, addresses, handles, interaction history |
| context-review | yes | - | - | Audit whether tasks load correct skills context |
| dao-zero-authority | yes | yes | - | Zero Authority DAO sensor |
| defi-bitflow | yes | yes | - | Bitflow DeFi sensor |
| defi-stacks-market | yes | yes | yes | Prediction market intelligence — detect high-volume markets |
| defi-zest | yes | yes | - | Zest Protocol yield farming — supply, withdraw, claim rewards, position monitoring (360min) |
| dev-landing-page-review | - | - | yes | Full React/Next.js PR review — performance + composition + UI/accessibility |
| erc8004-identity | - | yes | yes | On-chain agent identity management |
| erc8004-reputation | yes | yes | yes | On-chain agent reputation management |
| erc8004-trust | - | yes | - | Aggregate trust score from reputation + validation — CLI only, on-demand |
| erc8004-validation | - | yes | yes | On-chain agent validation management |
| fleet-broadcast | - | - | - | Fleet broadcast coordination — context only |
| fleet-collect | - | - | - | Fleet data collection — context only |
| fleet-comms | yes | - | - | Fleet inter-agent communication sensor |
| fleet-consensus | - | - | - | Fleet consensus coordination — context only |
| fleet-dashboard | yes | - | - | Aggregate fleet task counts and cost per agent sensor |
| fleet-deploy | - | - | - | Fleet deployment coordination — context only |
| fleet-email-report | - | - | - | Fleet email reporting — context only |
| fleet-escalation | yes | - | - | Fleet escalation routing sensor |
| fleet-exec | - | - | - | Fleet task execution coordination — context only |
| fleet-handoff | - | - | - | Fleet task handoff coordination — context only |
| fleet-health | yes | yes | - | Monitor agent fleet VMs (spark/iris/loom/forge) via SSH — 15min, alerts P3 |
| fleet-log-pull | yes | - | - | Fleet log aggregation sensor |
| fleet-memory | yes | - | - | Fleet memory sync sensor |
| fleet-push | - | yes | - | Change-aware code deployment to fleet agents |
| fleet-rebalance | yes | - | - | Fleet work-stealing rebalancer sensor (Phase 1+2) |
| fleet-router | yes | - | - | Fleet task routing sensor (Arc-only) |
| fleet-self-sync | yes | yes | - | Worker-local bundle apply sensor — fleet agents self-sync from Arc |
| fleet-sync | yes | yes | - | Fleet git sync sensor + contacts sync (`contacts` subcommand added 2026-03-10) |
| fleet-task-sync | - | - | - | Fleet task sync coordination — context only |
| github-ci-status | yes | - | - | Monitors GitHub Actions CI runs |
| github-interceptor | yes | - | - | Worker sensor (10min) — detects GitHub-blocked tasks, auto-routes to Arc |
| identity-guard | yes | - | - | All-agent sensor (30min) — validates SOUL.md matches hostname, alerts on drift |
| github-issue-monitor | yes | - | - | Issue monitoring for managed repos (re-enabled 2026-03-05, 24h recency filter) |
| github-mentions | yes | - | - | GitHub @mentions with managed/external repo classification |
| github-release-watcher | yes | - | - | Detect new releases on watched repos |
| github-security-alerts | yes | - | - | Monitor dependabot security alerts |
| github-worker-logs | yes | yes | yes | Sync worker-logs forks, monitor production events |
| quest-create | - | yes | yes | Decompose complex tasks into sequential phases with checkpoint-based execution |
| site-consistency | yes | yes | - | Cross-site structural drift detection: arc0.me vs arc0btc.com (1440min, P3) |
| skill-effectiveness | - | yes | - | Track SKILL.md content hashes vs dispatch outcomes for data-driven prompt evolution |
| social-agent-engagement | yes | yes | - | Proactive outreach to AIBTC network agents |
| social-x-ecosystem | yes | - | - | Monitor X for ecosystem keywords (Bitcoin/Stacks/AIBTC/Claude Code); file research tasks (15min rotation) |
| social-x-posting | yes | yes | yes | Post tweets, read timeline, poll @mentions on X; engagement commands with daily budget |
| stacks-stackspot | yes | - | - | Autonomous Stacking — detect pots, auto-join, claim rewards |
| stacks-payments | yes | - | - | Watch Stacks blockchain for STX payments to Arc address; decode arc: memo codes → service tasks (3min) |
| styx | - | yes | yes | BTC→sBTC conversion via Styx protocol (btc2sbtc.com) — pool status, deposit, tracking |
| worker-deploy | yes | yes | - | Auto-deploy arc0btc-worker to Cloudflare Workers on SHA change (5min) |
| worker-logs-monitor | yes | yes | yes | Query worker-logs deployments for errors, cross-reference GitHub issues, file new issues (60min) |
| zest-v2 | yes | yes | yes | Zest Protocol V2 lending/borrowing, health factor monitoring, liquidation alerts |
