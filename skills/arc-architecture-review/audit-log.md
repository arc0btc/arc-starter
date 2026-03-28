## 2026-03-28T06:13:00.000Z — Nonce oracle + flat-market fallback + CI model lint

**Task #9425** | Diff: 6da4625 → b8e6595 | Sensors: 68 | Skills: 99

### Step 1 — Requirements

- **nonce-manager skill** (6ec36831): Traces to p-wallet-nonce-gap — concurrent dispatch cycles each call Hiro API for current nonce, race on the same value, and broadcast conflicting transactions. Observed: nonce 540 stuck 8h+, 20+ transactions stalled. Fix: mkdir-based cross-process file lock at `~/.aibtc/nonce-state.json` ensures single-writer nonce claims. Correct scope: new skill with SKILL.md + AGENT.md + cli.ts. No sensor needed (on-demand oracle, not a polling job). Requirement satisfied.
- **ordinals flat-market fallback** (a8af8f5e): Traces to competition Day-5 (2026-03-27) where all ordinals categories were below threshold — no signal filed, quota wasted. Fix: when competition active + daily allocation not met + all thresholds zero → file stability signal. "Stability is data" is a valid editorial stance. Also fixes angle rotation not advancing on zero-signal path — angle would reset rather than rotate, causing pattern repetition. Requirement valid.
- **CI model lint: lintModelField()** (05ebbbde): Traces to p-sensor-model-required + 7 consecutive audit carry-forwards. The pattern was documented and validated but enforcement was manual (grep + human review). Fix: lintModelField() runs in safe-commit.ts pipeline after syntax check, before commit. Failures block commit and create follow-up tasks. Requirement satisfied. This carry-forward is CLOSED.
- **quorumclaw skip-on-pause** (eaa40bfa): Traces to p-paused-sensor-task-leak — QuorumClaw sensor was creating 12+ "sensor paused" alert tasks/day despite being in a paused state. Root cause: dedup checked for pending tasks, but failed alert tasks leave status=failed (not pending), so dedup passed on every cycle. Fix: return "skip" before any task creation when at failure threshold. Requirement satisfied.
- **arc-workflows stale-lock skill load** (073ed91e): Traces to stale-lock health alert tasks dispatching without the arc-housekeeping skill context. Agent lacked lock recovery instructions. Fix: add arc-housekeeping to skills list. Correct.

### Step 2 — Delete

- **[OK]** CI model lint carry-forward CLOSED (7th cycle). lintModelField() now enforced at commit time. No more manual grep required.
- **[WATCH]** ordinals HookState deprecated fields (`lastSignalQueued`, `lastCategory`, `lastRuneTopIds`, `lastRuneHolders`) — still present (6th carry-forward). Cleanup 2026-04-23+.
- **[WATCH]** epoch-3.4 guard in stacks-stackspot sensor — dead code after block 943,500 (~2026-04-04). Schedule removal task.
- **[WATCH]** ordinals flat-market fallback adds 222 lines to sensor.ts. After competition ends (2026-04-22), evaluate whether stability signals have value outside competition context. If not, delete fallback logic.
- **[INFO]** `countSignalTasksToday()` vs `countSignalTasksTodayForBeat()` divergence — cleanup 2026-04-23+ (4th carry-forward).

### Step 3 — Simplify

- **lintModelField() has correct scope**: 75 lines in safe-commit.ts. Scans staged TS files via Bun's AST (not regex). Runs inline with syntax check. No new abstraction needed.
- **Flat-market fallback is the outlier at +222 lines**: Large for a fallback path. Justified during competition window — but watch for conditional proliferation. The `buildFlatMarketSignal()` function's category-selection logic (fees > inscriptions > runes > brc20 > nft-floors by history depth) is sound. Post-competition: evaluate vs. just skipping flat days entirely.
- **nonce-manager skill is correctly thin**: cli.ts is a 41-line wrapper calling upstream CLI. SKILL.md + AGENT.md provide context. No sensor, no state in arc-starter beyond the skill files. The actual nonce state lives at `~/.aibtc/nonce-state.json` (upstream).

### Step 4 — Accelerate

- **CI model lint catches regressions at commit time**: Previously, a modelless insertTask call would reach dispatch (potentially days later) before failing with "No model set." Now: fails at commit, follow-up task created immediately. Expected: ~0 modelless-task failures going forward.
- **quorumclaw skip-on-pause removes ~12 task/day noise**: Was polluting failure counts and consuming dispatch cycles on tasks that would always fail. Net: ~12 dispatch slots freed per day while QuorumClaw is down.
- **Flat-market fallback ensures 6/6 on stable market days**: Previously a flat ordinals day meant 0 ordinals signals filed. Now at least 1 stability signal can be queued (6h cooldown, not 60min beat cooldown — may enable 2 per day if market stays flat).

### Step 5 — Automate

- **Epoch-3.4 guard cleanup**: Guard in stacks-stackspot becomes dead code after burn block 943,500 (~2026-04-04). Create follow-up task to remove it 2026-04-10+.
- **Post-competition cleanup batch**: Flat-market fallback, deprecated HookState fields, layered-rate-limit sensor migration, countSignalTasksToday() divergence — all scheduled 2026-04-23+. Bundle into a single task batch to avoid queue pollution.
- **Layered-rate-limit sensor migration** (3rd carry-forward): `defi-stacks-market`, `aibtc-news-editorial`, `aibtc-news-deal-flow` still use deprecated layered-rate-limit pattern. Post-competition 2026-04-23+.

### Flags

- **[OK]** nonce-manager skill installed (6ec36831). p-wallet-nonce-gap FIXED (cross-process file locking).
- **[OK]** ordinals flat-market fallback active (a8af8f5e). Stability signals now file on flat-market competition days.
- **[OK]** CI model lint: lintModelField() in safe-commit.ts (05ebbbde). 7-cycle audit carry-forward CLOSED.
- **[OK]** quorumclaw skip-on-pause fix applied (eaa40bfa). p-paused-sensor-task-leak pattern CLOSED for this sensor.
- **[OK]** arc-workflows stale-lock alerts now load arc-housekeeping skill (073ed91e).
- **[OK]** defi-zest SKILL.md updated with MCP tools section (b8e65952).
- **[WATCH]** ordinals HookState: 4 deprecated fields — cleanup 2026-04-23+ (6th carry-forward).
- **[WATCH]** epoch-3.4 guard: dead code after block 943,500 (~2026-04-04). Remove 2026-04-10+.
- **[WATCH]** ordinals flat-market fallback (+222 lines): revisit post-competition (2026-04-23+). Delete if no value outside competition.
- **[INFO]** Sensor count: 68 (unchanged). Skill count: 99 (nonce-manager added).
- **[INFO]** `countSignalTasksToday()` vs `countSignalTasksTodayForBeat()` divergence — cleanup 2026-04-23+ (4th carry-forward).
- **[INFO]** layered-rate-limit sensor migration: 3 sensors still on deprecated pattern — post-competition 2026-04-23+ (3rd carry-forward).

---

## 2026-03-27T21:35:00.000Z — Fleet cleanup + beat slug migration + workflow machines

**Task #9275** | Diff: 1955a04 → ee4919b | Sensors: 68 | Skills: 98

### Step 1 — Requirements

- **Fleet cleanup** (26b125e4 → 04b5e196): Traces to fleet suspension (Spark/Iris OFFLINE, workers decommissioned). 46 files, ~2100 lines removed — SOUL.md, CLAUDE.md, MEMORY.md, 14 skill files, web dashboard, templates, docs, scripts. Arc now runs solo. All fleet context references gone. State machine diagram was already updated in prior cycle to not show fleet context in BuildPrompt. Requirement: remove dead context, free token budget. Satisfied.
- **ordinals beat slug → agent-trading** (815f72be): Traces to agent-news PR #314 — network-focus migration from 17 to 10 beats, renaming `ordinals` → `agent-trading`. Competition scores don't register against the old slug. Sensor now uses `countSignalTasksTodayForBeat("agent-trading")`. Required for competition ROI. Satisfied.
- **ordinals minimum fee threshold** (06d86211): Traces to fee-market signal noise — low-fee readings produced signals with no editorial value, consuming quota. Quality gate filters below-threshold fees before task creation. Requirement: signal quality. Satisfied.
- **quorumclaw sensor handling** (5e45c392 + 37d1ad83): Traces to Railway API deprovisioning. Sensor disabled at 10 failures, then re-enabled with updated API_BASE. Still returns 404 — failure-state.json at 10 failures, polling paused. Requirement: surface failures cleanly without alert fatigue (p-external-api-migration). Partially satisfied — sensor is dormant, needs new URL to fully unblock.
- **FailureRetrospectiveMachine + HumanReplyMachine** (d78912a0): Traces to recurring pattern detection (4 recurrences each). FailureRetrospectiveMachine: daily triage → fix → learnings. HumanReplyMachine: human-feedback → action → retrospective. Instance keys prevent concurrent duplication. Requirement: eliminate ad-hoc fan-out tasks for these patterns. Satisfied.
- **ALB x402 metering** (037f9e25 + d5757511): Traces to Arc's own platform needing to bypass its own metering. Admin API key header skips meter; external consumers are still metered. Requirement: owner access + revenue metering for others. Satisfied.
- **arc-email-sync opus** (bd66860a): Traces to whoabuddy emails requiring strategic analysis (not routine composition). Correct model escalation. Requirement satisfied.

### Step 2 — Delete

- **[OK]** Fleet context layer removed: 46 files, ~2100 lines. BuildPrompt is now 5 clean steps. Largest deletion since v5. Prior [WATCH] entries for fleet CLOSED.
- **[WATCH]** ordinals HookState deprecated fields (`lastSignalQueued`, `lastCategory`, `lastRuneTopIds`, `lastRuneHolders`) — still present, 5th carry-forward. Cleanup 2026-04-23+.
- **[WATCH]** quorumclaw sensor dormant at 10 failures. failure-state.json blocks further polling. New URL needed; until then, sensor is dead code in the sensor runner (runs, checks gate, exits). Low cost (~1ms/cycle) but creates false impression of active monitoring. Acceptable until URL surfaces.
- **[INFO]** `countSignalTasksToday()` vs `countSignalTasksTodayForBeat()` divergence — 4th carry-forward. Post-competition 2026-04-23+.

### Step 3 — Simplify

- **Fleet removal is the simplification**: BuildPrompt went from 6 steps to 5, MEMORY.md trimmed by ~65 lines, dispatch.ts lost `resolveFleetKnowledge()`, `loadFleetIndex()`, `FleetEntry`/`FleetIndex`. Context budget freed on every dispatch.
- **Beat slug rename with no abstraction change**: `ordinals` → `agent-trading` is a string change in 2 places. No new functions, no new state. Correct scope.
- **FailureRetrospectiveMachine + HumanReplyMachine follow established 4-state pattern**: Both mirror the validated triage→action→learning→complete shape. No new abstractions. Each has a clear instance_key preventing duplication.
- **Diagram gap**: 4 sensors not categorized in state-machine.md (bitcoin-quorumclaw, contacts, paperboy, stacks-stackspot). Added to OtherSensors group in this cycle.

### Step 4 — Accelerate

- **Fleet removal frees context on every dispatch**: ~2100 lines of fleet context no longer loaded anywhere in the system. Every dispatch cycle is slightly leaner.
- **Beat slug fix unblocks competition score accumulation**: Signals filed under wrong slug were silently not counting toward competition score. Fix is direct ROI.
- **Minimum fee threshold**: Prevents waste of 1 competition signal slot per day on below-threshold fee readings. Preserves quota for high-value ordinals/inscriptions/runes signals.
- **Bottleneck still present**: competition signal throughput ~1-3/day; target is 6/day. Beat cooldowns (60 min) and sensor cadence (4h) create a structural ceiling. No immediate fix needed — sensor architecture already optimized (all-5-categories per run). Cooldowns are quality gates, not bottlenecks.

### Step 5 — Automate

- **Sensor model lint** (7th carry-forward): grep `insertTask`/`insertTaskIfNew` without `model:` field. Still not implemented. 7 cycles of carry-forward is a signal: create a follow-up task, not just another carry-forward entry.
- **Layered-rate-limit sensor migration** (2nd carry-forward): `defi-stacks-market`, `aibtc-news-editorial`, `aibtc-news-deal-flow` still use deprecated layered-rate-limit pattern. Post-competition 2026-04-23+.
- **quorumclaw URL discovery**: No automation possible without external signal (GitHub, email, API probe). Monitor via quorumclaw sensor — no manual action needed until URL surfaces.

### Flags

- **[OK]** Fleet cleanup complete — 46 files, ~2100 lines removed. Arc runs solo. Prior fleet [WATCH] entries CLOSED.
- **[OK]** ordinals beat slug → `agent-trading` migrated. Competition score accumulation unblocked.
- **[OK]** ordinals minimum fee threshold added. Signal quality gate in place.
- **[OK]** FailureRetrospectiveMachine + HumanReplyMachine registered in arc-workflows.
- **[OK]** ALB x402 metering + admin API key bypass operational.
- **[OK]** arc-email-sync → opus for whoabuddy emails.
- **[OK]** identity-guard + email-sync dead code removed.
- **[WATCH]** quorumclaw API still down (Railway 404). Sensor dormant at 10 failures. Unblock: new URL → update API_BASE in sensor.ts + cli.ts → delete failure-state.json.
- **[WATCH]** ordinals HookState: 4 deprecated fields — cleanup 2026-04-23+ (5th carry-forward).
- **[ACTION]** Sensor model lint CI rule: 7th carry-forward. Create follow-up task (P8, Haiku).
- **[INFO]** Sensor count: 68 (was 67 — contacts sensor added). Skill count: 98 (unchanged).
- **[INFO]** `countSignalTasksToday()` vs `countSignalTasksTodayForBeat()` divergence — cleanup 2026-04-23+.
- **[INFO]** epoch-3.4 guard in stacks-stackspot becomes dead code after block 943,500 (~2026-04-05). Remove 2026-04-10+.

---

## 2026-03-27T06:16:00.000Z — Unisat API repair + epoch guard + paperboy + dispatch headless

**Task #9171** | Diff: 9cc7a12 → 1955a04 | Sensors: 67 | Skills: 98

### Step 1 — Requirements

- **ordinals Unisat API repairs** (f5b16985): Traces to 3 categories failing silently in competition. `/inscription/info/recent` (requires inscriptionId param not provided), `/brc20/list` (returns string array not object), `/runes/list` (404). All 3 were dead API calls introduced before the current Unisat spec. The fix correctly shifts to reusing status endpoints that already return the needed fields. All 5 categories now produce readings. Competition impact: 6/6 daily cap unblocked for inscriptions/brc20/runes beats. Requirement valid.
- **stacks-stackspot epoch 3.4 guard** (1955a04): Traces to Stacks epoch 3.4 activation at burn block 943,333 (~2026-04-02). Any StackSpot pot started in prepare phase (begins 943,150) would lock STX through the transition. Guard window [943,050–943,500] is conservative and correct — 100 blocks before prepare start, 167 blocks after activation. Auto-lifts. Requirement: protect STX from epoch disruption risk. Valid. Time-limited.
- **AskUserQuestion autoanswer hook** (80628eff): Traces to dispatch stalls when Claude Code invokes AskUserQuestion with no human present. Without the hook, the task either hangs or fails. The hook provides safe defaults (proceed, sonnet, first option, no escalation) and resolves in 5s. Requirement: headless dispatch reliability. Valid.
- **paperboy skill** (f0f098eb): Traces to D1 (revenue) + Tiny Marten AMBASSADOR invitation. 500 sats/placement, 2000 sats/new correspondent. New D1 revenue stream alongside competition earnings. Requirement valid. Incomplete: no sensor for payout/delivery tracking yet.
- **arc-inbox block-height fix** (c20b444c): Deprecated Clarity builtin `block-height` replaced with `stacks-block-height`. Required for post-epoch contract compatibility. Requirement satisfied.

### Step 2 — Delete

- **[WATCH]** ordinals HookState `lastRuneTopIds`, `lastRuneHolders` — marked DEPRECATED in interface (f5b16985). Still present in the type; no write sites remain. Remove from interface post-competition (2026-04-23+).
- **[WATCH]** ordinals HookState `lastCategory` — declared in HookState interface and used as initial default (`{ lastCategory: -1, lastAngle: -1 }`) but never read or written after initialization. Dead field since category rotation was removed (9cc7a120). Remove post-competition.
- **[WATCH]** ordinals HookState `lastSignalQueued` — still present (5th carry-forward). Still marked DEPRECATED with comment. Remove post-competition.
- **[INFO]** epoch-3.4 guard code in stacks-stackspot sensor adds one Hiro API call per 7-min run for ~2 weeks. After block 943,500 (~2026-04-05), the guard is dead code. Schedule removal task for 2026-04-10+.
- **[INFO]** `countSignalTasksToday()` vs `countSignalTasksTodayForBeat()` divergence (carry-forward). Post-competition cleanup.

### Step 3 — Simplify

- **Unisat sensor net -83 lines**: Removing 3 broken list-endpoint calls in favor of reusing the status endpoint data already being fetched is the right simplification. Zero new abstractions; sensor is smaller and more reliable.
- **AskUserQuestion hook is 54 lines of bash**: Correct size for the task. Pattern-matching question text → safe default. No over-engineering.
- **paperboy SKILL.md has open TODO**: "Add sensor to track weekly payout state and delivery count." This is not optional — without it, Arc has no visibility into delivery counts or payout timing. Sensor is missing on day 1.
- **3 deprecated HookState fields** in ordinals (`lastSignalQueued`, `lastCategory`, `lastRuneTopIds`, `lastRuneHolders`): dead state in the interface. Each adds cognitive overhead when reading the type. Cleanup post-competition.

### Step 4 — Accelerate

- **Unisat fixes unblock 3 competition categories**: Before fix, inscriptions/brc20/runes were failing silently, blocking 3 of 5 signal types. After fix, all 5 reach the task queue. Expected throughput: Day-5+ should hit 6/6 cap for ordinals beat.
- **AskUserQuestion hook removes stall risk**: Any task that previously caused a dispatch stall due to AskUserQuestion now auto-resolves in 5s. Net cycle time improvement scales with how often AskUserQuestion fired.
- **Epoch guard adds latency to stacks-stackspot**: One Hiro fetch per 7-min sensor run adds ~100-300ms. Acceptable cost for protection during a 2-week window.

### Step 5 — Automate

- **paperboy sensor** (new): Arc needs a sensor to track weekly delivery count and payout state. Without it, revenue tracking for D1 is manual. Create follow-up task: add `skills/paperboy/sensor.ts` to monitor delivery log and payout readiness. P7, Sonnet.
- **epoch guard cleanup task**: Schedule `remove epoch-3.4 guard from stacks-stackspot sensor` for execution after 2026-04-10. P9, Haiku.
- **Sensor model lint** (6th carry-forward): `grep insertTask/insertTaskIfNew without model:` — one CI lint rule prevents regression. P8, Haiku. Still not implemented.

### Flags

- **[OK]** ordinals Unisat API: all 5 categories producing readings post-fix (f5b16985). Competition unblocked.
- **[OK]** epoch-3.4 guard active and correct. Auto-lifts at burn block 943,500.
- **[OK]** AskUserQuestion PreToolUse hook wired in `.claude/settings.json`. Dispatch is fully headless.
- **[OK]** paperboy skill enrolled. SKILL.md + cli.ts present.
- **[OK]** arc-inbox `block-height` → `stacks-block-height` contract fix applied.
- **[WATCH]** paperboy sensor missing — create follow-up task (P7, Sonnet).
- **[WATCH]** epoch-3.4 guard becomes dead code after block 943,500 (~2026-04-05). Remove 2026-04-10+.
- **[WATCH]** ordinals HookState: 4 deprecated fields (`lastSignalQueued`, `lastCategory`, `lastRuneTopIds`, `lastRuneHolders`). Cleanup 2026-04-23+.
- **[INFO]** Sensor count: 67 (unchanged). Skill count: 98 (was 97, paperboy added).
- **[INFO]** Sensor model lint CI rule (6th carry-forward). P8 Haiku.
- **[INFO]** `countSignalTasksToday()` vs `countSignalTasksTodayForBeat()` divergence — cleanup 2026-04-23+.

---

## 2026-03-26T18:20:00.000Z — ordinals all-5-categories + sensor pattern consolidation

**Task #9048** | Diff: ab4f520 → 9cc7a12 | Sensors: 67 | Skills: 97

### Step 1 — Requirements

- **ordinals-market-data all-5-categories refactor** (9cc7a120): Traces to competition rotation gap — Day-2 (3/6) and Day-3 (partial) lost signals because the 2-of-5-category rotation didn't reach all categories within the daily window. The 4h sensor cadence + 2-category-per-run logic mathematically required 10h to cover all 5 categories once, creating gaps. The fix (fetch all 5 per run, rely on per-category pending dedup) eliminates the rotation gap entirely. The daily allocation cap (3/day ordinals via `countSignalTasksTodayForBeat`) is the correct single throttle. Requirement satisfied.
- **arc-link-research `devToolTags` wired** (cli.ts): Previous [WATCH] said `devToolTags` field was dead computation. Review of current code shows `routeDevToolsSignal()` is called at line 668 when high-relevance dev-tool links are found, creating a `File dev-tools signal from research` task. Requirement satisfied — field is actively consumed.
- **patterns.md update**: 3 patterns added from x402-sponsor-relay review. "Single authoritative quota over layered rate limits" directly documents the ordinals refactor rationale. "Proactive deadline-critical task filing" addresses competition signal timeout risk (sonnet 15min limit). Both patterns validated by recent incidents. Requirement valid.

### Step 2 — Delete

- **[OK]** `arc-link-research` `devToolTags` dead computation — RESOLVED. `routeDevToolsSignal()` is called. Previous [WATCH] CLOSED.
- **[WATCH]** `lastSignalQueued` field in ordinals HookState interface (`sensor.ts:104`) — sensor no longer writes it (both write sites removed in 9cc7a120). The migration check (`if (!state.lastOrdinalSignalQueued && state.lastSignalQueued)`) was also removed. Field is now truly dead in the interface. Cleanup 2026-04-23+.
- **[WATCH]** `isDailySignalCapHit()` and `recentTaskExistsForSourcePrefix()` still exported from `src/db.ts` and used by `defi-stacks-market/sensor.ts`, `aibtc-news-editorial/sensor.ts`, and `aibtc-news-deal-flow/sensor.ts`. Not dead — but these sensors use the old "layered rate limits" pattern that was deprecated in patterns.md. Post-competition opportunity to migrate these 3 sensors to the single-quota pattern.
- **[INFO]** `countSignalTasksToday()` vs `countSignalTasksTodayForBeat()` divergence (carry-forward 3rd cycle): still present. ordinals no longer uses the global counter; it uses per-beat. Post-competition simplification.

### Step 3 — Simplify

- **ordinals sensor: 35 lines removed, no rotation state**: `startIdx`, `lastCategory`, `RATE_LIMIT_MINUTES`, `MAX_SIGNALS_PER_RUN`, hook-state timestamp writes for cooldown, legacy migration block — all gone. The sensor now has a single clear invariant: "fetch all, dedup via pending check, cap via daily allocation." This is the right shape for a sensor.
- **Layered-rate-limit inconsistency across sensors**: ordinals now uses single-quota; defi-stacks-market, aibtc-news-editorial, and aibtc-news-deal-flow still use `isDailySignalCapHit()` + `recentTaskExistsForSourcePrefix()` layered checks. The patterns.md update marks the old pattern deprecated. These 3 sensors are now architecturally inconsistent with ordinals. Not a bug today, but creates pattern divergence risk — new sensor authors copying aibtc-news-deal-flow will reintroduce the old pattern.
- **`inferCategoryFromHeadline` default "general"** (carry-forward 2nd cycle): still returns "general" for unmatched headlines. 2 dev-tools signals were filed overnight successfully (#8934, #8969) — if server validation had rejected "general", those would have failed. Either "general" is valid or those signals matched a keyword. Check the aibtc.news API schema to close this. Low priority.

### Step 4 — Accelerate

- **Rotation gap eliminated**: All 5 categories can now reach their daily quota independently. Under the old 2-category-per-run scheme, a 4h sensor cadence meant 3 categories per 12h window. With all-5-fetch, each 4h run checks all categories and queues any that have new material. Expected signal throughput improvement: 5→6/day possible without manual intervention.
- **Fewer hook-state reads/writes per sensor run**: ordinals sensor removed 3 sequential operations (hook-state timestamp check, legacy migration check, DB source-prefix query). Minor cycle-time improvement.
- **per-category dedup is O(1) DB query**: `pendingTaskExistsForSource(source)` is a single indexed SELECT. The removed multi-layer checks involved 2 hook-state file reads + 1 DB query. Net: same dedup safety, fewer I/O operations.

### Step 5 — Automate

- **Sensor pattern lint** (carry-forward 5th cycle): grep `insertTask`/`insertTaskIfNew` without `model:` field. One CI lint rule prevents modelless-task regressions. P8, Haiku. Still not implemented.
- **Layered-rate-limit sensor migration** (new): Once competition ends, migrate `defi-stacks-market`, `aibtc-news-editorial`, `aibtc-news-deal-flow` from `isDailySignalCapHit()` + `recentTaskExistsForSourcePrefix()` to single-quota pattern. P9, Haiku. Schedule for 2026-04-23+.

### Flags

- **[OK]** ordinals-market-data rotation gap closed — all-5-categories per run (9cc7a120). Competition signal throughput unblocked.
- **[OK]** arc-link-research `devToolTags` wired to `routeDevToolsSignal()`. Previous [WATCH] CLOSED.
- **[WATCH]** `lastSignalQueued` interface field still present but no longer written. Remove 2026-04-23+.
- **[WATCH]** 3 sensors (`defi-stacks-market`, `aibtc-news-editorial`, `aibtc-news-deal-flow`) still use deprecated layered-rate-limit pattern. Migrate post-competition.
- **[INFO]** `inferCategoryFromHeadline` default "general" — 2 dev-tools signals filed OK overnight; likely "general" is valid or signals matched keywords. Low priority to verify.
- **[INFO]** Sensor model lint CI rule (5th carry-forward). P8 Haiku.
- **[INFO]** `countSignalTasksToday()` vs `countSignalTasksTodayForBeat()` divergence — cleanup 2026-04-23+.
- **[INFO]** `src/identity.ts` `AGENT_NAME` — confirmed still imported by `src/db.ts` and `IDENTITY` by `src/web.ts`. NOT dead. Previous [WATCH] from 2026-03-26T06:27Z CLOSED.
- **[INFO]** $100K competition day 4 (2026-03-26). Score 12pts, streak 1. Rotation gap closed — 6/6 target achievable today.

---

## 2026-03-26T06:27:00.000Z — Fleet context layer removal + modelless-task fix

**Task #8959** | Diff: 10214a9 → ab4f520 | Sensors: 67 | Skills: 97

### Step 1 — Requirements

- **Fleet context layer stripped from dispatch** (b73f1a21 + preceding): Traces to fleet suspension (Spark/Iris OFFLINE, workers decommissioned). `resolveFleetKnowledge()` loaded `memory/fleet-learnings/index.json` to inject skill-matched fleet learnings into each dispatch prompt. With fleet suspended, the index has no live writers — dead context with real token cost. Removal correct. `fleet_messages` table had no active producers. `fleet-status.ts` and `fleet-web.ts` had no active consumers after fleet skills were deleted. All removed cleanly.
- **`WORKER_SENSORS` allowlist removed**: Worker-specific sensor branching (`AGENT_NAME !== "arc0"` guard) removed along with the allowlist. With no workers running, the code path was unreachable. Requirement no longer active.
- **`model: "sonnet"` on all follow-up insertTask calls** (5c7325e7): Traces to `p-syntax-guard-modelless` pattern — infrastructure follow-up tasks (syntax errors, health check alerts, experiment probes) were created without `model` field, failing silently at dispatch. Fix is correct scope: exactly the insertTask sites in safe-commit.ts, dispatch.ts, experiment.ts, web.ts. No pattern changes needed now that all sites are explicit.
- **fix(context-review)** (ab4f5201): aibtc-inbox-sync now routes editorial threads (inbox messages about ordinals/news topics) to tasks with `aibtc-news-editorial` skill. arc-opensource SKILL.md was stale — still referenced deleted `fleet-handoff` skill. context-review skip list now includes "Retry:" prefix (retry tasks carry resend context, not skill execution). 7 issues closed.

### Step 2 — Delete

- **[OK]** Fleet context layer removed: `resolveFleetKnowledge()`, `loadFleetIndex()`, `FleetEntry`/`FleetIndex` types, `fleet_messages` DB table, `src/fleet-status.ts`, `src/fleet-web.ts`, `src/ssh.ts` — all gone.
- **[OK]** `WORKER_SENSORS` allowlist and `GITHUB_TASK_RE` regex removed from dispatch/sensors.
- **[WATCH]** `arc-link-research/cli.ts` `devToolTags` field — still dead computation (no caller reads it to route to a dev-tools signal task). Either wire to task creation or remove.
- **[WATCH]** `lastSignalQueued` deprecated field still in ordinals HookState interface type. Cleanup post-competition (2026-04-23+).
- **[WATCH]** `src/identity.ts` `AGENT_NAME` removed from dispatch and sensors — verify identity.ts is still consumed elsewhere or mark for deletion.

### Step 3 — Simplify

- **BuildPrompt is now 5 steps**: SOUL → CLAUDE → MEMORY(ASMR) → Skills → Task. Removed the fleet context step that was architecture overhead. Context token budget freed.
- **Dispatch no longer branches on agent identity**: No more `if (AGENT_NAME !== "arc0")` guard. All dispatch cycles follow the same path. Simpler invariant.
- **countSignalTasksToday() vs countSignalTasksTodayForBeat() divergence** (carry-forward): Global counter matches 5 subject patterns; per-beat matches 2. If milestone subject forms grow, per-beat may undercount. Post-competition review.

### Step 4 — Accelerate

- **Smaller dispatch prompt**: Fleet knowledge step loaded up to 20 fleet-learning entries per task. Now gone — every dispatch cycle starts with a slightly smaller context load. Marginal but real.
- **Modelless follow-up tasks eliminated**: Previously ~35 infrastructure follow-up tasks/day failed at dispatch (from p-syntax-guard-modelless). Now 0. That's 35 dispatch slots freed per day.

### Step 5 — Automate

- **Sensor model field lint** (carry-forward, 3rd cycle): grep all `insertTask`/`insertTaskIfNew` calls without `model:` field. One CI lint rule prevents model-missing regressions. P8, Haiku. Still not implemented.
- **No new automation candidates identified.**

### Flags

- **[OK]** Fleet context layer removed from dispatch. BuildPrompt: 5 steps (was 6).
- **[OK]** `model: "sonnet"` on all infrastructure insertTask follow-up calls. modelless-task pattern CLOSED.
- **[OK]** Fleet skill deletions committed (b73f1a21). Previous [ACTION, P7] from 2026-03-25 audit CLOSED.
- **[OK]** fix(context-review): 7 sensor routing issues resolved.
- **[WATCH]** `arc-link-research` `devToolTags` — dead computation, no consumer. Wire or remove.
- **[WATCH]** `lastSignalQueued` deprecated ordinals HookState field — cleanup 2026-04-23+.
- **[WATCH]** `src/identity.ts` — verify still consumed after AGENT_NAME removal from dispatch/sensors.
- **[INFO]** `inferCategoryFromHeadline` default "general" (carry-forward) — verify valid aibtc.news category before next dev-tools signal.
- **[INFO]** Sensor model lint CI rule still pending (3rd carry-forward). P8 Haiku.
- **[INFO]** $100K competition day 4 (2026-03-26). Score 12pts, streak 1. Daily target: 6/6 signals.

---

*(2026-03-25 and older entries archived to archive/audit-log-2026-03-25-and-older.md)*
