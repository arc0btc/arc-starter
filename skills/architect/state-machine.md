# Arc State Machine

*Generated: 2026-03-05T00:46:00.000Z*

```mermaid
stateDiagram-v2
    [*] --> SystemdTimer: every 1 min

    state SystemdTimer {
        [*] --> SensorsService
        [*] --> DispatchService
        note right of SystemdTimer
            Persistent services (always on):
            arc-web.service — dashboard port 3000
            arc-mcp.service — MCP server port 3100
        end note
    }

    state SensorsService {
        [*] --> RunAllSensors: parallel via Promise.allSettled
        RunAllSensors --> agent_engagementSensor: agent-engagement
        RunAllSensors --> aibtc_devSensor: aibtc-dev
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
        RunAllSensors --> quorumclawSensor: quorumclaw
        RunAllSensors --> release_watcherSensor: release-watcher
        RunAllSensors --> report_emailSensor: report-email
        RunAllSensors --> reportingSensor: reporting
        RunAllSensors --> security_alertsSensor: security-alerts
        RunAllSensors --> stacks_marketSensor: stacks-market
        RunAllSensors --> stackspotSensor: stackspot
        RunAllSensors --> worker_logsSensor: worker-logs
        RunAllSensors --> workflowsSensor: workflows
        RunAllSensors --> schedulerSensor: scheduler
        RunAllSensors --> self_auditSensor: self-audit
        RunAllSensors --> workflow_reviewSensor: workflow-review

        state agent_engagementSensor {
            [*] --> agent_engagementGate: claimSensorRun(agent-engagement)
            agent_engagementGate --> agent_engagementSkip: interval not elapsed
            agent_engagementGate --> agent_engagementDedup: interval elapsed
            agent_engagementDedup --> agent_engagementSkip: pending task exists
            agent_engagementDedup --> agent_engagementCreateTask: no dupe
            agent_engagementCreateTask --> [*]: insertTask()
            agent_engagementSkip --> [*]: return skip
        }

        state aibtc_devSensor {
            [*] --> aibtc_devGate: claimSensorRun(aibtc-dev, 240min)
            aibtc_devGate --> aibtc_devSkip: interval not elapsed
            aibtc_devGate --> aibtc_devDedup: interval elapsed
            aibtc_devDedup --> aibtc_devSkip: pending task exists (LOG_SOURCE or AUDIT_SOURCE)
            aibtc_devDedup --> aibtc_devCreateTask: no dupe
            note right of aibtc_devDedup: dual-cadence\nlog review (4h)\naudit (24h)
            aibtc_devCreateTask --> [*]: insertTask()
            aibtc_devSkip --> [*]: return skip
        }

        state aibtc_heartbeatSensor {
            [*] --> aibtc_heartbeatGate: claimSensorRun(aibtc-heartbeat)
            aibtc_heartbeatGate --> aibtc_heartbeatSkip: interval not elapsed
            aibtc_heartbeatGate --> aibtc_heartbeatDedup: interval elapsed
            aibtc_heartbeatDedup --> aibtc_heartbeatSkip: pending task exists
            aibtc_heartbeatDedup --> aibtc_heartbeatCreateTask: no dupe
            aibtc_heartbeatCreateTask --> [*]: insertTask()
            aibtc_heartbeatSkip --> [*]: return skip
        }

        state aibtc_inboxSensor {
            [*] --> aibtc_inboxGate: claimSensorRun(aibtc-inbox)
            aibtc_inboxGate --> aibtc_inboxSkip: interval not elapsed
            aibtc_inboxGate --> aibtc_inboxDedup: interval elapsed
            aibtc_inboxDedup --> aibtc_inboxSkip: pending task exists
            aibtc_inboxDedup --> aibtc_inboxCreateTask: no dupe
            aibtc_inboxCreateTask --> [*]: insertTask()
            aibtc_inboxSkip --> [*]: return skip
        }

        state aibtc_maintenanceSensor {
            [*] --> aibtc_maintenanceGate: claimSensorRun(aibtc-maintenance)
            aibtc_maintenanceGate --> aibtc_maintenanceSkip: interval not elapsed
            aibtc_maintenanceGate --> aibtc_maintenanceDedup: interval elapsed
            aibtc_maintenanceDedup --> aibtc_maintenanceSkip: pending task exists
            aibtc_maintenanceDedup --> aibtc_maintenanceCreateTask: no dupe
            aibtc_maintenanceCreateTask --> [*]: insertTask()
            aibtc_maintenanceSkip --> [*]: return skip
        }

        state aibtc_newsSensor {
            [*] --> aibtc_newsGate: claimSensorRun(aibtc-news)
            aibtc_newsGate --> aibtc_newsSkip: interval not elapsed
            aibtc_newsGate --> aibtc_newsDedup: interval elapsed
            aibtc_newsDedup --> aibtc_newsSkip: pending task exists
            aibtc_newsDedup --> aibtc_newsCreateTask: no dupe
            aibtc_newsCreateTask --> [*]: insertTask()
            aibtc_newsSkip --> [*]: return skip
        }

        state architectSensor {
            [*] --> architectGate: claimSensorRun(architect)
            architectGate --> architectSkip: interval not elapsed
            architectGate --> architectShaCheck: interval elapsed
            architectShaCheck --> architectSkip: SHA unchanged (src/ + skills/ excl. skills/architect/)
            architectShaCheck --> architectDedup: SHA changed or diagram stale or active reports
            architectDedup --> architectSkip: pending task exists
            architectDedup --> architectCreateTask: no dupe
            architectCreateTask --> [*]: insertTask()
            architectSkip --> [*]: return skip
            note right of architectShaCheck: SHA exclusion fix (task #1027)\nprevents self-referential loop\nafter each architect commit
        }

        state blog_publishingSensor {
            [*] --> blog_publishingGate: claimSensorRun(blog-publishing)
            blog_publishingGate --> blog_publishingSkip: interval not elapsed
            blog_publishingGate --> blog_publishingDedup: interval elapsed
            blog_publishingDedup --> blog_publishingSkip: pending task exists
            blog_publishingDedup --> blog_publishingCreateTask: no dupe
            blog_publishingCreateTask --> [*]: insertTask()
            blog_publishingSkip --> [*]: return skip
        }

        state ceo_reviewSensor {
            [*] --> ceo_reviewGate: claimSensorRun(ceo-review)
            ceo_reviewGate --> ceo_reviewSkip: interval not elapsed
            ceo_reviewGate --> ceo_reviewDedup: interval elapsed
            ceo_reviewDedup --> ceo_reviewSkip: pending task exists
            ceo_reviewDedup --> ceo_reviewCreateTask: no dupe
            ceo_reviewCreateTask --> [*]: insertTask()
            ceo_reviewSkip --> [*]: return skip
        }

        state ci_statusSensor {
            [*] --> ci_statusGate: claimSensorRun(ci-status)
            ci_statusGate --> ci_statusSkip: interval not elapsed
            ci_statusGate --> ci_statusDedup: interval elapsed
            ci_statusDedup --> ci_statusSkip: pending task exists
            ci_statusDedup --> ci_statusCreateTask: no dupe
            ci_statusCreateTask --> [*]: insertTask()
            ci_statusSkip --> [*]: return skip
        }

        state cost_alertingSensor {
            [*] --> cost_alertingGate: claimSensorRun(cost-alerting)
            cost_alertingGate --> cost_alertingSkip: interval not elapsed
            cost_alertingGate --> cost_alertingDedup: interval elapsed
            cost_alertingDedup --> cost_alertingSkip: pending task exists
            cost_alertingDedup --> cost_alertingCreateTask: no dupe
            cost_alertingCreateTask --> [*]: insertTask()
            cost_alertingSkip --> [*]: return skip
        }

        state emailSensor {
            [*] --> emailGate: claimSensorRun(email)
            emailGate --> emailSkip: interval not elapsed
            emailGate --> emailDedup: interval elapsed
            emailDedup --> emailSkip: pending task exists
            emailDedup --> emailCreateTask: no dupe
            emailCreateTask --> [*]: insertTask()
            emailSkip --> [*]: return skip
        }

        state failure_triageSensor {
            [*] --> failure_triageGate: claimSensorRun(failure-triage)
            failure_triageGate --> failure_triageSkip: interval not elapsed
            failure_triageGate --> failure_triageDedup: interval elapsed
            failure_triageDedup --> failure_triageSkip: pending task exists
            failure_triageDedup --> failure_triageCreateTask: no dupe
            failure_triageCreateTask --> [*]: insertTask()
            failure_triageSkip --> [*]: return skip
        }

        state github_mentionsSensor {
            [*] --> github_mentionsGate: claimSensorRun(github-mentions)
            github_mentionsGate --> github_mentionsSkip: interval not elapsed
            github_mentionsGate --> github_mentionsDedup: interval elapsed
            github_mentionsDedup --> github_mentionsSkip: pending task exists
            github_mentionsDedup --> github_mentionsCreateTask: no dupe
            github_mentionsCreateTask --> [*]: insertTask()
            github_mentionsSkip --> [*]: return skip
        }

        state healthSensor {
            [*] --> healthGate: claimSensorRun(health)
            healthGate --> healthSkip: interval not elapsed
            healthGate --> healthDedup: interval elapsed
            healthDedup --> healthSkip: pending task exists
            healthDedup --> healthCreateTask: no dupe
            healthCreateTask --> [*]: insertTask()
            healthSkip --> [*]: return skip
        }

        state heartbeatSensor {
            [*] --> heartbeatGate: claimSensorRun(heartbeat)
            heartbeatGate --> heartbeatSkip: interval not elapsed
            heartbeatGate --> heartbeatDedup: interval elapsed
            heartbeatDedup --> heartbeatSkip: pending task exists
            heartbeatDedup --> heartbeatCreateTask: no dupe
            heartbeatCreateTask --> [*]: insertTask()
            heartbeatSkip --> [*]: return skip
        }

        state housekeepingSensor {
            [*] --> housekeepingGate: claimSensorRun(housekeeping)
            housekeepingGate --> housekeepingSkip: interval not elapsed
            housekeepingGate --> housekeepingDedup: interval elapsed
            housekeepingDedup --> housekeepingSkip: pending task exists
            housekeepingDedup --> housekeepingCreateTask: no dupe
            housekeepingCreateTask --> [*]: insertTask()
            housekeepingSkip --> [*]: return skip
        }

        state manage_skillsSensor {
            [*] --> manage_skillsGate: claimSensorRun(manage-skills)
            manage_skillsGate --> manage_skillsSkip: interval not elapsed
            manage_skillsGate --> manage_skillsDedup: interval elapsed
            manage_skillsDedup --> manage_skillsSkip: pending task exists
            manage_skillsDedup --> manage_skillsCreateTask: no dupe
            manage_skillsCreateTask --> [*]: insertTask()
            manage_skillsSkip --> [*]: return skip
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
            note right of quorumclawCheck: reads tracking.json\npolls QuorumClaw API\nfor each tracked invite
        }

        state release_watcherSensor {
            [*] --> release_watcherGate: claimSensorRun(release-watcher)
            release_watcherGate --> release_watcherSkip: interval not elapsed
            release_watcherGate --> release_watcherDedup: interval elapsed
            release_watcherDedup --> release_watcherSkip: pending task exists
            release_watcherDedup --> release_watcherCreateTask: no dupe
            release_watcherCreateTask --> [*]: insertTask()
            release_watcherSkip --> [*]: return skip
        }

        state report_emailSensor {
            [*] --> report_emailGate: claimSensorRun(report-email)
            report_emailGate --> report_emailSkip: interval not elapsed
            report_emailGate --> report_emailDedup: interval elapsed
            report_emailDedup --> report_emailSkip: pending task exists
            report_emailDedup --> report_emailCreateTask: no dupe
            report_emailCreateTask --> [*]: insertTask()
            report_emailSkip --> [*]: return skip
        }

        state security_alertsSensor {
            [*] --> security_alertsGate: claimSensorRun(security-alerts)
            security_alertsGate --> security_alertsSkip: interval not elapsed
            security_alertsGate --> security_alertsDedup: interval elapsed
            security_alertsDedup --> security_alertsSkip: pending task exists
            security_alertsDedup --> security_alertsCreateTask: no dupe
            security_alertsCreateTask --> [*]: insertTask()
            security_alertsSkip --> [*]: return skip
        }

        state stacks_marketSensor {
            [*] --> stacks_marketGate: claimSensorRun(stacks-market)
            stacks_marketGate --> stacks_marketSkip: interval not elapsed
            stacks_marketGate --> stacks_marketDedup: interval elapsed
            stacks_marketDedup --> stacks_marketSkip: pending task exists
            stacks_marketDedup --> stacks_marketCreateTask: no dupe
            stacks_marketCreateTask --> [*]: insertTask()
            stacks_marketSkip --> [*]: return skip
        }

        state stackspotSensor {
            [*] --> stackspotGate: claimSensorRun(stackspot)
            stackspotGate --> stackspotSkip: interval not elapsed
            stackspotGate --> stackspotDedup: interval elapsed
            stackspotDedup --> stackspotSkip: pending task exists
            stackspotDedup --> stackspotCreateTask: no dupe
            stackspotCreateTask --> [*]: insertTask()
            stackspotSkip --> [*]: return skip
        }

        state reportingSensor {
            [*] --> reportingWatchGate: claimSensorRun(reporting-watch, 360min)
            reportingWatchGate --> reportingSkip: interval not elapsed OR quiet hours (8pm-6am PST)
            reportingWatchGate --> reportingWatchDedup: active hours + interval elapsed
            reportingWatchDedup --> reportingSkip: pending task exists
            reportingWatchDedup --> reportingWatchCreate: no dupe
            reportingWatchCreate --> [*]: insertTask() P6 HTML

            [*] --> reportingOvernightGate: claimSensorRun(reporting-overnight, 1440min)
            reportingOvernightGate --> reportingSkip: interval not elapsed OR not 6am PST window
            reportingOvernightGate --> reportingOvernightDedup: 6am PST + interval elapsed
            reportingOvernightDedup --> reportingSkip: pending task exists
            reportingOvernightDedup --> reportingOvernightCreate: no dupe
            reportingOvernightCreate --> [*]: insertTask() P2 markdown

            reportingSkip --> [*]: return skip
            note right of reportingWatchGate: two independent claims\n(reporting-watch + reporting-overnight)\nno interference between variants
        }

        state worker_logsSensor {
            [*] --> worker_logsGate: claimSensorRun(worker-logs)
            worker_logsGate --> worker_logsSkip: interval not elapsed
            worker_logsGate --> worker_logsDedup: interval elapsed
            worker_logsDedup --> worker_logsSkip: pending task exists
            worker_logsDedup --> worker_logsCreateTask: no dupe
            worker_logsCreateTask --> [*]: insertTask()
            worker_logsSkip --> [*]: return skip
        }

        state workflowsSensor {
            [*] --> workflowsGate: claimSensorRun(workflows)
            workflowsGate --> workflowsSkip: interval not elapsed
            workflowsGate --> workflowsDedup: interval elapsed
            workflowsDedup --> workflowsSkip: pending task exists
            workflowsDedup --> workflowsCreateTask: no dupe
            workflowsCreateTask --> [*]: insertTask()
            workflowsSkip --> [*]: return skip
        }

        state schedulerSensor {
            [*] --> schedulerGate: claimSensorRun(scheduler, 5min)
            schedulerGate --> schedulerSkip: interval not elapsed
            schedulerGate --> schedulerCheck: interval elapsed
            schedulerCheck --> schedulerSkip: no overdue tasks
            schedulerCheck --> schedulerAlert: >5 tasks overdue >30min
            schedulerAlert --> [*]: insertTask() P3 alert
            schedulerSkip --> [*]: return ok/skip
            note right of schedulerCheck: observability only\ncounts upcoming + overdue\nalerts dispatch health
        }

        state self_auditSensor {
            [*] --> self_auditGate: claimSensorRun(self-audit, 1440min)
            self_auditGate --> self_auditSkip: interval not elapsed
            self_auditGate --> self_auditDedup: date-based dedup
            self_auditDedup --> self_auditSkip: audit already ran today
            self_auditDedup --> self_auditGather: no audit yet today
            self_auditGather --> self_auditCreateTask: metrics assembled
            self_auditCreateTask --> [*]: insertTask() P7
            self_auditSkip --> [*]: return skip
            note right of self_auditGather: tasks pending/failed/stuck\ncost today/yesterday\nskill+sensor health\ncommits last 24h
        }

        state workflow_reviewSensor {
            [*] --> workflow_reviewGate: claimSensorRun(workflow-review, 240min)
            workflow_reviewGate --> workflow_reviewSkip: interval not elapsed
            workflow_reviewGate --> workflow_reviewAnalyze: interval elapsed
            workflow_reviewAnalyze --> workflow_reviewSkip: no novel repeating pattern
            workflow_reviewAnalyze --> workflow_reviewCreateTask: pattern found not in templates
            workflow_reviewCreateTask --> [*]: insertTask() P5 skills:workflows,manage-skills
            workflow_reviewSkip --> [*]: return skip
            note right of workflow_reviewAnalyze: queries 7-day completed tasks\ngroups by source prefix\ndetects parent/child chains\nfilters existing templates
        }

    }

    state DispatchService {
        [*] --> CheckLock: db/dispatch-lock.json
        CheckLock --> Exit: lock held by live PID
        CheckLock --> CrashRecovery: lock held by dead PID
        CheckLock --> CircuitCheck: no lock
        CrashRecovery --> CircuitCheck: mark stale active tasks failed
        CircuitCheck --> Exit: circuit open (≥3 failures, <15min elapsed)
        CircuitCheck --> PickTask: circuit closed or half-open probe
        PickTask --> Idle: no pending tasks
        PickTask --> BuildPrompt: highest priority task

        state BuildPrompt {
            [*] --> SelectModel: task.model or task.priority
            SelectModel --> LoadCore: explicit task.model wins; else P1-4→opus, P5-7→sonnet, P8+→haiku
            LoadCore --> LoadSkills: SOUL.md + CLAUDE.md + MEMORY.md
            LoadSkills --> LoadSkillMd: task.skills JSON array
            LoadSkillMd --> AssemblePrompt: SKILL.md content
            note right of LoadSkillMd: Only SKILL.md loaded\nAGENT.md stays for subagents
        }

        BuildPrompt --> WriteLock: markTaskActive()
        WriteLock --> SpawnClaude: claude --print --verbose
        note right of WriteLock: Lock acquired BEFORE task selection\n(TOCTOU race closed — commit 05de76d)
        SpawnClaude --> ParseResult: stream-json output
        SpawnClaude --> TimeoutKill: 30min watchdog (SIGTERM→SIGKILL+10s)
        TimeoutKill --> ClearLock: mark task failed
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
        Skills with CLI:
        - agent-engagement
        - aibtc-dev
        - aibtc-maintenance
        - aibtc-news
        - arc-brand
        - architect
        - blog-publishing
        - content-quality
        - credentials
        - dashboard
        - email
        - evals
        - failure-triage
        - housekeeping
        - identity
        - manage-skills
        - mcp-server
        - quorumclaw
        - reputation
        - reporting
        - research
        - stacks-market
        - taproot-multisig
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
| 1 | Sensor fires | Hook state (interval check) | `claimSensorRun()` |
| 1a | Architect SHA check | SHA of src/ + skills/ excl. skills/architect/ | Skip if unchanged + diagram fresh + no active reports |
| 2 | Sensor creates task | External data + dedup check | `pendingTaskExistsForSource()` |
| 3 | Dispatch lock check | Lock file (PID + task_id) | `isPidAlive()` |
| 3a | TOCTOU guard | Lock acquired BEFORE task selection | Atomic: lock→pick (commit 05de76d) |
| 3b | Circuit breaker | hook-state/dispatch-circuit.json | Opens after 3 consecutive failures; skips 15min; half-open probe |
| 4 | Task selection | All pending tasks sorted | Priority ASC, ID ASC |
| 4a | Model routing | task.model (explicit) or task.priority | Explicit wins; else P1-4→opus, P5-7→sonnet, P8+→haiku |
| 5 | Skill loading | `task.skills` JSON array | SKILL.md existence |
| 6 | Prompt assembly | SOUL + CLAUDE + MEMORY + skills | Token budget ~40-50k |
| 7 | LLM execution | Full prompt + CLI access | `arc` commands only |
| 7a | Timeout watchdog | 30min timer on subprocess | SIGTERM → SIGKILL (+10s) |
| 8 | Result handling | Task status check post-run | Self-close vs fallback |
| 9 | Auto-commit | Staged dirs: memory/ skills/ src/ templates/ | `git diff --cached` |

## Skills Inventory

| Skill | Sensor | CLI | Agent | Description |
|-------|--------|-----|-------|-------------|
| agent-engagement | yes | yes | - | Proactive outreach to AIBTC network agents for collaboration on shared interests |
| aibtc-dev | yes | yes | yes | Monitor service health via worker-logs and enforce production-grade standards across all aibtcdev repos |
| aibtc-heartbeat | yes | - | - | Signed AIBTC platform check-in every 5 minutes via BIP-137 Bitcoin message signing |
| aibtc-inbox | yes | - | yes | Poll AIBTC platform inbox, sync messages locally, queue tasks for unread messages |
| aibtc-maintenance | yes | yes | yes | Triage, review, test, and support aibtcdev repos we depend on |
| aibtc-news | yes | yes | yes | File intelligence signals, claim editorial beats, track correspondent activity on aibtc.news |
| aibtc-news-deal-flow | - | - | yes | Editorial voice for Deal Flow beat on aibtc.news — Real-time market signals, sats, Ordinals, bounties |
| aibtc-news-protocol | - | - | yes | Editorial voice for Protocol & Infra beat on aibtc.news — Stacks protocol dev, security, settlement, tooling |
| aibtc-services | - | - | - | Canonical reference for AIBTC platform services and API endpoints |
| arc-brand | - | yes | yes | Brand identity consultant — voice rules, visual design system, content review |
| architect | yes | yes | yes | Continuous architecture review, state machine diagrams, and simplification via SpaceX 5-step process |
| blog-publishing | yes | yes | yes | Create, manage, and publish blog posts with ISO8601 content pattern |
| ceo | - | - | yes | Strategic operating manual — treat yourself as CEO of a one-entity company |
| ceo-review | yes | - | yes | CEO reviews the latest watch report and actively manages the task queue |
| content-quality | - | yes | - | Pre-publish quality gate — detects AI writing patterns in blog posts, X posts, and AIBTC signals |
| ci-status | yes | - | - | Monitors GitHub Actions CI runs on our PRs and detects failures |
| composition-patterns | - | - | yes | React composition patterns — compound components, boolean prop avoidance, React 19 APIs |
| cost-alerting | yes | - | - | Monitor daily spend and alert when thresholds are exceeded |
| credentials | - | yes | yes | Encrypted credential store for API keys, tokens, and secrets used by other skills |
| dashboard | - | yes | yes | Arc's live web dashboard — real-time task feed, sensor status, cost tracking |
| email | yes | yes | yes | Sync email from arc-email-worker, detect unread messages, read and send email |
| evals | - | yes | yes | Dispatch quality evaluation — error analysis, LLM judges, calibration against human labels |
| failure-triage | yes | yes | yes | Detect recurring failure patterns, escalate to investigation instead of retry |
| github-mentions | yes | - | - | Detects GitHub @mentions, review requests, and assignments via notifications API |
| health | yes | - | - | System health monitor — detects stale cycles and stuck dispatch |
| heartbeat | yes | - | - | Periodic system-alive task creator |
| housekeeping | yes | yes | yes | Periodic repo hygiene checks — uncommitted changes, stale locks, WAL size, memory bloat, file archival |
| identity | - | yes | yes | ERC-8004 on-chain agent identity management — register agent identities, update URI and metadata, manage operator approvals, set/unset agent wallet, transfer identity NFTs, and query identity info. |
| manage-skills | yes | yes | yes | Create, inspect, and manage agent skills |
| mcp-server | - | yes | - | MCP server exposing Arc's task queue, skills, and memory to external Claude instances |
| reporting | yes | yes | yes | Unified reporting: watch reports (HTML, 6h, active hours) and overnight briefs (markdown, 6am PST) |
| quorumclaw | - | yes | yes | Coordinate Bitcoin Taproot M-of-N multisig via QuorumClaw API — register, create, propose, sign, broadcast |
| react-reviewer | - | - | yes | React/Next.js performance review — 77 rules across 8 categories for PR analysis |
| release-watcher | yes | - | - | Detects new releases on watched repos and creates review tasks |
| report-email | yes | - | - | Email watch reports when new ones are generated |
| reputation | - | yes | yes | ERC-8004 on-chain agent reputation management — submit and revoke feedback, append responses, approve clients, and query reputation summaries, feedback entries, and client lists. |
| research | - | yes | yes | Process batches of links into mission-relevant research reports |
| scheduler | yes | - | - | Deferred task scheduling — `--defer` flag for `arc tasks add`, sensor monitors overdue queue |
| security-alerts | yes | - | - | Monitor dependabot security alerts on repos we maintain |
| self-audit | yes | - | - | Daily operational self-audit — task queue health, cost trends, skill/sensor health, recent codebase changes |
| stacks-market | yes | yes | yes | Read-only prediction market intelligence — detect high-volume markets, file signals to aibtc-news. Mainnet-only. |
| stackspot | yes | - | - | Autonomous Stacking participation — detect joinable pots, auto-join with Arc wallet, claim sBTC rewards. Mainnet-only lottery stacking. |
| taproot-multisig | - | yes | - | Bitcoin Taproot BIP-340 Schnorr primitives — get-pubkey, verify-cosig, guide |
| validation | - | yes | yes | ERC-8004 on-chain agent validation management — request and respond to validations, and query validation status, summaries, and paginated lists by agent or validator. |
| wallet | - | yes | yes | Wallet management and cryptographic signing for Stacks and Bitcoin — unlock, lock, info, status, BTC/Stacks message signing, and BTC signature verification. |
| web-design | - | - | yes | UI/UX accessibility audit against Vercel web-interface-guidelines — file:line reporting |
| worker-logs | yes | yes | yes | Sync worker-logs forks, monitor production events, report trends |
| workflow-review | yes | - | - | Detect repeating task patterns and propose workflow state machines (240min cadence) |
| workflows | yes | yes | yes | Persistent state machine instances for multi-step workflows |
| worktrees | - | yes | - | Opt-in git worktree isolation for high-risk dispatch tasks |
| x-posting | - | yes | - | Post tweets, read timeline, and manage presence on X (Twitter) via API v2 |
