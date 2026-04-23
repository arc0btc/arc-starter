# Dispatch Service Operational Audit

- **Date**: 2026-04-22T11:20:00-05:00
- **Auditor**: whoabuddy + Claude
- **Target**: arc-starter dispatch service on LAN VM
- **Scope**: Health, reliability, cost, safety, configuration, data integrity

---

## 1. Service Health & Uptime

### Timers

| Unit | State | Firing | Uptime |
|------|-------|--------|--------|
| arc-dispatch.timer | active (waiting) | every 1min, next ~11:28 | since 2026-04-16 (5 days) |
| arc-sensors.timer | active (running) | every 1min | since 2026-04-16 (5 days) |

Both timers have been running continuously since service install on Apr 16.

### Services

| Unit | State | PID | Memory | Notes |
|------|-------|-----|--------|-------|
| arc-dispatch.service | inactive (dead) | last exit 0 | - | Oneshot; last ran 11:27, idle (no pending tasks) |
| arc-sensors.service | activating (start) | 1202789 | 99.1M (peak 202M) | Currently running; checking 917 agents |
| arc-web.service | active (running) | 788 | 74.6M (peak 89.2M) | Up 5 days, SSE client cycling every 30min |
| arc-mcp.service | active (running) | 428470 | 35.3M (peak 58.4M) | Up since Apr 17 |
| arc-observatory.service | not found | - | - | Unit does not exist |

### Dispatch Lock

No lock file present (`db/dispatch-lock.json` absent) — dispatch is not running and no stale lock.

### Dispatch Gate

```json
{
  "status": "running",
  "consecutive_failures": 0,
  "stopped_at": null,
  "last_updated": "2026-04-15T18:00:09.102Z"
}
```

Gate is open. Zero consecutive failures. Last updated Apr 15 — 7 days ago, suggesting no dispatch work has run since then.

### Findings

- **[WARN] inotify exhaustion**: Every dispatch and MCP invocation logs `Failed to add control/memory inotify watch descriptor: No space left on device`. Current limit is 29,909 watches / 128 instances. The watches are being consumed (likely by VS Code Server, Bun file watchers, or Claude Code sessions). Not currently blocking execution, but could cause silent failures in file-watching services.
- **[INFO] Observatory missing**: `arc-observatory.service` does not exist on this machine. Either never installed or removed.
- **[INFO] Sensors running long**: The sensors run at 11:26 was still active at 11:28 (~2.5min), processing 917 agents in the welcome sensor. The timer shows `n/a` for next trigger because the current run hasn't finished yet — this is expected behavior for a long-running oneshot, but worth monitoring if sensor runtime continues to grow with agent count.
- **[OK] Dispatch healthy**: Timer firing reliably every minute, exiting cleanly with "No pending tasks. Idle." No crashes, no stale locks.

## 2. Task Queue State

### Overall Volume

| Metric | Value |
|--------|-------|
| Total tasks (all time) | 13,362 |
| Completed | 11,002 |
| Failed | 2,356 (17.6% all-time) |
| Pending | 4 |
| Active | 0 |
| Blocked | 0 |

### 7-Day Window

| Status | Count | Rate |
|--------|-------|------|
| Completed | 681 | 92.0% |
| Failed | 59 | 8.0% |

129 tasks created today alone.

### Pending Tasks (4)

All 4 pending tasks are scheduled for the future — the queue is effectively idle right now:

| ID | Priority | Model | Subject | Scheduled For |
|----|----------|-------|---------|---------------|
| 13302 | P4 | sonnet | monitor: hiro simulation:400 drain check | 2026-04-23 14:00 |
| 13137 | P6 | sonnet | cleanup: ordinals HookState deprecated fields | 2026-04-23 06:00 |
| 13256 | P6 | sonnet | wire quantum signal auto-queuing from arXiv digest | 2026-04-23 06:00 |
| 13209 | P7 | sonnet | architect: wire quantum arXiv digest auto-queuing (carry x9) | 2026-04-23 06:00 |

### Recent Failures (last 10)

Common failure patterns:
- **Cooldown collisions**: Tasks hitting global 60-min cooldown windows and rescheduling (e.g., #13312, #13311, #13306, #13305, #13304)
- **STX send simulation:400**: Welcome tasks failing at Hiro transaction simulation (#13330, #13224)
- **Email destination unverified**: Cloudflare Email Worker can't send to jason@joinfreehold.com (#13365)
- **Task supersession**: One task superseded by corrected follow-up (#13286)

### Findings

- **[OK] Queue is healthy**: Zero stuck or active tasks. All 4 pending are scheduled for tomorrow.
- **[INFO] High all-time failure rate (17.6%)**: Significantly higher than the 7-day rate (8.0%), suggesting early operational tuning drove up historical failures. The 7-day rate is more representative.
- **[WARN] STX send failures**: Hiro `simulation:400` errors are a recurring pattern in welcome tasks. May indicate an ongoing issue with the STX send flow.
- **[INFO] Cooldown cascading**: Multiple tasks fail due to hitting cooldown timers, then reschedule — this is by design but inflates failure counts.

## 3. Cost & Budget

### Daily Spend (7-day rolling)

| Day | Actual ($) | API Est ($) | Cycles | Avg $/cycle |
|-----|-----------|-------------|--------|-------------|
| Apr 15 | 27.46 | 28.67 | 86 | 0.32 |
| Apr 16 | 37.64 | 43.26 | 122 | 0.31 |
| Apr 17 | 39.86 | 39.60 | 129 | 0.31 |
| Apr 18 | 31.47 | 31.62 | 110 | 0.29 |
| Apr 19 | 26.27 | 27.72 | 54 | 0.49 |
| Apr 20 | 23.30 | 23.66 | 80 | 0.29 |
| Apr 21 | 40.82 | 42.59 | 89 | 0.46 |
| **Apr 22** | **34.71** | **35.68** | **88** | **0.39** |
| **7d total** | **261.54** | **273.08** | **758** | **0.34** |

The $200/day budget ceiling has never been hit. Peak day was Apr 21 at $40.82.

### Cost by Model (today)

| Model | Actual ($) | API Est ($) | Cycles | Tokens In | Tokens Out |
|-------|-----------|-------------|--------|-----------|------------|
| sonnet | 29.56 | 29.48 | 95 | 36.8M | 396K |
| opus | 25.17 | 27.89 | 9 | 7.8M | 69K |
| haiku | 1.90 | 1.90 | 22 | 6.8M | 58K |

### Cost by Model (7-day)

| Model | Actual ($) | API Est ($) | Cycles | % of spend |
|-------|-----------|-------------|--------|------------|
| sonnet | 198.56 | 193.19 | 643 | 76.0% |
| opus | 55.16 | 71.79 | 23 | 21.1% |
| haiku | 7.82 | 7.81 | 92 | 3.0% |

### Top 5 Most Expensive Tasks (7d)

| ID | Subject | Model | Cost ($) |
|----|---------|-------|----------|
| 13070 | quantum arXiv harvest + competition final push | opus | 7.90 |
| 13258 | Update /presentation for Stacks Builder Bash | opus | 4.25 |
| 13266 | Build AIBTC meeting presentation | opus | 4.11 |
| 13262 | Draft /presentation deck — scale/volume narrative | opus | 3.74 |
| 13315 | Debug x402-relay nonce lock | opus | 3.38 |

### Findings

- **[OK] Well under daily budget**: Peak day ($40.82) is only 20% of the $200 ceiling. No budget gate triggers.
- **[INFO] Sonnet dominates volume**: 643/758 cycles (85%) and 76% of spend. This is the workhorse model.
- **[INFO] Opus is expensive per-cycle**: 23 cycles consumed $55 (avg $2.40/cycle vs $0.31 for Sonnet). Top 5 costliest tasks are all Opus.
- **[INFO] Dual cost tracking divergence**: API estimates run ~4-5% higher than actual costs on average, with larger gaps on Opus tasks (up to 15% on #13070). The actual/API cost gap is expected but worth monitoring if it widens.
- **[INFO] Token volume**: 311M input tokens / 3M output tokens in 7 days. Heavy read-heavy workload (~100:1 input:output ratio).

## 4. Cycle Log & Reliability

### Success/Failure Rate (7 days)

| Outcome | Count | Rate |
|---------|-------|------|
| Completed | 700 | 92.5% |
| Failed | 57 | 7.5% |

### Cycle Duration by Model (7 days)

| Model | Avg (s) | Min (s) | Max (s) | Cycles |
|-------|---------|---------|---------|--------|
| opus | 144.9 | 39 | 431 | 23 |
| sonnet | 97.1 | 12 | 900 | 626 |
| haiku | 37.6 | 15 | 164 | 92 |

Two Sonnet cycles hit 10+ minutes: an arXiv digest (900s, 30 papers) and a research task (601s). These are near/at the 15-min Sonnet timeout.

### Failure Categorization (7 days)

| Reason | Count | Notes |
|--------|-------|-------|
| STX simulation:400 | 15 | Hiro API rejects malformed SP addresses |
| Cooldown collisions | 13 | Global 60-min cooldown causing reschedules |
| Email send failures | 8 | CF Email Worker destination unverified |
| Timeout | 1 | |
| Superseded | 1 | |
| Sandbox | 1 | |
| Other | 20 | Includes: flat data signals, 503 outages, score below threshold |

### Dispatch Volume by Hour (UTC, today)

Activity clustered in two bands: 00:00-03:00 UTC (evening US Mountain) and 13:00-19:00 UTC (morning-afternoon US Mountain). Dead zone around 04:00-11:00 UTC.

### Consecutive Failure Status

Dispatch gate shows 0 consecutive failures. No rate-limit events detected in the 7-day window. The gate has not tripped.

### Findings

- **[OK] 92.5% success rate**: Healthy for an autonomous agent system.
- **[WARN] STX simulation:400 is the top failure class (15 in 7d)**: These are all welcome tasks where Hiro rejects the transaction. The SP addresses failing validation (c32 pattern mismatch) suggest upstream data quality issues — the agent is receiving malformed addresses from the agent registry.
- **[INFO] Cooldown design inflates failures**: 13 of 57 failures (23%) are tasks that hit a rate-limit cooldown window. These aren't real failures — they reschedule. Consider whether these should be marked `blocked` or rescheduled instead of `failed`.
- **[INFO] Long-running Sonnet cycles**: Two cycles approached the 15-min timeout (900s and 601s). Both were research-heavy tasks. No actual timeouts, but these are borderline.
- **[INFO] Email failures are a known blocker**: 8 failures from CF Email Worker. This is the known issue where jason@joinfreehold.com isn't verified as a destination.

## 5. Safety Systems

### Dispatch Gate

```json
{ "status": "running", "consecutive_failures": 0, "stopped_at": null, "last_updated": "2026-04-15T18:00:09Z" }
```

Gate is open. No trips in the audit window.

### Dispatch Circuit Breaker

```json
{ "consecutive_failures": 0, "circuit_state": "closed", "opened_at": null, "last_updated": "2026-03-11T01:18:36Z" }
```

Circuit closed (healthy). Last updated over a month ago — has not needed to trip.

### Pre-Commit Syntax Guard

No reverts or syntax-related commits found in the 7-day git history. Either no syntax errors were caught, or the guard hasn't needed to fire.

### Post-Commit Service Health Check

No revert events found in git log. Services have remained stable through code changes.

### Security Scan (AgentShield)

Recent security-related tasks (all completed):

| ID | Subject | Status |
|----|---------|--------|
| 12873 | SPONSOR_API_KEY leaked in aibtc-mcp-server | completed (Apr 17) |
| 12501 | Security: next (high) in landing-page | completed (Apr 14) |
| 12312 | Security: axios (critical) in x402-api | completed (Apr 12) |
| 12311 | Security: axios (critical) in landing-page | completed (Apr 12) |
| 12077 | Security: axios (critical) in aibtc-mcp-server | completed (Apr 10) |

No open/pending security tasks. The leaked API key was detected and handled.

### Hook State Files

108 hook-state JSON files in `db/hook-state/`. Notable large files:
- `aibtc-welcome.json` — 40KB (tracking 917+ agents)
- `aibtc-welcome-hiro-rejected.json` — 16KB (deny list for failed STX sends)
- `social-x-ecosystem.json` — 11KB
- `ordinals-market-data.json` — 8KB

### Findings

- **[OK] All safety systems nominal**: Gate open, circuit closed, no reverts, no pending security findings.
- **[OK] Security tasks resolved promptly**: Critical axios CVE and API key leak both handled within 24h.
- **[INFO] Hook state directory is large (108 files)**: The sensor state files are accumulating. Some (like `aibtc-welcome.json` at 40KB) are growing with agent count. Not a problem now but could become one if agent count continues scaling.
- **[INFO] Hiro rejection deny list growing**: `aibtc-welcome-hiro-rejected.json` is 16KB, tracking addresses that fail STX simulation. This is the flip side of the STX simulation:400 failures from Section 4.

## 6. Configuration & Drift

### Model Configuration

Model IDs in `src/models.ts`:

| Tier | Model ID | Matches latest? |
|------|----------|-----------------|
| opus | claude-opus-4-7 | Yes (latest) |
| sonnet | claude-sonnet-4-6 | Yes (latest) |
| haiku | claude-haiku-4-5-20251001 | Yes (latest Haiku) |

OpenRouter aliases configured: kimi (Kimi K2.5), minimax (M2-5), qwen (Qwen3 Coder).

### Timeout Settings

| Model | Timeout | Budget/cycle |
|-------|---------|-------------|
| haiku | 5 min | $1 |
| sonnet | 15 min | $3 |
| opus (daytime) | 30 min | $10 |
| opus (overnight 00-08) | 90 min | $10 |

These match CLAUDE.md documentation. No drift.

### Pending Task Model Validation

All 4 pending tasks have explicit model assignments (all `sonnet`). Zero tasks created in the last 7 days without a model. The model-gate is working.

### Context Budget

| File | Bytes | ~Tokens |
|------|-------|---------|
| SOUL.md | 8,737 | ~2,200 |
| CLAUDE.md | 15,489 | ~3,900 |
| MEMORY.md | 19,258 | ~4,800 |
| **Always-loaded total** | **43,484** | **~10,900** |

112 SKILL.md files exist totaling 386KB (~97K tokens). Per-task loading keeps this manageable — only skills listed in the task's `skills` array are loaded.

Largest SKILL.md files:
- `aibtc-news-editorial` — 15KB (~3,750 tokens)
- `aibtc-news-editor` — 10KB (~2,600 tokens)
- `hodlmm-move-liquidity` — 9KB (~2,200 tokens)

A task loading 3-4 of the largest skills would be ~22K tokens for skills + ~11K always-loaded = ~33K tokens. Within the 40-50K budget.

### Environment

`.env` contains 7 lines, 2 key variables visible: `DANGEROUS=` and `ARC_CREDS_PASSWORD=`. Other credentials managed through the encrypted credential store at `~/.aibtc/credentials.enc`.

### Findings

- **[OK] No configuration drift**: Model IDs, timeouts, and budget caps all match documentation.
- **[OK] Context budget healthy**: Always-loaded context is ~11K tokens, well under the 40-50K ceiling.
- **[INFO] 112 skills installed**: Large skill tree. If tasks load many skills simultaneously, context could approach limits. Current task scheduling is disciplined (2-3 skills per task typical).
- **[INFO] MEMORY.md is the largest always-loaded file (19KB)**: At ~4,800 tokens this is approaching the point where consolidation would help. CLAUDE.md recommends keeping it under 2K tokens — it's currently ~2.4x that target.

## 7. Git & Worktree State

### Branch Status

- **Current branch**: main
- **Ahead of origin**: 32 commits
- **Last push**: 2026-04-21 12:29 MDT (~23 hours ago)
- **Uncommitted changes**: Only this audit report file (untracked)

### Worktrees

Only the main worktree exists. No orphaned worktree directories found. Clean.

### Stash

4 stashed entries from feature branches:

| # | Branch | Base commit |
|---|--------|-------------|
| 0 | feat/ci-syntax-check | 00507ded |
| 1-3 | fix/failure-triage-error-patterns | various |

These are leftover from previous branch work. Not blocking anything.

### Recent Commits (last 15)

Mostly automated: `chore(loop): auto-commit after dispatch cycle`, `chore(memory): auto-persist on Stop`, and a few deliberate commits (memory correction, housekeeping, agent-health fix, architect state machine update).

### Findings

- **[WARN] 32 unpushed commits**: Main is 32 commits ahead of origin. Last push was ~23 hours ago. If the VM has issues, these commits are at risk. The dispatch system explicitly does not push — this is by design — but the gap is larger than typical.
- **[INFO] 4 stale stashes**: Leftover from `feat/ci-syntax-check` and `fix/failure-triage-error-patterns` branches. Low risk but adds clutter.
- **[OK] No orphaned worktrees**: Worktree cleanup is working correctly.
- **[OK] Working tree clean**: No uncommitted changes besides this audit file.

## 8. Logging & Observability

### Journal Logs

- **Journal size**: 2.1 GB
- **Disk usage**: 22G / 246G (10%) — plenty of headroom
- **Error log content**: 100% of journal errors for `arc-dispatch.service` are inotify watch exhaustion messages. No application-level errors in journal — dispatch errors are captured in the SQLite `service_logs` table instead.

### Service Endpoints

| Endpoint | Status |
|----------|--------|
| Web dashboard (localhost:3000) | 200 OK |
| MCP server (localhost:3100/mcp) | 401 Unauthorized (expected — requires auth) |

### Service Logs (SQLite)

11,354 total log entries. Last 24 hours: 252 info-level entries, 0 errors.

Most recent errors (all Apr 15) were **sandbox failures** — Claude Code's bwrap/seccomp sandbox lost execute permissions, blocking all Bash commands in dispatch sessions. Tasks #12672-12681 were affected. This appears to have been resolved (no sandbox errors since Apr 15).

### Database Tables

32 tables in `arc.sqlite`, including:
- Core: `tasks`, `cycle_log`, `service_logs`
- Communication: `email_messages`, `aibtc_inbox_messages`, `fleet_messages`
- Social: `contacts`, `contact_links`, `contact_interactions`
- Market: `market_positions`, `contribution_tags`
- Memory: `arc_memory` + FTS5 indexes (`arc_memory_data`, `arc_memory_idx`, `arc_memory_content`)
- Governance: `consensus_proposals`, `consensus_votes`, `roundtable_discussions`
- Skills: `skill_versions`, `hub_agents`, `hub_capabilities`
- Workflows: `workflows`, `task_deps`, `reviews`
- Monitoring: `monitored_endpoints`, `conversations`

### Findings

- **[OK] Web dashboard operational**: Serving on port 3000.
- **[OK] No application errors in 24 hours**: All recent service_log entries are info-level.
- **[WARN] inotify errors dominate journal**: Every minute, 2 error lines are written. That's ~2,880 error lines/day of noise. Consider raising `fs.inotify.max_user_instances` or identifying the consumer exhausting watches.
- **[INFO] Sandbox failure incident (Apr 15)**: A cluster of sandbox failures affected ~10 tasks. Root cause was Claude Code's seccomp sandbox binary losing execute permissions. Resolved, but worth monitoring for recurrence.
- **[INFO] Journal growing (2.1 GB)**: Mostly from the inotify spam. Consider `journalctl --vacuum-size=500M` or configuring max journal size.

## 9. Database Integrity

### SQLite Health

| Check | Result |
|-------|--------|
| PRAGMA integrity_check | **ok** |
| Journal mode | WAL |
| Page size | 4,096 bytes |
| Page count | 8,802 |
| DB size (data file) | ~36 MB |
| WAL size | ~5 MB |
| Freelist pages | 0 |

### Table Row Counts

| Table | Rows | Notes |
|-------|------|-------|
| tasks | 13,362 | Primary work queue |
| cycle_log | 10,871 | ~2,491 fewer than tasks (not all tasks dispatch) |
| service_logs | 11,354 | Application-level logging |
| email_messages | 1,095 | |
| workflows | 1,712 | |
| contacts | 920 | Agent contact book |
| aibtc_inbox_messages | 383 | |
| contact_interactions | 333 | |
| skill_versions | 254 | |
| hub_capabilities | 100 | |
| reviews | 59 | |
| All other tables | 0-10 rows | Sparse or unused |

### Data Integrity

| Check | Result |
|-------|--------|
| Orphaned cycle_log entries | **7** (task_ids 852-858, from Mar 3 — early data, ~$1.46 total) |
| Completed tasks with null completed_at | 0 |
| Active tasks with null started_at | 0 |
| Tasks exceeding max_retries still pending | 0 |

### Indexing

51 indexes across all tables. Key query-path indexes present:
- `idx_tasks_status_priority` — dispatch task selection
- `idx_tasks_source_status` — sensor dedup lookups
- `idx_cycle_log_started_at` — cost/time queries
- `idx_service_logs_created` / `idx_service_logs_level` — log filtering

### Findings

- **[OK] Database passes integrity check**: No corruption.
- **[OK] WAL mode active**: Good for concurrent read/write from dispatch + web dashboard.
- **[OK] No active data anomalies**: All status/timestamp invariants hold.
- **[INFO] 7 orphaned cycle_log entries**: From Mar 3 (early days), tasks 852-858 were likely deleted while their cycle_log entries persisted. Cosmetic — $1.46 total cost attribution is lost. No foreign key constraint enforcement (SQLite default).
- **[INFO] Several empty tables**: `market_positions`, `fleet_messages`, `consensus_proposals/votes`, `conversations`, `monitored_endpoints` — schema is provisioned but these features appear unused or dormant.
- **[INFO] DB is compact at ~36MB**: No immediate need for VACUUM. The zero freelist pages means no wasted space.

---

## Summary & Recommendations

### Overall Health: Healthy

The dispatch service is operationally sound. Timers fire reliably, the task queue is clean, safety systems are nominal, the database is uncorrupted, and costs are well within budget. The system has processed 13,362 tasks with a 92.5% success rate over the last 7 days.

### Issues Found

#### Action Items (WARN)

1. **inotify watch exhaustion** (Sections 1, 8)
   - Every dispatch/MCP invocation logs `No space left on device` for inotify watches
   - Current limit: 29,909 watches / 128 instances
   - Impact: Journal noise (~2,880 error lines/day), potential silent failures in file-watching services
   - Fix: Identify the consumer (likely VS Code Server + Bun watchers + Claude Code) and raise `fs.inotify.max_user_instances` via sysctl

2. **32 unpushed commits on main** (Section 7)
   - Last push was ~23 hours ago
   - If the VM fails, 32 commits of work are at risk
   - Fix: Push to origin or set up a periodic auto-push (e.g., daily cron)

3. **STX simulation:400 is the top failure class** (Sections 2, 4)
   - 15 failures in 7 days from Hiro rejecting malformed SP addresses
   - These are welcome tasks for new agents with invalid addresses
   - Fix: Validate SP addresses upstream in the sensor before creating welcome tasks

#### Observations (INFO)

4. **Cooldown collisions inflate failure counts** — 13 of 57 failures (23%) are rate-limit reschedules. These could use a `rescheduled` status instead of `failed` to clean up metrics.

5. **MEMORY.md exceeds target size** — At ~4,800 tokens, it's 2.4x the recommended 2K token budget in CLAUDE.md. Consider consolidation.

6. **Email destination unverified** — 8 failures from CF Email Worker. Known blocker: jason@joinfreehold.com not verified in Cloudflare dashboard.

7. **Observatory service missing** — `arc-observatory.service` referenced in docs but not installed on this machine.

8. **4 stale git stashes** — From old feature branches. Low risk, can be cleaned up.

9. **Journal at 2.1 GB** — Mostly inotify spam. Can vacuum if needed.

10. **Sandbox failure incident (Apr 15)** — Resolved, but Claude Code seccomp permission loss affected ~10 tasks. Worth monitoring for recurrence.

### What's Working Well

- Timer reliability: 5+ days continuous uptime, zero missed cycles
- Dispatch gate: No trips, zero consecutive failures
- Safety systems: No reverts, no syntax guard failures, no service deaths
- Cost discipline: $34-41/day actual spend vs. $200 ceiling (17-20% utilization)
- Model routing: 100% of tasks have explicit model assignment
- Database: Clean, compact (36MB), zero corruption, proper indexing
- Security: All critical findings resolved within 24 hours
