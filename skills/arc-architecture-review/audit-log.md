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

## 2026-06-28T14:30:00.000Z — buildPrompt cache reorder; GLM/Devstral aliases; accept_rate metric; mem-health sensor wiring; 132 skills / 83 sensors

**Task #20212** | Diff: 92e5a56 → 5498f53 (7 commits — 4 structural in src/, 3 in skills/) | Sensors: 83 | Skills: 132

### Changed files

- `src/dispatch.ts` (31628a9b) — **PERF: buildPrompt reorder** — static sections (identity, memory, skills) now placed before dynamic sections (current time, recent cycles). Cache prefix is now stable across cycles. Comment estimates $1-3/day savings at current volume. Correct ordering: the more stable a section, the earlier it must appear for prefix caching to activate.
- `src/models.ts` (82843974) — **GLM-5.2** (`openrouter:glm`, ~$0.95/Mtok input) and **Devstral-2512** (`openrouter:devstral`, ~$0.40/Mtok input) added with full pricing. Prerequisite for open-weight routing policy written same day. Routing itself is NOT automated yet — policy exists but classification task is unqueued.
- `src/cli.ts` (5498f53a) — **NEW metric** in `arc status`: shows accept rate + cost/accepted-change. `cache_hit_rate` is the output label but the metric actually computes accept rate (`result_quality >= 3`). **MISLABELED — see Flags.**
- `src/constants.ts` (f76f9fc1) — Whop $9 SKU constant added (`LOOP_GRADED_PRODUCT_ID`). Library-only constant; no structural sensor/dispatch change.
- `skills/arc-housekeeping/sensor.ts` (746a528a) — Wires `arc-memory health` CLI into sensor. Separate source key (`sensor:arc-housekeeping:mem-health`) prevents source collision with regular housekeeping. Priority: P2 on FAIL, P4 on WARN. Correct separation of concerns.
- `skills/arc-skill-manager/sensor.ts` (7e5ee2e0) — patterns.md threshold raised 150→250; 12h cooldown added via `getLastCompletedTaskBySource`. Prevents oscillation when file hovers near threshold. Correct fix.
- `skills/arc-reporting/AGENT.md` (a34ee886) — Whop artifact read cap added to prevent context explosion. Correct.
- `skills/arc-architecture-review/AGENT.md + cli.ts + sensor.ts` (e79674ec) — Tokens fix from prior cycle. Reduces review context from 1.85M to <200K. This cycle confirms fix is working.

### Steps 1–5

- **Step 1 — Requirements**: buildPrompt reorder is valid and measurable. GLM/Devstral aliases are valid prerequisites. `cache_hit_rate` label is wrong — requirement is to track accept rate, not cache hit rate (true cache hit comes from API response headers, not result_quality). mem-health wiring is correct: separate source key was the right call. patterns.md threshold at 150 was too aggressive; 250 + 12h cooldown is calibrated.
- **Step 2 — Delete**: `[RESOLVED]` CATEGORY_HEADERS mismatch in arc-memory/cli.ts fixed by commit 9941a876 — 2-cycle carry closed. `cache_hit_rate` string in `src/cli.ts` line ~138 should be renamed to `accept_rate` — easy fix, misleading at current label.
- **Step 3 — Simplify**: mem-health task description embeds full `arc-memory health` stdout — bounded by health check output, acceptable. Cross-skill DB read in `arc-workflows/sensor.ts` unchanged — still open.
- **Step 4 — Accelerate**: buildPrompt reorder is the largest perf win this cycle. Static prefix stability unlocks caching across consecutive dispatch cycles without code changes.
- **Step 5 — Automate**: Open-weight routing policy is written but not automated — task-type classification unqueued. No new automation candidates beyond routing.

### Flags

- **[FLAG] `cache_hit_rate` mislabel**: `src/cli.ts` outputs `cache_hit_rate (7d)` but the metric is accept_rate (result_quality >= 3). True cache hit rate would require reading API response headers. Rename output string to `accept_rate (7d)` — one-line fix, low priority but misleads capacity planning if left as-is.
- **[WATCH]** Open-weight routing bottleneck: GLM/Devstral aliases live, policy written, but task-type classification unqueued. No automated routing until classification task is created (per MEMORY.md [[openrouter-open-weight-routing]]).
- **[CARRY-WATCH]** Cross-skill DB read: `arc-workflows/sensor.ts` queries `x_post_log` inline — extract to `src/db.ts countXPostsToday()`.
- **[CARRY-WATCH]** context-review skip list ~20 entries — refactor into declarative `{pattern, reason}[]` array on next sensor edit.
- **[MONITORING]** MCP_TOOL_TIMEOUT=90s — observation checkpoint 2026-07-01. No failures observed in 4d window.

---

## 2026-06-28T02:30:00.000Z — social-engine CLI fix; arc-memory health+archive; arc-housekeeping dual-threshold; arc-reporting council exemption; 132 skills / 83 sensors

**Task #20154** | Diff: 6ef6872 → 92e5a56 (6 commits — 4 structural) | Sensors: 83 | Skills: 132

### Changed files

- `skills/social-engine/cli.ts` (92e5a56) — **CRITICAL BUG FIX**: `sendReply()` was not forwarding `--tweet-created-at` CLI flag. P4 hardening admission guard 1 (target-age, fail-closed) requires `tweetCreatedAt` — missing value caused all CLI-initiated replies to block with `missing_tweet_age`. One-line fix restores the reply path.
- `skills/arc-memory/cli.ts` (c992574a) — **NEW commands**: `health` (read-only audit: MEMORY.md 180-warn/200-hard, recent.log >500, orphaned shared/entries, broken [[slug]] links, stale [STATE:] tags >14d; exits 1 on FAIL) and `archive` (snapshot MEMORY.md to memory/archive/ before consolidation).
- `skills/arc-housekeeping/sensor.ts` + `cli.ts` (c992574a) — Dual-threshold MEMORY check (180-warn/200-hard, was single 200). Added: broken [[slug]] link check, orphaned shared/entries check, recent.log >500 check. Fix: trims recent.log to 500 lines on housekeeping run.
- `skills/arc-reporting/sensor.ts` (ba86630f) — Council type exempted from stuck-distill alert. Council stalls are upstream dependency, not Arc architectural issue.
- `skills/arc-daily-read/cli.ts` (f57a1b19) — Cosmetic: drop trailing period from Edition N title line. No structural change.
- `skills/social-engine/crm-lookup.ts` (3f6f9fc8) — Minor CRM lookup update.

### Steps 1–5

- **Step 1 — Requirements**: social-engine fix valid and urgent — fail-closed guard was blocking ALL CLI replies. arc-memory health/archive valid — MEMORY.md at 200 lines hits Claude Code truncation cliff with no prior early warning. arc-housekeeping dual-threshold is a precision improvement. arc-reporting council exemption removes a structural FP.
- **Step 2 — Delete**: `[FLAG]` CATEGORY_HEADERS in arc-memory/cli.ts use ASMR-v2 names (`## [A] Operational State`) but MEMORY.md still uses ASMR-v1 (`## [A] Active Items`). `write-entry` and `list-entries` silently insert at EOF. `health` and `archive` unaffected. Context-review skip list still AT threshold (6th carry). Cross-skill DB read still open.
- **Step 3 — Simplify**: `cmdHealth` in arc-memory/cli.ts duplicates some detection from arc-housekeeping sensor check #5. Intentional: different purposes (proactive queue creation vs on-demand audit). Acceptable.
- **Step 4 — Accelerate**: health command surfaces memory issues before truncation cliff — proactive. reply path restored — CLI replies unblocked.
- **Step 5 — Automate**: health already wired into housekeeping sensor. Coverage complete.

### Flags

- **[FLAG] CATEGORY_HEADERS mismatch**: `arc-memory/cli.ts` uses ASMR-v2 headers but MEMORY.md uses ASMR-v1. `write-entry`/`list-entries` silently write to EOF. Follow-up task created.
- **[RESOLVED]** social-engine CLI reply path — tweet-created-at fix restores all CLI replies ✓
- **[CARRY-WATCH]** Cross-skill DB read: `arc-workflows/sensor.ts` queries `x_post_log` inline.
- **[CARRY-WATCH AT THRESHOLD ×6]** context-review skip list ~20 entries — refactor into declarative array. Follow-up task created.
- **[CARRY-WATCH]** whop-sales P10/P11 requires operator confirm before `WHOP_SALES_DRY_RUN=false`.
- **[MONITORING]** MCP_TOOL_TIMEOUT=90s — observation window checkpoint 2026-07-01.
