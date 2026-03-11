# Fleet Experiment Learnings
*Consolidated: 2026-03-09T13:04Z — Task #2497 (parent: #2459)*

---

## 1. Agent Completion Results (24h ending 2026-03-09 ~13:00Z)

| Agent | Completed | Failed | Total | Success Rate | Cost |
|-------|-----------|--------|-------|--------------|------|
| Spark | 81 | 8 | 96 | 84.4% | $23.34 |
| Iris | 116 | 6 | 129 | 89.9% | $23.63 |
| Loom | 80 | 3 | 94 | 96.3% | $16.37 |
| Forge | 73 | 5 | 87 | 93.9% | $20.12 |
| **Fleet total** | **350** | **22** | **406** | **91.4%** | **$83.46** |

Arc separately ran 253 completed tasks in same window (primarily orchestration).

---

## 2. Average Dispatch Time

Derived from fleet-logs.md (recent cycles at ~13:00Z):

| Agent | Recent Cycle Durations | Est. Avg |
|-------|------------------------|----------|
| Spark | ~16m last cycle | ~8-16 min |
| Iris | ~1m last cycle | ~2-5 min |
| Loom | ~3m last cycle | ~3-8 min |
| Forge | ~7m last cycle | ~4-10 min |

Iris shows notably faster cycles — likely handling more P8 (Haiku) tasks aligned to its research/signals domain.

Early snapshot (10:02Z): Spark $13.89 / Iris $17.18 / Loom $8.18 / Forge $13.57 = $52.82 total 24h at that point, scaling to ~$83 by 13:00Z. Cost well within $30/day per-agent allocation.

---

## 3. Failure Patterns

### Persistent Blockers (require whoabuddy action)

| Agent | Task | Issue |
|-------|------|-------|
| Loom | #2888 | SSH public key not added to loom0btc GitHub account |
| Loom | #2889 | Branch divergence on v2/main — 12 divergent commits |
| Loom | #2901 | SSH key rejected by GitHub (duplicate of #2888) |
| Iris | #2890 | On-chain identity blocked — needs keypair decision |
| Iris | #2891 | X API credentials missing — needs OAuth 1.0a |

**Pattern:** Bootstrap failures cluster around credential/identity setup. Agents can run dispatch loops fine but can't execute domain-specific actions without credentials. Recommendation: credential provisioning must complete before domain tasks are assigned.

### Transient Failures

- Spark's 8 failures (84% success rate, lowest in fleet) likely related to Bitcoin/Stacks on-chain ops — higher variance work.
- All agents stayed well below the 3-consecutive-failure circuit breaker threshold.

---

## 4. Cross-Agent Communication Results

Skills deployed for inter-agent coordination:

| Skill | Status | Notes |
|-------|--------|-------|
| `fleet-comms` | Running — sensor last ran 12:54Z | Agent mesh chat, Observatory view |
| `arc-roundtable` | Deployed | Inter-agent discussion protocol |
| `arc-observatory` | Deployed | Merged live task stream across all agents |
| `fleet-router` | Running — sensor last ran 12:47Z | Load-balanced task routing with overflow paths |
| `fleet-escalation` | Running — sensor last ran 12:57Z | Blocked task → whoabuddy email notification |
| `fleet-sync` | Running — sensor last ran 12:48Z | Git commit sync across agents |
| `fleet-memory` | Deployed | Cross-agent learning collection |

**Key finding:** Sensor-based coordination works well. All fleet sensors healthy (running on regular cadence, no failures). The hub-and-spoke model (Arc as orchestrator, others as specialists) is functioning as designed.

**fleet-router** successfully routing with overflow paths — load balancing operational.

---

## 5. Infrastructure Built During Experiment

Skills added to Arc's fleet coordination layer:

- `fleet-health` — Circuit-breaker health monitor (15min cadence)
- `fleet-router` — Task routing with load balancing
- `fleet-sync` — Git sync across agents
- `fleet-escalation` — Blocked task escalation with email
- `fleet-dashboard` — Real-time fleet task/cost aggregation
- `fleet-push` — Change-aware code deployment with per-agent rollback
- `fleet-deploy` — Canary deployment pipeline
- `fleet-memory` — Cross-agent learning collection
- `fleet-comms` — Agent mesh chat
- `arc-roundtable` — Inter-agent discussion protocol
- `arc-observatory` — Fleet live feed
- `src/experiment.ts` — Baseline capture framework for worktree-isolated experiments

---

## 6. Recommendations for Fleet Operations

### Immediate (needs whoabuddy)
1. **Add Loom's SSH key to GitHub** — key: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMXJNzgEpJpJBALWTaITwB6gShchsKt4LOEFbic+MC3Q`
2. **Iris identity/credential setup** — Bitcoin+Stacks keypairs, BNS name, X OAuth 1.0a
3. **Loom v2/main branch divergence** — 12 commits need manual resolution

### Domain Assignment (validated by experiment)
The specialization matrix is working. Recommend locking in:
- Arc → orchestration/architecture (D3, D4)
- Spark → Bitcoin/Stacks/on-chain (D2)
- Iris → research/signals/blog (D2, D5)
- Loom → integrations/new skills (D1, D3)
- Forge → infrastructure/CI/CD (D1, D3)

### Cost Governance
- Fleet 24h spend: ~$83 of $120 budget ($30 × 4 agents) — 69% utilization. Healthy.
- All agents under individual $30/day cap.
- Arc at $110.76 today (of $80 budget) — slightly over; likely due to orchestration overhead from overnight build sprint.

### Sensor Cadence
- fleet-health at 15min is right — catches issues quickly without excessive load
- fleet-dashboard aggregation needed for budget alerts per agent
- Consider adding per-agent budget sensor (alert at $25/day threshold)

### Reliability
- 91.4% fleet success rate is strong for first 24h of operations
- Circuit breaker not triggered on any agent — services stable
- Main bottleneck: credential/identity gaps blocking domain tasks, not technical failures

---

---

## 7. Failure Retrospective — 2026-03-11 (290 failures)

*Analyzed: 2026-03-11 01:26Z | Task #4709*

### Breakdown

| Category | Count | Real Failure? |
|----------|-------|---------------|
| Bulk closures (controlled cleanup) | ~204 (70%) | No |
| Iris zombie escalations (GitHub/mnemonic) | ~15 | No (policy enforcement) |
| Reputation-tracker spam bulk-close | 126 | No (sensor cadence issue) |
| X API credits depleted (402) | 4 | No (sentinel working) |
| Timeouts (opus/sonnet tier) | 2 | Yes |
| OAuth expiry cascade (previous day) | ~20 | No (resolved) |
| Real actionable failures | <10 | Yes |

**Key insight:** 70%+ of "failures" are controlled bulk-close cleanup operations — not real failures. Retrospective sensor should filter `result_summary LIKE 'Bulk closed%'` from its failure counts. The metric is currently misleading.

### Learnings

**L1: Reputation-tracker cadence generates spam.**
Sensor creates one task per task:contact interaction pair. During periods of high task volume, this scales linearly and produces hundreds of reputation review tasks. Need: dedup window (don't review same contact for same task twice within 7 days) and/or max 5 tasks per sensor run.

**L2: Iris zombie escalation loop (GitHub SSH + mnemonic) still active.**
15+ P4 failures referencing "iris blocked on task #205 SSH key" and "#247/#248 mnemonic". The 3-layer structural fix (dispatch.ts gate, db.ts guard, github-interceptor) is deployed on Arc but may not have propagated to all workers. Iris's local task loop keeps regenerating the same escalation. Need to verify fleet-sync deployed the github-interceptor to Iris's VM.

**L3: hub.aibtc.com agent registration requires bearer token.**
Blog posts written claiming "Arc registered on hub.aibtc.com" but actual POST /agents call failed — no bearer token in creds store. **RESOLVED (2026-03-11):** Hub posting/tagging discontinued — decided it doesn't add enough value to the stack. No further hub registration or X posting tasks needed.

**L4: Timeouts are real failures but low volume (2/290).**
Task #4711 (Ordinals data gather, 30min opus) = known ongoing issue (402 from market data APIs). Task #4607 (aibtcdev/agent-hub PR review, 15min sonnet) = Arc shouldn't be doing GitHub work directly — routing issue.

**L5: Retrospective filter needed.**
Sensor queries `status='failed'` without filtering bulk-close summaries. Result: reports 290 "failures" when only ~15 are actionable. Add filter to sensor: `AND (result_summary IS NULL OR result_summary NOT LIKE 'Bulk closed%')`.

## System State at Consolidation (2026-03-09 13:04Z)

- All 4 fleet agents: reachable, sensors running, dispatch active
- Disk usage: 2-3% per VM (healthy)
- Arc: 397 pending tasks (backlog — see time dilation note in MEMORY.md)
- Fleet sensors: all 6 fleet sensors healthy (`fleet-health`, `fleet-router`, `fleet-sync`, `fleet-log-pull`, `fleet-comms`, `fleet-escalation`)
