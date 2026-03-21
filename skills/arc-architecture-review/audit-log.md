## 2026-03-21T19:10:00.000Z

**Diff range:** 8a8c5c9 → 0444a19 | Sensors: 88 (1 disabled: aibtc-welcome) | Skills: 122

### Step 1 — Requirements

- **`effort` frontmatter removal**: Traces to 4-cycle carryover (36 skills, never consumed by dispatch.ts). Removal clean — no dispatch changes needed. **Requirement satisfied.**
- **aibtc-welcome self-healing**: Traces to task #7908 (sentinel cleared) and task #7914 (circuit breaker latch bug fix). `isRelayHealthy()` function correctly checks relay /health + nonce pool before honoring sentinel. Requirement valid.
- **aibtc-welcome full disable (line 121)**: Traces to human directive — "task flood." Root cause of flood not embedded in the commit or sensor comments. Disable is blunt instrument; rework needed before re-enabling.
- **ordinals-market-data zero-guard**: Traces to Unisat occasionally returning 0 recent inscriptions (confirmed via #7749 magiceden follow-through). Prevents empty signal submission. Requirement valid.
- **ordinals-market-data source swap (magiceden → unisat)**: Traces to task #7863 (watch report flag: 2 consecutive failures). magiceden.io unreachable confirmed. Requirement satisfied.
- **arc-workflow-review `patternAlreadyModeled()`**: Traces to task #7794 (validated: all patterns covered by existing state machines). Function prevents re-generating design tasks for already-modeled patterns. Requirement valid.
- **email thread sent messages**: Traces to task #7998 (web fix). `getEmailThread()` now returns both inbox + sent messages for two-way conversation view. Requirement valid.

### Step 2 — Delete

- **[NEW, P8]** `skills/defi-compounding/compounding-state.json` is tracked in git but is a runtime state file (`lastChecked`, empty pools). Should be gitignored like `skills/*/pool-state.json`. Needs `.gitignore` entry + `git rm --cached`. Creating task.
- **[OK]** `effort` frontmatter — REMOVED from all 36 skills. 4-cycle carryover **closed**.
- **[INFO]** `aibtc-welcome/sensor.ts` self-healing code (`isRelayHealthy()`) is dead while sensor is disabled. When rework executes, preserve it — the logic is correct.

### Step 3 — Simplify

- **`patternAlreadyModeled()` is correct abstraction**: Pure TypeScript, no subprocess, ~35 lines. Derives 2-3 name candidates per pattern key and calls `getTemplateByName()`. Clean.
- **aibtc-welcome disable is the right short-term move**: A broken sensor that floods the queue is worse than no sensor. The disable-and-rework pattern is correct. But the rework task should be created now, not deferred.
- **Jingswap `res → response` rename**: Cosmetic, correct. No structural change.

### Step 4 — Accelerate

- **ordinals-market-data zero-guard** saves ~1 failed Sonnet task per Unisat zero-count event. Small but zero-cost fix.
- **arc-workflow-review template check** prevents redundant P5-7 workflow design tasks. Keeps queue cleaner pre-competition.
- **No new bottlenecks introduced.**

### Step 5 — Automate

- **aibtc-welcome rework**: After identifying flood root cause, the sensor should be re-enabled with a per-run cap (e.g., max 5 welcome tasks per sensor cycle). This would prevent floods while maintaining automation.
- **`compounding-state.json` gitignore**: Should be automated — extend gitignore pattern from `skills/*/pool-state.json` to `skills/*/compounding-state.json` (or more broadly `skills/*/*-state.json`).

### Flags

- **[RESOLVED ✓]** `effort` frontmatter on 36 skills — removed. 4-cycle carryover closed.
- **[ACTION, P4]** aibtc-welcome flood root cause — diagnose and rework plan. Self-healing code is good; flood mechanism unknown. Create task.
- **[ACTION, P8]** `skills/defi-compounding/compounding-state.json` tracked in git. Gitignore + untrack.
- **[WATCH]** aibtc-welcome `isRelayHealthy()` — dead while disabled. Preserve when re-enabling.
- **[OK]** ordinals-market-data source fixes deployed ahead of competition (2026-03-23).
- **[OK]** arc-workflow-review template dedup working.

---

## 2026-03-21T07:20:00.000Z

**Diff range:** 5dfbe84 → 8a8c5c9 | Sensors: 88 (0 disabled) | Skills: 122

### Step 1 — Requirements

- **`isDailySignalCapHit()` in db.ts**: Traces to task #7806 (retrospective: 3/6 failures were daily-cap hits, sensors queuing tasks without checking first). DB-level shared function prevents each sensor from duplicating the query. Gate applied to 5 sensors. Requirement valid and proportionate.
- **`nostr-wot/trust-gate.ts`**: Traces to task #7793 (nostr-wot integration into DeFi/payment flows). Shared helper prevents subprocess logic copy-paste across fleet-handoff, arc-payments, defi-bitflow. Requirement valid.
- **`arc-self-review` sensor**: Traces to arc-workflows state machine work. Backs daily health-check with a formal workflow lifecycle instead of one-off task creation. 360-min cadence provides daily coverage without double-firing. Requirement valid.
- **`fleet-handoff --pubkey --force`**: Traces to nostr-wot trust integration. WoT verification before routing tasks to non-Arc agents is a safety gate. `--force` provides explicit override path. Requirement valid.
- **Classifieds status + `check-classified-status`**: Traces to aibtcdev/agent-news#144 (review flow added). `pending_review|approved|rejected` lifecycle. Without `check-classified-status`, Arc had no visibility into whether a posted ad was live or stuck in review. Requirement valid.
- **Runtime state files gitignored**: Traces to task #7823. Cache/state JSON files don't belong in git history — they're runtime artifacts, not configuration. Requirement valid. Pattern documented in `memory/shared/entries/arc-runtime-state-gitignore.md`.
- **context-review false positive reduction**: Traces to `fix(context-review): reduce false positives`. Arc-blocked-review source exclusion and "market data" keyword removal prevent context-review from generating meta-tasks for its own domain. Requirement valid.

### Step 2 — Delete

- **[RESOLVED ✓]** `skills/github-issues/sensor.ts` — finally deleted (`refactor(github-issues): remove disabled dead sensor`, commit 48f8a8d9). 4-cycle carryover closed. Sensor count now correctly 88 (0 disabled).
- **[CARRYOVER ×4, last flag]** `effort` frontmatter on ~36 skills — still not consumed by dispatch.ts. Wire it into model routing or remove it. Creating task this cycle to force resolution.
- **[NEW]** `skills/bitflow/pool-state.json` was in the diff but is now gitignored via `skills/*/pool-state.json`. Verify the file is not tracked in git (if it was committed, it needs to be removed from tracking).

### Step 3 — Simplify

- **`isDailySignalCapHit()` is the correct abstraction**: Single 2-line query, shared across 5 sensors. Alternative (per-sensor count query) would have been duplicated 5× with risk of divergence. Good.
- **`trust-gate.ts` subprocess pattern**: Each call spawns a nostr-wot CLI subprocess. For now (low frequency), this is fine. If WoT checks scale to per-payment volume, consider a local trust cache (TTL-based in-memory or hook-state JSON) to avoid subprocess overhead.
- **`arc-self-review` sensor delegates correctly**: 35 lines, creates a workflow instance, returns. The arc-workflows meta-sensor does the state evaluation and task creation. No logic duplication. Good.
- **Classifieds dedup uses 2 API calls** (marketplace + agent-scoped) instead of 1. This is correct for the new 3-state model — single endpoint no longer captures the full picture. Complexity is justified by correctness.

### Step 4 — Accelerate

- **isDailySignalCapHit() eliminates false-failure task overhead**: Estimated savings ~3 × $0.20/task per day = $0.60/day (Sonnet cost on sensor-queued tasks that fail immediately). Error rate drops from 6 failures/window to 0 for this class.
- **aibtc-inbox-sync workflow tracking adds one DB write per thread**: Previously a simple 24h dedup check. The added write is low-cost but should be monitored if inbox volume scales. Workflow instances persist in DB — watch for `workflows` table growth over time.
- **No new dispatch bottlenecks introduced.**

### Step 5 — Automate

- **`trust-gate.ts` subprocess** — if WoT check frequency increases (e.g., per-payment), auto-cache trust decisions per pubkey with 1h TTL. Not urgent at current volume.
- **`effort` frontmatter → model routing**: If dispatch reads `effort: high` and maps to Opus tier regardless of priority, per-skill model guidance becomes automatic. 4 cycles flagged; time to act.
- **Nothing premature recommended.**

### Flags

- **[RESOLVED ✓]** github-issues disabled sensor deleted. 4-cycle carryover closed.
- **[ACTION, P8]** `effort` frontmatter on ~36 skills: wire into dispatch.ts model routing OR strip from all SKILL.md files. 4th cycle — creating task this cycle.
- **[WATCH]** `aibtc-inbox-sync` workflow tracking: DB writes per thread. Monitor workflows table growth; archive old instances if needed.
- **[OK]** `isDailySignalCapHit()` gates 5 sensors. Daily-cap false-failure class eliminated.
- **[OK]** `nostr-wot/trust-gate.ts` shared helper wired into fleet-handoff and DeFi/payment flows.
- **[OK]** Runtime state files gitignored. Pattern memorialized.

---

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

*(2026-03-19T00:12Z entry archived to archive/audit-log-2026-03-12-and-older.md)*
