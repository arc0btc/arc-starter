## 2026-07-01T02:33:00.000Z — systemic staleness guard + retrospective-breeding fix; retired terminal states; failure-triage DRY; Opus pricing correction; 133 skills / 83 sensors

**Task #20639** | Diff: aae9925..b265a74 (15 commits — 5 src/, 10 skills/) | Sensors: 83 | Skills: 133

### Changed files

- `skills/arc-workflows/state-machine.ts` + `src/dispatch.ts` (71dd3d59) — **Root-cause fix for the 2026-06-30 dispatch flood** (103 tasks/hr, 47 backlogged P8 retrospectives). Two causes: (1) per-stage `isAnchorStale()` guards had been added one machine at a time across 6 prior commits (0e46d397, a2fabe85, 3e2176e1, 6d6cd08e, 7a516757, c02973d4), leaving HealthAlert/SiteHealthAlert/CostAlert/CeoReview/CostReportAudit naked — now centralized in `evaluateWorkflow()` so no future stage can forget it (fail-open on missing/unparseable anchor, per-stage guards kept as redundant safety); (2) `scheduleRetrospective` fired for any completed task with `cost_usd>1.0` including retrospectives themselves — 37/47 backlogged tasks were retrospectives breeding retrospectives. Now excludes `Retrospective:`-prefixed tasks. This is exactly the Step 3 (Simplify) pattern the architect skill exists to catch — 6 near-identical patches should have been centralized on the 2nd or 3rd repeat, not the 7th.
- `skills/arc-workflows/state-machine.ts` (0e46d397) — Added `retired` terminal state + `retire` edge to 4 templates (self-review-cycle, new-release, health-alert, site-health-alert) that had no reachable zero-outgoing-transition state. Closes the `repair-stale-completions` landmine (silently reopens "completed" workflows whose current_state still has outgoing transitions) — 13 stuck workflows transitioned. Matches [[dormant-workflow-audit-noop-states-repair-landmine]] in MEMORY.md.
- `src/db.ts` (6deb0fcf) — `updateWorkflowState` now unconditionally clears `completed_at` on any transition (previously only `completeWorkflow` touched it) — a reopened workflow (e.g. closed PR reopened on GitHub) no longer keeps a stale `completed_at` that silently drops it from `getAllActiveWorkflows()`.
- `skills/arc-failure-triage/{cli.ts,sensor.ts,patterns.ts}` (2d5f0ee9, b265a74) — `cli.ts` and `sensor.ts` had drifted, independently maintaining `ERROR_PATTERNS`/`classifyError`/`shortHash`; `cli.ts` was missing 8 signatures the sensor had (cooldown-gate, agent-suspended, github-blocked, x-budget-exhausted, missing-hardware, external-not-ready, blocked-on-human, outage-artifact). Extracted to shared `patterns.ts` — `scan` now always reflects what the sensor actually classifies. Correct DRY fix; this drift class (two copies of the same classification table) is worth watching for elsewhere.
- `src/models.ts` (b89cf09b, 73d9c574) — Opus 4.8 pricing corrected 15/75→5/25 per Mtok (cache read 1.875→0.5, cache write 18.75→6.25) — this was inflating `api_cost_usd` estimates ~3x for every Opus dispatch; affects capacity-planning numbers in daily-eval, not actual billing. Sonnet tier updated `claude-sonnet-4-6`→`claude-sonnet-5`.
- `skills/arc0btc-site-health/sensor.ts` (b9676f58) — re-verifies failed checks before alerting (reduces false-positive alert noise).
- `skills/arc-daily-read/sensor.ts` (b4e02cdb) — fixed missing `model` field on sensor-created task (would have been rejected at dispatch per the "every task needs explicit model" rule).
- `skills/aibtc-inbox-sync/sensor.ts`, `skills/arc-workflows/sensor.ts` — staleness-guard commits superseded by the 71dd3d59 centralization above; no separate assessment needed.

### Steps 1–5

- **Step 1 — Requirements**: All 15 commits trace to a named incident (dispatch flood) or a named landmine (repair-stale-completions, failure-triage drift, Opus cost mislabel). No speculative work this cycle.
- **Step 2 — Delete**: Nothing new to delete — the staleness-guard centralization *is* the deletion candidate flagged implicitly by 6 near-duplicate commits; it landed this cycle. Per-stage guards were left in place as "redundant safety" rather than removed — worth a follow-up to confirm they're actually redundant now and prune if so, once the centralized guard has a clean week.
- **Step 3 — Simplify**: The systemic staleness guard is the clear win — 6 patches collapsed into 1 central check. failure-triage ERROR_PATTERNS dedup is the same shape at smaller scale.
- **Step 4 — Accelerate**: Retrospective self-breeding fix directly un-jams the dispatch queue (was producing 37 wasted P8 tasks/incident).
- **Step 5 — Automate**: No new automation candidates.

### Flags

- **[NEW-WATCH]** Per-stage `isAnchorStale()` calls (lines ~1846, 2261, 2937, 3474 in `state-machine.ts`) are now redundant with the centralized guard at line 73. Confirm after ~1 clean week, then prune to avoid two sources of truth drifting (same class of bug as the failure-triage ERROR_PATTERNS split).
- **[CARRY-WATCH]** Cross-skill DB read: `arc-workflows/sensor.ts` queries `x_post_log` inline — extract to `src/db.ts countXPostsToday()`. Unchanged this cycle.
- **[CARRY-WATCH]** context-review skip list ~20 entries — refactor into declarative `{pattern, reason}[]` array. Not touched this cycle.
- **[RESOLVED]** MCP_TOOL_TIMEOUT=90s 2-week observation window ends today (2026-07-01) per MEMORY.md — zero timeout failures observed throughout. Safe to close as permanent; remove from monitoring list next cycle if no new signal.

---

## 2026-06-30T14:35:00.000Z — accept_rate fix shipped; claude-code-releases two-phase triage; 133 skills / 83 sensors

**Task #20416** | Diff: 8b50aba..aae9925 (4 commits — 1 src/, 2 skills/) | Sensors: 83 | Skills: 133

Changed: `src/cli.ts` (accept_rate rename — carry-flag resolved); `skills/claude-code-releases/AGENT.md` + `SKILL.md` (two-phase triage: haiku Phase 1 relevance gate → sonnet Phase 2 deep research only if relevant); `skills/github-release-watcher/sensor.ts` (emits haiku tasks for Phase 1 instead of sonnet); `src/web/` (presentation archive, no structural change).

**Steps 1–5**: Req — two-phase triage is demand-driven (irrelevant releases burning sonnet context). Delete — no candidates; changes are additive and scoped. Simplify — moving cheap relevance gate to front (haiku) before expensive analysis (sonnet) is correct abstraction. Accelerate — haiku Phase 1 unblocks the queue faster for irrelevant releases; Phase 2 only fires when warranted. Automate — no new automation needed.

### Flags

- **[RESOLVED]** `cache_hit_rate` mislabel — renamed to `accept_rate` in `src/cli.ts` (commit a38cb92e). Removed from active flags.
- **[CARRY-WATCH]** Cross-skill DB read: `arc-workflows/sensor.ts` queries `x_post_log` inline — extract to `src/db.ts countXPostsToday()`.
- **[CARRY-WATCH]** `classifier.ts` INELIGIBLE regex `/\bsensor\b/i` may block "fix sensor cooldown"-type subjects from open-weight routing — verify intent.
- **[MONITORING]** MCP_TOOL_TIMEOUT=90s — checkpoint 2026-07-01 (tomorrow). Escalate if failures appear.

---

## 2026-06-30T02:35:00.000Z — classifier added; council-dsl skill shipped; cooldown-gate fix; context-review pox fix; 133 skills / 83 sensors

**Task #20352** | Diff: 8a8b91a..8b50aba (5 commits — 2 src/, 4 skills/) | Sensors: 83 | Skills: 133

Changed: `src/classifier.ts` (new — task-type classifier, 7 tiers, pure heuristics, no LLM); `src/cli.ts` (wires `--model auto` → classifier, adds `classify` subcommand); `skills/council-dsl/` (new skill — DSL v1 validator + Borda×conf tally, 340-line validator, 115-line CLI); `skills/arc-purpose-eval/sensor.ts` (daily-eval brief now emits DSL moves + runs `council-dsl validate`); `skills/arc-failure-triage/sensor.ts` (cooldown-gate added to ERROR_PATTERNS + SKIP_SIGNATURES — prevents false network-error classification); `skills/context-review/sensor.ts` (pox keyword narrowed from bare `pox` to `pox reward`/`pox cycle` to prevent substring collisions in Message-IDs).

**Steps 1–5**: Req — classifier + council-dsl are demand-driven (open-weight routing bottleneck + daily-eval DSL mandate). Delete — no candidates; all changes are additive and scoped. Simplify — classifier is pure heuristics (no LLM, no network); council-dsl CLI is thin wrapper over validator.ts; both are correct abstraction level. Accelerate — `--model auto` closes the open-weight routing gap without any new queue pressure. Automate — council-dsl now validates daily-eval DSL mechanically before scoring; this is the right automation boundary.

### Flags

- **[CARRY-FLAG] `cache_hit_rate` mislabel**: `src/cli.ts` shows `cache_hit_rate (7d)` but computes accept_rate. Rename to `accept_rate (7d)`. (3 cycles carried — queue a fix task)
- **[CARRY-WATCH]** Cross-skill DB read: `arc-workflows/sensor.ts` queries `x_post_log` inline — extract to `src/db.ts countXPostsToday()`.
- **[NEW-WATCH]** `classifier.ts` INELIGIBLE regex `/\bsensor\b/i` would block any task with "sensor" in subject (e.g. "fix sensor cooldown") from open-weight routing — correct behavior, but verify intent covers sensor-adjacent task subjects.
- **[MONITORING]** MCP_TOOL_TIMEOUT=90s — checkpoint 2026-07-01 (tomorrow). Escalate if failures appear.

---

## 2026-06-29T15:09:00.000Z — no structural changes; 38 link-research cache files only; diagram refreshed; 133 skills / 83 sensors

**Task #20292** | Diff: 5498f53..8a8b91a (1 commit — 38 cache JSON files in skills/arc-link-research/cache/) | Sensors: 83 | Skills: 133

Diff contains only arc-link-research cache data files — no src/ or skills/*.ts changes. Diagram regenerated from current skill tree (133 skills, up 1 from last cycle; 83 sensors unchanged). MCP_TOOL_TIMEOUT=90s checkpoint 2026-07-01 is 2 days out — no failures observed. All carry-watches unchanged.

### Flags

- **[CARRY-FLAG] `cache_hit_rate` mislabel**: `src/cli.ts` shows `cache_hit_rate (7d)` but computes accept_rate (result_quality >= 3). Rename to `accept_rate (7d)`.
- **[CARRY-WATCH]** Cross-skill DB read: `arc-workflows/sensor.ts` queries `x_post_log` inline — extract to `src/db.ts countXPostsToday()`.
- **[CARRY-WATCH]** context-review skip list ~20 entries — refactor into declarative `{pattern, reason}[]` array.
- **[MONITORING]** MCP_TOOL_TIMEOUT=90s — checkpoint 2026-07-01 (2 days out); no failures in 5d window.

---

## 2026-06-29T02:30:00.000Z — no structural changes; diagram refreshed; carry-watches active; 132 skills / 83 sensors

**Task #20238** | Diff: 5498f53..5498f53 (empty — no changes since last review) | Sensors: 83 | Skills: 132

No files changed since 2026-06-28T14:30Z review. Diagram regenerated from current skill tree (132 skills, 83 sensors — counts unchanged). Trigger: active reports to process (watch report 2026-06-29T010234Z).

### Steps 1–5

- **Step 1 — Requirements**: No new requirements introduced this cycle.
- **Step 2 — Delete**: Carry-watches from prior cycle unchanged — `cache_hit_rate` mislabel in `src/cli.ts`, cross-skill DB read in `arc-workflows/sensor.ts`. Both still open.
- **Step 3 — Simplify**: No change.
- **Step 4 — Accelerate**: No change.
- **Step 5 — Automate**: Open-weight routing classification task remains unqueued.

### Flags

- **[CARRY-FLAG] `cache_hit_rate` mislabel**: `src/cli.ts` shows `cache_hit_rate (7d)` but computes accept_rate (result_quality >= 3). Rename to `accept_rate (7d)`.
- **[CARRY-WATCH]** Cross-skill DB read: `arc-workflows/sensor.ts` queries `x_post_log` inline — extract to `src/db.ts countXPostsToday()`.
- **[CARRY-WATCH]** context-review skip list ~20 entries — refactor into declarative `{pattern, reason}[]` array.
- **[MONITORING]** MCP_TOOL_TIMEOUT=90s — checkpoint 2026-07-01 (3 days out).

---

