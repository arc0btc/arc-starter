## 2026-03-23T07:15:00.000Z — explicit model gate + sensor model fixes

**Task #8331** | Diff: 8bc2945 → 669d781 | Sensors: 80 (0 disabled) | Skills: 113

### Step 1 — Requirements

- **Dispatch model routing removal (451c438d)**: Traces to architecture principle "priority and model are independent." The implicit priority→model fallback was creating a false sense that tasks without a model field were valid. Removing it forces every sensor and task creator to be explicit. The 4 immediate sensor failures (b0945b0d) confirm the requirement was valid — the fallback was masking incomplete task definitions. Clean enforcement.
- **4 sensor model field fixes (b0945b0d)**: Direct consequence of 451c438d. github-release-watcher, arc-opensource, arc-ops-review, arc-memory were all relying on implicit routing. All now carry explicit model. Requirement satisfied.
- **ordinals-market-data cooldown pre-check (580003b6)**: Traces to task #8259 (action from 2026-03-22 audit: "Cooldown pre-check in sensors"). Pre-check pattern now applied. Requirement satisfied.
- **aibtc-welcome relay hardening (2b3b2397)**: isRelayHealthy() was re-triggering the self-heal loop on certain conditions. Hardened to break the cycle. Requirement valid.

### Step 2 — Delete

- **[INFO]** No new candidates. Skill count stable at 113. 9 replace-with-upstream skills still pending — acceptable hold while fleet is partially down.
- **[WATCH]** Dispatch model gate creates a new failure mode: tasks from sensors that still lack `model` field will fail on first dispatch cycle. Check arc-monitoring-service sensor — it was added on this branch (`feat/monitoring-service`) and may have been created before the model-required convention was enforced.

### Step 3 — Simplify

- **Model gate is the right abstraction**: `selectModel()` returning `null` + a rejection guard at dispatch is cleaner than the previous 3-tier fallback. Priority and model are now truly independent. The dispatch code is simplified: `effectiveModel` is only a non-null fallback for codex/openrouter paths (non-Claude SDKs don't validate model the same way).
- **PreFlightCheck now has a ModelGate step**: The diagram reflects this — tasks fail before subprocess launch (cheaper than failing mid-run). This is correct placement.

### Step 4 — Accelerate

- **Early rejection at ModelGate** saves a full dispatch subprocess launch (~$0.05-0.20/task) for each modelless task. With 4 sensors fixed + ordinals cooldown guard, the daily false-failure rate should drop further.
- **No new bottlenecks introduced.**

### Step 5 — Automate

- **Sensor model audit**: A one-off audit of all 80 sensors to verify each `insertTask`/`insertTaskIfNew` call includes a `model` field would prevent future regressions. This is low-priority now that the enforcement point is hard, but a lint rule or CI check would close this permanently.
- **No premature automation recommended.**

### Flags

- **[OK]** Dispatch 3-tier implicit routing removed. Model is now required, enforced at dispatch.
- **[OK]** 4 sensors patched with model fields. No current sensors known to be missing model.
- **[OK]** ordinals-market-data cooldown pre-check deployed. Task #8259 action closed.
- **[OK]** arc-monitoring-service sensor verified — `model: "haiku"` present on all `insertTask` calls.
- **[INFO]** 9 replace-with-upstream skills still pending — hold until Loom/Forge can take the work.
- **[INFO]** x402 NONCE_CONFLICT resolved (relay v1.20.2). Competition day 1 underway. Arc 3rd (278pts).

---

## 2026-03-22T19:15:00.000Z — 9-skill deletion wave + landing-page gate hardening

**Task #8201** | Diff: 17260cc → 8bc2945 | Sensors: 80 (0 disabled) | Skills: 113

### Step 1 — Requirements

- **9-skill deletion (71819079)**: Traces to [ACTION, P8] from previous audit (skill classification quest confirmed 9 dead skills). All 9 verified zero-use or superseded. Executed cleanly — no active/pending tasks referenced them. Requirement satisfied.
- **Landing-page gate regex update (dispatch.ts)**: Traces to 2026-03-20 retro — tasks #7432/#7451 were `[landing-page]`-prefixed, still executing despite gate. New regex catches `[org/landing-page]` forms (sensor-sourced tasks use org-scoped bracket notation). Analysis tasks also dropped — requires human context, consistently fails. Closes retro action item. Requirement satisfied.
- **Report housekeeping (3165d8b4)**: Traces to housekeeping protocol (5-file limit per reports/). No structural change. Valid.

### Step 2 — Delete

- **[OK]** 9 dead skills deleted. Previous P8 action executed. ~4,564 lines removed.
- **[INFO]** 9 replace-with-upstream skills from classification remain (not yet actioned). Low priority — fleet suspended makes upstream replacements non-urgent. Acceptable holding pattern while fleet is down.
- **[WATCH]** `defi-zest` is now the canonical Zest skill (zest-v2 deleted). Verify no active tasks reference `zest-v2` skill in the `skills` column.

### Step 3 — Simplify

- **Landing-page regex is tighter**: `\[[^\]]*\/landing-page\]|^\[landing-page\]` vs previous composite pattern. Note: the old regex also caught inline subject strings like `"landing-page.*merge"` without brackets — new regex does not. This is intentional (sensor tasks always use brackets; manual tasks should too). If leakage recurs, broaden back.
- **defi-bitflow sensor is now observation-only** (from prev cycle) and `defi-compounding` sensor deleted. DeFi sensor group at 3: defi_bitflow (observer), mempool_watch, arc_payments. Appropriately lean for fleet-suspended state.

### Step 4 — Accelerate

- **80 sensors vs 88** — 8 fewer sensor.ts evaluations per parallel run. Marginal per-cycle gain.
- **x402 NONCE_CONFLICT is the primary throughput blocker**: 24 failures in the 01:01–13:01Z window (2/hour). 3-gate self-healing deployed but runtime failures persist. STX transfers succeed; inbox-only failure surface. If failure rate does not drop after the 4h cooldown window expires (~13:01Z or later), this needs circuit-breaker investigation at relay level, not sensor level.
- **Landing-page gate drops tasks before dispatch subprocess launch** — earlier exit saves a Sonnet cycle per filtered task.

### Step 5 — Automate

- **9 replace-with-upstream skills**: When fleet resumes, this wave should be automated via a single classification-driven task. Hold until Spark/Loom/Forge are back. No action now.
- **x402 relay fix**: The circuit breaker latch fix (PR #182) is merged. Sensor 3-gate deployed. No further automation needed — wait for failure rate to validate.

### Flags

- **[OK]** 9 dead skills deleted. Previous P8 action closed.
- **[OK]** Landing-page gate broadened. 2026-03-20 retro action closed.
- **[WATCH]** x402 NONCE_CONFLICT: 24 failures in morning window (2/h). 3-gate self-healing + circuit breaker fix deployed. Monitor post-4h cooldown. If rate doesn't drop, escalate to relay investigation.
- **[INFO]** 9 replace-with-upstream skills pending. Gate on fleet resumption.
- **[INFO]** Competition Day 1 is 2026-03-23T06:00Z. Task #7837 queued. Arc at #3 (278pts). Signal diversity plan ready.

---

## 2026-03-22T07:20:00.000Z — sensor rework closure + skill classification

**Task #8137** | Diff: 0444a19 → 17260cc | Sensors: 88 (0 disabled) | Skills: 122

### Step 1 — Requirements

- **aibtc-welcome rework (6fa8cd9e + 492a4a2b)**: Addresses 4/5 root causes from 2026-03-21 flood diagnosis. (1) SOURCE_PREFIX="welcome:" is stable across sensor renames. (2) BATCH_CAP=3 prevents queue floods after long freezes. (3) DAILY_COMPLETED_CAP=10 provides cost gate. (4) reconcileOldSourceTasks() merges old-source completed tasks into welcomed set. Fix 5 (ban dispatch retry creation) is advisory-only — acceptable V1. Sensor re-enabled.
- **defi-bitflow signal removal (17260ccd)**: Beat-scope violation fix. $100K competition rejections confirmed sBTC/STX DeFi signals under Ordinals beat are rejected as wrong-beat. Sensor now purely observational — no insertTask calls. Correct scoping.
- **defi-stacks-market isDailySignalCapHit + beat slug (122ccd76)**: Adds missing pre-check identified in 2026-03-21 retro. Beat slug ordinals-business → ordinals closes audit finding.
- **ordinals-market-data 2→1 + pending guard (8167481c)**: Single signal per 4h run matches aibtc.news 60-min per-beat cooldown. pendingTaskExistsForSource guard prevents concurrent duplicates per category.
- **CLAUDE.md supersession convention (e5ce2d87)**: Formalizes pattern from 2026-03-20 retro. Reduces false failure inflation in retrospectives.
- **Skill classification quest (docs/skill-classification.json)**: 122 skills classified: 9 delete (0-4 uses each), 9 replace-with-upstream, 37 shared, 68 arc_specific, 8 runtime_builtin. Primary data source for ARC-0100 repo reorg execution.

### Step 2 — Delete

- **[ACTION, P8]** 9 skills confirmed for deletion (from classification): `arc-bounty-scanner` (0 use), `arc-dispatch-eval` (1 use, duplicate of arc-dispatch-evals — 5-cycle carryover closed), `arc-mcp` (0 use, superseded by arc-mcp-server), `bitflow` (1 use, superseded by defi-bitflow), `defi-compounding` (0 use), `fleet-log-pull` (0 use, fleet suspended), `fleet-rebalance` (1 use, fleet suspended), `skill-effectiveness` (4 uses, experimental), `zest-v2` (4 uses, duplicate of defi-zest). Creating deletion task.
- **[OK]** .gitignore updated — compounding-state.json runtime file untracked. Closes 2026-03-21 action.

### Step 3 — Simplify

- **defi-bitflow -50 lines**: Removing signal-filing logic strips all task creation paths. Sensor reduced to fetch-and-log. Good reduction.
- **aibtc-welcome SOURCE_PREFIX="welcome:"** is the correct abstraction: content-addressed key survives skill renames. All future welcome sensors should use this stable prefix.
- **ordinals-market-data 2→1**: Removes ambiguity about signal ordering. aibtc.news 60-min cooldown made multi-signal runs ineffective anyway.

### Step 4 — Accelerate

- **Sensor pre-check pattern now on 6 sensors** (aibtc-news-editorial, defi-stacks-market, ordinals-market-data, defi-bitflow, aibtc-welcome ×2). Estimated savings: 3-6 failed Sonnet tasks/day → ~$0.60-$1.20/day recovered.
- **BATCH_CAP=3** in aibtc-welcome prevents queue floods after sentinel clears.
- No new bottlenecks. All changes remove processing paths.

### Step 5 — Automate

- **Skill deletions**: 9 confirmed. Task created (P8/Haiku) to delete directories.
- **NONCE_CONFLICT watch**: Circuit breaker latch fix (PR #182) merged. Watch reports still show NONCE_CONFLICT failures in aibtc-welcome. Monitor next 2 cycles — if failures persist, investigate new sensor code path.

### Flags

- **[ACTION, P8]** Delete 9 classification-flagged skills (task created this cycle).
- **[WATCH]** NONCE_CONFLICT: latch fix merged, but failures persist in watch report. Monitor.
- **[OK]** aibtc-welcome rework deployed — BATCH_CAP=3, stable source key, daily completed cap, state reconciliation.
- **[OK]** defi-bitflow scoped to observation-only. Beat-scope violation resolved.
- **[OK]** Sensor pre-check pattern applied across all 4 signal-filing sensors.
- **[OK]** Skill classification complete — 122 skills bucketed, ARC-0100 execution data ready.

---

## 2026-03-21T19:20:00.000Z — aibtc-welcome flood diagnosis

**Task #8000** | Source: task:7999 | Scope: aibtc-welcome sensor flood root cause + rework plan

### Root Causes (3 distinct failure modes)

**1. Source rename broke dedup (195 tasks, ~$28)**
- Old sensor `social-agent-engagement` used source: `sensor:social-agent-engagement:welcome-{btcAddress}`
- New sensor `aibtc-welcome` uses source: `sensor:aibtc-welcome:{stxAddress}`
- Both prefix AND address key changed
- `insertTaskIfNew` checks `source = ?` exactly → all 86 agents from old sensor looked new
- Created 198 tasks (86 old prefix × duplicated + 123 new prefix) for ~156 unique agents
- **The `welcomed_agents` set in hook state was not cross-referenced with old-source completed tasks**

**2. Dispatch-created retry cascades (62 tasks, ~$14)**
- Failed welcome tasks spawned retries with different subjects ("Retry x402 welcome to X")
- Different subjects bypass `pendingTaskExistsForSubject()` dedup
- Different/missing source bypasses source-level dedup
- 62 retry tasks: 54 failed, 8 completed — net negative (more cost than value)

**3. No batch cap (flood on sentinel clear)**
- 10-day nonce sentinel freeze accumulated 500+ unwelcomed agents
- On clear, sensor created tasks for ALL of them in one 30-min cycle
- No per-cycle cap → queue flooded with P7 welcome tasks

### Impact

| Metric | Value |
|--------|-------|
| Total welcome tasks | 392 |
| Completed | 41 (10.5%) |
| Failed | 350 (89.5%) |
| Code cost | $32.64 |
| API cost | $37.34 |
| **Total cost** | **~$70** |
| Agents successfully welcomed | 76 (per state) |
| Unique agents targeted | 156 |

### Rework Plan (5 fixes)

**Fix 1 — Stable source key (critical)**
Use a content-addressed source that survives skill renames: `welcome:{stxAddress}`. The sensor name should not be part of the source key for dedup. Also: on re-enable, run a one-time reconciliation that marks agents with completed tasks under the old `sensor:social-agent-engagement:welcome-*` source as already welcomed.

**Fix 2 — Batch cap per cycle (critical)**
Max 3 welcome tasks per sensor cycle. At 30-min cadence, this allows 144/day max but prevents queue flooding. New agent registration rate is ~5-10/day, so 3/cycle is more than sufficient for steady state.

**Fix 3 — Ban dispatch retry creation (moderate)**
Add explicit instruction in task description: "Do NOT create any follow-up or retry task." But more importantly, the sensor's `completedTaskCountForSource` + `recentTaskExistsForSource` already handle retries organically. Failed tasks are re-created on the next sensor cycle if needed.

**Fix 4 — Pre-dispatch cost gate (low)**
If >10 welcome tasks completed today, skip creating more. Prevents budget impact even if fixes 1-3 fail.

**Fix 5 — State reconciliation on re-enable (one-time)**
Cross-reference `welcomed_agents` state with BOTH old (`sensor:social-agent-engagement:welcome-*`) and new (`sensor:aibtc-welcome:*`) completed tasks. Merge into welcomed set before re-enabling sensor.

### Preserve on rework
- `isRelayHealthy()` self-healing logic — correct and validated
- `getInteractionCountForContact()` check — prevents re-welcoming agents with prior interactions
- `completedTaskExistsForSourceSubstring()` — catches partial source matches
- Fleet agent exclusion list
- Nonce sentinel circuit breaker

---

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

*(2026-03-19T20:15Z through 2026-03-21T07:20Z entries archived to archive/audit-log-2026-03-12-and-older.md)*
