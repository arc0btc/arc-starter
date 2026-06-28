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
- **[AUDIT-LOG HOUSEKEEPING]** audit-log.md at 8 active entries (max 5) — trim to 5 on next housekeeping pass.

---

## 2026-06-27T14:28:00.000Z — arc-daily-read new sensor; site-consistency broadened; compliance renames; x402-pull-loop P6 provenance; 132 skills / 83 sensors

**Task #20087** | Diff: fa5f6aa → 6ef6872 (5 commits — 1 structural) | Sensors: 83 | Skills: 132

### Changed files

- `skills/arc-daily-read/SKILL.md` + `cli.ts` + `sensor.ts` (159696e5) — **NEW skill + sensor**: Arc's Daily Read. P3 arc-demand-distribution quest. 30-min sensor cadence, time-gated to UTC 13:00. Checks X budget (4 slots needed before posting). 4-tweet beat: root (chart + edition stamp) → reply-2 (so-what) → reply-3 (thesis continuity) → CTA. Chart from `distilled_artifacts` SQL, ASCII sparkline. New table: `daily_read_log`. Post-posting amplification email to whoabuddy@gmail.com (non-blocking). Kill switch wired.
- `skills/site-consistency/cli.ts` + `sensor.ts` (6ef6872) — Services check broadened to match current arc0btc.com content structure. cli.ts: verbose mode + response time tracking added. sensor.ts: detection logic aligned.
- `skills/arc-workflows/sensor.ts` + `skills/social-x-posting/cli.ts` (c191aea0) — Compliance variable renames: `cnt` → `total_count`, `tmp` → `temporaryFilePath`. No structural change.
- `skills/x402-pull-loop/cli.ts` (ee5cd2dd) — P6 buyer-authenticity classifier: `resolveProvenance()` checks buyer_address against `tagged_wallets` before upsert. CAS state guard (Kleppmann pattern). Prevents tagged wallets from producing `provenance='organic'` demand signals.
- `skills/whop/ACTIVATION-PATH.md` (ee5cd2dd) — Docs update only.

### Steps 1–5

- **Step 1 — Requirements**: arc-daily-read is valid P3 demand work — the free tier of the value ladder. X cap check (4 slots) and kill switch wiring are correct safety constraints. site-consistency broadening is a precision fix for a drifted check. x402-pull-loop provenance gate correctly prevents tagged wallets from polluting organic demand signals — the CAS guard is the right tool (Kleppmann council finding applied).
- **Step 2 — Delete**: Dead import `getWorkflowByTemplateAndContextTitle` in `arc-workflows/sensor.ts` — previous audit noted "follow-up task created" (P8/haiku). Verify that task ran and import was removed; if not, create new task. Context-review skip list ~20 entries — AT THRESHOLD, refactor still pending.
- **Step 3 — Simplify**: arc-daily-read 30-min interval for a 13:00 UTC time-gate is consistent with other time-gated sensors in this codebase — acceptable. The `daily_read_log` table is checked in sensor.ts with a graceful null-guard ("table may not exist on first run") — correct, cli.ts creates the table on first post. Cross-skill DB dependency still open: `arc-workflows/sensor.ts` queries `x_post_log` inline.
- **Step 4 — Accelerate**: No bottleneck impact from this diff.
- **Step 5 — Automate**: No new candidates.

### Flags

- **[WATCH]** arc-daily-read 4-slot budget assumption: sensor hardcodes cap check at DAILY_TWEET_CAP=6 → needs ≥4 slots. If DAILY_TWEET_CAP changes, sensor must be updated too — cross-file coupling.
- **[RESOLVED]** Dead import `getWorkflowByTemplateAndContextTitle` confirmed removed from `arc-workflows/sensor.ts` — 4-cycle carry closed.
- **[CARRY-WATCH]** Cross-skill DB read: `arc-workflows` sensor queries `x_post_log` inline — extract to `src/db.ts countXPostsToday()`.
- **[CARRY-WATCH AT THRESHOLD]** context-review skip list ~20 entries — refactor into declarative array on next sensor edit.
- **[CARRY-WATCH]** whop-sales P10/P11 requires operator confirm before `WHOP_SALES_DRY_RUN=false`.
- **[MONITORING]** MCP_TOOL_TIMEOUT=90s — observation window checkpoint 2026-07-01.

---

## 2026-06-27T02:30:00.000Z — P2 arc-funnel-hardening: DAILY_TWEET_CAP=6, CC x-thread daily cap, kill-switch in cmdPost; 133 skills / 84 sensors

**Task #20048** | Diff: fa42af4 → fa5f6aa (2 commits — 1 structural) | Sensors: 84 | Skills: 133

### Changed files

- `skills/social-x-posting/cli.ts` (fa5f6aa) — P2 arc-funnel-hardening: `DAILY_TWEET_CAP=6` constant added; all `cmdPost` calls now check total tweet count via `x_post_log` before firing (covers root + continuation + CTA). Kill switch (`outbound_enabled=false`) wired into `cmdPost` — previously only `social-engine/admission.ts` enforced it; direct-post path was a gap. `is_root` column added to `x_post_log` schema (idempotent `ALTER TABLE`). `saveBudget` now uses atomic temp-and-rename via `node:fs.renameSync` (Bun has no native rename — unavoidable `node:*` import).
- `skills/arc-workflows/sensor.ts` (fa5f6aa) — CC x-thread daily cap: `ContentCalendarMachine` x-thread steps (`content-calendar:<slug>:x`, excluding `:x-cta`) now check `x_post_log` row count before `insertTask`. Cap is 1/day. Panel target (arc-strategy-panel 2026-06-27): 25-workflow CC backlog drains in 25 days at this rate. Uses `getDatabase()` inline — cross-skill DB read (see Flags).
- `skills/blog-publishing/sensor.ts` (fa5f6aa) — CTA footer product name updated: "The Harness Engineering Field Guide" → "Arc Daily Research Report". Cosmetic, no structural change.
- `skills/social-x-posting/CADENCE.md` (fa5f6aa) — P2 doctrine documented: 1 thread/day + ≤6 total tweets/day. Updated pillar table.
- `skills/whop/lib/events.ts` (7a8a1b20) — Secondary commit: no structural change (prior audit covered).

### Steps 1–5

- **Step 1 — Requirements**: `DAILY_TWEET_CAP=6` is panel-confirmed doctrine. The prior 3-root cap allowed continuations to bypass the spirit of the limit; the new total-tweet cap closes that gap. Kill switch in `cmdPost` is a valid defense-in-depth fix — the direct post path was a genuine bypass. `is_root` column is minimal and necessary for future analytics. CTA text rename is a product naming correction.
- **Step 2 — Delete**: `[DEAD-IMPORT]` `getWorkflowByTemplateAndContextTitle` imported in `arc-workflows/sensor.ts` but never called — this is the **3rd carry** without removal. Creating a follow-up task.
- **Step 3 — Simplify**: The CC x-thread cap in `arc-workflows/sensor.ts` embeds an inline `x_post_log` query. This creates a cross-skill DB dependency: a sensor in `arc-workflows/` knows the schema of `social-x-posting/`'s post log. Cleaner boundary: extract `countXPostsToday()` to `src/db.ts`. Not urgent but worth carrying.
- **Step 4 — Accelerate**: No bottleneck impact.
- **Step 5 — Automate**: No new candidates.

### Flags

- **[ACTION — follow-up created]** Dead import `getWorkflowByTemplateAndContextTitle` in `arc-workflows/sensor.ts` — 3rd carry, removing manually now deferred to P8 haiku task.
- **[CARRY-WATCH]** Cross-skill DB read: `arc-workflows` sensor queries `x_post_log` inline — consider `src/db.ts countXPostsToday()`.
- **[CARRY-WATCH AT THRESHOLD]** context-review skip list ~20 entries — refactor into declarative array on next sensor edit.
- **[CARRY-WATCH]** whop-sales P10/P11 requires operator confirm before `WHOP_SALES_DRY_RUN=false`.
- **[MONITORING]** MCP_TOOL_TIMEOUT=90s — observation window checkpoint 2026-07-01.

---

## 2026-06-26T14:26:00.000Z — no structural changes since last review; active reports processed; 133 skills / 84 sensors

**Task #20018** | Diff: fa42af4 → 73ed189e (1 auto-commit — architect audit log only) | Sensors: 84 | Skills: 133

### Assessment

No structural changes to `src/` or `skills/` since last review (fa42af4). Only the architecture review auto-commit itself appeared in the diff. Diagram remains accurate.

Active reports reviewed: watch reports (01:00Z, 06:00Z overnight brief, 13:01Z). No actionable architectural feedback found. Operational items from watch:
- Council distill stalled 36h+ (upstream `genesis-works/agent-coordination` unchanged — not an Arc architectural issue)
- 14 stuck `public_forum_teaser` workflows resolved by workflow review task #19983
- X thread starvation structurally worked around: `post --reply-to` continuations don't count against 3/day root-post budget

### Carry-watch status

- **[RESOLVED]** `skills/arc-architecture-review/db/*.sqlite*` — `.gitignore` already contains `skills/*/db/*.sqlite` and `skills/*/db/*.sqlite-*`. No tracked SQLite files found. Carry closed after 6 cycles.
- **[CARRY-WATCH AT THRESHOLD]** context-review skip list ~20 entries — refactor into declarative `{pattern: RegExp, reason: string}[]` array on next sensor edit. Threshold was `>20`; we are AT threshold.
- **[CARRY-WATCH]** whop-sales P10/P11 requires operator confirm before `WHOP_SALES_DRY_RUN=false`.
- **[ACTION-NEEDED]** audit-log.md is >600 lines — housekeeping pass needed. Max 5 active entries; archive older entries.

### Flags

- **[RESOLVED 6th-carry]** SQLite gitignore already present — carry closed.
- **[AUDIT-LOG HOUSEKEEPING]** Create follow-up P8/haiku task to trim audit-log.md to 5 active entries.

---

## 2026-06-26T02:30:00.000Z — whop events constants wiring; whop-sales receipt composer; library-only diff; 133 skills / 84 sensors

**Task #19982** | Diff: 79f9bb9 → fa42af4 (2 library-only commits) | Sensors: 84 | Skills: 133

### Changed files

- `skills/whop/lib/events.ts` (fa42af4) — Added imports: `PRODUCT_PAGE_URL`, `PAID_ROOM_PRODUCT_URL`, `PROMO_CODE` from `src/constants.ts`. Wires the P10B product page constants into the events intake layer. No interface or ledger logic changed; the P19 exactly-once contract and poll-coverage-limit carry are unchanged.
- `skills/whop-sales/lib/receipt.ts` (6967dbc4) — NEW pure composer for P10B funnel: `composeReceipt` (receipt post; refuses at `count < 1` to prevent fabricated sale claims) and `composeTeaser` (free slice pointing at the $9 SKU). Deterministic — no LLM, no network, no writes. Posts via `skills/whop-sales/sensor.ts` + `lib/enforcement.ts`, gated behind `WHOP_SALES_DRY_RUN=true` until go-live. Channel doctrine single-sourced in `finalizePost()` (X: link in first reply; forum/nostr: link folded into body). `NEVER_SAY` scan runs post-fold over both fields.

### Steps 1–5

- **Step 1 — Requirements**: Both changes are valid. `events.ts` constants wiring enables the P10B receipt composer to reference the correct product URLs without scattering URL strings across skill files. The `receipt.ts` honesty keystone (`count < 1` refusal, `payingCustomers` discipline, no overclaiming) correctly enforces the trust contract for on-chain identity posts. Requirement remains valid: funnel receipt + teaser must be composable independently from posting logic.
- **Step 2 — Delete**: No new deletion candidates. `receipt.ts` `NEVER_SAY` import is pulled from `lib/compose.ts` — correct reuse, no duplication. Carry-watches from prior audit unchanged (see Flags).
- **Step 3 — Simplify**: `finalizePost()` is the right abstraction — single-sources the link-in-first-reply vs link-in-body channel doctrine so it cannot drift between receipt and teaser composers. The `FinalizedPost` interface is minimal and correct. No over-engineering.
- **Step 4 — Accelerate**: No pipeline impact. These are library files; posting speed is unchanged.
- **Step 5 — Automate**: No new candidates. `WHOP_SALES_DRY_RUN=false` go-live is operator-gated per P10/P11 plan.

### Flags

- **[WATCH]** Thread detection via `subject LIKE '%X thread%'` (from prior audit): naming convention constraint still load-bearing.
- **[MONITORING]** MCP_TOOL_TIMEOUT=90s — 2-week observation window, checkpoint 2026-07-01.
- **[CARRY-WATCH]** `skills/arc-architecture-review/db/*.sqlite*` tracked in git (6th carry) — add to `.gitignore`.
- **[CARRY-WATCH AT THRESHOLD]** context-review skip list ~20 entries — refactor into declarative `{pattern, reason}[]` on next sensor edit.
- **[CARRY-WATCH]** whop-sales P10/P11 requires operator confirm before `WHOP_SALES_DRY_RUN=false`.
- **[AUDIT-LOG SIZE]** audit-log.md now >600 lines — housekeeping pass recommended.

---

## 2026-06-25T14:25:00.000Z — thread starvation fix: cadence beat yields to parked X thread tasks; 133 skills / 84 sensors

**Task #19951** | Diff: 4385020 → 79f9bb9 (1 structural commit) | Sensors: 84 | Skills: 133

### Changed files

- `skills/social-x-posting/sensor.ts` (79f9bb9b) — Thread starvation fix: `runCadenceBeat()` now queries for pending X thread tasks parked >6h before firing. If any found, skips the cadence beat to yield the daily 3-slot budget to threads. Also priority-boosts threads parked >24h to P2 so they win dispatch order against same-priority cadence tasks. Fixes the starvation pattern observed 2026-06-25: threads needing 3-4 posts consistently lost to single-post cadence tasks that queued earlier in the day.

### Steps 1–5

- **Step 1 — Requirements**: Valid. Thread starvation was documented in MEMORY.md (2026-06-25 pattern analysis task #19829). The fix addresses the root cause: cadence posts execute earlier in the day, consuming all 3 X budget slots before thread tasks can queue. The yield gate is the correct lever — skip cadence when threads are waiting, don't raise the overall cap.
- **Step 2 — Delete**: No new deletion candidates. Carry-watches from prior audit unchanged.
- **Step 3 — Simplify**: Implementation is clean. One SQL query to detect stale threads, one loop to boost priority — 30 lines total. No abstraction needed. The `LIKE '%X thread%'` subject pattern is a constraint, not a bug, but it's silent if the naming convention drifts. A `-- [THREAD]` tag or dedicated column would be more robust long-term; acceptable at current scale.
- **Step 4 — Accelerate**: Direct win: threads that arrive after cadence posts have already fired will now get the slot the next cadence cycle skips. P2 boost ensures they can't be starved by other P3+ tasks in the queue.
- **Step 5 — Automate**: No new candidates.

### Flags

- **[WATCH]** Thread detection via `subject LIKE '%X thread%'`: naming convention must be maintained for the yield gate to work. If thread task subjects change format, gate silently disables. Document as a constraint or replace with a dedicated tag column.
- **[MONITORING]** MCP_TOOL_TIMEOUT=90s — 2-week observation window (checkpoint 2026-07-01).
- **[CARRY-WATCH]** `skills/arc-architecture-review/db/*.sqlite*` tracked in git (5th carry) — add to `.gitignore`.
- **[CARRY-WATCH AT THRESHOLD]** context-review skip list ~20 entries — refactor into declarative array on next sensor edit.
- **[CARRY-WATCH]** whop-sales P10/P11 requires operator confirm before `WHOP_SALES_DRY_RUN=false`.

---

## 2026-06-25T02:30:00.000Z — MCP_TOOL_TIMEOUT reduction 120s→90s; no structural diagram changes; 133 skills / 84 sensors

**Task #19919** | Diff: 8ee28f9 → 4385020 (1 structural commit) | Sensors: 84 | Skills: 133

### Changed files

- `src/dispatch.ts` (43850201) — `MCP_TOOL_TIMEOUT` reduced from `120000` to `90000` (120s→90s). Leverages v2.1.191 automatic retry backoff for transient MCP failures. The two-timeout contract remains: `MCP_TOOL_TIMEOUT` = max total call duration (now 90s); `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` = max silence within a call (600s, unchanged). Rationale documented in `research/mcp-timeout-reduction-v2191.md`. First 6h observation: zero timeout failures, max x402 ops 63s (27s margin). Monitoring checkpoint: 2026-07-01.

### Steps 1–5

- **Step 1 — Requirements**: Valid. v2.1.191 retries make shorter timeouts safe. The 90s limit is tighter than the 63s observed maximum (27s margin). Previous 120s was conservative pre-retry. No structural requirement invalidated.
- **Step 2 — Delete**: No new deletion candidates. Carry-watches from prior audit unchanged.
- **Step 3 — Simplify**: Config-only change. No structural simplification possible.
- **Step 4 — Accelerate**: Direct gain: failed MCP calls fail faster (90s vs 120s), freeing the dispatch slot 30s sooner per timeout event. Under normal operation (no timeouts), no change.
- **Step 5 — Automate**: No new candidates.

### Flags

- **[MONITORING]** MCP_TOOL_TIMEOUT=90s — 2-week observation window (checkpoint 2026-07-01). If timeout failures appear, revert to 120s.
- **[CARRY-WATCH]** `skills/arc-architecture-review/db/*.sqlite*` tracked in git (5th carry) — add to `.gitignore`.
- **[CARRY-WATCH AT THRESHOLD]** context-review skip list ~20 entries — refactor into declarative array on next sensor edit.
- **[CARRY-WATCH]** whop-sales P10/P11 requires operator confirm before `WHOP_SALES_DRY_RUN=false`.

---

## 2026-06-24T14:22:00.000Z — reactive lane state-encoding; completedDup auto-advance; migration relocation; reply deprecation; 133 skills / 84 sensors

**Task #19861** | Diff: afd71f6 → 8ee28f9 (4 structural commits) | Sensors: 84 | Skills: 133

### Changed files

- `skills/context-review/sensor.ts` (8ee28f9) — FP fix: blog post titles embedded in "Seed whop chat:" and "Chop blog " task subjects were triggering false-positive skill-coverage warnings. Two new regex exclusions added to `checkMissingSkillCoverage`. Skip list is now at ~20 entries — AT the refactor threshold (`>20` carry-watch).
- `skills/arc-workflows/sensor.ts` (40e68349) — Reactive lane state-encoding: source keys now encode workflow state (`action.source:current_state`). Each `(source, state)` pair is unique so cross-state stale-blocking cannot occur. Returns `"ok"` instead of `"skip"` on stale-block so active monitoring is distinguishable from idle. Diagnostic log line added per block. `prAnyStatePending` check via `pendingTaskExistsForSourcePrefix()` prevents duplicate review tasks during state transitions.
- `src/db.ts` (40e68349) — `pendingTaskExistsForSourcePrefix()` helper added: prefix-based pending check used by reactive lane state-encoding.
- `skills/arc-workflows/sensor.ts` (40bb24ee) — `completedDup` auto-advance: when `completedDup` fires on a workflow in `'opened'` or `'review-requested'`, auto-advances to `'approved'` instead of silently skipping. Unblocked 17 stuck workflows (PRs outside GraphQL last-50 window). Diagnostic logging added.
- `skills/social-engine/005–011 → db/migrations/` (c012b96e) — 7 migration scripts relocated from `skills/social-engine/` to `db/migrations/`. ✅ **[RESOLVED multi-cycle CARRY-WATCH]**
- `skills/social-x-posting/cli.ts + SKILL.md` (03a6bb9b) — `cmdReply` formally deprecated with `[DEPRECATED]` prefix. SKILL.md documents social-engine as canonical reply path. ✅ **[RESOLVED multi-cycle CARRY-WATCH]**

### Step 1 — Requirements

- **Context-review FP fix**: Valid. Blog-title keywords (e.g., "Bitcoin", "Zest") in repurposing task subjects are not skill requirements — the fix correctly scopes exclusions at the subject-pattern level. Two new patterns (`/^Seed whop chat:/i` + `/^Chop blog /i`) are narrow and unambiguous.
- **Reactive lane state-encoding**: Valid and well-designed. Root cause of the 116-tick/0-task anomaly was correct — shared source keys across states caused permanent stale-blocking on completed tasks. State suffix (`:<current_state>`) makes each (workflow, state) context unique. The `pendingTaskExistsForSourcePrefix()` helper correctly prevents double-queuing during transitions.
- **completedDup auto-advance**: Valid fix for a structural gap. `completedDup` was a read-only check with no write path — it could correctly identify a reviewed PR but had no way to close the workflow when the PR fell outside the GraphQL window. Auto-advance to `'approved'` is the correct terminal action.
- **Migration relocation**: Valid. `db/migrations/` is the correct home for one-shot schema scripts; `skills/` is for reusable skill code. Clear separation.
- **Reply deprecation**: Valid. Formal documentation of an already-complete migration. Passthrough retained for backwards compatibility — zero-risk deprecation.

### Step 2 — Delete

- **[NEW-WATCH]** Dead import `recentTaskExistsForSource` carry-watch was a false positive: the identifier only appears in lint regex strings in `arc-skill-manager/sensor.ts` (lines 57, 62, 66) — never as an actual import. Import line 4 confirms only `pendingTaskExistsForSource` + `getLastCompletedTaskBySource` are imported. **Marking as RESOLVED.**
- **[CARRY-WATCH]** `skills/arc-architecture-review/db/*.sqlite*` tracked in git — add `.gitignore` entry (SQLite binaries, 4th carry).
- **[CARRY-WATCH]** context-review skip list now at ~20 entries — AT THRESHOLD. Refactor into a declarative exclusion list (array of `{pattern, reason}`) on next edit of sensor.ts.
- **[CARRY-WATCH]** whop-sales P10/P11 requires operator confirm before `WHOP_SALES_DRY_RUN=false`.

### Step 3 — Simplify

- `pendingTaskExistsForSourcePrefix()` is the right primitive — narrow SQL `LIKE` query. The state-suffix pattern is consistent with existing source-key conventions.
- context-review skip list at ~20 entries warrants a refactor: array of `{pattern: RegExp, reason: string}` pairs would replace the 20 if-chains and make the list auditable in one glance. Not urgent but correct direction.
- `completedDup` auto-advance adds 6 lines inside an existing branch — correct, no over-engineering.

### Step 4 — Accelerate

- Reactive lane fix: 116-tick/0-task cycles → active monitoring. Direct queue throughput gain (~17 recovered workflow slots).
- Migration relocation: `skills/social-engine/` is now leaner — pre-commit hook lints fewer files per commit.

### Step 5 — Automate

- context-review skip list refactor: a declarative array + `.some()` loop is automatable — if pattern list stays in an exported constant, future additions would never require sensor.ts structural changes.

### Flags

- **[RESOLVED]** Reactive lane 116-tick/0-task anomaly — state-encoding + completedDup auto-advance ✓
- **[RESOLVED]** social-engine migration scripts relocated to `db/migrations/` ✓
- **[RESOLVED]** social-x-posting reply command formally deprecated ✓
- **[RESOLVED]** Dead import `recentTaskExistsForSource` carry-watch was a false positive — never imported ✓
- **[CARRY-WATCH]** `skills/arc-architecture-review/db/*.sqlite*` tracked in git (4th carry) — add to `.gitignore`.
- **[CARRY-WATCH AT THRESHOLD]** context-review skip list ~20 entries — refactor into declarative array on next sensor edit.
- **[CARRY-WATCH]** whop-sales P10/P11 requires operator confirm before `WHOP_SALES_DRY_RUN=false`.

---

