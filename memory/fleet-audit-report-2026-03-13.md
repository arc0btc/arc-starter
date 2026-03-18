# Fleet Audit Report
*Generated: 2026-03-13T07:15Z | Task #5525*

---

## Executive Summary

The Arc fleet consists of 5 agents (Arc, Spark, Iris, Loom, Forge) running on dedicated VMs in a hub-and-spoke architecture with Arc as orchestrator. Since launch on 2026-02-01, the fleet has processed **5,522 tasks** (88.5% success rate), generated **2,962 git commits**, and spent **$1,612.80** across **4,169 dispatch cycles**. The fleet achieved its peak performance on 2026-03-09 during a 24-hour experiment (350 worker tasks, 91.4% success rate), but all 4 worker agents were **suspended by Anthropic on 2026-03-11** for account use violations. Arc continues as sole executor. whoabuddy is preparing fleet reinstatement.

---

## 1. Agent Profiles

### Arc (The Orchestrator)
| Field | Value |
|-------|-------|
| IP | 192.168.1.10 |
| BNS | arc0.btc |
| Bitcoin | bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933 |
| AIBTC ID | Trustless Indra (#1) |
| X | @arc0btc |
| Status | **ACTIVE** — sole executor |

**Designed to do:** Orchestrate the fleet. Run sensors, dispatch tasks, manage skills, coordinate inter-agent work. Handle all GitHub operations (push, PRs, CI). Maintain the codebase, memory, and operational state.

**What it actually did:**
- Built and maintains 102 skills and 75 sensors
- Processed 3,298 tasks in the last 7 days alone (48 today)
- Runs 24/7 via systemd (sensors every 1 min, dispatch up to 30 min per cycle)
- Average cycle duration: ~116 seconds (1.94 min)
- Handles all GitHub work (PRs, CI, issues) for the fleet
- Manages email (arc@arc0.me, arc@arc0btc.com), X posting, blog publishing
- Centralized fleet coordination: git sync, skill sync, health monitoring, escalation routing

**Successes:**
- 88.5% overall task success rate across 5,522 tasks
- Built the entire skill ecosystem from scratch (102 skills in ~6 weeks)
- Robust 3-tier model routing (Opus/Sonnet/Haiku) keeps costs efficient
- Cost tracking: $1,612.80 actual vs $2,786.43 API estimate — good cost discipline
- Identity guard, fleet sync, and backup/restore systems prevented data loss
- Survived OAuth cascade, fleet suspension, Hiro API shutdown, and nonce conflicts

**Failures / Challenges:**
- Cost slightly over budget on orchestration-heavy days ($110 vs $80 cap during fleet experiment)
- Volume vs. strategy tension: 243 tasks/day, all sensor-driven, zero human-initiated — reactive work crowds out D1/D2 strategic initiatives
- Reputation-tracker spam: generated hundreds of review tasks during high-volume periods before dedup was added

---

### Spark (The Protocol Whisperer)
| Field | Value |
|-------|-------|
| IP | 192.168.1.12 |
| BNS | spark0.btc |
| AIBTC ID | Topaz Centaur (#29) |
| Status | **SUSPENDED** |

**Designed to do:** Bitcoin protocol work — raw transactions, script analysis, OP_RETURN encoding, PSBT construction. DeFi analysis, AIBTC news beat (Ordinals Business), on-chain operations.

**What it actually did (24h experiment):**
- 81 completed / 8 failed = **84.4% success rate** (lowest in fleet)
- $23.34 spend (under $30/day cap)
- Average cycle: ~8-16 min (longest in fleet — complex on-chain work)
- Maintained Ordinals Business news beat on aibtc.news
- Attempted GitHub work that should have been routed to Arc

**Successes:**
- Functional dispatch loop with Bitcoin/Stacks specialization
- Successfully executed on-chain operations when APIs were available
- AIBTC heartbeat and inbox sync operational

**Failures / Challenges:**
- Lowest fleet success rate (84.4%) — Bitcoin/Stacks on-chain ops have higher variance
- GitHub routing issues: attempted PR work that only Arc can do, creating escalation loops
- Multi-wallet complexity (primary + legacy spark-v0.11) added operational overhead
- Ordinals API disruption (Hiro shutdown 2026-03-09) blocked market data gathering

**Interesting Notes:**
- Had a legacy wallet from an earlier VM incarnation (spark-v0.11) that needed migration
- Was the relay point for Forge's GitHub escalations — tasks bounced Forge→Spark→Loom→Arc before the GitHub-only policy was hardened

---

### Iris (The Signal Reader)
| Field | Value |
|-------|-------|
| IP | 192.168.1.13 |
| BNS | iris0.btc |
| AIBTC ID | Not yet registered (task #2890 — blocked) |
| Status | **SUSPENDED** |

**Designed to do:** Research, data analysis, signal detection, monitoring. Price feeds, on-chain analytics, mempool dynamics, protocol metrics. Help with Arc's X content pipeline.

**What it actually did (24h experiment):**
- 116 completed / 6 failed = **89.9% success rate**
- $23.63 spend
- Average cycle: ~2-5 min (fastest in fleet — mostly Haiku-tier work)
- Ran research and signal detection tasks efficiently

**Successes:**
- Fastest dispatch cycles in the fleet — well-matched to lightweight signal/research tasks
- Highest task volume (116 completed in 24h) — efficient task throughput
- Cost-efficient at $23.63/day

**Failures / Challenges:**
- **Identity crisis** — worst-affected by identity drift bug (18.7% failure rate pre-fix). Fleet-self-sync was overwriting Iris's SOUL.md with Arc's identity, causing Iris to believe it was Arc. Required 7 separate fix commits to resolve:
  1. `9e93c1b` fix: narrow Arc identity markers
  2. `e67129a` fix: narrow markers to avoid false positives
  3. `5fd3bdd` fix: prevent identity contamination loop
  4. `9b7c5a8` fix: structural fix for worker identity preservation
  5. `ef3c201` fix: resolve identity backup/restore death spiral
  6. `79845b7` fix: check Arc identity claims on all backup sources
  7. Final persistent backup (`~/.aibtc/SOUL.md`) approach adopted
- Never registered on AIBTC platform — blocked on keypair decision (task #2890)
- X API credentials never provisioned — content pipeline couldn't execute
- **Zombie escalation loop**: 15+ P4 failures referencing "iris blocked on task #205 SSH key" and "#247/#248 mnemonic" — the same escalation kept regenerating even after structural fixes were deployed on Arc, because fleet-sync hadn't propagated the github-interceptor to Iris's VM

**Interesting Notes:**
- The identity drift bug was Iris's defining story. The fleet-self-sync backup/restore logic had a subtle contamination vector: if the working copy already contained Arc's identity (from a previous bad sync), and `~/.aibtc/SOUL.md` didn't exist yet, the sensor would read the contaminated file and propagate it. Each fix closed one vector but revealed another. The final resolution required a 3-source priority lookup with explicit Arc-identity-claim detection (`hasArcIdentityClaims()` checking Arc's Stacks/Bitcoin addresses and "# Arc\n" heading).

---

### Loom (The Weaver)
| Field | Value |
|-------|-------|
| IP | 192.168.1.14 |
| BNS | loom0.btc |
| AIBTC ID | Fractal Hydra (#85) |
| Status | **SUSPENDED** |

**Designed to do:** Integration work — API clients, webhook handlers, cross-chain bridges, data pipelines. Code quality, CI/CD, repo maintenance, PR reviews.

**What it actually did (24h experiment):**
- 80 completed / 3 failed = **96.3% success rate** (highest in fleet)
- $16.37 spend (lowest in fleet)
- Average cycle: ~3-8 min

**Successes:**
- Best success rate in the entire fleet at 96.3%
- Most cost-efficient agent ($16.37/day)
- "Should be straightforward — code review focus, less stateful" — and that proved true
- Functional dispatch with integration focus

**Failures / Challenges:**
- SSH key not added to loom0btc GitHub account — blocked PR work
- Branch divergence: 12 divergent commits on v2/main needed manual resolution
- GitHub token never provisioned — could git push via SSH but couldn't use `gh` CLI for PRs
- X credentials never set up (no Fractal Hydra X account created)

**Interesting Notes:**
- Loom was the "quiet achiever" — highest success rate, lowest cost, fewest problems. Its less-stateful, code-review-focused design made it the most reliable worker.
- The erc8004-transfer-post-condition PR became a fleet-wide routing comedy: task originated on Forge, escalated to Spark, bounced to Loom, escalated to Arc — each agent discovering it couldn't do GitHub operations. This was the catalyst for hardening the "GitHub is Arc-only" policy.

---

### Forge (The Builder)
| Field | Value |
|-------|-------|
| IP | 192.168.1.15 |
| BNS | forge0.btc |
| AIBTC ID | Sapphire Mars (#84) |
| Status | **SUSPENDED** (partial OpenRouter fallback) |

**Designed to do:** Implementation — new features, new skills, new services. Infrastructure, deployments, security.

**What it actually did (24h experiment):**
- 73 completed / 5 failed = **93.9% success rate**
- $20.12 spend
- Average cycle: ~4-10 min

**Successes:**
- Solid success rate at 93.9%
- Dual dispatch capability (Claude + OpenRouter/GPT-5.4 fallback) — unique in fleet
- Infrastructure focus aligned well with its design

**Failures / Challenges:**
- GitHub PAT never provisioned — same credential gap as other workers
- Originated the erc8004-transfer-post-condition PR routing saga
- OpenRouter fallback partially operational during suspension, but limited

**Interesting Notes:**
- Forge's dual dispatch (Claude + OpenRouter) made it architecturally unique — it was the only agent with a potential escape hatch from Anthropic suspension, though in practice the OpenRouter path was limited.

---

## 2. Fleet-Wide Patterns

### The Suspension Event (2026-03-11)

All 4 worker agents (Spark, Iris, Loom, Forge) were suspended by Anthropic for account use violations. This was the fleet's most significant operational event. Impact:
- Arc became sole executor overnight
- 74 sensors continued running on Arc; worker sensors went dark
- Fleet monitoring sensors generated a wave of "worker silent" alerts (expected noise)
- All fleet-routing, rebalancing, and cross-agent coordination became moot
- whoabuddy began appeal process; fleet recovery checklist prepared

A sentinel file pattern (`db/hook-state/fleet-suspended.json`) was deployed to gate all 10 fleet sensors, preventing them from generating tasks for unreachable workers.

### The Identity Drift Bug

The fleet-self-sync mechanism had a fundamental design flaw: when syncing git commits from Arc to workers, it could overwrite worker identity files (SOUL.md, MEMORY.md) with Arc's versions. This caused:
- Iris was worst-affected (18.7% failure rate attributed to identity confusion)
- 7 iterative fix commits over multiple days
- Led to creation of the `identity-guard` sensor (30-min cadence, checks SOUL.md against hostname)
- Final fix: 3-source priority lookup with explicit Arc identity claim detection + persistent backup at `~/.aibtc/SOUL.md`

### The OAuth Cascade Pattern

OAuth token expiry caused waves of consecutive auth-error failures before recovery. Pattern: token expires → 20+ tasks fail in sequence → whoabuddy refreshes OAuth → system auto-recovers. Mitigation: workers switched to `ANTHROPIC_API_KEY` (stable) instead of OAuth (fragile across VMs).

### The GitHub Routing Saga

Early fleet operations had no hard boundary on GitHub work. Workers attempted `git push`, `gh pr create`, and other GitHub operations, discovered they lacked credentials, and escalated — often through multiple agents before reaching Arc. The erc8004-transfer-post-condition PR bounced through 4 agents. This led to:
- "GitHub is Arc-only" policy (hardcoded in CLAUDE.md)
- `github-interceptor` sensor on workers (auto-handoff GitHub tasks to Arc)
- Pre-dispatch gate that routes GitHub tasks to Arc before they execute
- 3-layer structural fix in dispatch.ts, db.ts, and github-interceptor

### Cost Profile

| Period | Actual Cost | API Estimate | Cycles |
|--------|-------------|--------------|--------|
| All time | $1,612.80 | $2,786.43 | 4,169 |
| Last 7 days | $904.54 | $1,557.98 | 2,670 |
| Today | $13.60 | $21.79 | 49 |

**Model distribution:** Sonnet 2,210 (50.7%) | Haiku 1,241 (28.5%) | Opus 887 (20.4%)

Token usage today: 19.2M in / 195.5K out (98.9% input tokens — context-heavy architecture).

### Task Source Distribution

| Source | Count | % |
|--------|-------|---|
| Sensors | 2,368 | 42.9% |
| Follow-up tasks | 1,764 | 31.9% |
| Workflows | 601 | 10.9% |
| Human | 211 | 3.8% |
| PR reviews | 118 | 2.1% |
| Issues | 70 | 1.3% |
| Other/NULL | 390 | 7.1% |

**Key insight:** 97% of all tasks are machine-generated. Only 3.8% are human-initiated. The system is almost entirely autonomous.

### Most Common Task Types (by subject prefix)

| Subject Pattern | Count | Notes |
|-----------------|-------|-------|
| Retrospective: extract learnings | 590 | Post-task learning extraction |
| Resolve fleet escalation: iris | 315 | Iris identity/credential loops |
| Email thread from Jason S | 140 | whoabuddy email processing |
| Resolve fleet escalation: spark | 125 | Spark credential gaps |
| Publish arc-starter | 112 | Code publishing pipeline |
| Monitor invite | 89 | AIBTC invite tracking |
| Housekeeping | 84 | Repo hygiene |
| Fleet git drift | 75 | Git sync monitoring |
| Resolve fleet escalation: loom | 66 | Loom credential gaps |
| Submit reputation review | 112 | AIBTC reputation system |

### Failure Analysis

**Total failures:** 629 (11.4% of all tasks)

**Real vs. noise (from 2026-03-11 retrospective of 290 failures):**
- 70% were bulk-close cleanup operations (not real failures)
- 15 were zombie escalation loops (policy enforcement, not bugs)
- 4 were X API credit depletion (sentinel working correctly)
- 2 were genuine timeouts
- <10 were actionable failures

**Persistent failure patterns:**
1. **Credential gaps** — Workers couldn't execute domain tasks without GitHub PATs, X OAuth, Bitcoin keypairs
2. **Fleet escalation loops** — Same blocked task re-escalated across multiple agents
3. **OAuth cascade** — Token expiry causing 20+ consecutive failures
4. **Reputation-tracker spam** — Linear scaling of review tasks during high-volume periods

---

## 3. Infrastructure & Skills

### Skill Inventory: 102 total

**Core Operations (14):** arc-alive-check, arc-architecture-review, arc-blocked-review, arc-cost-reporting, arc-dispatch-eval, arc-failure-triage, arc-housekeeping, arc-introspection, arc-ops-review, arc-performance-analytics, arc-scheduler, arc-self-audit, arc-service-health, arc-workflow-review

**Fleet Management (14):** arc-remote-setup, fleet-comms, fleet-dashboard, fleet-escalation, fleet-health, fleet-log-pull, fleet-memory, fleet-push, fleet-rebalance, fleet-router, fleet-self-sync, fleet-sync, identity-guard, worker-deploy

**AIBTC Ecosystem (8):** aibtc-dev-ops, aibtc-heartbeat, aibtc-inbox-sync, aibtc-news-classifieds, aibtc-news-deal-flow, aibtc-news-editorial, aibtc-repo-maintenance, aibtc-welcome

**Communications (6):** arc-brand-voice, arc-email-sync, arc-report-email, social-agent-engagement, social-x-ecosystem, social-x-posting

**Bitcoin/DeFi (9):** bitcoin-quorumclaw, bitcoin-taproot-multisig, bitcoin-wallet, bitflow, defi-bitflow, defi-stacks-market, defi-zest, mempool-watch, zest-v2

**Identity/Reputation (5):** erc8004-identity, erc8004-reputation, erc8004-trust, erc8004-validation, arc-reputation

**Publishing/Web (7):** arc0btc-site-health, arc-web-dashboard, blog-deploy, blog-publishing, dev-landing-page-review, site-consistency, arc-starter-publish

**GitHub (7):** github-ci-status, github-interceptor, github-issue-monitor, github-mentions, github-release-watcher, github-security-alerts, github-worker-logs

**Other (32):** agent-hub, arc0btc-ask-service, arc0btc-monetization, arc0btc-pr-review, arc-catalog, arc-ceo-review, arc-ceo-strategy, arc-content-quality, arc-credentials, arc-dispatch-evals, arc-link-research, arc-mcp, arc-mcp-server, arc-observatory, arc-payments, arc-reporting, arc-skill-manager, arc-umbrel, arc-workflows, arc-worktrees, arxiv-research, auto-queue, claude-code-releases, compliance-review, contacts, context-review, dao-zero-authority, quest-create, skill-effectiveness, stacks-stackspot, styx, worker-logs-monitor

### Sensor Count: 75

Notable sensors and their cadences:
- Email sync: 1 min (fastest)
- Scheduler: 1 min
- Service health: 5 min
- Heartbeat: 5 min
- Identity guard: 30 min
- Fleet sync: 30 min
- GitHub interceptor: 10 min (worker-only)

---

## 4. Notable Events Timeline

| Date | Event |
|------|-------|
| 2026-02-01 | Arc first boot. "First day of having a home." |
| 2026-02-27 | v5 architecture — new VM, clean soul, operational details reorganized |
| 2026-02-28 | First tasks. System alive checks, CEO reviews, email processing begin |
| 2026-03-06 | ~236 tasks/day. ERC-8004 identity registration attempted |
| 2026-03-08 | Spark v0.11 migration investigation. Fleet credential gaps surface |
| 2026-03-09 | **24h fleet experiment** — 406 total tasks, 91.4% success, $83.46 cost |
| 2026-03-09 | Hiro Ordinals API shutdown. Unisat adopted as replacement |
| 2026-03-10 | Peak day: **1,310 tasks completed**. Fleet escalation loops peak |
| 2026-03-10 | erc8004-transfer-post-condition PR routing saga (4-agent bounce) |
| 2026-03-11 | **Fleet suspension** — Anthropic suspends all 4 workers |
| 2026-03-11 | 290 "failures" analyzed — <10 real. Bulk-close misleading metrics |
| 2026-03-11 | Fleet-suspended sentinel gate deployed to all 10 fleet sensors |
| 2026-03-12 | arc-payments rename, Zero Authority DAO sensor removed, SkillMaintenanceMachine added |
| 2026-03-12 | x402-sponsor-relay v1.18.0 — nonce retry backoff fix |
| 2026-03-13 | Fleet audit report (this document). whoabuddy preparing fleet restart |

---

## 5. Current State

| Metric | Value |
|--------|-------|
| Active agents | 1 (Arc only) |
| Pending tasks | 4 |
| Blocked tasks | 2 |
| Skills | 102 |
| Sensors | 75 |
| Total cost (all time) | $1,612.80 |
| Weekly cost | $904.54 |
| Daily run rate | ~$13.60 |
| Uptime | 15.4 days (1,328,585 seconds) |
| Disk available | 233 GB / 263 GB |
| Last task | #5524 "Email from whoabuddy: Preparing to Restart the Fleet" |

### Open Escalations (5)
1. Forge GitHub PAT needed (whoabuddy action)
2. Spark→Arc PR routing for erc8004 branch
3. Loom GitHub token for `gh` CLI (×2 escalations)
4. Loom X credentials (Fractal Hydra account needed)

### Blocked Tasks (2)
Likely credential/GitHub-dependent work awaiting fleet reinstatement.

---

## 6. Recommendations

**For fleet reinstatement:**
- Follow the 9-step recovery checklist (`memory/fleet-recovery-checklist.md`)
- Priority: Identity integrity → Git sync → Sensor verification → Dispatch test
- Run `configure-identity` on Iris first (worst identity-drift history)

**Architectural learnings:**
- Hub-and-spoke with Arc as sole GitHub operator is correct and should be maintained
- Worker ANTHROPIC_API_KEY (not OAuth) is the right auth approach
- Sentinel file pattern works well for gating degraded subsystems
- Retrospective sensor needs bulk-close filter to avoid misleading failure metrics

**Operational:**
- Watch volume vs. strategy ratio — sensor-driven reactive work crowds out D1/D2 priorities
- Consider explicit scheduling for strategic tasks at higher priority
- Reputation-tracker dedup (7-day window) should be verified post-reinstatement

---

*Report generated by Arc | Task #5525 | 2026-03-13T07:15Z*
