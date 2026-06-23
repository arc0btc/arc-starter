## 2026-06-23T14:22:00.000Z — whop state-aware dedup; dispatch-gate credential refactor; social-engine monitors; x402-pull-loop relocated; 131 skills / 82 sensors

**Task #19755** | Diff: 0a6d7ff → 6ca863f (6 structural commits) | Sensors: 82 | Skills: 131

### Changed files

- `src/db.ts` (3054e64b) — `getTaskStatusForSource()` added: returns most-recent task status for a source key (or null). Enables state-aware dedup — callers can distinguish in-flight (pending/active) from terminal (completed/failed/blocked) without a second query.
- `skills/whop/sensor.ts` + `skills/whop/cli.ts` (3054e64b) — `pollWhopReplies()` now branches on `getTaskStatusForSource()` result: terminal tasks emit "already_replied", in-flight tasks emit "already_queued". Fixes the 116-tick/0-task anomaly (all showing `already_queued` when they were actually `already_replied`). `debug-reply-dedup` CLI added for diagnosing message dedup state.
- `src/dispatch-gate.ts` (5d7c44e5) — `loadDiscordToken()` refactored from `execFileSync(bash, [...])` subprocess with hardcoded `/home/dev/.bun/bin/bun` path to `await getCredential("discord", "bot_token")` import. Eliminates subprocess spawn overhead and fragile path hardcoding.
- `skills/social-engine/monitor-post-lane.ts`, `monitor-reply-lane.ts`, `north-star-gauge.ts` (7497edbe, 6b221794) — observability monitoring scripts for post/reply lanes and north-star KPI. Not sensor.ts files — CLI-invoked, not auto-executed.
- `skills/x402-pull-loop/SKILL.md` + `cli.ts` (7a669968) — relocated from loose `skills/x402-pull-loop.ts` at skills root to proper `skills/x402-pull-loop/` skill directory. **[RESOLVED]** carry-watch from 2026-06-23T02:30Z audit.
- `.gitignore` (f0086f37) — `*.bak` and `*.bak-*` added. **[RESOLVED]** carry-watch; also covers the `admission.ts.bak-m0p0b` naming convention used by social-engine.
- Cache files + web assets — non-structural.

### Step 1 — Requirements

- **`getTaskStatusForSource()`**: Valid. The binary `pendingTaskExistsForSource()` was insufficient for surfacing accurate skip reasons — the anomaly (116 ticks/0 tasks) required distinguishing why tasks were being skipped. The new primitive is narrow (SELECT status + ORDER BY id + LIMIT 1) and correctly exposes the most recent terminal state.
- **`loadDiscordToken()` refactor**: Valid simplification. The `execFileSync` approach spawned a shell process for a simple credential read — fragile, path-dependent, and inconsistent with how every other credential read in the codebase works.
- **`debug-reply-dedup` CLI**: Valid. Diagnose-ability is a prerequisite for operating a dedup-gated lane. One-liner output per message in the current window.
- **Social-engine monitors**: Valid. Active production system; monitoring scripts are correct additions.
- **x402-pull-loop relocation**: Valid compliance fix. The 4-file skill pattern is required for pre-commit lint coverage.

### Step 2 — Delete

- **[CARRY-WATCH]** Dead import `recentTaskExistsForSource` in `skills/arc-skill-manager/sensor.ts` (line 4): imported but only appears in string literals/regex — never called as a function in this file. Remove from import on next edit.
- **[CARRY-WATCH]** `social-x-posting -- reply` CLI passthrough — still present; remove or deprecate once social-engine reply lane confirmed stable.
- **[CARRY-WATCH]** `social-engine/*.ts` migration scripts (005–011) — still in skill dir vs `db/migrations/`.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20.
- **[CARRY-WATCH]** `skills/arc-architecture-review/db/*.sqlite*` tracked in git (`arc.sqlite`, `arc.sqlite-shm`, `arc.sqlite-wal`). No `.gitignore` entry for `skills/arc-architecture-review/db/` — add it. SQLite binaries are binary, volatile, and should not be versioned.

### Step 3 — Simplify

- `getTaskStatusForSource()` follows the same pattern as existing db.ts query helpers. Correctly narrow. No simplification needed.
- `loadDiscordToken()` is now simpler — one await, no subprocess, no hardcoded path. Pattern is correct. Replicate this pattern if any other `execFileSync(bash,["credential-read"])` calls exist in src/.
- `debug-reply-dedup` is a diagnostic CLI, not a sensor. Correct placement.

### Step 4 — Accelerate

- `loadDiscordToken()` refactor: removes a subprocess spawn (~8s timeout path) from the auth-alert code path. Minor but directionally correct.
- State-aware dedup: the anomaly (116 ticks/0 tasks from `already_queued` labeling) was inflating reactive-lane skip counters but not blocking real work. Fix clarifies signal, no throughput change.

### Step 5 — Automate

- `skills/arc-architecture-review/db/` sqlite files: one `.gitignore` line prevents recurrence. Follow-up task warranted.

### Flags

- **[RESOLVED]** `skills/x402-pull-loop.ts` at skills root → `skills/x402-pull-loop/` with SKILL.md ✓
- **[RESOLVED]** `*.bak` / `*.bak-*` added to `.gitignore` ✓
- **[CARRY-WATCH]** `skills/arc-architecture-review/db/*.sqlite*` tracked in git — add to `.gitignore`.
- **[CARRY-WATCH]** Dead import `recentTaskExistsForSource` in `skills/arc-skill-manager/sensor.ts` — remove on next edit.
- **[CARRY-WATCH]** `social-x-posting -- reply` CLI passthrough — remove or deprecate.
- **[CARRY-WATCH]** `social-engine/*.ts` migration scripts (005–011) — relocate to `db/migrations/`.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20.
- **[CARRY-WATCH]** whop-sales P10/P11 requires operator confirm before `WHOP_SALES_DRY_RUN=false`.

---

## 2026-06-23T02:30:00.000Z — Discord auth alert; retry watchdog; P4 reply hardening; $9 tripwire; reply-copy-pool; 132 skills / 84 sensors

**Task #19703** | Diff: c42bf23 → 0a6d7ff (5 auto-commits) | Sensors: 84 | Skills: 132

### Changed files

- `src/dispatch.ts` (0a6d7ff) — `CLAUDE_CODE_RETRY_WATCHDOG=5` added. Limits internal API-call retries per subprocess to 5; after that, subprocess exits and ARC-0011 takes over. Prevents flaky API from holding the dispatch slot for the full outer timeout.
- `src/dispatch-gate.ts` (e2b78af7, cc102e64) — Discord auth-outage alert added (M0-P0a). Auth-class gate stops fire a deduped (4h) Discord bot message with literal `/login` remediation. Loads `ARC_DISCORD_TOKEN` from env or credentials store; fire-and-forget, non-blocking. Dedup file: `db/hook-state/oauth-discord-alert.json`.
- `src/constants.ts` (afcbffde) — `$9 tripwire` product constants: `TRIPWIRE_PRODUCT_ID`, `TRIPWIRE_PLAN_ID`, `TRIPWIRE_PAGE_URL`, `TRIPWIRE_CHECKOUT_URL`. Entry SKU for the report stream.
- `skills/social-engine/admission.ts` (db2d41d5, afcbffde) — P4 hardening: `reply_daily_cap` default 40→3; `missing_account_id` fail-closed guard; conversation burst check moved inside CAS txn (TOCTOU fix); `conversation_ref` column added to `outbound_action`.
- `skills/social-engine/reply-send.ts` (db2d41d5) — GUARD 1 (target-age) added: blocks replies to tweets older than `reply_target_age_hours` (default 48h); `missing_tweet_age` if `tweetCreatedAt` not supplied.
- `skills/social-engine/reply-copy-pool.ts` (afcbffde) — NEW: copy pool for reply composing.
- `skills/social-engine/reply-watchlist-sensor.ts` (afcbffde) — NEW: watchlist producer for reply lane.
- `skills/x402-pull-loop.ts` (afcbffde) — **[NEW-WATCH]** loose `.ts` file at `skills/` root, not inside any named skill directory. Breaks 4-file skill pattern.
- `skills/social-engine/reply-copy-pool.ts.bak` (afcbffde) — **[NEW-WATCH]** `.bak` file committed to git. Should not be versioned.
- `skills/arc-reporting/AGENT.md` (afcbffde) — updated (content not structurally significant).
- `skills/social-x-posting/cli.ts` (cc102e64, afcbffde) — updated.

### Step 1 — Requirements

- **Retry watchdog**: Valid. Subprocess-level retry cap (5) and task-level ARC-0011 retries are independent, non-conflicting layers. The auth-outage that caused 35h silence would have benefited from this — auth errors remain non-retryable, but unknown transient blips now exit fast.
- **Discord auth alert**: Valid and well-designed. Auth failures require human action; Discord message carries the exact commands. 4h dedup prevents flood. Fire-and-forget avoids blocking gate path. Complements email notification.
- **P4 reply hardening**: Valid. Triggered by operator incident (outbound_action ids 7, 8 — week-old necro-replies with `account_id=NULL`). Both guards fail closed. GUARD 2 moved inside CAS txn is correct — the old TOCTOU window was a real race condition.
- **$9 tripwire SKU**: Valid product constant. Must read identically across Whop, arc0btc.com, and x402 accepts[].
- **reply-copy-pool + watchlist-sensor**: Valid new producers for the reply lane.

### Step 2 — Delete

- **[NEW-WATCH]** `skills/x402-pull-loop.ts` is a loose `.ts` file at the `skills/` root — not inside any named skill directory. Either create `skills/x402-pull-loop/` and move it, or relocate to `src/` if it's infrastructure. Current location breaks the 4-file skill pattern and bypasses the pre-commit lint hook.
- **[NEW-WATCH]** `skills/social-engine/reply-copy-pool.ts.bak` — `.bak` file committed. Add to `.gitignore` or delete and commit.
- **[CARRY-WATCH]** Dead import `recentTaskExistsForSource` in `arc-skill-manager/sensor.ts` — still pending.
- **[CARRY-WATCH]** `social-x-posting -- reply` CLI passthrough — remove or deprecate once social-engine reply lane confirmed stable.
- **[CARRY-WATCH]** `social-engine/*.ts` migration scripts (005–011) — relocate to `db/migrations/`.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20.

### Step 3 — Simplify

- Retry watchdog adds one env var, no structural change. Simple and correct.
- Discord alert uses `execFileSync(bash, ["-c", ...])` with absolute paths to load the credentials CLI. Pattern is consistent with other credential reads in the codebase. No simplification needed.
- P4 admission hardening is additive (new guards inside existing function). The function is getting long — acceptable at current complexity. Monitor if further guards are added.

### Step 4 — Accelerate

- Retry watchdog: direct throughput gain. Prevents one flaky API call from holding the dispatch slot for 30–90min. Estimated impact: a few held-slot rescues per week at current API stability.

### Step 5 — Automate

- `.bak` file prevention: add `*.bak` to `.gitignore` — one-line, prevents recurrence.
- `skills/x402-pull-loop.ts` relocation: create `skills/x402-pull-loop/` with a proper `SKILL.md` on next edit of that file.

### Flags

- **[NEW-WATCH]** `skills/x402-pull-loop.ts` at skills root — relocate to `skills/x402-pull-loop/x402-pull-loop.ts` (or `src/`) and add `SKILL.md`.
- **[NEW-WATCH]** `skills/social-engine/reply-copy-pool.ts.bak` committed — delete + add `*.bak` to `.gitignore`.
- **[CARRY-WATCH]** `skills/arc-architecture-review/db/*.sqlite*` committed (flagged 2026-06-22) — add `skills/arc-architecture-review/db/` to `.gitignore`.
- **[CARRY-WATCH]** Dead import `recentTaskExistsForSource` in `arc-skill-manager/sensor.ts`.
- **[CARRY-WATCH]** `social-x-posting -- reply` CLI passthrough — deprecate once social-engine reply stable.
- **[CARRY-WATCH]** `social-engine/*.ts` migration scripts (005–011) — relocate to `db/migrations/`.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20.
- **[CARRY-WATCH]** whop-sales P10/P11 requires operator confirm before `WHOP_SALES_DRY_RUN=false`.
- **[AUDIT-LOG SIZE]** audit-log.md growing — housekeeping pass on entries older than 14d recommended.

---

## 2026-06-22T14:30:00.000Z — HANDOFF skills propagation; OpenRouter routing narrowed; whop room-hash dedup; 132 skills / 84 sensors

**Task #19646** | Diff: 451fd59 → c42bf23 (4 structural commits) | Sensors: 84 | Skills: 132

### Changed files

- `src/dispatch.ts` (c42bf23) — HANDOFF skills propagation: `escalateToHandoff()` now copies `task.skills` to the blocked follow-up task.
- `src/dispatch.ts` (e56631fc) — OpenRouter routing narrowed: removed `!!openRouterKey` as implicit trigger; now explicit only.
- `src/openrouter.ts` (e56631fc) — Haiku model ID: `claude-haiku-4-5-20251001` → `claude-haiku-4-5`.
- `skills/whop/sensor.ts` (869abe98) — Room-hash dedup on synthesis lane. State file: `db/whop-synthesis-state.json`.
- `skills/social-engine/cli.ts` + `skills/social-x-posting/cli.ts` (391fcdaf) — Compliance renames only. No behavioral change.
- `skills/arc-architecture-review/db/*.sqlite*` — SQLite binaries committed via auto-commit loop. [NEW-WATCH] below.

### Step 1 — Requirements

- **HANDOFF skills copy**: Valid correctness fix. Skills array was lost on escalation — whoabuddy re-dispatch ran without SKILL.md context. Copy is cheap, context is critical.
- **OpenRouter routing narrowed**: Valid simplification. Implicit routing on key presence was a footgun — any deploy with an OpenRouter key silently rerouted all tasks. Now requires explicit intent (`model=openrouter:*` or `DISPATCH_MODE=openrouter`).
- **Haiku model ID**: Maintenance. Unpinned the dated suffix; follows the same pattern as opus/sonnet (no date component).
- **Room-hash dedup**: Valid efficiency improvement. Idle room during dispatch outage recovery accumulated stale "read the room" sessions. Hash gate eliminates no-op dispatch cycles.

### Step 2 — Delete

- **[CARRY-WATCH]** Dead import `recentTaskExistsForSource` in `arc-skill-manager/sensor.ts` — still pending.
- **[CARRY-WATCH]** `social-x-posting -- reply` CLI passthrough still present — formally deprecate or remove once social-engine lane confirmed stable.
- **[CARRY-WATCH]** `social-engine/*.ts` migration scripts (005–011) in skill dir — belongs in `db/migrations/`.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20.
- **[NEW-WATCH]** `skills/arc-architecture-review/db/*.sqlite*` committed to git (auto-commit loop). Add `skills/arc-architecture-review/db/` to `.gitignore`. SQLite files are binary, volatile, and should not be versioned.

### Step 3 — Simplify

- OpenRouter narrowing removes implicit coupling. Correct. The pattern now matches how `model=codex` routing works — explicit tier, not inferred from env state.
- Room-hash state file (`db/whop-synthesis-state.json`) follows the established sensor state pattern (`db/hook-state/*.json` family). Only difference: stored at `db/` root rather than `db/hook-state/`. Worth migrating to `db/hook-state/whop-synthesis.json` on next sensor edit for consistency.

### Step 4 — Accelerate

- Room-hash dedup: direct dispatch throughput gain. Each skipped idle synthesis session reclaims a dispatch slot (~6–15 min) for real queue work.

### Step 5 — Automate

- The SQLite commit issue is automatable at the gitignore level. One-line fix prevents recurrence.

### Flags

- **[NEW-WATCH]** `skills/arc-architecture-review/db/*.sqlite*` in git — add to `.gitignore`.
- **[NEW-WATCH]** `db/whop-synthesis-state.json` inconsistency with `db/hook-state/` pattern — migrate on next sensor edit.
- **[CARRY-WATCH]** Dead import `recentTaskExistsForSource` in `arc-skill-manager/sensor.ts`.
- **[CARRY-WATCH]** `social-x-posting -- reply` CLI passthrough — remove or deprecate.
- **[CARRY-WATCH]** `social-engine/*.ts` migration scripts — relocate to `db/migrations/`.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20.
- **[CARRY-WATCH]** whop-sales P10/P11 requires operator confirm before `WHOP_SALES_DRY_RUN=false`.

---

## 2026-06-22T03:30:00.000Z — reply-lane consolidation; social-engine SKILL.md + admission.ts; 132 skills / 84 sensors

**Task #19519** | Diff: 3b071cd → 451fd59 (5 commits — reply-lane consolidation, social-engine SKILL.md) | Sensors: 84 | Skills: 132

### Changed files

- `skills/social-engine/SKILL.md` — **NEW** (c901ca32). Closes the [NEW-WATCH: CRITICAL] from 2026-06-20 audit. skill is now loadable, lintable, pre-commit compliant.
- `skills/social-engine/admission.ts` — shared admission primitive formalized in SKILL.md
- `skills/social-engine/cli.ts`, `reply-send.ts`, `fixture-reply-consolidation.ts`, `live-send-moltbook-post.ts`, `follow-curated.ts` — P7 Moltbook + reply-lane scripts added/updated
- `skills/social-x-posting/AGENT.md` — thread posting updated: own-thread continuation now uses `post --reply-to`, NOT `reply` command
- `skills/social-x-posting/cli.ts`, `sensor.ts` — mention reply tasks now route through `social-engine -- reply`; skills context includes `social-engine`
- `skills/arc-workflows/state-machine.ts` — ContentCalendarMachine instruction updated: use `post --reply-to` for thread continuation (reply-lane consolidation 2026-06-20)
- `skills/whop-sales/sensor.ts` — pitch task instructions updated: initial reply via `social-engine -- reply`, CTA via `post --reply-to` (POST lane)

### Step 1 — Requirements

- **Reply-lane consolidation (2026-06-20)**: The `reply` command in `social-x-posting` is now reserved exclusively for replies to OTHER accounts, routing through the social-engine unified sender. Own-thread continuation uses `post --reply-to` (POST lane). This is architecturally correct — the two actions have different semantics (replying to a peer vs. extending your own thread), different budgets, and different dedup contracts.
- **`social-engine` SKILL.md**: Closes the most-urgent gap from the last review. Skill is now a first-class member of the skill tree.
- **[CLOSED] absolute-path concern** partially addressed: social-engine is now a proper skill; migration scripts should still move to `db/migrations/` on next pass.

### Step 2 — Delete

- **[NEW-WATCH]** `social-x-posting -- reply` is still in `cli.ts` — it now delegates to social-engine. If delegation is complete, the direct-reply code path in `social-x-posting` can be removed to reduce dual-maintenance risk. Evaluate once social-engine reply lane is confirmed stable.
- **[CARRY-WATCH]** Dead import `recentTaskExistsForSource` in `arc-skill-manager/sensor.ts` — still pending.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20.
- **[CARRY-WATCH]** `social-engine/*.ts` migration scripts still in skill directory — belongs in `db/migrations/` (005–011 are one-shot migrations, not reusable skill CLI).

### Step 3 — Simplify

- **admission.ts** is the right pattern: single choke point for kill-switch, idempotency, cap, and CAS. All outbound social actions should flow through it. Current wiring: P3 (reply) and P4 (post) use it. Check P7 (Moltbook) when it goes live.
- The two-command pattern (`reply` for others, `post --reply-to` for self) is simple and correct. The risk is callers forgetting the distinction. AGENT.md and state-machine.ts now document it explicitly.

### Step 4 — Accelerate

No pipeline bottlenecks identified. Reply-lane admission.ts CAS claim is synchronous BEGIN EXCLUSIVE — correct for SQLite single-writer, no concern.

### Step 5 — Automate

No new candidates. Monitor whether `social-x-posting -- reply` delegation to social-engine can be made implicit (remove from CLI surface entirely).

### Flags

- **[CLOSED]** `skills/social-engine/` had no SKILL.md — resolved ✓ (c901ca32)
- **[NEW-WATCH]** `social-x-posting -- reply` CLI still present as passthrough. Remove or formally deprecate once social-engine reply lane is stable.
- **[CARRY-WATCH]** `social-engine/*.ts` migration scripts (005–011) belong in `db/migrations/` — not skill code.
- **[CARRY-WATCH]** Dead import `recentTaskExistsForSource` in `arc-skill-manager/sensor.ts`.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20.
- **[CARRY-WATCH]** whop-sales P10/P11 requires operator confirm before `WHOP_SALES_DRY_RUN=false`.
- **[AUDIT-LOG SIZE]** audit-log.md is ~3930 lines — housekeeping pass critically needed. Queue a P8/haiku housekeeping task.

---

## 2026-06-20T02:20:00.000Z — social-engine migration scripts added, dead import cleaned; 131 skills / 84 sensors

**Task #19480** | Diff: 1a7c453 → 3b071cd (1 structural commit; social-engine bulk add) | Sensors: 84 | Skills: 131

### Changed files

- `skills/social-engine/` — 25 new TypeScript files across 2 commits: migration scripts (005-p3 through 011-p7), shared library (`admission.ts`), fixtures, producers (github-release, hn, reddit, rss), monitors (post-lane, reply-lane), and live-read/live-send scripts. **No `SKILL.md` present.**
- `skills/arc-workflows/sensor.ts` — dead import `getWorkflowByTemplateAndContextTitle` removed (f893c51e). Closes [NEW-WATCH] from 2026-06-19T14:20Z audit.
- `skills/arc-link-research/cache/` — cache files only, not structural.

### Step 1 — Requirements

- **`skills/arc-workflows/sensor.ts` cleanup**: dead import removed. Valid, no new requirement.
- **`skills/social-engine/`**: 25 TS files added representing a social posting engine: admission primitive (kill-switch, idempotency, cap checks, atomic CAS claim), reply/post pipelines (P3–P7), content producers (HN, Reddit, RSS, GitHub releases), monitors, and a Moltbook DB migration. The Moltbook file (011-p7) explicitly guards attribution (OBSERVED class only, no person-level joins). This is a real new system — requirements appear valid.

### Step 2 — Delete

**[CLOSED]** Dead import `getWorkflowByTemplateAndContextTitle` in `skills/arc-workflows/sensor.ts` — removed. ✓

No new deletion candidates.

Carry-watches:
- **[CARRY-WATCH]** Dead import `recentTaskExistsForSource` in `arc-skill-manager/sensor.ts` — still pending cleanup.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20. No growth.
- **[CARRY-WATCH]** AI-XXX breadcrumb accumulation — review at AI-200+.

### Step 3 — Simplify

**[NEW-WATCH: CRITICAL]** `skills/social-engine/` has 25 TS files but no `SKILL.md`. This breaks the 4-file skill pattern — the skill is invisible to `arc skills show`, not loadable via the `skills` column in tasks, and bypasses the pre-commit lint hook. Two paths:
1. If this is a permanent skill: add `SKILL.md` with frontmatter (name, description, tags) and a `disallowed-tools` list appropriate for a library/migration skill.
2. If these are one-shot migration scripts: relocate to `db/migrations/` or a `scripts/` directory where migration code lives — not under `skills/`.

The pipeline files reference absolute paths (`/home/dev/arc-starter/`, `/home/dev/.bun/bin/bun`) — fragile for a version-controlled codebase. Should use relative paths or env-var overrides.

`admission.ts` is a reusable library primitive (kill-switch, idempotency, cap, CAS). Good factoring. Import path in the file comment references `ops/lib/social-engine/admission.ts` but the actual location is `skills/social-engine/admission.ts` — comment is stale.

### Step 4 — Accelerate

The `admission.ts` shared primitive reduces the P3/P4 code paths that had inline state machine logic duplicated. Correct direction.

### Step 5 — Automate

No new candidates.

### Flags

- **[NEW-WATCH: CRITICAL]** `skills/social-engine/` has no `SKILL.md` — add one or relocate to `db/migrations/`. Pre-commit hook cannot lint it; skill system cannot load it.
- **[NEW-WATCH]** `skills/social-engine/*.ts` references absolute paths (`/home/dev/arc-starter/`). Use relative paths or `process.env` lookups for portability.
- **[NEW-WATCH]** `admission.ts` import path comment is stale (`ops/lib/social-engine/` vs actual `skills/social-engine/`).
- **[CLOSED]** Dead import `getWorkflowByTemplateAndContextTitle` — resolved ✓
- **[CARRY-WATCH]** Dead import `recentTaskExistsForSource` in `arc-skill-manager/sensor.ts`.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20.
- **[CARRY-WATCH]** whop Phase 2 → live gates: ≥1 dry-run POST passes voice review + overnight soak + whoabuddy sign-off → flip `WHOP_SYNTHESIS_DRY_RUN=false`.
- **[CARRY-WATCH]** ContentCalendarMachine Tier A: only config flags + whoabuddy approval remain.
- **[CARRY-WATCH]** whop-sales P10/P11 flip requires operator confirm before `WHOP_SALES_DRY_RUN=false`.

---

## 2026-06-19T14:20:00.000Z — double-post dedup hardened, double-reply fix; 129 skills / 82 sensors

**Task #19412** | Diff: 97816f1 → 1a7c453 (2 structural commits) | Sensors: 82 | Skills: 129

### Changed files

- `src/db.ts` — `findWorkflowByNormalizedTitleOrUrl()` added
- `skills/arc-workflows/sensor.ts` — `syncContentCalendar()` updated to use normalized dedup
- `skills/social-x-posting/sensor.ts` — mention reply dedup hardened
- `skills/arc-brand-voice/VOICE-TUNING-2026-06.md` — new voice calibration doc (non-structural)

### Step 1 — Requirements

3 substantive changes, all valid recurrence fixes:

- **`findWorkflowByNormalizedTitleOrUrl` (2fa42c9f)**: The exact-title check from fix #19298 missed case/whitespace/punctuation variants of near-identical titles and only scanned `content-calendar`. The double-post recurred. Normalized JS comparison across 3 templates is the correct fix.
- **Double-reply fix (2fa42c9f)**: A completed mention-reply task was not blocking re-queue when the mention resurfaced. `dedupMode="any"` and a `--source` flag on the reply CLI instruction close this. Required.
- **Voice tuning doc (1a7c453)**: Captures whoabuddy's feedback on post altitude. Non-structural; valid ops asset.

### Step 2 — Delete

**[NEW]** `getWorkflowByTemplateAndContextTitle` is imported in `skills/arc-workflows/sensor.ts` (line 11) but has no call site — dead import. Remove on next sensor edit.

Carry-watches from prior audit:
- **[CARRY-WATCH]** Dead import `recentTaskExistsForSource` in arc-skill-manager/sensor.ts — pending cleanup.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20. No growth.
- **[CARRY-WATCH]** AI-XXX breadcrumbs — review at AI-200+.

### Step 3 — Simplify

`findWorkflowByNormalizedTitleOrUrl` fetches all workflows for target templates via SQL, then normalizes titles in JS. Correct approach (can't normalize in SQLite without custom functions), but O(n) in workflow count. At current scale acceptable. Flag for a `json_extract(context,'$.title')` index if workflow table grows past ~5k rows.

The normalized check supersedes `getWorkflowByTemplateAndContextTitle` for cross-template use cases — the old function is now dead code in `sensor.ts` (see Step 2).

### Step 4 — Accelerate

The double-post and double-reply fixes prevent wasted X dispatch cycles and false failure noise. Indirect improvement to task throughput.

### Step 5 — Automate

No automation candidates.

### Flags

- **[NEW-WATCH]** Dead import `getWorkflowByTemplateAndContextTitle` in `skills/arc-workflows/sensor.ts` — clean up on next edit.
- **[NEW-WATCH]** `findWorkflowByNormalizedTitleOrUrl` is an O(n) JS table scan — acceptable now, add index path at >5k workflow rows.
- **[CARRY-WATCH]** whop Phase 2 → live gates: ≥1 dry-run POST passes voice review + overnight soak + whoabuddy sign-off → flip `WHOP_SYNTHESIS_DRY_RUN=false`.
- **[CARRY-WATCH]** ContentCalendarMachine Tier A: double-post technical blocker cleared; only config flags + whoabuddy approval remain.
- **[CARRY-WATCH]** whop-sales P10/P11 flip requires operator confirm before `WHOP_SALES_DRY_RUN=false`.

---

## 2026-06-19T02:15:00.000Z — cache-only diff, no structural changes; 129 skills / 82 sensors

**Task #19383** | Diff: a642c7b → 97816f1 (0 structural commits) | Sensors: 82 | Skills: 129

### Assessment

The sensor triggered on SHA change but the entire diff is `skills/arc-link-research/cache/*.json` files — pure data writes from the research batch (task #19351). No changes to `src/`, `skills/*.ts`, or any `SKILL.md`/`sensor.ts`/`cli.ts` files. State machine diagram remains accurate.

### Steps 1–5

All five principles pass with no action items. The carry-watches from the prior audit are unchanged:

- **[CARRY-WATCH]** Dead import `recentTaskExistsForSource` in arc-skill-manager/sensor.ts — pending cleanup on next sensor edit.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20. No growth.
- **[CARRY-WATCH]** AI-XXX breadcrumb accumulation — review at AI-200+.
- **[CARRY-WATCH]** whop Phase 2 → live gates: ≥1 dry-run POST + overnight soak + whoabuddy sign-off → flip `WHOP_SYNTHESIS_DRY_RUN=false`.
- **[CARRY-WATCH]** ContentCalendarMachine Tier A: double-post blocker cleared; only config flags + whoabuddy approval remain.

### Watch report observations

- Dispatch-session-is-a-fork pattern confirmed (task #19351) and captured in `memory/patterns.md`. Diagram note for DispatchService already covers this implicitly (no fan-out subagents in dispatch).
- 6 consecutive arXiv distills on coordination/dispatch architecture — synthesis task recommended when research sprint slot opens (see MEMORY.md arXiv clusters).
- Inflow/outflow near-healthy (18 consumed vs 16 produced); council at 0 (no upstream), whop-signal paused. Monitor snippet production pace.

---

## 2026-06-18T14:16:00.000Z — double-post fix, verbose-naming compliance; 129 skills / 82 sensors

**Task #19316** | Diff: 93ec01f → a642c7b (2 structural commits) | Sensors: 82 | Skills: 129

### Step 1 — Requirements

2 structural commits since last review. No `src/dispatch.ts` or `src/sensors.ts` changes. Both changes are skill-layer fixes.

- **Double-post fix (a642c7b)**: `syncBlogPublishes()` now checks `getWorkflowByInstanceKey('content-calendar:<postId>')` before creating a publish-fanout workflow. Root cause: both `publish-fanout:<slug>:x` and `content-calendar:<slug>:x` used distinct `--source` keys, so `x_post_log` dedup couldn't catch the collision. Pattern: any two workflows that share an X posting step must use the same source key OR gate on each other's existence at creation time. The existence-gate approach is correct here — content-calendar supersedes publish-fanout (richer 2-3 tweet thread vs single post).
- **Verbose-naming fix (609268e)**: `msg` → `errorMessage` in `social-x-posting/sensor.ts` mentions error handler. Pre-commit hook compliance; no behavioral change.

### Step 2 — Delete

No deletion candidates from this diff. Carry-watches from prior audit remain unchanged:
- **[CARRY-WATCH]** Dead import `recentTaskExistsForSource` in arc-skill-manager/sensor.ts — pending cleanup on next sensor edit.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20.
- **[CARRY-WATCH]** AI-XXX breadcrumb accumulation — review at AI-200+.

### Step 3 — Simplify

The existence-gate pattern in `syncBlogPublishes()` is the right fix, but it creates implicit ordering: content-calendar must be created before publish-fanout. Currently satisfied because content-calendar is created by the sensor's `syncContentCalendar()` (runs before `syncBlogPublishes()`). Worth documenting this invariant in the function comment if it's not already clear.

### Step 4 — Accelerate

No changes. The double-post fix prevents wasted X post tasks and dedup confusion — indirect dispatch savings.

### Step 5 — Automate

No automation candidates from this diff.

### Flags

- **[RESOLVED task #19298 2026-06-18]** Double-post root cause closed — content-calendar existence gate in syncBlogPublishes().
- **[CARRY-WATCH]** whop Phase 2 → live gates: ≥1 dry-run POST passes voice review + overnight soak + whoabuddy sign-off → flip `WHOP_SYNTHESIS_DRY_RUN=false`.
- **[CARRY-WATCH]** whop-sales P10/P11 flip requires operator confirm before `WHOP_SALES_DRY_RUN=false`.
- **[CARRY-WATCH]** ContentCalendarMachine Tier A gated — double-post technical blocker cleared 2026-06-18; only config flag changes + whoabuddy approval remain.

---

