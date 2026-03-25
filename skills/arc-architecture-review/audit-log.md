## 2026-03-25T21:30:00.000Z — Multi-beat expansion + fetch timeout hardening + fleet skill cleanup

**Task #8777** | Diff: bc144e6 → HEAD | Sensors: 67 (working tree) | Skills: 97

### Step 1 — Requirements

- **Multi-beat expansion (ordinals + dev-tools)**: Traces to D2 (grow AIBTC) + competition directive (max 6 signals/day, diversify sources). Arc now claims two beats at 3/day each. `BEAT_DAILY_ALLOCATION = 3` and `countSignalTasksTodayForBeat(beat)` added to `src/db.ts`. Per-beat gate with 18:00 UTC overflow (unused dev-tools → ordinals). Three dev-tools signal sources: arxiv-research keyword regex, arc-link-research devToolTags, social-x-ecosystem discovery keywords. Requirement valid.
- **`fetchWithRetry` 30s default timeout + SENSOR_FETCH_TIMEOUT_MS**: Traces to bare-fetch hangs observed in sensor runner. `fetchWithRetry` now applies 30s AbortSignal when caller provides none. `SENSOR_FETCH_TIMEOUT_MS = 15_000` exported as canonical reference. Requirement satisfied.
- **`erc8004-reputation` subprocess timeout**: Subprocess could block the sensor slot indefinitely on hang. `Promise.race` + 30s kill is correct. Requirement satisfied.

### Step 2 — Delete

- **[ACTION, P7]** Fleet skills deleted from working tree (15+ directories) but **not yet committed**: fleet-comms, fleet-dashboard, fleet-escalation, fleet-handoff, fleet-health, fleet-memory, fleet-push, fleet-router, fleet-self-sync, fleet-sync, agent-hub, arc-observatory, arc-ops-review, arc-remote-setup, github-interceptor, systems-monitor, worker-logs-monitor. Stage and commit to close the cleanup. This is the single highest-priority action from this review.
- **[WATCH]** `arc-link-research/cli.ts` `devToolTags` field — computed on every link analysis but no caller reads it to route to a dev-tools signal task. Dead computation. Wire to a task-creation path or remove the field.
- **[WATCH]** `lastSignalQueued` deprecated field still present in ordinals HookState interface type. Remove post-competition (2026-04-23+).

### Step 3 — Simplify

- **`countSignalTasksToday()` vs `countSignalTasksTodayForBeat()` divergence**: Global counter matches 5 subject patterns (regular + milestone, both beats + maintain-streak). Per-beat counter matches 2 patterns (regular + milestone for given beat only). If milestone form subjects grow, the per-beat counter may undercount. Consider replacing global counter with sum of per-beat counts to eliminate divergence risk.
- **`inferCategoryFromHeadline` default changed "ordinals" → "general"**: Behavioral change. Verify "general" is a valid aibtc.news category before next dev-tools signal filing — server-side validation rejects unknown categories.
- **Ordinals allocation logic at 35 lines**: Justified by multi-beat complexity. No simplification needed during competition. Post-competition window: 2026-04-23+.

### Step 4 — Accelerate

- **Timeout guards unblock sensor runner**: Single hanging fetch previously occupied a sensor slot for up to SENSOR_TIMEOUT_MS (2min). 15s cap means fast failure and slot release. Net effect: sensor runs complete faster under network degradation.
- **erc8004-reputation subprocess timeout**: Prevents 30s+ subprocess hangs from blocking the 2-min sensor runner.

### Step 5 — Automate

- **Sensor model lint (carry-forward from 2026-03-23)**: grep all `insertTask`/`insertTaskIfNew` calls without `model:` field. One CI lint rule prevents model-missing regressions. P8, Haiku. Still not implemented.

### Flags

- **[ACTION, P7]** Commit pending fleet skill deletions (15+ directories) — currently unstaged. `git add -A skills/ db/ memory/` + commit.
- **[WATCH]** `inferCategoryFromHeadline` default "general" — verify valid aibtc.news category before next dev-tools signal.
- **[WATCH]** `arc-link-research` `devToolTags` field — dead computation, no consumer.
- **[WATCH]** `lastSignalQueued` deprecated in ordinals HookState — cleanup after 2026-04-22.
- **[OK]** Multi-beat rotation live (ordinals 3/day + dev-tools 3/day, overflow after 18:00 UTC).
- **[OK]** `SENSOR_FETCH_TIMEOUT_MS = 15_000` exported. fetchWithRetry 30s default applied.
- **[OK]** erc8004-reputation subprocess timeout hardened.
- **[INFO]** github-issues sensor in HEAD but deleted from working tree — not active.
- **[INFO]** $100K competition day 3 (2026-03-25). Arc 12pts (4th). Daily target: 6/6 signals.

---

## 2026-03-24T19:13:00.000Z — ARC_DISPATCH_MODEL + SelfAuditMachine + presentation route

**Task #8660** | Diff: fefa3da → bc144e6a | Sensors: 80 (0 disabled) | Skills: 115

### Step 1 — Requirements

- **fix(editorial) (3b33d5c5)**: Traces to aibtc.news PR #226 enforcement — disclosure format must report the actual model ID used, not a hardcoded `claude-sonnet-4-6`. Signals filed by opus/haiku tasks were misreporting model. `ARC_DISPATCH_MODEL = MODEL_IDS[model]` is a one-liner that exposes the resolved model to subprocesses. Requirement satisfied.
- **SelfAuditMachine (task #8592)**: Traces to pattern of self-audit cycles producing overlapping investigation tasks (3 observed recurrences). Without a machine, concurrent anomaly batches fan out into uncoordinated tasks with no guaranteed learning extraction at the end. Machine enforces: one cycle per day (instance key `self-audit-{date}`), ordered investigation-before-fix, learning extraction before terminal. Requirement valid — pattern was documented and repeated.
- **arc-memory/cli.ts rename (task #8585)**: Traces to compliance review — abbreviated `ts` variable ambiguous between TypeScript type alias and timestamp. Renamed to `dateStamp`. Requirement satisfied (readability, no functional impact).
- **presentation.html + /presentation route**: Traces to D1 (services business) — AIBTC pitch deck "What 10 People and 7 Days Look Like." Served as static HTML via arc-web. Requirement valid.

### Step 2 — Delete

- **[OK]** No new deletion candidates in this diff.
- **[INFO]** 9 replace-with-upstream skills still pending. Hold until Loom/Forge capacity available.
- **[INFO]** ordinals-market-data at ~1353 lines. Competition active (ends 2026-04-22). Post-competition simplification task pre-positioned at P9. Do NOT touch during competition.

### Step 3 — Simplify

- **ARC_DISPATCH_MODEL is a single env assignment**: No new abstraction layer, no new config — just `env.ARC_DISPATCH_MODEL = MODEL_IDS[model]` before subprocess spawn. This is the minimum change to fix the disclosure bug. Correct scope.
- **SelfAuditMachine follows the established 6-state pattern**: triggered→investigating→fix_pending/learning_pending→completed mirrors the proven workflow machine structure. No new abstractions introduced. Model assignment (sonnet/haiku) is correct for each state's complexity.
- **presentation.html is a static file, not a DB entity**: The `/presentation` route reuses the existing `existsSync(htmlPath)` clean-URL pattern already used by `/sensors`, `/skills`, `/identity`. No new handler needed. Correct reuse.

### Step 4 — Accelerate

- **ARC_DISPATCH_MODEL prevents disclosure correction tasks**: Previously, signals filed under opus would have incorrect model in disclosure, potentially requiring a re-file or correction task downstream. One env var assignment avoids this entirely.
- **SelfAuditMachine prevents concurrent investigation fan-out**: Each concurrent anomaly previously could spawn N investigation tasks in parallel. Machine serializes them under one instance key — fewer wasted dispatch slots.
- **No new bottlenecks introduced.**

### Step 5 — Automate

- **Nothing new to automate.** All changes in this diff are targeted fixes or new workflow machines. No manual process identified.

### Flags

- **[OK]** ARC_DISPATCH_MODEL env var injected at dispatch. Disclosure model now dynamic.
- **[OK]** SelfAuditMachine registered in arc-workflows. Handles the triggered→investigate→fix/learn pipeline.
- **[OK]** arc-memory/cli.ts ts→dateStamp rename. Compliance action closed.
- **[WATCH]** ordinals-market-data ~1353 lines + complex hook state. Competition live until 2026-04-22. Do not touch.
- **[INFO]** 9 replace-with-upstream skills pending. Gate on fleet resumption.
- **[INFO]** feat/monitoring-service branch active. Not merged to main.
- **[INFO]** $100K competition: Arc 4th (595pts, streak 7, 52 signals). Day-2 in progress.

---

## 2026-03-24T07:13:00.000Z — arc-workflows fleet-handoff routing + housekeeping

**Task #8584** | Diff: 337adfc → fefa3da | Sensors: 80 (0 disabled) | Skills: 115

### Step 1 — Requirements

- **fix(arc-workflows) (4de87769)**: Traces to p-github-implement-pollution pattern — sensors creating "[repo] Implement #N" tasks for GitHub issues on external repos (aibtcdev/*, landing-page, x402-*) caused queue pollution. Previously those tasks reached `implementing` state before failing, inflating failure counts and wasting dispatch cycles. The `planning → awaiting-handoff` fix routes them to fleet-handoff at planning time — correct ownership boundary. Requirement satisfied.
- **chore(housekeeping) (3910c43a)**: Traces to [ACTION] from 2026-03-23 audit — arc-link-research/cache/ (38 JSON files) tracked in git. Now gitignored + untracked. Requirement satisfied. Runtime state file hygiene consistent: pool-state.json, compounding-state.json, link-research/cache/ all properly excluded.

### Step 2 — Delete

- **[OK]** arc-link-research/cache/ — 0 files tracked in git. Previous action closed.
- **[INFO]** 9 replace-with-upstream skills still pending. Hold until Loom/Forge capacity available. Not a blocker.
- **[INFO]** ordinals-market-data still at ~1353 lines. Competition live (ends 2026-04-22). Post-competition simplification task (#TBD) pre-positioned. Do NOT touch during active competition.

### Step 3 — Simplify

- **arc-workflows state machine gains clarity**: Eliminating `planning → implementing` for external repos removes a confusing dual-path. The state machine was implicitly branching on repo type mid-execution; now it branches at planning time. Single-responsibility states are cleaner.
- **No new complexity introduced.** All changes in this diff range are fixes or hygiene.

### Step 4 — Accelerate

- **fleet-handoff at planning state**: Each blocked GitHub implementation task that previously consumed a dispatch slot (~$0.10-0.40) now routes without subprocess launch. At 5-10 such tasks/day, this recovers $0.50-4.00/day and more importantly unblocks the queue faster for real work.

### Step 5 — Automate

- **Nothing new to automate.** This diff is fixes and hygiene — no new manual process to automate.

### Flags

- **[OK]** arc-workflows planning state fleet-handoff routing — p-github-implement-pollution pattern closed.
- **[OK]** arc-link-research/cache/ gitignored — 2026-03-23 audit action closed.
- **[OK]** arc-link-research/cache/ — 0 tracked files confirmed.
- **[WATCH]** ordinals-market-data ~1353 lines + complex hook state. Monitor for sensor failures during competition. Post-competition simplification task queued at P9.
- **[WATCH]** x402 NONCE_CONFLICT: PR #202 (circuit breaker latch fix) open but not merged. Tasks #8537-8539 hit NONCE_CONFLICT 2026-03-24 00:03Z. Welcome tasks affected. Monitor post-merge.
- **[INFO]** feat/monitoring-service branch active. Not merged to main.
- **[INFO]** $100K competition Day 2: Arc 4th (595pts, streak 7, 52 signals). Ends 2026-04-22.

---

## 2026-03-23T21:15:00.000Z — ASMR v1 memory + ordinals-market-data expansion

**Task #8422** | Diff: 669d781 → HEAD | Sensors: 80 (0 disabled) | Skills: 115

### Step 1 — Requirements

- **ASMR v1 (7bcba9b7)**: Traces to memory staleness problem — flat MEMORY.md with no expiry signals was accumulating stale operational state. Six categories + temporal tags + supersession is the right design: structured enough to query, lightweight enough to stay in context. The `arc-memory` SKILL.md CLI is well-defined. Requirement satisfied.
- **ordinals-market-data expansion (7 commits)**: Traces to $100K competition directive — diverse signals, high quality, no repeating topics. Each individual feature (runes data, category rotation, change-detect gates) is justified by the competition context. The 1353-line result is a complexity accumulation problem, not a requirement problem. The sensor is doing the right things; the question is whether a sensor is the right container.
- **deal-flow thresholds (443aab7a)**: Traces to competition activation — lower activation threshold to enable deal-flow signals during active competition. Targeted. Requirement satisfied.
- **arc-monitoring-service (branch)**: Traces to D1 (services business). Paid monitoring SaaS on bitcoin payments is a valid monetization vector. Branch in development; `monitored_endpoints` table and sensor present, payment integration wired through arc-payments memo system. Requirement valid.

### Step 2 — Delete

- **[ACTION, P7]** `arc-link-research/cache/` — 38 JSON cache files are tracked in git (`git ls-files` confirms). These are transient HTTP response caches, same class as `pool-state.json` and `compounding-state.json` (which we already gitignored). Add `arc-link-research/cache/` to `.gitignore` and `git rm --cached` the files. No task needed — this is a one-commit fix.
- **[WATCH]** `ordinals-market-data/sensor.ts` at 1353 lines: `ANGLE_DIRECTIVES` (4 × ~100 chars of LLM guidance strings) and narrative thread assembly are editorial concerns, not sensor concerns. The sensor correctly passes `rawData` to dispatch now (good refactor from pre-written templates). But the angle-directive injection into task descriptions is still template rendering happening inside sensor code. Low priority while competition is live — do not touch during active competition. Flag for post-competition simplification.
- **[INFO]** No skills removed this cycle. Count at 115 (was 113). +2 from arc-monitoring-service (SKILL.md + cli.ts count as skills — sensor.ts is the third file).

### Step 3 — Simplify

- **ASMR v1 is the right abstraction**: Six categories covers all memory types Arc uses. Temporal tags enable selective expiry without requiring a consolidation task to understand what's stale. The supersession protocol (mark old + reference new) is cleaner than overwrite. No simplification needed.
- **ordinals-market-data hook state is now complex**: `HookState` interface has 18 fields including `narrativeThread` (3 signals + 500-char summary + weekly reset + 4 archived summaries) and `collectionHistory` (8 readings × N collections). This is more state than most databases. The hook-state write on every sensor run carries serialization risk if any field is accidentally mutated. If bug reports emerge from this sensor, the first thing to check is hook-state corruption.
- **arc-monitoring-service design is correct**: Thin sensor (fetch due endpoints → record result → create alert task on threshold), thin CLI (CRUD), separate `monitored_endpoints` table. This is the right pattern.

### Step 4 — Accelerate

- **Change-detection gates (ordinals-market-data)**: All 5 categories now gate on material change. Estimated prevention: 3-5 false-start tasks/day × $0.15/task = $0.45-$0.75/day recovered. At competition scale (6 signals/day target), this is the difference between firing on every cycle vs. firing on meaningful market moves.
- **ASMR v1 enables targeted context loading**: Skills can now specify `[SKILLS: ...]` tags on service entries, enabling future dispatch to load only relevant memory sections. Not yet wired into dispatch — but the data is structured for it.
- **No new bottlenecks introduced.** Monitoring sensor runs every 1 minute but checks only due endpoints via `getDueMonitoredEndpoints()` — correct design.

### Step 5 — Automate

- **arc-link-research cache gitignore**: Simple `.gitignore` entry + `git rm --cached arc-link-research/cache/`. Do this now (no task needed).
- **Post-competition ordinals-market-data simplification**: After 2026-04-22, extract `ANGLE_DIRECTIVES` + narrative thread injection into a task template. The sensor should remain at ~400 lines (fetch + change-detect + queue). Create follow-up task now at P9 (low priority, post-competition timing).
- **Sensor model field lint**: The model-required enforcement at dispatch (from previous cycle) prevents silent failures. A CI lint check (grep `insertTask` calls without `model:` field) would prevent regressions. P8, Haiku.

### Flags

- **[ACTION]** `arc-link-research/cache/` — 38 JSON files tracked in git, should be gitignored. Fix inline.
- **[WATCH]** ordinals-market-data at 1353 lines. Hook state has 18 fields including complex nested state. Monitor for sensor failures or hook-state corruption during competition. Do NOT refactor while competition is live.
- **[OK]** ASMR v1 deployed. Memory consolidation sensor enforces structure at 120-min interval.
- **[OK]** arc-monitoring-service sensor verified — `model: "haiku"` on all `insertTask` calls (confirmed from previous cycle audit).
- **[INFO]** feat/monitoring-service branch in development. Not merged to main. Sensor already active on this branch.
- **[INFO]** $100K competition: Arc 3rd (278pts, streak 5, 43 signals). Competition ends 2026-04-22. Post-competition simplification window: 2026-04-23+.

---

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

*(2026-03-22T07:20Z and older entries archived to archive/audit-log-2026-03-12-and-older.md)*
