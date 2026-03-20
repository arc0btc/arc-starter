## 2026-03-20T19:10:00.000Z

**Diff range:** 8191198 → e990c462 | Sensors: 88 (1 disabled) | Skills: 121

### Step 1 — Requirements

- **ARC-0000 proposal process**: Traces to ARC-0100 v7 reorg need and lessons from v6 audit. Governance layer before major structural changes is proportionate. Scope is tight: only core system changes require ARCs; routine skills/fixes exempt. Requirement valid.
- **ARC-0100 v7 repo reorg**: Traces to v6 audit (1/5 rating on org, 121 skills, ghost skills at 13%). Draft status is correct — formalized intent with open questions (engine defaults, migration protocol, proposal home post-split). No premature action.
- **ARC-0003 DB migration protocol**: Traces to existing inline `addColumn()` pattern and 11+ table schema complexity. 3-phase template (prep, execute, integrity) is proportionate to the risk. Valid.
- **arc-workflows state machines**: Traces to task #7709 (CeoReview, WorkflowReview, ComplianceReview). Dependency-free runner (~70 lines) for orchestrating multi-step workflows without hardcoded task chains. Valid — emerging pattern made explicit.
- **db/skill-proposals/ directory**: Traces to maximumsats-wot community proposal. Clean separation from live skills. Requirement valid.

### Step 2 — Delete Candidates

- **[CARRYOVER ×3, P8]** `skills/github-issues/sensor.ts` — disabled sensor still exists, still inflating count (3 audit cycles flagged). Concrete task needed, not just a flag. Creating task now.
- **[INFO]** `effort` frontmatter on 36 skills — still unconsumed by dispatch. Third cycle flagging this. Either wire it or strip it. No urgent action.
- **[INFO]** v6 audit delete recommendations (old-arc0btc-v4-skills, 11 fleet skills, fleet-web.ts, ssh.ts) remain unexecuted. ARC-0100 formalizes the intent but execution is gated on the 5-quest plan. Acceptable holding pattern.

### Step 3 — Simplify

- **ARC proposal process is appropriately minimal**: ARC-0000 is 105 lines, template is simple frontmatter + sections. No bureaucratic overhead. Good.
- **arc-workflows state machine runner is minimal** (~70 lines, zero deps). The pattern: `evaluateWorkflow(workflow, template) → WorkflowAction` is clean. New state machines compose without adding code to the runner.
- **DB migration protocol template is thorough but justified**: 253 lines, 3 phases, auto-rollback. The complexity matches the risk of schema changes at 11+ tables and 455 tasks/day throughput. Appropriate.

### Step 4 — Accelerate

- **No bottlenecks introduced.** ARC proposals are async process (no dispatch impact). State machines evaluate synchronously — no timeout risk.
- **arc-workflows state machines could reduce task chaining latency**: Instead of spawning N sequential tasks for CEO/compliance review workflows, the state machine can auto-advance states in one dispatch cycle. Potential cycle-time improvement if adopted broadly.

### Step 5 — Automate

- **ARC proposal review sensor**: Could auto-detect when a proposal transitions Draft→Final and create a review task. Not yet implemented. Low priority but clear path.
- **DB migration protocol automation**: A sensor could scan for pending migration scripts and auto-queue prep phase. Not urgent — migrations are rare.
- **Nothing premature recommended.** Current additions are all correct V1 scope.

### Flags

- **[ACTION, P8]** Delete `skills/github-issues/sensor.ts` — 3rd carryover. Creating task this cycle.
- **[ACTION, P7]** Archived audit-log.md entries from 2026-03-12 and older → `archive/audit-log-2026-03-12-and-older.md`. File now within 5-entry policy.
- **[OK]** ARC proposal process is live. ARC-0100 formalizes v7 reorg intent. Execution gated on 5-quest plan.
- **[OK]** arc-workflows state machine runner is minimal and extensible. New machines compose cleanly.
- **[OK]** DB migration protocol provides safe path for future schema changes.

---

## 2026-03-20T07:10:00.000Z

**Diff range:** ea9d04c → 8191198 | Sensors: 88 (1 disabled) | Skills: 121

### Step 1 — Requirements

- **Landing-page gate**: Traces to retrospective (tasks #7432/#7451 leaking past gate, wasting Sonnet budget). Fix is proportionate — regex gate in dispatch.ts auto-closes before subprocess. Requirement satisfied.
- **ordinals-market-data sensor**: Traces to $100K competition prep (task #7684, task #7689). Competition runs 2026-03-23 to 2026-04-22. Diversifying signal data sources is the right strategy. Requirement valid.
- **arc-bounty-scanner**: Traces to task #7595 (post-MCP v1.41.0 integration review). D1 revenue opportunity detection. Valid.
- **defi-bitflow tuning**: Threshold 5%→15%, rate 240→720min. Traces to task #7687 — 8/10 recent signals were identical sBTC/STX volatility. Fix is proportionate; reduces slot-burning duplicate signals.
- **`effort` frontmatter on 36 skills**: Origin unclear — not consumed by dispatch.ts. Documentation value only. Acceptable V1 but should be noted as unused metadata.

### Step 2 — Delete Candidates

- **[CARRYOVER, P8]** `skills/github-issues/sensor.ts` — disabled sensor still inflating count. Still not deleted. Create task.
- **`effort` frontmatter not consumed by dispatch.ts** — 36 skills have it, none of them benefit from it yet. Either wire it into model routing or remove it to reduce SKILL.md noise.
- **audit-log.md is 865+ lines** — exceeds max 5 active entries policy. Housekeeping should archive this file. Lines 80+ should move to archive/.

### Step 3 — Simplify

- **Landing-page gate placement is correct** — fires after lock check, before GitHub gate, before LLM. Cost savings confirmed.
- **arc-cost-reporting 60min→1440min** is correct. Daily cost reports are sufficient; hourly was generating noise with no actionable delta.
- **ordinals-market-data categories** (inscriptions, BRC-20, NFT floors, fee market) are distinct signals — no overlap between them. Good decomposition.
- **github-mentions dedup improvement** — PR review dedup now prevents re-engagement on already-completed reviews. Pattern consistent with github-issue-monitor "any" dedup.

### Step 4 — Accelerate

- **No bottlenecks introduced.** Landing-page gate is a fast regex check. New sensors add parallel paths.
- **defi-bitflow rate limit increase** reduces queue pressure during competition window.

### Step 5 — Automate

- **`effort` frontmatter → model routing**: If dispatch.ts read `effort: high` and mapped it to Opus tier, it would provide per-skill model guidance beyond just priority. Low priority but clear automation path.
- **Nothing premature recommended.**

### Flags

- **[ACTION, P8]** Delete `skills/github-issues/sensor.ts` — dead disabled sensor, inflating count. Carryover from prior audit.
- **[INFO]** `effort` frontmatter on 36 skills is unused. Wire into dispatch or document as human-readable-only. No urgency.
- **[OK]** Landing-page gate deployed and verified (2026-03-20 retrospec confirms pattern working).
- **[OK]** ordinals-market-data live ahead of competition start (2026-03-23). Data pipeline established.

---

## 2026-03-19T20:15:00.000Z

**Diff range:** e930cf6 → ea9d04c | Sensors: 86 (1 disabled) | Skills: 119

### Step 1 — Requirements

- **Quality tracking** (result_quality, getQualityStats): Traces to D3 (stack reliability) + dispatch-evals work. Valid — creates a data signal for self-improvement. Currently no automated action on low scores; that's a gap but acceptable for V1.
- **github-issues disable**: Correct. Two sensors doing the same job with different source keys caused race-condition duplication. Option B consolidation (whoabuddy approved). Requirement satisfied by github-issue-monitor.
- **Automated PR skip**: Traces to whoabuddy feedback (PR spam). Valid. 28% of reviewed PRs were automated. Fix is proportionate.

### Step 2 — Delete Candidates

- **`github-issues/sensor.ts`**: File exists but returns "skip" immediately. It's dead code. Should be deleted or the directory marked DISABLED. Leaving a disabled sensor file in the sensor tree causes confusion (sensor count shows 86 but 85 actually run). **Recommendation: delete `github-issues/sensor.ts` or add `// @disabled` guard that makes it skip at top-level with a comment.**
- **`arc-dispatch-eval` vs `arc-dispatch-evals`** (carryover): Still overlapping. Both still exist. Not urgent but worth documenting clearly.
- **Signal backlog (4 stale "Ordinals Business" tasks)**: CEO review killed them. Good.

### Step 3 — Simplify

- **Quality signal has no downstream consumer yet.** `getQualityStats()` surfaces in `arc status` but no sensor reads it and no automated task is spawned for low-quality patterns. V1 acceptable. V2 candidate: sensor that detects quality drop (7d avg < 3) and creates strategy review task.
- **GitHub source key canonicalization is good.** `issue:{repo}#{number}` shared across github-issue-monitor and github-mentions eliminates the race condition cleanly. No further simplification needed.
- **4h lookback on github-issue-monitor**: Tighter window reduces volume. Risk: issues updated exactly on the 4h boundary could be missed if sensor fires late. Low probability but worth noting.

### Step 4 — Accelerate

- **No bottlenecks introduced.** Quality write is a single SQLite update. PR skip is a regex check before any network call.
- **github-issues disable saves ~15 duplicate tasks/day** (estimated). Reduces dispatch queue pressure.

### Step 5 — Automate

- **Quality-driven model routing**: If historical quality for a task category is low, auto-escalate priority to get a higher model tier. Future automation candidate (needs 30+ quality data points first).
- **Nothing premature recommended.**

### Flags

- **[ACTION]** Delete or clearly disable `skills/github-issues/sensor.ts` — dead sensor file inflating count. Low urgency (P8).
- **[WATCH]** Quality tracking has no feedback loop yet. Create follow-up when 30+ quality ratings exist.
- **[OK]** GitHub consolidation complete. PR spam fixed. Diagram updated.

---

## 2026-03-19T00:12:00.000Z

**Diff range:** 88f0fe3 → ed8eae3 | Sensors: 74 → 85 | Skills: 108 → 119

### Step 1 — Requirements

- All new skills (monitoring, nostr-wot, fleet-handoff, jingswap, defi-compounding, erc8004-indexer) trace to v6 roadmap tasks. Requirements valid.
- `DAILY_BUDGET_USD = 500` in dispatch.ts but D4 cap is $200/day. The constant controls *task gating* (only P3+ blocked above $500), not the directive. D4 is a personal directive, not enforced in code. However, D4 was breached ($272 on 2026-03-18) — cost monitoring is reactive, not proactive.

### Step 2 — Delete Candidates

- **[RESOLVED ✓ 2026-03-19]** `nostr-wot` and `maximumsats-wot` both wrap MaximumSats API. **Investigation complete:** Deleted `maximumsats-wot` as redundant (subset of nostr-wot + broken check-agent + no free tier fallback). Kept `maximumsats` (offers predict/trust-path) + `nostr-wot` (best fallback strategy). See memory/wot_consolidation.md for analysis.
- **[OVERLAP]** `arc-dispatch-eval` (sensor, auto-scores task outcomes) and `arc-dispatch-evals` (CLI, LLM judge quality evaluation) have overlapping domains. The distinction is sensor-driven vs CLI-driven — acceptable, but should be documented clearly in each SKILL.md.
- **[STALE? 2026-03-19]** `maximumsats` (parent skill) vs `maximumsats-wot` — Confirmed: `maximumsats` has unique features (predict, trust-path). Not redundant. Kept both.

### Step 3 — Simplify

- **Context delivery is sound.** SOUL.md + CLAUDE.md + MEMORY.md (always) + per-task SKILL.md (on-demand) keeps prompt lean. Fleet knowledge loader adds relevant entries by topic match — good.
- **Retrospective gate tightened.** Previously spawning ~17/day. Now P1 or cost>$1 — correct fix.
- **24h dedup window for github-issues** — correct fix for reactive volume. Pattern should be applied to other high-volume sensors (aibtc-welcome, agent-hub) that flagged "no dedup" in prior audit.

### Step 4 — Accelerate

- **Sensor count at 85.** All run in parallel via Promise.allSettled — no bottleneck here.
- **github-issues dedup** reduces task queue pressure. Same pattern needed for: `agent-hub`, `aibtc-welcome`, `arc-blocked-review`, `arc-ops-review`, `arc-reporting`, `arc-reputation`, `arc0btc-pr-review`, `arc0btc-security-audit`, `auto-queue`, `blog-publishing`, `compliance-review`, `context-review`, `defi-compounding`, `erc8004-reputation`, `fleet-comms`, and others (per prior 2026-03-18 audit). High-volume sensors without dedup are still a D4 cost risk.

### Step 5 — Automate

- D4 cap enforcement is manual (monitoring). Consider: dispatch pre-flight gate that checks `getTodayCostUsd()` and scales down model tier (Opus→Sonnet) at $150 rather than only blocking tasks at $500. This would automatically soften cost curve without operator intervention.

### Follow-up Tasks Created

- ✓ RESOLVED: Investigate nostr-wot vs maximumsats-wot consolidation (2026-03-19, task #7228)
- Apply 24h dedup pattern to remaining high-volume sensors (WARN - ongoing)
- Consider automatic model downgrade at $150/day D4 cost gate (INFO)

---

## 2026-03-18T23:38:51.564Z

33 finding(s): 2 error, 27 warn, 4 info

- **WARN** [sensor:agent-hub] agent-hub/sensor.ts has no dedup check
- **WARN** [sensor:aibtc-welcome] aibtc-welcome/sensor.ts has no dedup check
- **WARN** [sensor:arc-blocked-review] arc-blocked-review/sensor.ts has no dedup check
- **ERROR** [skill:arc-opensource] arc-opensource/SKILL.md missing frontmatter
- **INFO** [cli:arc-opensource] arc-opensource/cli.ts has no help/usage text
- **WARN** [sensor:arc-ops-review] arc-ops-review/sensor.ts has no dedup check
- **WARN** [sensor:arc-reporting] arc-reporting/sensor.ts has no dedup check
- **WARN** [sensor:arc-reputation] arc-reputation/sensor.ts has no dedup check
- **ERROR** [skill:arc-strategy-review] arc-strategy-review/SKILL.md missing frontmatter
- **WARN** [sensor:arc0btc-pr-review] arc0btc-pr-review/sensor.ts has no dedup check
- **WARN** [sensor:arc0btc-security-audit] arc0btc-security-audit/sensor.ts has no dedup check
- **WARN** [sensor:auto-queue] auto-queue/sensor.ts has no dedup check
- **WARN** [sensor:blog-publishing] blog-publishing/sensor.ts has no dedup check
- **INFO** [skill:claude-code-releases] claude-code-releases has AGENT.md but no sensor/cli — verify it's referenced by other skills
- **WARN** [sensor:compliance-review] compliance-review/sensor.ts has no dedup check
- **WARN** [sensor:context-review] context-review/sensor.ts has no dedup check
- **WARN** [sensor:defi-compounding] defi-compounding/sensor.ts has no dedup check
- **INFO** [skill:dev-landing-page-review] dev-landing-page-review has AGENT.md but no sensor/cli — verify it's referenced by other skills
- **WARN** [sensor:erc8004-reputation] erc8004-reputation/sensor.ts has no dedup check
- **WARN** [sensor:fleet-comms] fleet-comms/sensor.ts has no dedup check
- **WARN** [sensor:fleet-dashboard] fleet-dashboard/sensor.ts has no dedup check
- **INFO** [cli:fleet-handoff] fleet-handoff/cli.ts has no help/usage text
- **WARN** [sensor:fleet-health] fleet-health/sensor.ts has no dedup check
- **WARN** [sensor:fleet-memory] fleet-memory/sensor.ts has no dedup check
- **WARN** [sensor:fleet-sync] fleet-sync/sensor.ts has no dedup check
- **WARN** [sensor:github-ci-status] github-ci-status/sensor.ts has no dedup check
- **WARN** [sensor:github-interceptor] github-interceptor/sensor.ts has no dedup check
- **WARN** [sensor:identity-guard] identity-guard/sensor.ts has no dedup check
- **WARN** [sensor:social-agent-engagement] social-agent-engagement/sensor.ts has no dedup check
- **WARN** [sensor:social-x-ecosystem] social-x-ecosystem/sensor.ts has no dedup check
- **WARN** [sensor:social-x-posting] social-x-posting/sensor.ts has no dedup check
- **WARN** [sensor:worker-logs-monitor] worker-logs-monitor/sensor.ts has no dedup check
- **WARN** [memory] MEMORY.md is ~2181 tokens (78 lines) — consider consolidation

---
