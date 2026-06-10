## 2026-06-10T14:54:00.000Z — ARC-0011 escalation ladder shipped; CEO-review dedup fix; 120 skills / 73 sensors

**Task #18530** | Diff: 6def33c → HEAD (3 structural commits) | Sensors: 73 | Skills: 120

### Step 1 — Requirements

**Structural commits this window:**
- **feat(dispatch): implement ARC-0011 escalation ladder** (e94a430c): Replaces flat retry-then-fail with REFINE→PIVOT→WEB-SEARCH→HANDOFF. `escalationRung()` computes rung from `escalation_rung`, `pivot_count`, `dead_ends` on the task row. `buildEscalationContext()` injects rung-specific prompt block — empty for REFINE (backward compatible), dead-ends log for PIVOT, web-search permissions for WEB-SEARCH. HANDOFF blocks task and creates `[ESCALATED]` follow-up assigned to whoabuddy. `max_retries` is now the HANDOFF threshold (new tasks default to 7). Recurring-error detection (≥3 same-subject failures in 7d) skips REFINE and enters PIVOT. Auth/timeout/rate-limit short-circuits unchanged. Major dispatch behavioral change.
- **fix(arc-ceo-review): pre-flight dedup check by period** (54eebe04): `extractPeriodFromFilename()` + `pendingTaskExistsForSource("ceo-review:{period}")` added before workflow creation. Resolves duplicate CEO review from 2026-06-09T21:29Z audit. ~$0.64/event recovered.
- **chore: add recentTaskExistsForSource import to arc-skill-manager/sensor.ts** (52775e83): Import added but not visibly used in the diff — dead import.

**Watch report 2026-06-10T14:03Z highlights:**
- 19 completed, 2 failed, 0 blocked. Total $5.03. $0.265/task (good).
- ARC-0011 escalation ladder shipped to dispatch.
- Claude Fable 5 assessed: $10/$50/M tokens (vs opus-4-8 $15/$75/M) — cost reduction option.
- Safety gate correctly blocked premature model-ID migration — two-layer defense working.
- Haiku timeout on MEMORY dedup fix — one-off; pattern known (haiku = bounded tasks only).

### Step 2 — Delete

No deletion candidates. 120/73 stable.

**Dead import** (`recentTaskExistsForSource` in arc-skill-manager/sensor.ts, 52775e83): imported but not used. Minor cleanup candidate — not blocking.

### Step 3 — Simplify

- **[RESOLVED]** Duplicate CEO review dedup (54eebe04) — pre-flight period check closes the [NEW-ACTION] from last audit.
- **[RESOLVED]** ARC-0011 replaces the flat retry loop — dispatch now has principled failure progression. The HANDOFF threshold being `max_retries` is correct; CLI default of 7 gives more runway than prior 3.
- **[DEAD-IMPORT-WATCH]** `recentTaskExistsForSource` unused in arc-skill-manager sensor — cleanup on next sensor edit.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20. No growth this window.
- **[CARRY-WATCH]** Arch-review model downgrade for no-structural-change cycles — still low priority.

### Step 4 — Accelerate

- 19 tasks, 2 failures (both benign: safety gate + haiku timeout). $0.265/task — below $0.40 target.
- ARC-0011 reduces wasted retry cycles on known-dead-end approaches — less dispatch time burned on hopeless retries.
- Claude Fable 5 at $10/$50/M could reduce costs 33% vs opus-4-8. Worth evaluating MODEL_IDS update after more signals on quality.

### Step 5 — Automate

- HANDOFF creates `[ESCALATED]` tasks automatically — no manual escalation needed for REFINE/PIVOT/WEB-SEARCH failures.
- Dead import cleanup (`recentTaskExistsForSource`) could be caught by a lint-skills rule for unused imports. Low priority.

### Flags

- **[RESOLVED]** Duplicate CEO review dedup (54eebe04) — pre-flight period check.
- **[RESOLVED]** Duplicate MEMORY consolidation dedup — see last audit; follow-up task was queued.
- **[NEW]** ARC-0011 escalation ladder live (e94a430c) — state machine updated. Monitor first PIVOT/WEB-SEARCH/HANDOFF cycles for correctness.
- **[NEW-WATCH]** Claude Fable 5 ($10/$50/M): 33% cost reduction vs opus-4-8 possible. Evaluate after quality signals accumulate.
- **[NEW-WATCH]** Dead import: `recentTaskExistsForSource` in arc-skill-manager/sensor.ts — cleanup on next sensor edit.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20.
- **[CARRY-WATCH]** RFC Phase 2 (RFC 0011 ADAPT ports) — not yet started.
- **[CARRY-WATCH]** arc-email-worker no-CI/CD — deploy workflow still missing.
- **[CARRY-WATCH]** arc0me-site PR #8 merge conflicts — requires whoabuddy.
- **[CARRY-WATCH]** X API credits depleted (#17796 blocked) — awaiting whoabuddy top-up.
- **[CARRY-WATCH]** amber-otter credential exposure — no autonomous path.

---

## 2026-06-09T21:29:00.000Z — no structural changes; duplicate-sensor dedup pattern flagged; 120 skills / 73 sensors

**Task #18515** | Diff: 0f46d2b5..HEAD (0 structural commits) | Sensors: 73 | Skills: 120

### Step 1 — Requirements

No structural commits to `src/` or `skills/` since last review (0f46d2b5). Sensor triggered on "active reports to process."

**Watch report 2026-06-09T13:00Z highlights** (17 tasks, 0 failures, $5.53):
- PR #992 aibtcdev/landing-page approved — 1-line cadence relaxation 5min→30min, trivially correct.
- Weekly deck generated: 386 tasks, 322 commits, 8 shipped changes, 120 skills / 73 sensors.
- arXiv digest: 50 papers, 21 relevant compiled. Signal filing paused — no auto-signal queued.
- MEMORY.md consolidated 234→159 lines (context-load warning resolved, task #18489).
- Blog "Thirteen Repositories" published proactively.
- Cost improved: $0.264/task, $9.78/day.

**CEO review 2026-06-09T13:00Z assessment:**
> "On track. 17/17 success, blog post published proactively, PR #992 approved — all visible external output. Three recurring sensor-noise patterns persist: duplicate CEO reviews for same period, duplicate MEMORY consolidation firing, $0.83 arch-review on stable codebase — none blocking, but each burns real cycles."

**Overnight brief 2026-06-09T06:00Z highlights** (27 tasks, 0 failures, $7.16):
- PURPOSE 2.70/5 (S:1 O:5 E:3 C:2 Ad:3 Co:2 Se:3). Ops near-perfect (75/76, 98.7%).
- v2.1.169 release report written. CLAUDE_CODE_SAFE_MODE docs added to dispatch troubleshooting.
- 1btc-news 60-day bounty confirmed closed by Iskander-Agent (PRs #37/#68).

### Step 2 — Delete

No deletion candidates. 120/73 stable.

### Step 3 — Simplify

- **[NEW-ACTION]** Duplicate MEMORY.md consolidation: health-check (task #18488) and self-review triage (task #18490) both independently fire on line-count threshold with no shared dedup state. Task #18489 ran and succeeded; task #18491 found nothing to do ($0.13 wasted). Fix: add `pendingTaskExistsForSource` or `recentTaskExistsForSource` guard in both queuing paths using a shared source key. Follow-up task created.
- **[NEW-ACTION]** Duplicate CEO review tasks: two tasks (#18485, #18493) ran for the same "2026-06-09T02:14" period — one queued by a subtask, one by the sensor. ~$0.64 redundant review cost. Fix: pre-flight dedup on CEO review subject + period string. Follow-up task created.
- **[CARRY-WATCH]** Arch-review cost on stable codebase ($0.83 for "no structural changes"). The reports-based sensor trigger is intentional but generates full-cost reviews when all flags are carry-watches. Consider routing no-structural-change cycles to haiku (vs sonnet) as cost optimization. Low priority.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20. No growth this window.

### Step 4 — Accelerate

- 17/17 tasks, 0 failures. Cost improved to $0.264/task ($9.78/day) — down from $0.471 prior window.
- Pipeline nominal. No new bottlenecks.

### Step 5 — Automate

No new automation gaps. Active blocks remain human-gated (X API credits, signal filing policy, arc0me-site PR #8).

### Flags

- **[NEW-ACTION]** Duplicate MEMORY.md consolidation dedup — follow-up task queued.
- **[NEW-ACTION]** Duplicate CEO review dedup — follow-up task queued.
- **[CARRY-WATCH]** Arch-review model downgrade for no-structural-change cycles — low priority cost optimization.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20.
- **[CARRY-WATCH]** RFC Phase 2 (RFC 0011 + ADAPT ports) — not yet started.
- **[CARRY-WATCH]** arc-email-worker no-CI/CD — deploy workflow still missing.
- **[CARRY-WATCH]** arc0me-site PR #8 merge conflicts — requires whoabuddy.
- **[CARRY-WATCH]** X API credits depleted (#17796 blocked) — awaiting whoabuddy top-up.
- **[CARRY-WATCH]** amber-otter credential exposure — no autonomous path.

---

## 2026-06-09T09:28:00.000Z — no structural changes; OpenRouter deep research window ($27.35); 120 skills / 73 sensors

**Task #18497** | Diff: cfea1c10..6def33c (0 structural commits) | Sensors: 73 | Skills: 120

### Step 1 — Requirements

No structural commits to `src/` or `skills/` since last review (cfea1c10). Two commits in window: chore(loop) auto-commit (weekly deck HTML only) + docs(architect) (prior review output). Sensor triggered by "active reports to process."

**Watch report 2026-06-08T13:01Z → 2026-06-09T01:02Z highlights:**
- 52 tasks completed, 0 failures, 0 blocks. $27.35 actual. 36,731k tokens in / 318k out.
- **OpenRouter deep research dominated**: 13 Phase 1 per-repo analyses + 6 Phase 2 synthesis tasks + final report emailed to whoabuddy. Human-initiated single-session deep research request.
- arc-email-sync parseFlags boolean fix (cfea1c10) verified shipped and working.
- PR #991 aibtcdev/landing-page approved — paginate leaderboard + show all earners. Trivially correct.
- bff-skills payout @mention handled — escalated to decision-makers on #494/#485/#231.
- daily-eval: 2.70/5 (S:1 O:5 E:3 C:2 Ad:3 Co:2 Se:3). Ops near-perfect (75/76, 98.7%). Cost C:2 — slightly elevated ($0.471/task, $35.79/day including OR research).

### Step 2 — Delete

No deletion candidates. 120/73 stable. Window was high-activity but all tasks were real work.

### Step 3 — Simplify

- **[CARRY-WATCH]** context-review skip list ~18 entries — structural refactor at >20. No growth this window.
- **[CARRY-WATCH]** arc0me-site PR #8 merge conflicts — requires whoabuddy.
- **[PATTERN-WATCH]** OpenRouter multi-phase research tasks chunk into 13+6 phases — expected pattern for deep research emails. Cost ($27.35 in 12h vs ~$5-10 typical) is appropriate for the workload; not a dispatch anomaly.

### Step 4 — Accelerate

- 52/52 tasks, 0 failures. Pipeline performing at peak throughput when fed real work.
- OR research chunks correctly — phase decomposition prevents single-task timeout; no bottleneck.
- parseFlags fix unblocks `--force` CLI in arc-email-sync — tested and working.

### Step 5 — Automate

No new automation gaps. All active blocks remain human-gated.

### Flags

- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20.
- **[CARRY-WATCH]** RFC Phase 2 (RFC 0011 + ADAPT ports) — not yet started.
- **[CARRY-WATCH]** arc-email-worker no-CI/CD — deploy workflow still missing.
- **[CARRY-WATCH]** arc0me-site PR #8 merge conflicts — requires whoabuddy.
- **[CARRY-WATCH]** X API credits depleted (#17796 blocked) — 48h cooldown active; awaiting whoabuddy top-up.
- **[CARRY-WATCH]** amber-otter credential exposure — no autonomous path.

---

## 2026-06-08T21:27:00.000Z — arc-email-sync parseFlags boolean fix; 7 PR earnings indexer reviews; freshness-decay 4th occurrence; 120 skills / 73 sensors

**Task #18474** | Diff: 21f490d3..cfea1c10 (1 structural commit) | Sensors: 73 | Skills: 120

### Step 1 — Requirements

- **fix(arc-email-sync): parseFlags handles boolean --force flag correctly** (cfea1c10): `BOOLEAN_FLAGS = new Set(["force"])` added to `cli.ts`. `parseFlags()` now short-circuits for boolean flags: sets value to `"true"` without advancing `i`, preventing the next arg from being consumed as the flag's value. Prior behavior caused `--force` to eat the next subcommand argument, silently misrouting calls. Paired with `parseFlags.test.ts` unit tests. No sensor or dispatch architecture changes.

**Watch report 2026-06-08T01:01Z–13:01Z highlights:**
- 34 completed, 1 failed (#17796 permanently closed — 12d stale X tweet content). $10.07/day ($0.296/task).
- **7 PR reviews**: aibtcdev/landing-page earnings indexer rollout (#979–#985) — DO→cron migration, Phase 1–3 + anti-gaming + enable cron. All approved.
- arc0btc.com freshness-decay: **4th occurrence** in 11 days. Root cause variant confirmed: "The Third Alarm" post existed locally but wasn't tracked in arc0me-site repo. Fix: deployed → freshness 2d→1d.
- Task #17796 (X API 402, 12d stale) permanently closed as failed. Recurring cycle drain eliminated.
- PURPOSE eval: 2.60/5 (S:1 O:4 E:3 C:2 Ad:4 Co:2 Se:3). Signal filing still policy-locked.

**Overnight brief 2026-06-08T13:08Z highlights:**
- 34 completed, 0 new failures. 48h blocked-review cooldown on X API 402 active.
- arc0me-site PR #8: still blocked (merge conflicts). Requires whoabuddy.

### Step 2 — Delete

No deletion candidates. parseFlags fix is net-reduction (removes a test file duplication). 120/73 stable.

### Step 3 — Simplify

- parseFlags fix is correct and minimal: 5 lines, one data structure, no new abstractions. Pattern is the right approach for boolean CLI flags.
- **[CARRY-WATCH]** context-review skip list ~18 entries — structural refactor at >20. No growth this window.
- **[CARRY-WATCH]** arc0.me freshness-decay ~4-7d cycle confirmed 4 times. Reactive fix works; proactive scheduling every 3-5d is the only durable solution. No code change required — behavioral commitment needed.
- **[CARRY-WATCH]** arc0me-site PR #8 merge conflicts — whoabuddy must resolve.

### Step 4 — Accelerate

- 7 PR reviews in one overnight window at $0.296/task — effective throughput when PR queue is active.
- Task #17796 permanently closed: one fewer re-queue drain every 48h.
- parseFlags fix unblocks any `--force` CLI usage in arc-email-sync workflows.

### Step 5 — Automate

No new automation gaps. Freshness-decay proactive scheduling is a dispatch behavioral change, not a code change.

### Flags

- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20.
- **[CARRY-WATCH]** RFC Phase 2 (RFC 0011 + ADAPT ports) — not yet started.
- **[CARRY-WATCH]** arc-email-worker no-CI/CD — deploy workflow still missing.
- **[CARRY-WATCH]** arc0me-site PR #8 merge conflicts — requires whoabuddy.
- **[CARRY-WATCH]** X API credits depleted — 48h cooldown active; awaiting whoabuddy top-up.
- **[CARRY-WATCH]** amber-otter credential exposure — no autonomous path.
- **[PATTERN-NOTE]** Freshness-decay: 4th occurrence confirms ~4-7d cadence while signal filing is paused. Proactive blog scheduling every 3-5d is the only durable loop-break.

---

## 2026-06-08T09:27:00.000Z — no structural changes; untracked-content freshness variant; proactive blog action; 120 skills / 73 sensors

**Task #18428** | Diff: fa2c8739..21f490d3 (0 structural commits) | Sensors: 73 | Skills: 120

### Step 1 — Requirements

No structural commits to `src/` or `skills/` since last review (fa2c8739). Sensor triggered by "active reports to process."

**Watch report 2026-06-08T01:01Z highlights:**
- 17 tasks completed, 0 failures, 1 blocked (#17796 X API 402). $5.88. 100% success.
- arc0btc.com freshness: 4th occurrence in 11 days. **New variant discovered**: "The Third Alarm" post was committed locally but untracked in the arc0me-site repo — deploying it resolved freshness from 2d→1d. Content can exist locally and not be reflected in site repo.
- X API 402: 5th consecutive review confirms same external block (credits depleted). 48h cooldown applied per churn rule.
- CEO assessment: "Ops are clean but this watch produced zero external-facing output: no PRs opened, no signals filed, no agent interactions." Next focus: draft and stage next blog post proactively before 4-day cycle fires.
- arc0me-site PR #8 still blocked — merge conflicts in astro.config.mjs, package.json, content.config.ts, and src/. Requires whoabuddy review and merge.

### Step 2 — Delete

No deletion candidates. 120/73 stable.

### Step 3 — Simplify

- **[PATTERN VARIANT]** Freshness-decay now has two failure modes: (1) no content ready (original) → publish a blog post; (2) content locally committed but untracked in site repo (new) → verify site repo tracking after deploy. Both now documented in MEMORY.md. The compounding variant space makes reactive patching increasingly expensive — proactive scheduling every 3-5 days remains the only durable fix.
- **[CARRY-WATCH]** context-review skip list ~18 entries — structural refactor at >20. No growth this window.
- **[CARRY-WATCH]** arc0me-site PR #8 merge conflicts — requires whoabuddy to resolve.

### Step 4 — Accelerate

- 48h churn rule on X API 402 working correctly — 5th review triggered cooldown instead of queuing a 6th.
- $0.35/task average (17 tasks, $5.88). Nominal.
- CEO action clear: proactive blog post before 4-day freshness cycle fires (~2026-06-11).

### Step 5 — Automate

No new automation gaps. Reactive freshness fixes are working; proactive cadence is a behavioral change, not an automation change.

### Flags

- **[NEW-WATCH]** arc0me-site PR #8 merge conflicts — whoabuddy must resolve. Not a dispatch blocker unless freshness fires before then.
- **[PATTERN]** Freshness untracked-content variant: after deploying a blog post, verify it appears in arc0me-site repo tracking, not just that deploy command ran.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20.
- **[CARRY-WATCH]** RFC Phase 2 (RFC 0011 + ADAPT ports) — not yet started.
- **[CARRY-WATCH]** arc-email-worker no-CI/CD — deploy workflow still missing.
- **[CARRY-WATCH]** X API credits depleted (#17796 blocked) — 48h cooldown active; awaiting whoabuddy top-up.
- **[CARRY-WATCH]** amber-otter credential exposure — no autonomous path.

---

## 2026-06-07T21:24:00.000Z — no structural changes; churn-rule self-applied; freshness pattern published; 120 skills / 73 sensors

**Task #18401** | Diff: fa2c8739..24d7f309 (0 structural commits) | Sensors: 73 | Skills: 120

### Step 1 — Requirements

No structural commits to `src/` or `skills/` since last review (fa2c8739). One docs commit only (24d7f309 — arch-review audit log). Sensor triggered by "active reports to process."

**Watch report 2026-06-07T13:00Z highlights:**
- 13 tasks completed, 0 failed, 1 blocked (#17796 X API 402). $3.12. All services healthy.
- Blog post "The Third Alarm" published — arc0.me freshness resolved (3rd occurrence in 11 days confirmed ~4-7d cadence).
- PR #977 aibtcdev/landing-page approved — column header rename (L2 Balance → sBTC), trivially correct.
- Self-review triage applied blocked-review churn rule for first time: X API 402 reviewed 3× consecutively → 48h cooldown applied. Rule working as designed.
- Housekeeping fired twice (0 fixes each) — cooldown guard preventing queuing correctly.
- daily-eval 2.55/5 (S:1 locked — signal pause; Co:1 — no peer interactions). Both externally blocked.

**Overnight brief 2026-06-07T13:05Z highlights:**
- 8 completed, 0 failed, $2.03. Clean.
- arc-blocked-review fired twice overnight; 48h cooldown confirmed active after 3rd consecutive external-block confirmation.
- Housekeeping zero-fix runs (03:11, 11:12 UTC) — cooldown guard working.

### Step 2 — Delete

No deletion candidates. 120/73 stable.

### Step 3 — Simplify

- **[PATTERN VALIDATED]** Churn-rule self-application working: 3 consecutive X API 402 blocked-reviews → 48h cooldown applied automatically by self-review triage. No dispatch intervention needed. Rule reduces wasted cycles from ~21/week to ≤1/week on this class.
- **[PATTERN VALIDATED]** Freshness → blog post dual-use: "The Third Alarm" converts the recurrence pattern into published content. Reactive fix AND proactive documentation in one cycle.
- **[CARRY-WATCH]** context-review skip list ~18 entries — structural refactor at >20. No growth this window.
- **[CARRY-WATCH]** Self-review triage memory lag — FP fix tasks when MEMORY.md lags in-session commits. Low priority.

### Step 4 — Accelerate

- 48h churn-rule: eliminates 21 wasted X API 402 re-review cycles/week while external block persists.
- Housekeeping 8h cooldown: zero-fix guard preventing repeat queuing correctly.
- $0.24/task (13 tasks, $3.12 in watch window) — improved from prior $0.27.

### Step 5 — Automate

No new automation gaps. All active blocks remain human-gated (X API credits, signal filing policy).

### Flags

- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20.
- **[CARRY-WATCH]** Self-review triage memory lag — false fix tasks for in-session commits. Low priority.
- **[CARRY-WATCH]** RFC Phase 2 (RFC 0011 + ADAPT ports) — not yet started.
- **[CARRY-WATCH]** arc-email-worker no-CI/CD — deploy workflow still missing.
- **[CARRY-WATCH]** X API credits depleted (#17796 blocked) — 48h cooldown active; awaiting whoabuddy top-up.
- **[CARRY-WATCH]** amber-otter credential exposure — no autonomous path.

---

## 2026-06-07T09:22:00.000Z — no structural changes; arc0.me freshness cadence confirmed; blocked-review churn rule active; 120 skills / 73 sensors

**Task #18386** | Diff: fa2c8739..HEAD (0 structural commits) | Sensors: 73 | Skills: 120

### Step 1 — Requirements

No structural commits to `src/` or `skills/` since last review (fa2c8739). Sensor triggered by "active reports to process."

**Watch report 2026-06-07T01:01Z highlights:**
- 20 completed, 0 failures, 1 blocked (#17796 X API 402). $5.79, $0.29/task. Clean window.
- arc0.me freshness: 4 backlogged blog posts published (3rd occurrence in 11 days, ~4-7d cadence). Memory updated with proactive scheduling recommendation.
- X API 402 reviewed for the 3rd time in 24h; blocked-review churn rule added to memory (48h+ cooldown). Rule shipped.
- Dispatch-stale FP recurred (task #18372, P2) — PID alive, 3 recent cycles. Classic FP; no action.
- PURPOSE 2.40/5: S:1 (signal pause), Co:1 (no peer interactions). Both blocked externally.

**CEO review 2026-06-06T14:09Z:** "On track; 19/19 clean window; memory lag FP noted; 0 tasks adjusted."

### Step 2 — Delete

No deletion candidates. 120/73 stable.

### Step 3 — Simplify

- **[CARRY-WATCH]** Self-review triage memory lag — FP fix tasks when MEMORY.md is stale for in-session commits. Low priority.
- **[CARRY-WATCH]** context-review skip list ~18 entries — structural refactor at >20. No growth this window.
- **[PATTERN]** arc0.me freshness decay ~4-7d cycle is now confirmed. Reactive fix works; proactive blog scheduling every 3-5d would eliminate alerts entirely. No code change needed — behavioral pattern for dispatch to adopt.

### Step 4 — Accelerate

- 168h blocked-review cooldown active for X API 402 — eliminates 21 wasted cycles/week.
- 8h housekeeping cooldown confirmed reducing churn.
- $0.29/task average. Pipeline nominal.

### Step 5 — Automate

No new automation gaps. All active blocks remain human-gated.

### Flags

- **[CARRY-WATCH]** Self-review triage memory lag — false fix tasks for in-session shipped commits. Low priority.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20.
- **[CARRY-WATCH]** RFC Phase 2 (RFC 0011 + ADAPT ports) — not yet started.
- **[CARRY-WATCH]** arc-email-worker no-CI/CD — deploy workflow still missing.
- **[CARRY-WATCH]** X API credits depleted (#17796 blocked) — 168h cooldown active; awaiting whoabuddy top-up.
- **[CARRY-WATCH]** amber-otter credential exposure — no autonomous path.

---

## 2026-06-06T21:21:00.000Z — no structural changes; self-review triage memory lag flagged; cooldowns confirmed effective; 120 skills / 73 sensors

**Task #18367** | Diff: fc1a37d9..HEAD (0 structural commits) | Sensors: 73 | Skills: 120

### Step 1 — Requirements

No structural commits to `src/` or `skills/` since last review (fc1a37d9). Sensor triggered by "active reports to process."

**Watch report 2026-06-06T13:00Z highlights:**
- 19/19 completed, 0 failures, $6.17. $0.325/task (slightly above $0.293 baseline, driven by arch review #18352 at $1.17).
- Blog published: "sensors-that-forget" (3067 chars) — freshness maintained.
- Claude Code v2.1.166 and v2.1.167 release reports written. No dispatch changes needed.
- **Self-review triage false fix task**: #18347 queued a fix for age-based recent.log archiving, but work was already shipped in d2b1677d. Root cause: triage reads MEMORY.md which hasn't been updated yet for in-session commits — session-boundary memory lag.
- X API 402 verified again twice (tasks #18348, #18355). 168h cooldown now active — no further blocked-review task should fire until credits restored.
- Housekeeping no-op cycles: 2 this window vs previous 3+ — 8h cooldown is working.

**CEO review 2026-06-06T02:08Z highlights:**
- "On track. 19/19 tasks completed, zero failures." Cost variance driven by arch review — worthwhile.
- Concern: self-review triage generating false fix tasks for already-shipped work.

**daily-eval 2026-06-06 task #18363:**
- Weighted 2.85/5 (S:1 O:5 E:2 C:4 Ad:4 Co:1 Se:3). Signal filing still caps S at 1.

### Step 2 — Delete

No deletion candidates. 120/73 stable.

### Step 3 — Simplify

- **[NEW-WATCH] Self-review triage memory lag**: triage reads MEMORY.md which lags in-session commits by one consolidation cycle. When a fix ships mid-session and MEMORY.md hasn't been updated yet, triage sees stale state and queues "fix already done" tasks. Mitigation: self-review triage could check `git log --oneline -20 -- skills/ src/` before queuing fix tasks — if the subject keyword appears in recent commit messages, skip. Low priority; pattern recurs 1-2×/month.
- **[CARRY-WATCH]** context-review skip list ~18 entries — structural refactor warranted at >20. No growth this window.

### Step 4 — Accelerate

- 8h housekeeping cooldown reducing no-op churn as expected (2 → 1 confirmed fix this window).
- 168h blocked-review cooldown now active for X API 402 — eliminates 21 wasted review cycles/week.
- Dispatch cost/task nominal at $0.293/task (7d average).

### Step 5 — Automate

No new automation gaps. All active blocks remain human-gated.

### Flags

- **[NEW-WATCH]** Self-review triage memory lag — false fix tasks when MEMORY.md is stale for in-session commits. Low priority.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20.
- **[CARRY-WATCH]** RFC Phase 2 (RFC 0011 + ADAPT ports) — not yet started.
- **[CARRY-WATCH]** arc-email-worker no-CI/CD — deploy workflow still missing.
- **[CARRY-WATCH]** X API credits depleted (#17796 blocked) — 168h cooldown now active; awaiting whoabuddy top-up.
- **[CARRY-WATCH]** amber-otter credential exposure — no autonomous path.

---

## 2026-06-06T09:19:00.000Z — dispatch fallback visibility; blocked-review 168h cooldown; housekeeping 8h cooldown; 120 skills / 73 sensors

**Task #18352** | Diff: 44b55ea → 6f00f63 (3 structural commits) | Sensors: 73 | Skills: 120

### Step 1 — Requirements

- **feat(dispatch): capture and log actual model when fallback activates** (6f00f638): `src/dispatch.ts` — adds `actual_model` field to `DispatchResult`. Parsed from two locations in stream JSON: `assistant` message `model` field, and `result` event `model` field. Post-dispatch: if `actual_model !== MODEL_IDS[effectiveModel]`, emits a warn log, inserts a service_log entry, and calls `updateCycleLog(cycleId, { model: actual_model })`. Closes an observability blind spot: `--fallback-model sonnet` (set since 7f3fdefc) could silently run an opus task on sonnet; cycle_log.model showed the requested model, not the actual one — cost tracking and quality retrospectives were wrong for degraded cycles.

- **fix(arc-blocked-review): extend review interval for dead-end blocked tasks** (9bbab77d): `skills/arc-blocked-review/sensor.ts` — new `DEAD_END_REVIEW_COOLDOWN_HOURS = 168`. Candidates split into `signaledCandidates` (any reason not starting with "blocked for ") and `staleOnlyCandidates` (all reasons start with "blocked for "). Signal-triggered candidates fire immediately. Stale-only candidates suppressed if `getLastCompletedTaskBySource(TASK_SOURCE)` ran within 168h. Addresses CEO action from 2026-06-05T21:20Z audit: X API 402 task #17796 was re-reviewed every ~8h with no new context and no unblock path — 21 wasted cycles/week.

- **fix(arc-housekeeping): extend zero-fix cooldown 4h→8h** (e07e7c37): `skills/arc-housekeeping/sensor.ts` — `ZERO_FIX_COOLDOWN_MINUTES` 240→480. One-line constant change. Halves wasted dispatch cycles for persistent-but-unfixable issues. Addresses CEO action from 2026-06-05T21:20Z audit.

**Watch report 2026-06-06T01:01:53Z highlights:**
- 25/25 completed, 0 failures, 1 blocked (#17796 X API 402). 100% success.
- Both cooldown fixes shipped in same watch window as CEO feedback — feedback loop working.
- Signal filing still the binding constraint (PURPOSE ~2.90). No autonomous path.
- CEO: "On track operationally... structural fixes are the highlight."

### Step 2 — Delete

No deletion candidates. 120/73 stable.

### Step 3 — Simplify

- All three changes are minimal. Fallback visibility adds ~20 lines across two parse points and one mismatch handler — correct scope.
- Arc-blocked-review signal-vs-stale split is the right abstraction: ~30 lines, cleanly separates two semantically distinct candidate types. The 7-day cooldown is appropriately long for known dead-ends.
- **[CARRY-WATCH]** context-review skip list ~18 entries — structural refactor warranted at >20. Pattern `p-exclusion-rule-accumulation-refactor` in memory.

### Step 4 — Accelerate

- 168h dead-end cooldown: 21 wasted cycles/week → at most 1/week for known dead-ends.
- 8h housekeeping cooldown: ~50% reduction in zero-fix churn.
- Fallback visibility enables correct cost attribution — no more phantom "opus" cycles that ran on sonnet.

### Step 5 — Automate

No new automation gaps. Both sensor cooldown patterns are now well-established (arc-housekeeping, arc-blocked-review both use `getLastCompletedTaskBySource` guard).

### Flags

- **[RESOLVED]** blocked-review dead-end churn (9bbab77d) — 168h cooldown for stale-only candidates.
- **[RESOLVED]** housekeeping zero-fix cooldown extension (e07e7c37) — 4h→8h, halves churn.
- **[NEW]** fallback model visibility (6f00f638) — cycle_log.model now records actual model when fallback activates.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20.
- **[CARRY-WATCH]** RFC Phase 2 (RFC 0011 + ADAPT ports) — not yet started.
- **[CARRY-WATCH]** arc-email-worker no-CI/CD — deploy workflow still missing.
- **[CARRY-WATCH]** X API credits depleted (#17796 blocked) — awaiting whoabuddy top-up.
- **[CARRY-WATCH]** amber-otter credential exposure — no autonomous path.

---

## 2026-06-05T21:20:00.000Z — no structural changes; CEO feedback: housekeeping cooldown + X API review cadence; 120 skills / 73 sensors

**Task #18327** | Diff: 44b55ea → 4c17f84a (0 structural commits — arch-review docs only) | Sensors: 73 | Skills: 120

### Step 1 — Requirements

No structural commits to `src/` or `skills/` since last review. Sensor triggered by "active reports to process."

**Overnight brief 2026-06-05T13:07Z highlights:**
- 27 completed, 1 failed (arXiv 429 — transient, sensor will retry). $8.77. PURPOSE: 3.06/5 (S:1 O:5 E:3 C:4 A:3 Co:2 Se:4).
- Blog published: "PURPOSE Score and the Signal-Filing Pause" — keeps freshness alive.
- X API 402 remains blocked (#17796 P9). Two blocked-task review cycles ran with no path forward this watch.
- Housekeeping fired 3× in last watch window; 0 fixes twice — zero-fix cooldown guard is active (4h) but CEO flagged fire rate still high.

**CEO review 2026-06-05T02:05Z assessment:**
- "Solid maintenance watch, but tilting too far internal." bff-skills completedDup guard was legitimate; everything else was housekeeping (3 fires, 0 fixes twice), arch review, and learning capture.
- **[CEO ACTION]** Housekeeping zero-fix cooldown guard should be revisited — extend the window to reduce churn.
- **[CEO ACTION]** X API blocked-task review cycles: "consider increasing review interval to reduce wasted cycles on a known-blocked escalation."
- **[CEO FOCUS]** Next watch: at least one external PR reviewed or code contribution opened.

### Step 2 — Delete

No deletion candidates. 120/73 stable. No dead code paths identified in the unchanged codebase.

### Step 3 — Simplify

- **[ACTION]** Housekeeping zero-fix cooldown: currently 4h (`ZERO_FIX_PATTERNS`, `e96561a0`). CEO says extend window. Recommendation: raise to 8h (240→480 min). One-line constant change in `skills/arc-housekeeping/sensor.ts`. Follow-up task queued.
- **[ACTION]** X API blocked-task review sensor: fires and selects #17796 (P9, confirmed blocked, no autonomous path). Pattern matches [dead-end] status. Recommendation: when a blocked-task-review cycle confirms a task as `blocked` with a known dead-end reason, the review sensor should extend its own review interval for that source (e.g. 48h vs daily). Follow-up task queued.
- **[CARRY-WATCH]** context-review skip list ~18 entries — structural refactor warranted at >20. No growth this period.

### Step 4 — Accelerate

- Queue is empty entering this cycle. No task pipeline bottlenecks.
- External contribution (PR reviews in aibtcdev ecosystem) is the primary throughput gap. Signal filing paused, X API depleted — blog posts fill the freshness gap but don't move ecosystem metrics.

### Step 5 — Automate

No new automation gaps. Existing automation (housekeeping, arch-review, catalog) is running as designed but with excess frequency relative to output.

### Flags

- **[ACTION]** Extend housekeeping zero-fix cooldown 4h→8h — follow-up task queued.
- **[ACTION]** Extend blocked-task review interval for known dead-ends — follow-up task queued.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20.
- **[CARRY-WATCH]** RFC Phase 2 (RFC 0011 + ADAPT ports) — not yet started.
- **[CARRY-WATCH]** arc-email-worker no-CI/CD — deploy workflow still missing.
- **[CARRY-WATCH]** X API credits depleted (#17796 blocked) — awaiting whoabuddy top-up.
- **[CARRY-WATCH]** amber-otter credential exposure — no autonomous path.

---

## 2026-06-05T09:18:00.000Z — arc-workflows completed-task dedup for PR reviews; 120 skills / 73 sensors

**Task #18307** | Diff: 55137b0 → 44b55ea (1 structural commit) | Sensors: 73 | Skills: 120

### Step 1 — Requirements

- **fix(arc-workflows): block PR review re-queue when completed task exists for exact versioned source** (44b55ea9): `skills/arc-workflows/sensor.ts` adds a `completedDup` guard for `"pr-review:"` sources alongside the existing `pendingDup` and `recentDup` checks. Root cause addressed: PRs outside the GraphQL `last:50` query window never have `arcHasReview` set by `syncGitHubPRs`, so the workflow stays stuck in `review-requested` state and re-queues review tasks indefinitely. The fix: `completedTaskCountForSource(source) > 0` → skip re-queue. Versioned source keys (`v1`, `v2`, ...) preserve per-commit re-review capability. Failed tasks not blocked — retry after 60-min `recentDup` window.

Watch report 2026-06-04T13:00Z → 2026-06-05T01:02Z highlights:
- 5/5 completed, $1.25, zero failures. All internal: self-audit, introspection, PURPOSE eval, failure retro, research scan.
- CEO: "Holding steady, not advancing." PURPOSE 3.06/5, S:1/5 (filing pause compressing strategic output). Goal: ≥1 externally visible output in next 24h.
- Queue: only #17796 blocked (X API 402, awaiting credits).

### Step 2 — Delete

No deletion candidates. 120/73 stable.

### Step 3 — Simplify

- `completedDup` guard is the correct fix: one DB query, closes a persistent re-queue class. Three-layer dedup is now complete: pending, recent (60-min), completed (versioned).
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20. No growth this window.

### Step 4 — Accelerate

- completedDup guard eliminates silent re-review cycles for stuck-workflow PRs. Low dispatch volume (5 tasks / 12h) reflects empty queue, not bottleneck.

### Step 5 — Automate

No new automation gaps.

### Flags

- **[RESOLVED]** arc-workflows stuck-PR re-queue (44b55ea9) — completedDup guard closes the GraphQL window blindspot.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20.
- **[CARRY-WATCH]** RFC Phase 2 (RFC 0011 + ADAPT ports) — not yet started.
- **[CARRY-WATCH]** arc-email-worker no-CI/CD — deploy workflow missing.
- **[CARRY-WATCH]** X API credits depleted (#17796 blocked) — awaiting whoabuddy top-up.
- **[CARRY-WATCH]** amber-otter credential exposure — no autonomous path.

---

## 2026-06-04T21:18:00.000Z — github-mentions sensor pre-flight; age-based recent.log archiving; OvernightBriefMachine autoAdvanceState; 120 skills / 73 sensors

**Task #18280** | Diff: e2ba4e1 → 55137b0 (4 structural commits) | Sensors: 73 | Skills: 120

### Step 1 — Requirements

- **fix(github-mentions): gate external PRs on state and review status at sensor time** (58715da1): `getPRState()` helper added. For non-watched repos, checks PR state (skip if not OPEN) and Arc review status (skip if already reviewed) before queuing a task. Closes the [sensor-level fix needed] carry from 2026-06-04T09:17Z audit — bff-skills PRs #564/#565/#579 were closed/approved but kept re-queuing. Previously only dispatch pre-flight caught these. Pattern: sensor-time external resource validation.

- **fix(arc-memory): age-based recent.log archiving** (44ec2ef6 + d2b1677d): Two commits on the same day — `44ec2ef6` (haiku, quick band-aid) raised threshold 300→500; `d2b1677d` (sonnet, proper fix) replaced count-based threshold entirely with age check. Sensor now fires only when entries older than 14 days exist. Self-limiting — after archiving, won't trigger again for ~14 days. `RECENT_LOG_THRESHOLD` constant removed; cooldown bumped to 24h. Closes [CARRY-WATCH] from prior audit. Pattern: archival sensors should gate on data age, not volume.

- **fix(arc-workflows): OvernightBriefMachine missing autoAdvanceState** (83a77c62): `skills/arc-workflows/state-machine.ts` — `pending` state lacked `autoAdvanceState`. Belt-and-braces 60-min dedup allowed hourly re-fire, ~$0.75/day wasted on no-op sonnet cycles. Same root cause as retrospective_pending flood (1a700e99 2026-05-25). Fix: add `autoAdvanceState` to pending state. Pattern: ALL machine states with create-task actions must have `autoAdvanceState`; belt-and-braces dedup is defense-in-depth, not the primary guard.

- **fix(arc-skill-manager): compliance rename ts→timestamp** (55137b0d): Pre-commit hook enforcement, no behavioral change.

### Step 2 — Delete

No deletion candidates. 120/73 stable.

### Step 3 — Simplify

- Age-based archiving (d2b1677d) is the correct architecture: removes a constant that will keep needing to be bumped. The data doesn't shrink on consolidation when all entries are recent — so volume-based thresholds can never converge. The two-commit pattern (band-aid first, real fix same day) is reasonable: quick haiku cycle to stop the immediate bleeding, sonnet cycle to fix the root cause.
- **[CARRY-WATCH]** context-review skip list ~18 entries. No growth this window. Threshold is >20.
- **[CARRY-WATCH]** OvernightBriefMachine fix is the 2nd instance of the missing-autoAdvanceState class (after retrospective_pending 2026-05-25). Pattern is now clearly documented in state-machine notes — future machine additions should default to including autoAdvanceState.

### Step 4 — Accelerate

- Recent cycles: $0.048–$0.853/task, last 6 cycles avg ~$0.36. OvernightBriefMachine fix recovers ~$0.75/day.
- No new bottlenecks.

### Step 5 — Automate

- **[LINT-WATCH]** `lint-skills --staged` could check that sensor functions with a line-count/file-count threshold also have a cooldown or age check. Low priority but would catch d2b1677d-class issues earlier. Third candidate for lint-skills enhancement.

### Flags

- **[RESOLVED]** github-mentions stale-PR sensor noise (58715da1) — pre-flight gate now at sensor time, not just dispatch.
- **[RESOLVED]** recent.log infinite threshold-bumping (d2b1677d) — age-based archiving replaces count threshold entirely.
- **[RESOLVED]** OvernightBriefMachine no-op hourly cycles (83a77c62) — autoAdvanceState prevents re-fire after task creation.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20.
- **[CARRY-WATCH]** RFC Phase 2 (RFC 0011 + ADAPT ports) — not yet started.
- **[CARRY-WATCH]** arc-email-worker no-CI/CD — deploy workflow missing.
- **[CARRY-WATCH]** X API credits depleted (#17796 blocked) — awaiting whoabuddy top-up.
- **[CARRY-WATCH]** amber-otter credential exposure — no autonomous path.
- **[CARRY-WATCH]** Hiro circuit-breaker gap in Arc's Hiro-dependent sensors — low urgency.

---

## 2026-06-04T09:17:00.000Z — no structural changes; watch report integrated; recent.log threshold tuning flagged; 120 skills / 73 sensors

**Task #18249** | Diff: cb79dd8b → 5aa3d416 (0 structural commits) | Sensors: 73 | Skills: 120

### Step 1 — Requirements

No structural commits to `src/` or `skills/` since last review. Watch report 2026-06-04T01:02Z integrated.

Watch report highlights:
- 32/32 completed, 0 failed, $9.96, 12,376k tokens in. Cleanest period in recent memory.
- 4 PR reviews: PRs #957–#959 (landing-page) + #559 (aibtc-mcp-server) all approved.
- 1btc-news major bounty Day 0 ack posted (task #18085, all 6 deliverables confirmed).
- `recent.log` consolidation fired twice as no-ops (#18210, #18222, 431→443 lines). 4h cooldown in place but entries keep pushing past 300-line threshold.
- bff-skills stale-PR sensor noise (tasks #18240–#18242): PRs #564/#565/#579 queued by sensor but already closed/approved. Pattern in MEMORY.md.
- Signal filing paused day 16. PURPOSE 2.65/5 (S:1 locked).
- CEO flagged: raise `recent.log` line threshold vs. cooldown if no-op pattern continues.
- context-review skip list still at ~18 entries — no new FPs this period.

### Step 2 — Delete

No deletion candidates. 120/73 stable.

### Step 3 — Simplify

- **[CARRY-WATCH → ACTION]** `recent.log` consolidation threshold: fired twice as no-ops in one 12h window. Root cause: entries are added faster than archiving can absorb (all within 30d, nothing archivable). Fix options: (1) raise line threshold from 300→500 so no-ops fire less often, or (2) add a second guard that skips if none of the oldest N entries are >30d old (pure archivability check). CEO recommendation: raise threshold. Raising to 400–500 is a one-line fix in arc-skill-manager sensor.ts.
- **[CARRY-WATCH]** context-review skip list at ~18 conditions. No growth this period. Threshold is >20.

### Step 4 — Accelerate

- 32/32 with 0 failures and $9.96 for 12h. $0.311/task. Pipeline nominal.
- No new bottlenecks.

### Step 5 — Automate

- `recent.log` threshold tuning would reduce the no-op consolidation overhead (~$0.30–0.40/day in wasted cycles). Simple constant change.

### Flags

- **[NEW-ACTION]** `recent.log` line threshold: raise 300→500 in `skills/arc-skill-manager/sensor.ts` to stop no-op consolidation cycles. One-line fix. Create follow-up task.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20.
- **[CARRY-WATCH]** bff-skills stale-PR sensor noise: pre-flight `gh pr view --json state` mandatory for all bff-skills PRs (pattern in MEMORY.md).
- **[CARRY-WATCH]** RFC Phase 2 (RFC 0011 + ADAPT ports) — not yet started.
- **[CARRY-WATCH]** arc-email-worker no-CI/CD — deploy workflow still missing.
- **[CARRY-WATCH]** X API credits depleted (#17796 blocked) — awaiting whoabuddy top-up.
- **[CARRY-WATCH]** amber-otter credential exposure — no autonomous path.
- **[CARRY-WATCH]** Hiro circuit-breaker gap: Arc's Hiro-dependent sensors have no circuit-breaker equivalent. Low urgency.

---

## 2026-06-03T21:15:00.000Z — no structural changes; overnight brief processed; Hiro circuit-breaker gap identified; 120 skills / 73 sensors

**Task #18220** | Diff: e2ba4e1 → bd2749bb (0 structural commits) | Sensors: 73 | Skills: 120

### Step 1 — Requirements

No structural commits to `src/` or `skills/` since last review. `bd2749bb` is the prior arch-review docs commit itself.

**Overnight brief 2026-06-03T13:06Z highlights:**
- 40 completed, 0 failed. $0.367/task average. Clean pipeline.
- 4 blog posts published in one burst (arc services, RFC handover, Zest audit, CF DO row reads) — freshness resolved efficiently.
- Zest audit bounty submitted (task #18169). Submission ID: mpxf5rek026008332af2.
- PR #559 (aibtc-mcp-server) resolved: cycle-3 review approved + apologized after stale-diff false negative caught (task #18198). See MEMORY.md stale-diff FALSE NEGATIVE entry.
- Context-review: 2 FP cycles overnight (bare "zest" + auto-queue). Both fixed in e2ba4e1. Skip list at ~18 entries.
- 1btc-news major bounty closed 2026-06-03 (task #18208) — all 6 deliverables confirmed.
- `aibtc-mcp-server v1.58.0` adds `--install` flags for IDE integrations. Arc uses dispatch subprocess path — no config change needed.
- `aibtcdev/landing-page PR #958` merged: Hiro circuit-breaker added to prevent budget storms from cascading.

### Step 2 — Delete

No deletion candidates. 120/73 stable.

### Step 3 — Simplify

- **[CARRY-WATCH → ACTION]** context-review skip list at ~18 entries. Prior audits set the refactor threshold at >20. Overnight had 2 more FP fixes. The pattern is structural: domain-content words in task subjects (blog topics, auto-queue enumeration) are systematically different from operational-intent keywords. Fix: `CONTENT_TASK_PATTERNS: RegExp[]` table replacing the growing exclusion string list. **Next FP fix = trigger refactor.**
- **[NEW-WATCH]** Hiro circuit-breaker gap: aibtcdev/landing-page added a circuit-breaker to Hiro API calls (PR #958). Arc's Hiro-dependent sensors (defi-zest, zest-yield-manager, arc-payments, mempool-watch, stacks-stackspot, defi-stacks-market) make Hiro API calls with no circuit-breaker equivalent. Under budget-storm conditions (e.g. BNS cascade, balance polling surge), Arc's sensors could amplify the storm rather than absorb it. Low urgency but worth tracking — pattern is now documented on the ecosystem side.

### Step 4 — Accelerate

- 0% failure rate. $0.367/task overnight. Pipeline nominal.
- Batch blog deployment pattern validated: 4 posts + deploy in one cycle was more efficient than 1-at-a-time. Pattern captured in MEMORY.md.
- No new pipeline bottlenecks.

### Step 5 — Automate

No new automation gaps. All active blocks remain human-gated.

### Flags

- **[RESOLVED]** 1btc-news major bounty — all 6 deliverables met, closed 2026-06-03 (task #18208).
- **[RESOLVED]** PR #559 stale-diff false negative — cycle-3 approved + corrected (task #18198). Stale-diff rule now in MEMORY.md.
- **[CARRY-WATCH → ACTION]** context-review skip list ~18 — structural refactor warranted at >20. **Next FP fix = trigger refactor.**
- **[NEW-WATCH]** Hiro circuit-breaker gap in Arc's own Hiro-dependent sensors (no current risk, but pattern is documented on ecosystem side).
- **[CARRY-WATCH]** bff-skills PR #300 HODLMM: 3rd re-review done, all 4 blocking issues unchanged. Next trigger = escalate to whoabuddy for policy, do NOT re-review.
- **[CARRY-WATCH]** RFC Phase 2 (RFC 0011 + ADAPT ports) — not yet started.
- **[CARRY-WATCH]** arc-email-worker no-CI/CD — deploy workflow still missing.
- **[CARRY-WATCH]** X API credits depleted (#17796 blocked) — awaiting whoabuddy top-up.
- **[CARRY-WATCH]** amber-otter credential exposure — no autonomous path.

---

## 2026-06-03T09:15:00.000Z — worktree lstatSync fix; context-review skip list at ~18; 120 skills / 73 sensors

**Task #18189** | Diff: 15547bf → e2ba4e1 (2 structural commits) | Sensors: 73 | Skills: 120

### Step 1 — Requirements

- **fix(arc-worktrees): replace fragile db/ dir check with lstatSync before symlinking** (ff63c252): `src/worktree.ts` `createWorktree()` — previous code used `readdirSync()` entry count to decide whether to remove db/ before symlinking. Root cause: db/ contains tracked SVG files, so count was always >1. `unlinkSync` first failed (dir, not file); `readdirSync` returned >1 entries → skipped `rm -rf`; `symlinkSync` threw EEXIST. Dispatch silently fell back to main tree — **worktree isolation was silently bypassed on every run**. Fix: `lstatSync` detects dir vs file/symlink correctly regardless of entry count. Pattern: always `lstatSync` before symlink creation in worktree setup.

- **fix(context-review): remove bare "zest" keyword and add blog/auto-queue exclusions** (e2ba4e1): Bare `"zest"` in `defi-zest` keywords matched blog posts (task #18177) and auto-queue domain-enumeration tasks (task #18174). Fix: replaced with operational-only terms; added `^Write blog post:` and `^Auto-queue:` subject exclusions. Skip list grows to ~18 conditions.

Watch report 2026-06-03T01:02Z highlights:
- 31 completed, 0 failed, $0.325/task. 100% success.
- arc-worktrees lstatSync fix deployed and verified (v2.1.161).
- patterns.md consolidated 151→143 lines; recent.log cooldown confirmed stable.
- Signal filing paused day 15; PURPOSE 2.45/5 (S:1 locked).
- 34% arc-skill-manager overhead noted in introspection (task #18157).
- Zero human-initiated tasks → alignment uncertainty flagged by CEO review.

### Step 2 — Delete

- `readdirSync` import removed from `src/worktree.ts` — replaced by `lstatSync`. Clean.
- No other deletion candidates. 120/73 stable.

### Step 3 — Simplify

- lstatSync fix is minimal and correct — 5 lines changed, removes a fragile entry-count assumption. The prior code was trying to detect "is this a directory" by counting its entries rather than checking its type directly. Now reads filesystem state directly.
- **[CARRY-WATCH → APPROACHING ACTION]** context-review skip list at ~18 conditions. Prior audits set refactor threshold at >20. If one more FP-reduction commit arrives, that threshold is crossed. The accumulation pattern is structural: domain-content words in task subjects (blog topics, auto-queue enumeration) are systematically different from operational-intent keywords that indicate which skills to load. Consider `CONTENT_TASK_PATTERNS: RegExp[]` structural exclusion table rather than adding individual subject-prefix guards.

### Step 4 — Accelerate

- lstatSync fix restores intended worktree isolation for arc-worktrees skill tasks. Prior silent fallback to main tree was an invisible correctness regression — changes that should have been isolated were running against the live codebase.
- No new pipeline bottlenecks. $0.325/task average nominal.

### Step 5 — Automate

- No new automation gaps this window.

### Flags

- **[RESOLVED]** arc-worktrees lstatSync EEXIST crash (ff63c252) — worktree isolation now correctly handles db/ with any number of tracked files. Pattern added to state-machine WorktreeCheck note.
- **[RESOLVED]** context-review defi-zest FP on blog/auto-queue tasks (e2ba4e1) — bare "zest" keyword removed; subject exclusions added.
- **[CARRY-WATCH → APPROACHING ACTION]** context-review skip list ~18 conditions — structural refactor warranted at >20. Next FP fix = trigger refactor.
- **[CARRY-WATCH]** bff-skills PR #300 HODLMM: 3rd re-review, all 4 blocking issues unchanged. Per bounty-farming flood rule: next trigger = escalate to whoabuddy for policy.
- **[CARRY-WATCH]** RFC Phase 2 (RFC 0011 + ADAPT ports) — not yet started.
- **[CARRY-WATCH]** arc-email-worker no-CI/CD — deploy workflow still missing.
- **[CARRY-WATCH]** X API credits depleted (#17796 blocked) — awaiting whoabuddy top-up.
- **[CARRY-WATCH]** amber-otter credential exposure — no autonomous path.

---

## 2026-06-02T21:15:00.000Z — recent.log cooldown fix; over-fire loop resolved; 120 skills / 73 sensors

**Task #18146** | Diff: 95a0715 → 15547bf (1 structural commit) | Sensors: 73 | Skills: 120

### Step 1 — Requirements

- **fix(arc-memory): add 4h cooldown to arc-recent-log-consolidate sensor** (15547bf3): `arc-skill-manager` sensor (`skills/arc-skill-manager/sensor.ts`) was firing 6-8×/day on `recent.log` exceeding 300 lines, but consolidation was always a no-op — all entries <30 days old, nothing to archive. Each run added 2-3 lines back, pushing count over threshold next cycle. Fix: added `RECENT_LOG_COOLDOWN_MINUTES=240` constant; checks `getLastCompletedTaskBySource(RECENT_LOG_TASK_SOURCE)` and skips if last completed run was within 4h. Mirrors arc-housekeeping e96561a0 pattern. Validated in CEO review #18133.

Overnight brief 2026-06-02T13:06:56Z:
- 15 completed, 0 failures, $4.79 ($0.319/task). 5 of 15 cycles were consolidation overhead from over-fire (now resolved).
- bff-skills #300 HODLMM: 3rd re-review, all 4 blocking issues still unchanged. Bounty-farming threshold reached — next trigger = escalate to whoabuddy, do NOT re-review.
- X API 402 verified twice overnight (tasks #18115, #18126). Still blocked.
- arXiv 29 relevant papers collected. Signal filing paused day 14.

### Step 2 — Delete

No deletion candidates. 120/73 stable.

### Step 3 — Simplify

- recent.log cooldown is correct and minimal: 4 lines added, 1 import, 1 constant. Same guard pattern as housekeeping zero-fix (e96561a0).
- **Pattern now validated twice**: threshold sensors both required cooldown guards because the underlying data doesn't reliably shrink after a run. This pattern belongs in the lint-skills sensor authoring checklist.
- **[CARRY-WATCH]** context-review skip list ~16+ conditions — refactor if >20.

### Step 4 — Accelerate

- $0.319/task overnight (nominal). 5 over-fire cycles eliminated — reduces daily overhead by ~$0.30–0.40.
- No new bottlenecks.

### Step 5 — Automate

- **[NEW-WATCH]** `lint-skills --staged` could detect threshold-firing sensors lacking a cooldown guard. Low priority.

### Flags

- **[RESOLVED]** recent.log over-fire (15547bf3) — 4h cooldown validated in CEO review #18133.
- **[NEW-WATCH]** lint-skills threshold-sensor cooldown check — low priority.
- **[CARRY-WATCH]** bff-skills PR #300 HODLMM: 3+ re-reviews, no progress. Next trigger = escalate to whoabuddy for policy.
- **[CARRY-WATCH]** aibtcdev/skills stale-issue sensor — live timestamp check required; confirm code patched.
- **[CARRY-WATCH]** RFC Phase 2 (RFC 0011 + ADAPT ports) — not yet started.
- **[CARRY-WATCH]** arc-email-worker no-CI/CD — deploy workflow still missing.
- **[CARRY-WATCH]** context-review skip list ~16+ conditions — refactor if >20.
- **[CARRY-WATCH]** X API credits depleted (#17796 blocked) — awaiting whoabuddy top-up.
- **[CARRY-WATCH]** amber-otter credential exposure — no autonomous path.

---

## 2026-06-02T09:15:00.000Z — no structural changes; watch report integrated; carry-watch status; 120 skills / 73 sensors

**Task #18122** | Diff: b07bc650 → 95a0715 (0 structural commits) | Sensors: 73 | Skills: 120

### Step 1 — Requirements

No structural commits to `src/` or `skills/` since last review. Only `src/web/presentation.html` (weekly deck auto-commit) changed. Sensor triggered by "active reports to process."

Watch report 2026-06-01T20:40Z highlights:
- 22 completed, 1 failed (self-healed) — YAML duplicate-key in blog frontmatter: retrospective → fix → redeploy, no human touch
- 4 blog posts published: RFC 0007–0010 Phase 1, cursor pattern, Phase 5 shared queue, Noise Floor
- 3 PR approvals: landing-page #947 (bounties proof-of-flow), #948 (BNS TTL 7d→6h), #950 (x402 stats drift)
- Dispatch stale FP (#18063) and skills escalation FP (#18077) both caught and closed correctly
- Avg cost: $0.38/task; signal filing paused day 14 (locks S:1 in PURPOSE)

### Step 2 — Delete

No deletion candidates. 120/73 stable.

### Step 3 — Simplify

- Self-healing pipeline validated: YAML duplicate-key failure resolved in 3 tasks, no human touch
- **[CARRY-WATCH]** aibtcdev/skills stale-issue sensor: must use live `gh pr list --json createdAt` timestamps (memory rule 2026-06-01)
- **[CARRY-WATCH]** context-review skip list ~16+ conditions — refactor if >20

### Step 4 — Accelerate

- Cost-per-task $0.31–$0.38 over past 48h — nominal
- No new pipeline bottlenecks

### Step 5 — Automate

No new automation gaps.

### Flags

- **[CARRY-WATCH]** aibtcdev/skills stale-issue sensor — live timestamp check required; confirm code patched
- **[CARRY-WATCH]** RFC Phase 2 (RFC 0011 + ADAPT ports) — not yet started
- **[CARRY-WATCH]** arc-email-worker no-CI/CD — deploy workflow still missing
- **[CARRY-WATCH]** context-review skip list ~16+ conditions — refactor if >20
- **[CARRY-WATCH]** X API credits depleted (#17796 blocked) — awaiting whoabuddy top-up
- **[CARRY-WATCH]** amber-otter credential exposure — no autonomous path

---

## 2026-06-01T21:12:00.000Z — no structural changes; self-healing confirmed; stale-issue sensor FP; 120 skills / 73 sensors

**Task #18094** | Diff: b07bc650 → 129c62ad (0 structural commits) | Sensors: 73 | Skills: 120

### Step 1 — Requirements

No structural commits to `src/` or `skills/` since last review. Sensor triggered by active reports.

Watch report 2026-06-01T01:02Z → 20:40Z highlights:
- 22 completed, 1 failed (self-healed) — YAML duplicate-key in blog frontmatter triggered auto-retrospective → fix (#18071) → redeploy, no human touch
- 4 blog posts published: "Four RFCs, One Foundation", cursor pattern, Phase 5 shared queue, + Noise Floor
- 3 PR approvals: landing-page #947 (bounties proof-of-flow), #948 (BNS TTL 7d→6h), #950 (x402 stats drift)
- `recent.log` at 302 lines — consolidation queued (#18086, threshold 300)
- Dispatch stale FP (#18063) — in-flight lock held, closed correctly
- Skills escalation FP (#18077) — date calculation stale; last PR was 3 days ago, not 10. Closed without escalation.

### Step 2 — Delete

No deletion candidates. 120/73 stable.

### Step 3 — Simplify

- Self-healing pipeline working as designed — YAML duplicate-key failure resolved in 3 tasks, no human touch.
- **[NEW-WATCH]** aibtcdev/skills stale-issue sensor used stale date calculation. Rule captured in MEMORY.md. Confirm sensor is patched.
- **[CARRY-WATCH]** context-review skip list ~16+ conditions — refactor if >20.

### Step 4 — Accelerate

- $0.38/task average (22 tasks, $8.44). Elevated due to 4-blog-post day; nominal.
- No new pipeline bottlenecks.

### Step 5 — Automate

- recent.log consolidation queued and running — automation working as designed.

### Flags

- **[RESOLVED]** aibtcdev/skills escalation carry — last PR was 3 days ago (live check), not 10. Sensor date bug is the issue.
- **[NEW-WATCH]** aibtcdev/skills stale-issue sensor date calculation — must use live `gh pr list` timestamp, not derived value.
- **[CARRY-WATCH]** RFC Phase 2 (RFC 0011 + ADAPT ports) — not yet started.
- **[CARRY-WATCH]** arc-email-worker no-CI/CD — deploy workflow still missing.
- **[CARRY-WATCH]** context-review skip list ~16+ conditions — refactor if >20.
- **[CARRY-WATCH]** X API credits depleted (#17796 blocked) — awaiting whoabuddy top-up.
- **[CARRY-WATCH]** amber-otter credential exposure — no autonomous path. Awaiting whoabuddy.

---

## 2026-06-01T09:15:00.000Z — blog-publishing idempotency fix; aibtcdev/skills escalation threshold reached; 120 skills / 73 sensors

**Task #18076** | Diff: e96561a0 → b07bc650 (1 structural commit) | Sensors: 73 | Skills: 120

### Step 1 — Requirements

- **fix(blog-publishing): skip adding published_at if already present in frontmatter** (b07bc650): `cmdPublish` now guards `published_at` insertion with `!/^published_at:/m.test(content)`. Prior code unconditionally appended `published_at: <now>` on every publish run — re-publishing or `--force` on an already-published post produced duplicate frontmatter fields. Minimal, correct fix.

Active reports integrated:
- **Watch 2026-05-31T13:01Z → 2026-06-01T01:02Z**: 27 completed, 0 failures, $7.42. "The Noise Floor" blog published (freshness fix). Arc-opensource synced 36 commits. Housekeeping cooldown guard working correctly (2 zero-fix passes skipped). Queue empty at period end. X API 402 still blocked.

### Step 2 — Delete

No deletion candidates. 120/73 stable.

### Step 3 — Simplify

- Blog-publishing fix is minimal and correct: 3-line change, one guard, no new abstractions.
- **[CARRY-WATCH]** context-review skip list ~16+ conditions — refactor if >20.

### Step 4 — Accelerate

- 27 tasks, 0 failures, $0.274/task. Pipeline nominal.
- Housekeeping cooldown confirmed working (2 zero-fix skips in watch window).
- No new bottlenecks.

### Step 5 — Automate

No new automation gaps.

### Flags

- **[CARRY-WATCH → ESCALATE TODAY]** aibtcdev/skills 0 PRs since 2026-05-22 — 10 days. Escalation threshold was 2026-06-01 (today). Create escalation task to whoabuddy.
- **[CARRY-WATCH]** RFC Phase 2 (RFC 0011 + ADAPT ports) — queue empty, opportunity to start.
- **[CARRY-WATCH]** arc-email-worker no-CI/CD — deploy workflow still missing.
- **[CARRY-WATCH]** context-review skip list ~16+ conditions — refactor if >20.
- **[CARRY-WATCH]** X API credits depleted (#17796 blocked) — awaiting whoabuddy top-up.
- **[CARRY-WATCH]** amber-otter credential exposure — no autonomous path. Awaiting whoabuddy.

---

## 2026-05-31T21:08:00.000Z — housekeeping zero-fix cooldown shipped; CF quota VERIFIED closed; 120 skills / 73 sensors

**Task #18047** | Diff: d0bd9179 → e96561a0 (1 structural commit) | Sensors: 73 | Skills: 120

### Step 1 — Requirements

- **fix(arc-housekeeping): add 4h zero-fix cooldown** (e96561a0): `getLastCompletedTaskBySource(source)` added to `src/db.ts` and re-exported via `src/sensors.ts`. Sensor checks last completed housekeeping task's `result_summary` against `ZERO_FIX_PATTERNS`. If matched and `elapsedMinutes < 240`, sensor logs "cooling off" and returns early. Closes [ACTION] from 2026-05-31T09:07Z audit — 5 zero-fix cycles (tasks #18021/#18025/#18026/#18032) generated overnight, all script-model no-ops.

Active reports integrated:
- **Overnight brief 2026-05-31T13:09Z**: 14 completed, 0 failures, $0.251/task. Highlights: housekeeping cooldown shipped (`e96561a0`), CF quota fix VERIFIED (99.9% row-read reduction sustained 24h, target <1k/hr met), agent-runtime PR #5 merged (Phase 5 substrate intake). X API 402 still open (no credits). Queue empty post-overnight.

### Step 2 — Delete

No deletion candidates. Catalog count from task #18030: **120 skills / 73 sensors** (prior state-machine showed 121 — likely catalog excludes a skill without valid SKILL.md; not structurally significant).

### Step 3 — Simplify

- Zero-fix cooldown: correct and minimal — 15 lines, one new DB query, zero behavioral change on the happy path. Pattern mirrors existing `recentTaskExistsForSource` guard on arc-workflows (e4c8a9b3). Rule: `getLastCompletedTaskBySource` is now the standard for sensors that must avoid repeat no-op runs.
- **[CARRY-WATCH]** context-review skip list ~16+ conditions — refactor if >20.

### Step 4 — Accelerate

- Housekeeping zero-fix churn eliminated: 4–5 script-model cycles/night → at most 1 per 4h window. Tangible overnight cost reduction.
- No new bottlenecks.

### Step 5 — Automate

No new automation gaps. Zero-fix cooldown is the automation the prior arch-review flagged.

### Flags

- **[RESOLVED]** arc-housekeeping zero-fix churn (e96561a0) — 4h cooldown + ZERO_FIX_PATTERNS. [ACTION] from 2026-05-31T09:07Z closed.
- **[RESOLVED]** arc-email-worker CF quota (task #17961 PASS, 24h sustained) — fully closed.
- **[CARRY-WATCH]** aibtcdev/skills 0 PRs since 2026-05-22 (9d+) — escalation threshold reached; escalate to whoabuddy.
- **[CARRY-WATCH]** RFC Phase 2 (RFC 0011 + ADAPT ports) — queue empty, time to start.
- **[CARRY-WATCH]** context-review skip list ~16+ conditions — refactor if >20.
- **[CARRY-WATCH]** amber-otter credential exposure — no autonomous path. Awaiting whoabuddy.
- **[CARRY-WATCH]** X API credits depleted (#17796 blocked, 4+ days stale) — awaiting whoabuddy top-up.
- **[CARRY-WATCH]** arc-email-worker no-CI/CD — deploy workflow still missing.
- **[WATCH]** Housekeeping cooldown first real test — monitor next 1-2 cycles to confirm ZERO_FIX_PATTERNS matches the "2 issues detected / 0 fixed" pattern correctly.

---

## 2026-05-31T09:07:00.000Z — no structural changes; housekeeping churn actionable; CF quota verified; 121 skills / 73 sensors

**Task #18028** | Diff: d0bd9179 → d0bd9179 (0 structural commits) | Sensors: 73 | Skills: 121

### Step 1 — Requirements

No structural commits to `src/` or `skills/` since last review. Sensor triggered on "active reports to process" — watch report 2026-05-31T01:02Z.

Watch report highlights:
- 32 tasks, 0 failures, 100%, $10.72. Clean.
- Agent-runtime PR #5 reviewed ($2.56, opus): surfaced file-dep-pin-illusion + double-execution-window gaps. Both patterns extracted to patterns.md.
- PR #942 (aibtcdev/landing-page phantom unread COUNT bypass) merged.
- "Dead Ends Are Data Too" blog published — arc0.me freshness cleared.
- arc-opensource sync: 54 commits shipped.
- Housekeeping: **5 zero-fix cycles** in this window. CEO review flagged as dispatch churn.
- CF row-read verify (#17961): PASS — 99.9% reduction confirmed (82k → ~70 rows/hr sustained 24h). RESOLVED.

### Step 2 — Delete

No deletion candidates. 121/73 stable.

### Step 3 — Simplify

- **[ACTION → follow-up created]** Housekeeping sensor churn: 5 consecutive zero-fix cycles. Same pattern as self-review triage redundancy (#17763, fixed via autoAdvanceState). Fix: add a "nothing fixed" state-diff guard or 2h dedup cooldown between zero-fix runs. CEO review confirmed this is actionable.
- **[CARRY-WATCH]** context-review skip list ~16+ conditions — refactor if >20.

### Step 4 — Accelerate

- CF quota crisis fully resolved (#17961 PASS). arc-email-worker row reads from 7.35M/day → ~70/hr — quota no longer a daily concern.
- RFC Phase 2 (RFC 0011 + ADAPT ports) gap remains. Queue is near-empty — time to queue tasks if whoabuddy hasn't already.

### Step 5 — Automate

- Housekeeping dedup guard: follow-up task created this cycle. Same mechanism as `recentTaskExistsForSource` belt-and-braces in arc-workflows (e4c8a9b3).
- arc0.me freshness decay is now a predictable ~2d cycle during signal pause — "incident-to-blog-post" is a reliable dual-purpose fix. No new automation needed; pattern is documented.

### Flags

- **[RESOLVED]** arc-email-worker CF quota (task #17961 PASS) — 99.9% row-read reduction verified 24h post-deploy. Sustained 68–74 rows/hr.
- **[ACTION → task created]** Housekeeping zero-fix churn: 5 cycles, 0 fixes — add dedup cooldown.
- **[CARRY-WATCH]** aibtcdev/skills 0 PRs since 2026-05-22 (9d) — escalation threshold reached. Prior entry flagged as ACTION; verify task exists or create.
- **[CARRY-WATCH]** RFC Phase 2 (RFC 0011 + ADAPT ports) — not yet started. Queue near-empty.
- **[CARRY-WATCH]** context-review skip list ~16+ conditions — refactor if >20.
- **[CARRY-WATCH]** amber-otter credential exposure — no autonomous path. Awaiting whoabuddy.
- **[CARRY-WATCH]** X API credits depleted (#17796 blocked) — awaiting whoabuddy top-up.
- **[CARRY-WATCH]** arc-email-worker no-CI/CD — deploy workflow still missing.

---

## 2026-05-30T21:06:00.000Z — no structural changes; overnight brief processed; aibtcdev/skills escalation threshold reached; 121 skills / 73 sensors

**Task #18006** | Diff: d0bd9179 → d0bd9179 (0 structural commits) | Sensors: 73 | Skills: 121

### Step 1 — Requirements

No structural commits to `src/` or `skills/` since last review. Sensor triggered on "active reports to process" — overnight brief 2026-05-30T13:06Z.

Overnight brief highlights:
- 13 tasks completed, 0 failures, $2.35. Clean.
- Dispatch stale FP fired again (4th+ occurrence, 07:54 UTC) — #17763 tracking dedup cooldown, no progress.
- arc-email-worker CF quota verify scheduled tonight (#17961, 23:45 UTC).
- Blog "The Hidden Tax: 4.67M Row Reads" published — freshness alert clear.
- aibtcdev/skills: 0 PRs since 2026-05-22 = 8+ days — escalation threshold reached per MEMORY.md rule.

### Step 2 — Delete

No deletion candidates. 121/73 stable.

### Step 3 — Simplify

- **[CARRY-WATCH]** context-review skip list ~16+ conditions — no growth this window. Still below ~20 refactor threshold.
- **[CARRY-WATCH → ACTION]** Dispatch stale FP (#17763): 4th+ occurrence with no code fix. The dedup cooldown is a small, targeted change (1h gate on identical-result stale alerts). If still open next arch-review cycle, promote to explicit follow-up task.

### Step 4 — Accelerate

- arc-email-worker CF quota verify tonight (#17961, 23:45 UTC): if rows/hr dropped from 82k → <1k, that closes the dominant CF quota drain. Key result to watch.
- No new pipeline bottlenecks.

### Step 5 — Automate

No new automation gaps. All active blocks remain human-gated.

### Flags

- **[ACTION — THRESHOLD REACHED]** aibtcdev/skills 0 PRs since 2026-05-22 (8+ days). Memory rule: escalate to whoabuddy today. Threshold was 2026-06-01 but silence is already 8 days and no upstream PR activity. Create escalation task if not already queued.
- **[CARRY-WATCH → NEXT ACTION]** Dispatch stale FP (#17763) — 4th+ occurrence, dedup cooldown fix not yet implemented. Promote to follow-up task if open at next cycle.
- **[WATCH]** arc-email-worker CF quota verify: #17961 at 23:45 UTC tonight. Expected: <1k rows/hr.
- **[CARRY-WATCH]** arc-email-worker no-CI/CD — deploy workflow still missing.
- **[CARRY-WATCH]** context-review skip list ~16+ conditions — refactor if >20.
- **[CARRY-WATCH]** amber-otter credential exposure — 12d stale. No autonomous path.
- **[CARRY-WATCH]** X API credits depleted — #17796 blocked. Awaiting whoabuddy top-up.
- **[CARRY-WATCH]** RFC 0011 + ADAPT ports — next phase of agent-runtime.

---

## 2026-05-30T09:10:00.000Z — arc-catalog MDX escaping fix; no structural changes; 121 skills / 73 sensors

**Task #17982** | Diff: f1125a85 → d0bd9179 (1 structural commit) | Sensors: 73 | Skills: 121

### Step 1 — Requirements

- **fix(arc-catalog): escape angle brackets in skill descriptions for MDX safety** (d0bd9179): `escapeMdx()` helper added to `skills/arc-catalog/cli.ts`. Replaces `<` → `&lt;` and `>` → `&gt;` in skill descriptions before writing to the MDX catalog. Applied to both sensor and non-sensor table rows (lines 168 and 199). Prevents JSX parse errors when descriptions contain angle bracket text — catalog generation would silently produce invalid MDX without this fix.

No active CEO/watch report findings to integrate this window. Most recent reports (2026-05-30T01:02Z watch) are standard pipeline summaries.

### Step 2 — Delete

No deletion candidates. 121 skills / 73 sensors unchanged.

### Step 3 — Simplify

- `escapeMdx()` is exactly the right abstraction: 2 lines, one responsibility, applied at the output boundary. Not over-engineered.
- **[CARRY-WATCH]** context-review skip list ~16+ conditions — refactor if >20.

### Step 4 — Accelerate

- arc-catalog MDX fix prevents site build failures from angle bracket descriptions — eliminates a silent breakage class on every future `arc-catalog generate` run.
- No new pipeline bottlenecks.

### Step 5 — Automate

- Low-priority follow-up: `lint-skills --staged` could check for unescaped `<>` in SKILL.md descriptions to catch at commit time rather than at catalog generation time. Not urgent — the fix is at the output layer.

### Flags

- **[RESOLVED]** arc-catalog MDX escaping — d0bd9179. Angle brackets in skill descriptions no longer break site catalog generation.
- **[WATCH]** arc-email-sync CF quota: PR #8 deployed 2026-05-29T23:39Z — verify row reads at task #17961 (2026-05-30T23:45 UTC).
- **[CARRY-WATCH]** arc-email-worker no-CI/CD — deploy workflow still missing. No verification possible until workflow added.
- **[CARRY-WATCH]** context-review skip list ~16+ conditions — refactor if >20.
- **[CARRY-WATCH]** amber-otter credential exposure — no autonomous path. 12d stale.
- **[CARRY-WATCH]** aibtcdev/skills: 0 PRs since 2026-05-22 — **escalate to whoabuddy today (2026-05-30, threshold was 2026-06-01 but activity has been silent 8+ days).**
- **[CARRY-WATCH]** X API credits depleted — parked P9 tasks. Awaiting whoabuddy top-up.
- **[CARRY-WATCH]** RFC 0011 + ADAPT ports — next phase of agent-runtime.

---

## 2026-05-29T21:10:00.000Z — arc-email-sync cursor cold-start fix; context-review FP narrowing; worktree merge safety; 121 skills / 73 sensors

**Task #17956** | Diff: 32e8ae4 → f1125a85 (4 structural commits) | Sensors: 73 | Skills: 121

### Step 1 — Requirements

- **fix(arc-email-sync): add since-cursor to /api/messages poll** (b7c5f4b8): `since` param added to `/api/messages` requests. Targets 4.67M CF DO row reads/day → ~5k/day. Fix was non-functional until cold-start bug resolved (see below).
- **fix(arc-email-sync): repair since-cursor cold-start when sensor state file exists** (c40f4ceb): Root cause: `loadCursorState()` only initialized cursors when file was ABSENT, but `db/hook-state/arc-email-sync.json` always exists (sensor infra writes `last_ran`/`version`). Result: `cursor = undefined` → `new Date(undefined).toISOString()` throws RangeError, error swallowed, full-table scan ran every poll. Also: `saveCursorState` overwrote sensor metadata, breaking `claimSensorRun` interval gate. Fix: validate `inbox`/`sent` as parseable ISO strings before trusting; fall through to cold-start (NOW) if missing/invalid. `saveCursorState` now merges into existing file.
- **fix(context-review): narrow arc-email-sync keyword to prevent FP on arc-email-worker tasks** (9bf388ed): `"arc-email"` keyword in `SKILL_KEYWORD_MAP` replaced with `"arc-email-sync"`. Prior broad match caught `arc-email-worker` CF worker tasks that don't need the email client skill — causing false-positive skill suggestions.
- **chore(loop) arc-worktrees/cli.ts + src/worktree.ts** (f1125a85): `cmdMerge` removes `--force` from `git worktree remove`. Previously force-removed worktrees even with uncommitted changes — silently discarding work. Now fails cleanly, letting the validate step catch issues before merge.

### Step 2 — Delete

No deletion candidates this window. 121/73 stable.

### Step 3 — Simplify

- Since-cursor fix is structurally correct: cursor validation is the right guard rather than trusting that the file is always in the expected shape. The shared state file pattern (sensor metadata + sync cursors in one JSON) is now explicitly handled at both read and write.
- **[CARRY-WATCH]** context-review skip list ~16+ conditions — refactor if >20.
- **[CARRY-WATCH]** dead-ends.md / MEMORY.md [A] overlap — define convention in next memory consolidation.

### Step 4 — Accelerate

- arc-email-sync cursor fix eliminates the dominant CF quota drain. Cursors initialized at 2026-05-29T15:25Z; verify row-read drop via CF GraphQL Analytics at task #17938 (23:30 UTC).
- Worktree merge safety prevents silent data loss — improves dispatch resilience for worktree-scoped tasks.

### Step 5 — Automate

No new automation gaps identified. Cursor state management is now self-healing.

### Flags

- **[RESOLVED]** arc-email-sync cursor cold-start bug (c40f4ceb) — cursor now initialized reliably; `saveCursorState` preserves sensor metadata.
- **[RESOLVED]** arc-email-sync since-cursor non-functional (b7c5f4b8 + c40f4ceb) — both commits required; quota fix now live.
- **[RESOLVED]** context-review FP on arc-email-worker tasks (9bf388ed) — keyword narrowed.
- **[RESOLVED]** arc-worktrees cmdMerge force-remove risk (f1125a85) — removed `--force` flag.
- **[WATCH]** arc-email-sync CF quota reduction — verify row reads at task #17938 (23:30 UTC). Expected: ~4.67M/day → ~5k/day.
- **[CARRY-WATCH]** arc-email-worker no-CI/CD — PR merged but worker never deployed. Cursor fix doesn't help until worker is deployed.
- **[CARRY-WATCH]** context-review skip list ~16+ conditions — refactor if >20.
- **[CARRY-WATCH]** amber-otter credential exposure — 11d stale. No autonomous path.
- **[CARRY-WATCH]** aibtcdev/skills: 0 PRs since 2026-05-22 — escalate to whoabuddy if persists past 2026-06-01.
- **[CARRY-WATCH]** X API credits depleted — parked P9 tasks. Awaiting whoabuddy top-up.
- **[CARRY-WATCH]** RFC 0011 + ADAPT ports — next phase of agent-runtime work queued.

---

## 2026-05-29T09:09:00.000Z — dispatch resurrection fix; rate_limit_event classification; email dedup; arc0btc-email-worker; opus 4.8; recent.log trigger; 121 skills / 73 sensors

**Task #17908** | Diff: 0de5548 → 32e8ae4 (11 structural commits) | Sensors: 73 | Skills: 121

### Step 1 — Requirements

- **fix(dispatch): informational rate_limit_event bypass** (510b9e67): `status='allowed'` events (bucket warning, call succeeded) no longer abort dispatch or trip gate. Prior code treated all events as denials — discarded successful results. Fix: short-circuit on `status='allowed'`; read reset from `rate_limit_info.resetsAt` (epoch). Verified against 2026-05-28 repro. Pairs with default-backoff fix.
- **fix(dispatch-gate): default backoff for unknown reset** (e423f55f): When `rate_limit_event` has no parseable reset, `stopped_until = now + 60min`. Previously latched indefinitely. Closes 2026-05-28T15:11:56Z incident (11+ min freeze). Full rate-limit handling now self-healing with no manual intervention path.
- **fix(dispatch+db): dispatch resurrection two-layer fix** (af5c6ac2 + 78408d07): Catch-block guard prevents requeue if LLM self-closed; DB-layer `WHERE status != 'completed'` enforces terminal invariant race-safely. Closes task #17845 class fully.
- **feat(arc-email-sync): sent-folder dedup guard** (651120e6): Before any send, query sent folder for matching subject. Skip + idempotent close if already sent. Closes side-effecting re-dispatch bug #1 (task #17836).
- **feat(models): opus 4.8** (8d8b18a5): `MODEL_IDS.opus` → `claude-opus-4-8` (sdk-v0.100.0, 2026-05-28). Clean one-liner.
- **feat(skill): arc0btc-email-worker scaffold** (495369d1): New skill for `arc0btc/arc-email-worker` CF Worker + DO email store. Skill count 120→121. Pending: schema-health issue #2.
- **feat(arc-memory): recent.log consolidation trigger** (32e8ae47): Check 1c in arc-skill-manager sensor — queues consolidation at >300 lines. Closes [NEW-WATCH] from 2026-05-29T08:50Z audit.
- **fix(abbreviated vars)** (cbd1ff78+7ccf1eef): Pre-commit hook compliance. `res/msg → response/message`; `ts → timestamp`.

### Step 2 — Delete

No deletion candidates this window. 121/73 stable. Rate limit handling is now three properly-separated modules (dispatch.ts / dispatch-gate.ts) — correct decomposition, no dead code.

### Step 3 — Simplify

- Rate limit handling is now structurally complete: 3 distinct bugs (classification, backoff, gate extraction) each fixed in isolation. `stopped_until` as a first-class field eliminates all O(n) string-parsing on gate checks.
- **[CARRY-WATCH]** context-review skip list ~16 conditions — refactor if >20.
- **[CARRY-WATCH]** dead-ends.md / MEMORY.md [A] overlap — both lists same blockers. Convention: dead-ends.md = machine-readable check, MEMORY.md [A] = human context. Apply migration in next memory consolidation.

### Step 4 — Accelerate

- Full rate-limit auto-recovery path: denial events now parse reset time reliably; informational events don't abort. Gate stops only on real quota denials, self-heals without manual reset.
- Email dedup + dispatch resurrection fixes eliminate the main class of wasted cycles during rate-limit recovery windows.

### Step 5 — Automate

- recent.log consolidation is now automated (sensor-triggered at 300 lines) — closes the [NEW-WATCH] from prior audit.
- No new automation gaps identified.

### Flags

- **[RESOLVED]** dispatch resurrection bug (af5c6ac2 + 78408d07) — terminal task invariant enforced at catch + DB layer.
- **[RESOLVED]** informational rate_limit_event classification (510b9e67) — allowed events no longer abort dispatch.
- **[RESOLVED]** rate_limit_event unknown reset → default backoff (e423f55f) — gate always self-heals.
- **[RESOLVED]** email sent-folder dedup guard (651120e6) — side-effecting task re-dispatch bug #1 closed.
- **[RESOLVED]** recent.log consolidation trigger (32e8ae47) — [NEW-WATCH] from 2026-05-29T08:50Z audit closed.
- **[NEW-WATCH]** arc0btc-email-worker: schema-health endpoint (issue #2) pending. No sensor/cli yet — just SKILL.md scaffold.
- **[CARRY-WATCH]** context-review skip list ~16 conditions — refactor if >20.
- **[CARRY-WATCH]** dead-ends.md / MEMORY.md [A] overlap — define convention in next memory consolidation.
- **[CARRY-WATCH]** aibtcdev/skills: 0 PRs since 2026-05-22 — escalate to whoabuddy if persists past 2026-06-01.
- **[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.
- **[CARRY-WATCH]** amber-otter credential exposure — 11d stale. No autonomous path.
- **[CARRY-WATCH]** X API credits depleted — parked P9 tasks. Awaiting whoabuddy top-up.
- **[CARRY-WATCH]** RFC 0007–0010 (#17857–17860) — 4 tasks queued by whoabuddy, not yet started.

---

## 2026-05-29T08:50:00.000Z — dispatch gate extracted to own module; arc-peer-inbox; per-task reflect; dead-ends registry; tool_calls eval column; 120 skills / 73 sensors

**Task #17817** | Diff: 428b8fd → 0de5548 (7 structural commits) | Sensors: 73 | Skills: 120

### Step 1 — Requirements

- **feat(dispatch): three-layer rate-limit detection** (0de55487): Gate logic extracted from `dispatch.ts` to `src/dispatch-gate.ts`. New `stopped_until` field computed at record time eliminates parse cost on every check. Three-layer detection hierarchy for rate limit events. Email notification on gate stop. Closes the 19h recovery gap pattern.
- **feat(arc-peer-inbox): file-based inter-agent inbox** (9d287f4d): New skill + sensor. Stop hook writes `inbox/<peer>/<ts>.md` for aibtc.com inbox-thread tasks. Sensor creates P3/sonnet task per unprocessed file. Local IPC; production path remains aibtc.com. Sensor count 72→73, skill count 118→120.
- **feat(reflect): per-task reflection to memory/recent.log** (6aa253fe): RARV Reflect phase. `appendTaskReflection()` appends one line at every task close. Two memory outputs now: MEMORY.md (compressed) + recent.log (rolling).
- **feat(cycle_log): tool_calls column** (f51a7ec2): JSON array of tool names per cycle. Enables golden case assertions per Hylak eval guidance.
- **feat(memory): dead-end registry** (8d2378fa): `memory/dead-ends.md` JSONL + `arc dead-ends` CLI. 15 known blockers. "Check dead-ends before escalating" pattern now operationalized.
- **fix(arc-workflows): auto-advance self-review-cycle issues_found→triaging** (d797bb65): Closes self-review triage redundancy carry (task #17763).
- **Reports**: Overnight 2026-05-29T05:53Z — dispatch resurrection bug fully patched (78408d07 + af5c6ac2). Email dedup guard shipped (651120e6). 6 completed, $1.41, 70 pending.

### Step 2 — Delete

No deletion candidates this window. 120/73 stable.

### Step 3 — Simplify

- `dispatch-gate.ts` extraction correct — gate state was entangled with dispatch orchestration. Own module improves separation.
- **[NEW-WATCH]** `dead-ends.md` vs MEMORY.md [A] overlap: same blockers in both. Need convention: dead-ends.md = machine-readable, MEMORY.md [A] = human context. Or consolidate [A] into dead-ends.md to prevent drift on blocker resolution.
- **[NEW-WATCH]** `memory/recent.log` accumulation — no automated trigger for monthly consolidation. Add to arc-memory sensor: if line count > N, queue consolidation task.
- **[CARRY-WATCH]** context-review skip list ~16 conditions — refactor if >20.

### Step 4 — Accelerate

- `stopped_until` eliminates repeated string parsing on gate checks — now O(1) date comparison.
- Email dedup guard prevents whoabuddy duplicate emails during re-dispatch windows.

### Step 5 — Automate

- **[NEW-WATCH]** recent.log monthly consolidation — add line count check to arc-memory sensor.
- dead-ends.md check before escalation is the right mechanism — next step: surface matched dead-ends in task description at dispatch time.

### Flags

- **[RESOLVED]** dispatch resurrection bug — two-layer fix (af5c6ac2 + 78408d07). Terminal task invariant now enforced at DB layer.
- **[RESOLVED]** self-review triage redundancy (task #17763) — d797bb65 auto-advances issues_found→triaging.
- **[NEW-WATCH]** dead-ends.md / MEMORY.md [A] overlap — define convention to prevent drift.
- **[NEW-WATCH]** recent.log consolidation trigger — add to arc-memory sensor.
- **[CARRY-WATCH]** context-review skip list ~16 conditions — refactor if >20.
- **[CARRY-WATCH]** amber-otter credential exposure — day 11 stale. Autonomous paths exhausted.
- **[CARRY-WATCH]** Loom inscription spiral — no runs.
- **[CARRY-WATCH]** Payout disputes (11) — 30+ days stale. Requires whoabuddy direct outreach.
- **[CARRY-WATCH]** aibtcdev/skills: 0 PRs since 2026-05-22 — escalate to whoabuddy if persists past 2026-06-01.
- **[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.
- **[CARRY-WATCH]** X API credits depleted — task #17796 parked P9. Awaiting whoabuddy top-up.
- **[CARRY-WATCH]** RFC 0007–0010 implementation (#17857–17860) — 4 tasks queued by whoabuddy, not yet started.

---

## 2026-05-27T09:05:00.000Z — disallowed-tools rollout complete; dispatch resilience (opus fallback + MCP timeout); AGENT.md wave; 118 skills / 72 sensors

**Task #17751** | Diff: 8295967 → 428b8fd (7 structural commits) | Sensors: 72 | Skills: 118

### Step 1 — Requirements

- **fix(dispatch): MCP_TOOL_TIMEOUT=120s + opus fallback model** (7f3fdefc): Two targeted resilience improvements. `MCP_TOOL_TIMEOUT=120000` fixes v2.1.142 regression where HTTP/SSE MCP servers ignored this env var (silent 60s cap). `--fallback-model sonnet` for opus tasks prevents full dispatch stall if Opus is temporarily unavailable (v2.1.152+ feature).
- **feat(skills): disallowed-tools rollout complete** (4 batch commits + 10c3d2fa): 29/29 candidates from the 2026-05-27 audit now have `disallowed-tools` frontmatter. Read-only enforcement is now structural, not just documented. Authoring guide in `arc-skill-manager/SKILL.md` updated.
- **feat(hooks): reloadSkills flag on skill create** (cd278723): `arc-skill-manager/cli.ts` writes `db/skills-pending-reload.flag` on `create`. SessionStart hook returns `reloadSkills:true`, enabling dynamic reload. Closes the workflow gap where freshly scaffolded skills were invisible to the current session.
- **docs: AGENT.md wave** (41f62581 + auto-commits): 7 skills got subagent briefings: `daily-brief-inscribe`, `arc-worktrees`, `jingswap`, `defi-zest`, `arc-payments`, `dao-zero-authority`, `defi-bitflow`. Implements the SKILL.md-for-orchestrator / AGENT.md-for-subagent separation cleanly.
- **fix(context-review): disallowed-tools config tasks excluded from keyword matching** (428b8fd4): Skip list grows to ~16 conditions (+1). `/^Add disallowed-tools to /i` added. Consistent with prior sync-task exclusion.
- **Watch/brief integration**: 2026-05-27T01:00Z watch — 32 completed, 0 failed, $13.51. Queue clear. 2026-05-26 overnight brief — 31 tasks, 0 failures, $10.61. Pipeline nominal.

### Step 2 — Delete

- No deletion candidates this window. Sensor/skill counts hold at 72/118.

### Step 3 — Simplify

- disallowed-tools rollout is architecturally clean: enforcement at the skill layer (SKILL.md frontmatter), not buried in dispatch logic or agent instructions. Claude Code blocks disallowed tool calls before they execute — belt-and-suspenders over "don't do that" prose.
- AGENT.md separation is correct pattern: orchestrators get SKILL.md (lean), subagents get AGENT.md (full detail). 7 new AGENT.md files reduce token exposure when dispatching deep-work.
- **[CARRY-WATCH]** context-review skip list at ~16 conditions. One more per window → ~20 within 2-4 cycles. Consider `SKIP_SUBJECT_PATTERNS: Array<RegExp | ((task) => boolean)>` table refactor if list grows further.
- **[NEW-WATCH]** `db/skills-pending-reload.flag` cleanup: verify SessionStart hook clears the flag after consuming it. If not cleared, every subsequent session start would trigger spurious reload.

### Step 4 — Accelerate

- Opus fallback eliminates dispatch stalls on model availability issues. MCP timeout prevents silent 60s cap that caused x402/Stacks tool calls to appear to hang. Both reduce invisible failure modes.
- No new pipeline bottlenecks. 0% failure rate this window.

### Step 5 — Automate

- `disallowed-tools` lint check in `lint-skills --staged` hook would enforce the new best practice for future skill additions. Currently the authoring guide documents it but the hook doesn't verify. Low-priority follow-up.
- No other new automation opportunities.

### Flags

- **[RESOLVED]** disallowed-tools rollout — 29/29 candidates complete. Authoring guide updated. Read-only enforcement is now structural.
- **[NEW-WATCH]** `db/skills-pending-reload.flag` cleanup path — verify SessionStart hook clears flag after reloadSkills (cd278723).
- **[CARRY-WATCH]** context-review skip list ~16 conditions — refactor if >20.
- **[CARRY-WATCH]** amber-otter credential exposure — day 9 stale. Autonomous paths exhausted.
- **[CARRY-WATCH]** Loom inscription spiral — no runs.
- **[CARRY-WATCH]** Payout disputes (11) — 30+ days stale. Requires whoabuddy direct outreach.
- **[CARRY-WATCH]** x402-relay nonce sprint PRs #409/#411/#412 — approved, awaiting whoabuddy merge.
- **[CARRY-WATCH]** aibtcdev/skills: 0 PRs since 2026-05-22 — escalate to whoabuddy if persists past 2026-06-01.
- **[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.
- **[CARRY-WATCH]** Zest borrow MCP server 1.56.1 release PR #552 — awaiting release-please merge.

---

## 2026-05-26T21:02:00.000Z — AIBTC title convention enforced in code; deck content refreshed; 118 skills / 72 sensors

**Task #17705** | Diff: 1af299a0 → 8295967 (2 structural commits) | Sensors: 72 | Skills: 118

### Step 1 — Requirements

Two structural commits since last review, both in `skills/arc-weekly-presentation/`:

- **feat(arc-weekly-presentation): refresh May 26 deck with full research** (b0789e56): `src/web/presentation.html` regenerated. Parallel subagent research — 20 PRs, 68 commits, 7 daily blog posts, 3 active beats, 6 services updates, 8 agents welcomed. Content update; no structural change to the generator.
- **fix(arc-weekly-presentation): title slide now leads with AIBTC convention** (82959679): `weekVerb()` + `weekSummaryLine()` added to `cli.ts`. Dynamic AIBTC-led headline replaces hardcoded "Arc Weekly". Verb picked from week's standout metric (prs/agents/tasks). This is the correct fix: prior deck (b0789e56) violated the standing title convention from MEMORY.md [P], prompting the immediate follow-up commit. Convention is now enforced at code level — generator cannot produce a non-compliant title.

No active reports (overnight brief or watch) to integrate this cycle.

### Step 2 — Delete

No deletion candidates. Sensor/skill counts unchanged (118/72).

### Step 3 — Simplify

- `weekVerb()`/`weekSummaryLine()` pattern is correct: title logic belongs in the CLI, not in the research file or MEMORY.md prose. The generator now owns the convention — no agent instruction needed.
- **[CARRY-WATCH]** context-review skip list (15+ conditions) — no growth this window.

### Step 4 — Accelerate

- Title convention violations eliminated at generation time. Prior cycle needed 2 commits (generate + fix); with this change, next deck generation should be single-pass.
- All active bottlenecks remain human-gated: amber-otter rotation (8d stale), payout disputes (30+d), Zest PRs, x402-relay nonce PRs.

### Step 5 — Automate

No new automation opportunities this window.

### Flags

- **[RESOLVED]** AIBTC title convention — now enforced in code via `weekVerb()`/`weekSummaryLine()`. Standing rule from MEMORY.md [P] no longer requires agent vigilance to uphold.
- **[CARRY-WATCH]** x402-relay nonce sprint: PRs #409/#411/#412 approved — awaiting whoabuddy merge.
- **[CARRY-WATCH]** Inbox direct-path CLI gap — `send-inbox-message-direct` subcommand not yet in x402.ts CLI.
- **[CARRY-WATCH]** amber-otter credential exposure — day 8 post-incident, no rotation. Autonomous paths exhausted.
- **[CARRY-WATCH]** Loom inscription spiral — no runs.
- **[CARRY-WATCH]** Payout disputes (11) — 30+ days stale. Requires whoabuddy direct outreach.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge.
- **[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.
- **[CARRY-WATCH]** aibtcdev/skills: 0 PRs — escalate to whoabuddy if persists past 2026-06-01.

---

## 2026-05-26T09:00:00.000Z — MIN_STX_SEND_THRESHOLD recalibrated; x402-relay nonce sprint reviewed; 118 skills / 72 sensors

**Task #17679** | Diff: e4c8a9b3 → 1af299a0 (1 structural commit) | Sensors: 72 | Skills: 118

### Step 1 — Requirements

One structural change since last review:
- **fix(aibtc-welcome): recalibrate MIN_STX_SEND_THRESHOLD** (task #17648): `MIN_STX_SEND_THRESHOLD` in `skills/aibtc-welcome/sensor.ts` reduced 100k → 40k µSTX. Previous threshold was a leftover from when `STX_AMOUNT = 100k µSTX`; after the `a1e4ddd0` reduction to 10k µSTX, the gate blocked welcome-agent even when 4-9 sends were possible. New threshold = `BATCH_CAP × (send + fee) ≈ 3 × 15k = 45k` → 40k. Closes [ACTION] from 2026-05-25T20:59Z audit.

**Watch report (2026-05-25T13:00Z – 2026-05-26T01:01Z)**: 10/10 completed, 0 failures, $2.48 / $0.248/task. Three x402-relay nonce-hardening PRs reviewed and approved (#409 ConflictingNonce fix, #411 aborted-tx confirmable fix, #412 replay-buffer eviction). Weekly deck generated (May 26). Catalog regenerated: 118 skills / 72 sensors. PURPOSE: 3.20/5 (S:1 policy-pause, ops nominal).

### Step 2 — Delete

No new deletion candidates. 118/72 steady.

### Step 3 — Simplify

- **[RESOLVED]** MIN_STX_SEND_THRESHOLD now accurately reflects actual send cost. No remaining miscalibrated thresholds in welcome-agent pipeline.
- No over-engineering in this window.

### Step 4 — Accelerate

- Recalibrated threshold eliminates unnecessary welcome-agent blocks when wallet has 4-9 sends available. Concrete throughput improvement for new agent onboarding.
- 100% success this window. No new bottlenecks.

### Step 5 — Automate

No new automation opportunities. All active blocks are human-gated (amber-otter, payout disputes, Zest PRs, mcp-server PR).

### Flags

- **[RESOLVED]** MIN_STX_SEND_THRESHOLD recalibration (task #17648) — [ACTION] from 2026-05-25 audit closed.
- **[CARRY-WATCH]** x402-relay nonce sprint: PRs #409/#411/#412 approved — awaiting whoabuddy merge.
- **[CARRY-WATCH]** Inbox direct-path CLI gap — `send-inbox-message-direct` not yet in x402.ts CLI. Follow-up tasks queued.
- **[CARRY-WATCH]** amber-otter credential exposure — day 8, no rotation. Arc exhausted autonomous paths.
- **[CARRY-WATCH]** Loom inscription spiral — no runs.
- **[CARRY-WATCH]** Payout disputes (11) — 30+ days stale. Requires whoabuddy direct outreach.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge.
- **[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.
- **[CARRY-WATCH]** aibtcdev/skills: 0 PRs — escalate to whoabuddy if persists past 2026-06-01.

---

## 2026-05-25T20:59:00.000Z — no structural changes; STX wallet resolved; skill count reconciled to 118; 118 skills / 72 sensors

**Task #17647** | Diff: e4c8a9b3 → 782e12d7 (0 structural commits) | Sensors: 72 | Skills: 118

No src/ or skills/ code changes since last review. Sensor triggered by active reports (overnight brief 2026-05-25T13:08Z + watch 2026-05-25T13:00Z).

### Step 1 — Requirements

No new structural commits since the last arch-review. Overnight brief 2026-05-25T13:08Z: 24/25 completed (0 true failures), $7.86 / $0.314/cycle. Highlights:
- **Inbox direct path confirmed** (task #17617): `send_inbox_message_direct` (MCP v1.55.0) eliminates sponsored relay settlement timeouts. CLI gap documented; follow-up tasks queued.
- **Blog published** (tasks #17609/#17610): "Build Is Not Deploy" — captures arc0.me build-without-deploy pattern.
- **Catalog regenerated** (task #17622): 118 skills / 72 sensors. Count reconciled from prior audit's 119.
- **STX wallet refilled**: 100.06 STX confirmed. Escalation to whoabuddy (#17265) worked.

Three escalations remain stale (all human-gated): amber-otter credential rotation (8 days), payout disputes (27+ days), Zest PRs #512/#513.

### Step 2 — Delete

No new deletion candidates. Skill/sensor catalog stable at 118/72.

### Step 3 — Simplify

- **[CARRY-WATCH → ACTION]** `MIN_STX_SEND_THRESHOLD` (100k µSTX) — wallet healthy (100.06 STX). With `STX_AMOUNT = 10k µSTX`, threshold is 10× send. Better: ~40k (BATCH_CAP × send + fees). Now actionable — creating follow-up task.
- Skill count: catalog regeneration task #17622 is authoritative at 118.

### Step 4 — Accelerate

- 0% true failure rate. Pipeline nominal.
- Inbox direct path upgrade eliminates sponsored relay timeout class.
- No new bottlenecks. All active blocks are human-gated.

### Step 5 — Automate

No new automation opportunities. Inbox CLI gap and STX gate follow-up tasks already queued.

### Flags

- **[RESOLVED]** stx-wallet-low-balance — 100.06 STX confirmed.
- **[ACTION]** MIN_STX_SEND_THRESHOLD recalibration — 100k vs. 10k send, now actionable post-refill. Follow-up task created.
- **[CARRY-WATCH]** Inbox direct-path CLI gap — `send-inbox-message-direct` not yet in x402.ts CLI.
- **[CARRY-WATCH]** amber-otter credential exposure — day 8, no rotation. Arc exhausted autonomous paths.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — 27+ days stale. Requires whoabuddy direct outreach.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge.
- **[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.
- **[CARRY-WATCH]** aibtcdev/skills: 0 PRs — escalate to whoabuddy if persists to 2026-06-01.

---

## 2026-05-25T08:56:00.000Z — retrospective flood root cause closed (autoAdvanceState + 60min dedup gate); 119 skills / 72 sensors

**Task #17612** | Diff: f6961f5d → e4c8a9b3 (2 structural commits) | Sensors: 72 | Skills: 119

### Step 1 — Requirements

- **fix(arc-workflows): add autoAdvanceState to all retrospective_pending actions** (1a700e99): Adds `autoAdvanceState: "completed"` to all 9 retrospective_pending state actions in `state-machine.ts`. Root cause of the 2026-05-24 flood (116 dupes, $15.10 in 12h): workflow stuck in `retrospective_pending` — `pendingTaskExistsForSource` returned false because the task completed but the workflow never advanced state → sensor re-created the task every 5-min cycle. Fix: state machine auto-advances to `completed` on task creation. Also removes "Transition workflow to 'completed'" from 9 task description step lists — dispatched agents no longer need to execute this manually.
- **fix(arc-workflows): add belt-and-braces 60min sensor-side dedup gate** (e4c8a9b3): `recentTaskExistsForSource(source, 60)` check added before `insertTask` in the workflow meta-sensor. Defense-in-depth: if a future state action omits `autoAdvanceState`, duplicates are capped at 1/hour instead of 1 per 5-min cycle. Two-layer guard: (1) state machine auto-advance, (2) time-based sensor fallback.
- **Last watch report** (2026-05-25T01:00Z): 9 tasks since last arch-review. Both commits landed overnight post-flood. No new PR reviews or signal tasks (policy pause continues).

### Step 2 — Delete

- The "Transition workflow to 'completed'" instruction was deleted from 9 retrospective task descriptions. Correct: instructions that are now automated by the state machine have no place in agent briefings — they're noise that could cause double-transition bugs.

### Step 3 — Simplify

- `autoAdvanceState` is the correct architecture: the state machine owns its transitions, not the dispatched agent. Previously the state machine depended on the agent following a specific step — that's an inversion of control that caused this exact class of failure. Fixed.
- Belt-and-braces redundancy is appropriate: two independent guards at different layers (machine vs. sensor). Cost is one DB query per task-creation attempt — negligible vs. the $15 flood that prompted it.
- No over-engineering. Both changes are small, targeted additions to existing patterns.

### Step 4 — Accelerate

- Retrospective cost per event: ~$0.13 (one task) vs. $15.10 (116 tasks). Token ratio should normalize away from the 143:1 extreme during the flood.
- No new bottlenecks introduced. All existing blocks remain human-gated.

### Step 5 — Automate

- Both commits ARE the automation fix. Dispatched agents no longer need to manually transition workflows for retrospective states. The state machine is now self-driving for this task class.

### Flags

- **[RESOLVED — CRITICAL]** Retrospective flood ($15.10, 116 dupes in 12h) — 1a700e99 closes root cause (autoAdvanceState on all 9 retrospective_pending actions); e4c8a9b3 adds defense-in-depth (60min recentDup gate). Closes [CRITICAL → ACTION] from 2026-05-24T20:55Z audit.
- **[CARRY-WATCH]** MIN_STX_SEND_THRESHOLD stale (100k vs. 10k send). Calibrate post-wallet-refill.
- **[CARRY-WATCH]** STX wallet critically low (~89k µSTX) — escalated (task #17265). Awaiting whoabuddy refill.
- **[CARRY-WATCH]** amber-otter credential exposure — escalated (task #17266). Day 8 post-incident, no rotation yet.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — 29+ days stale. Requires whoabuddy direct outreach. Hard limit confirmed.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge.
- **[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.
- **[CARRY-WATCH]** aibtcdev/skills: 0 PRs — escalate to whoabuddy if persists to 2026-06-01.

---

## 2026-05-24T20:55:00.000Z — retrospective flood confirmed ($15.10 waste, 116 duplicates); no structural changes; 119 skills / 72 sensors

**Task #17583** | Diff: f6961f5d → f6961f5d (0 structural commits) | Sensors: 72 | Skills: 119

No src/ or skills/ code changes since last review. Sensor triggered by active reports (watch 2026-05-24T01:01Z–13:00Z + overnight brief 2026-05-24T13:03Z).

### Step 1 — Requirements

No new structural commits. Overnight brief (2026-05-24T13:03Z): 145 tasks, 100% success, $22.85 — clean ops but dominated by the retrospective flood already in-flight.

**Watch report (2026-05-24T01:01Z–13:00Z):** 136 tasks completed (0 failed), $20.72 total — but 116 of those were duplicate "Retrospective: arc0btc.com health alert" runs, each spending ~$0.13 to confirm "pattern already captured." Total waste: **~$15.10** (73% of period spend). Token ratio: 21,556k in / 151k out (143:1) — driven entirely by 116 retro cycles loading full context per run. Effective non-duplicate work: 20 tasks at ~$0.28/task.

Previous audit (task #17453, 2026-05-24T08:55Z) flagged retrospective dedup as [NEW-WATCH]. It then flooded in this exact period. Prediction validated; fix is now critical.

Three escalations remain stale (all human-gated): amber-otter credential rotation (day 7), STX wallet refill (~89k µSTX), payout disputes (28+ days).

### Step 2 — Delete

- No new deletion candidates. Skill/sensor catalog stable (119 skills / 72 sensors).

### Step 3 — Simplify

- **[CRITICAL → ACTION]** Retrospective sensor dedup: the retrospective sensor re-queues for already-documented patterns without checking if a completed retrospective for the same source already exists. `pendingOrCompletedTaskExistsForSource` check (or TTL per source task) would close this. 116 duplicate cycles = $15.10 waste in one 12h period. This is the #1 structural fix.
- **[CARRY-WATCH]** `MIN_STX_SEND_THRESHOLD` (100k µSTX) stale after `STX_AMOUNT` reduction to 10k. Better threshold ~40k. Low urgency pending wallet refill.

### Step 4 — Accelerate

- 20 meaningful tasks at 100% (PR approvals, blog published, sensor health 72/72 clean, lint audit 0 violations). Pipeline nominal for real work.
- The flood is the sole bottleneck. Fixing retrospective dedup restores token ratio and cost efficiency to baseline.

### Step 5 — Automate

- No new automation opportunities beyond the retrospective dedup fix.

### Flags

- **[CRITICAL → ACTION]** Retrospective sensor dedup: 116 duplicates, ~$15.10 waste in one 12h window. Add `pendingOrCompletedTaskExistsForSource` check or TTL before queuing retrospective tasks. Follow-up task created.
- **[CARRY-WATCH]** MIN_STX_SEND_THRESHOLD stale (100k vs. 10k send). Calibrate post-wallet-refill.
- **[CARRY-WATCH]** STX wallet critically low (~89k µSTX) — escalated (task #17265). Awaiting whoabuddy refill.
- **[CARRY-WATCH]** amber-otter credential exposure — escalated (task #17266). Day 7 post-incident, no rotation yet.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — 28+ days stale. Requires whoabuddy direct outreach. Hard limit confirmed.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge.
- **[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.
- **[CARRY-WATCH]** aibtcdev/skills 0 PRs — gregoryford963-sys threat actor; escalate to whoabuddy if persists to 2026-06-01.

---

## 2026-05-24T08:55:00.000Z — no structural changes; retrospective dedup FP noted; 119 skills / 72 sensors

**Task #17453** | Diff: f6961f5d → f6961f5d (0 structural commits) | Sensors: 72 | Skills: 119

No src/ or skills/ code changes since last review. Sensor triggered by active reports (overnight brief 2026-05-23T13:07Z + watch report 2026-05-23T13:00Z–2026-05-24T01:01Z).

### Step 1 — Requirements

No new structural commits. Watch report 2026-05-23T13:00Z–2026-05-24T01:01Z: 27/27 (100%), $8.93, $0.331/task. 7 PR reviews across 5 repos (skills, landing-page, x402-sponsor-relay, mcp-server, bff-skills). arc0btc.com build-without-deploy gap closed and promoted to memory (task #17354 → #17355). PURPOSE eval 2.87/5 (S:1 locked while signal filing paused). Landing-page bounty system PRs (#909/#910) now active post-launch.

Three escalations remain stale:
- amber-otter credential rotation — day 7 post-incident (2026-05-18), still no rotation
- STX wallet refill (~89k µSTX)
- Payout disputes (27+ days stale, platform-side block)

### Step 2 — Delete

No new deletion candidates. 119 skills / 72 sensors unchanged.

### Step 3 — Simplify

- **[NEW-WATCH]** Retrospective dedup gap: arc0btc.com incident generated 3 retrospective tasks (tasks #17355, #17356, #17357) for the same incident. CEO Review flagged "one too many." LearningCheck in dispatch spawns retrospectives per task without checking whether a retrospective for the same incident source already exists/completed. Consider adding a dedup check in LearningCheck: skip if completed retrospective exists for same source within last 24h.
- **[CARRY-WATCH]** `MIN_STX_SEND_THRESHOLD` (100k µSTX) stale after `STX_AMOUNT` reduction to 10k. Better threshold ~40k. Low urgency pending wallet refill.

### Step 4 — Accelerate

100% success (27/27 watch + 40/40 overnight). Pipeline nominal. No new bottlenecks. All active blocks are human-gated.

### Step 5 — Automate

No new automation opportunities this window.

### Flags

- **[NEW-WATCH]** Retrospective dedup: 3 passes for single arc0btc.com incident. LearningCheck doesn't deduplicate retrospectives for same source. Consider dedup guard in dispatch LearningCheck.
- **[CARRY-WATCH]** MIN_STX_SEND_THRESHOLD stale (100k vs. 10k send). Calibrate post-wallet-refill.
- **[CARRY-WATCH]** STX wallet critically low (~89k µSTX) — escalated (task #17265). Awaiting whoabuddy refill.
- **[CARRY-WATCH]** amber-otter credential exposure — escalated (task #17266). Day 7 post-incident, no rotation yet.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — 27+ days stale. Requires whoabuddy direct outreach. Hard limit confirmed.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge.
- **[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.
- **[CARRY-WATCH]** aibtcdev/skills 0 PRs for 6+ days — escalate to whoabuddy if persists to 2026-06-01.

---

## 2026-05-23T20:54:00.000Z — no structural changes; 100% overnight (40/40); council name = Notch; 119 skills / 72 sensors

**Task #17345** | Diff: fc2cb43e → fc2cb43e (0 structural commits) | Sensors: 72 | Skills: 119

No src/ or skills/ code changes since last review. Sensor triggered by active reports (overnight brief 2026-05-23T13:07Z + watch report 2026-05-23T13:00Z).

### Step 1 — Requirements

No new structural commits. Overnight brief 2026-05-23T13:07Z: 40/40 completed (100%), 0 failures, $11.79 / $0.295 per task. Highlights: 5-round council naming vote → **Notch**, "Five Rounds to Notch" blog published at arc0.me; gregoryford963-sys cross-repo supply chain pattern confirmed (aibtcdev/skills + 1btc-news/#33); bff-skills PR #605 approved (Phase 2 proof confirmed, ft-trait vault wrapper fix validated).

Three escalations remain human-gated (all sent 2026-05-22):
- amber-otter credential rotation — day 6 post-incident, still no rotation
- STX wallet refill (~89k µSTX, ~500k needed)
- Payout disputes (27+ days stale, platform-side block)

### Step 2 — Delete

No deletion candidates this window. 119 skills / 72 sensors unchanged.

### Step 3 — Simplify

- **[CARRY-WATCH]** `MIN_STX_SEND_THRESHOLD` (100k µSTX) stale after `STX_AMOUNT` reduction to 10k. Better threshold ~40k. Low urgency pending wallet refill.
- context-review skip list at 15+ conditions — still below ~20 refactor threshold. No growth this window.

### Step 4 — Accelerate

- 100% success (40/40). Pipeline nominal. No new bottlenecks. All active blocks are human-gated.

### Step 5 — Automate

- No new automation opportunities this window. Existing escalation items are all human-decision-gated.

### Flags

- **[CARRY-WATCH]** gregoryford963-sys supply chain: cross-repo pattern now confirmed (aibtcdev/skills + 1btc-news/#33). Arc has exhausted autonomous response (blocking reviews, security flags). Awaiting whoabuddy policy on preemptive close.
- **[CARRY-WATCH]** MIN_STX_SEND_THRESHOLD stale (100k vs. 10k send). Calibrate post-wallet-refill.
- **[CARRY-WATCH]** STX wallet critically low (~89k µSTX) — escalated (task #17265). Awaiting whoabuddy refill.
- **[CARRY-WATCH]** amber-otter credential exposure — escalated (task #17266). Day 6 post-incident, no rotation yet.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — 27+ days stale. Requires whoabuddy direct outreach. Hard limit confirmed.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge.
- **[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.
- **[CARRY-WATCH]** aibtcdev/skills 0 PRs for 9+ days — escalate to whoabuddy if persists to 2026-05-29.

---

## 2026-05-23T08:52:00.000Z — no structural changes; gregoryford963-sys supply chain pattern escalating (PRs #394/#395); 119 skills / 72 sensors

**Task #17330** | Diff: fc2cb43e → fc2cb43e (0 structural commits) | Sensors: 72 | Skills: 119

No src/ or skills/ code changes since last review. Sensor triggered by active reports (2026-05-23 watch report).

### Step 1 — Requirements

No new structural commits. Watch report 2026-05-22T13:00Z → 2026-05-23T01:02Z: 26/26 completed (100%), $7.41 for 12h (~$14.82/day run rate, well under $30 target). Council naming vote converged on **Notch** (5 rounds, $1.11 total). Research cycle (task #17310) identified 3 signal-worthy aibtc-network topics — all held by signal-filing policy pause.

Three escalations remain human-gated (all sent 2026-05-22):
- amber-otter credential rotation (PR #389, day 5 post-incident)
- STX wallet refill (~89k µSTX, ~500k needed)
- Payout disputes (27+ days stale, platform-side block)

### Step 2 — Delete

- No deletion candidates this window. 119 skills / 72 sensors unchanged.

### Step 3 — Simplify

- **[CARRY-WATCH]** `MIN_STX_SEND_THRESHOLD` (100k µSTX) stale after `STX_AMOUNT` reduction to 10k. Better threshold ~40k. Low urgency pending wallet refill.
- context-review skip list at 15+ conditions — still below ~20 refactor threshold. No growth this window.

### Step 4 — Accelerate

- 100% success rate (26/26). Pipeline nominal. No new bottlenecks. All active blocks are human-gated.

### Step 5 — Automate

- **[NEW-WATCH]** gregoryford963-sys supply chain pattern: PRs #394 and #395 on aibtcdev/skills add the same unvetted `pip install skills-ref==0.1.1` to CI — repeating the PR #389 injection pattern. CEO Review flagged this as a persistent threat and recommended whoabuddy decide on preemptive close policy vs. case-by-case review. No automation path for Arc (cannot close external PRs preemptively without policy authorization). This is a human decision.

### Flags

- **[NEW-WATCH]** gregoryford963-sys supply chain injection now 3 PRs (#389, #394, #395). Same `pip install skills-ref==0.1.1` CI pattern. CEO Review recommends preemptive close policy — needs whoabuddy decision.
- **[CARRY-WATCH]** MIN_STX_SEND_THRESHOLD stale (100k vs. 10k send). Calibrate post-wallet-refill.
- **[CARRY-WATCH]** STX wallet critically low (~89k µSTX) — escalated (task #17265). Awaiting whoabuddy refill.
- **[CARRY-WATCH]** amber-otter credential exposure — escalated (task #17266). Day 5 post-incident, no rotation yet.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — 27+ days stale. Requires whoabuddy direct outreach. Hard limit confirmed.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge.
- **[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.
- **[CARRY-WATCH]** aibtcdev/skills 0 PRs for 8+ days — escalate to whoabuddy if persists to 2026-05-29.

---

## 2026-05-22T20:51:00.000Z — no structural changes since 08:47Z; RileyCraig14 spam pattern flagged; 119 skills / 72 sensors

**Task #17305** | Diff: f6961f5d → f6961f5d (0 structural commits) | Sensors: 72 | Skills: 119

Only commit since last review is b3cef4a2 (arch-review docs). No src/ or skills/ code changes. Sensor triggered by active reports (overnight brief + watch reports).

### Step 1 — Requirements

No new structural commits. Overnight brief 2026-05-22T13:05Z: 34/35 cycles (97%), $8.91. Watch report 01:02Z–13:00Z: 48/49 cycles (98%), $11.68. One structural failure: payout-disputes platform block (confirmed hard limit, no autonomous path).

Three escalations sent to whoabuddy — all human-gated, awaiting response:
- amber-otter credential rotation (PR #389, 4 days since incident)
- STX wallet refill (~89k µSTX, below threshold)
- Payout disputes (26+ days stale)

Context-review FP fix shipped (f6961f5d): PR regex extended + escalation task exclusions. Next cycle should show materially lower FP rate.

### Step 2 — Delete

- No new deletion candidates in this window.
- 118 skills / 72 sensors — catalog verified (task #17288). No orphaned directories.

### Step 3 — Simplify

- **[CARRY-WATCH]** `MIN_STX_SEND_THRESHOLD` (100k µSTX) stale after `STX_AMOUNT` reduction to 10k. Threshold is 10× send amount. Calibrate post-wallet-refill.
- context-review skip list now 15+ conditions (up from 13+ two cycles ago). Still below ~20 refactor threshold. Monitor — one more FP-reduction cycle would warrant a table refactor.

### Step 4 — Accelerate

- 98% success rate in watch window. Pipeline nominal.
- No new bottlenecks. All active blocks are human-gated.

### Step 5 — Automate

- **[NEW-WATCH]** RileyCraig14 spam pattern: 3 off-topic comments on security-sensitive x402-sponsor-relay threads (#372, #373, #375) flagged in watch report as "potential prompt injection vector." Pattern: coordinated spam across related threads, promoting external endpoints on security threads. No automation today — worth monitoring. If recurs on Arc's own repo threads, consider adding user-pattern detection to github-mentions sensor.

### Flags

- **[RESOLVED]** context-review FP reduction (PR regex + escalation exclusion) — f6961f5d. [CARRY-WATCH ×2] closed.
- **[NEW-WATCH]** RileyCraig14 spam pattern across x402-sponsor-relay threads — potential prompt injection vector. Monitor for recurrence on Arc-owned repo threads.
- **[CARRY-WATCH]** MIN_STX_SEND_THRESHOLD stale (100k vs. 10k send). Calibrate post-wallet-refill.
- **[CARRY-WATCH]** STX wallet critically low (~89k µSTX) — escalated (task #17265). Awaiting whoabuddy refill.
- **[CARRY-WATCH]** amber-otter credential exposure — escalated (task #17266). 4 days post-incident, no rotation yet.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — 26+ days stale. Requires whoabuddy direct outreach. Hard limit confirmed.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge.
- **[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.
- **[CARRY-WATCH]** aibtcdev/skills 0 PRs for 7+ days — security incident likely chilled contributors. Escalate to whoabuddy if persists to 2026-05-29.

---

## 2026-05-22T08:47:00.000Z — trading-comp-mirror uninstalled; context-review FP reduction; 119 skills / 72 sensors

**Task #17286** | Diff: c3eccc57 → f6961f5d (2 structural commits) | Sensors: 72 | Skills: 119

### Step 1 — Requirements

- **chore(trading-comp-mirror): uninstall sensor** (3c519fa3): Competition ended 2026-05-20T19:30Z. Sensor self-disabled via COMP_END_TIMESTAMP but full removal was queued as [CARRY-WATCH]. All 6 skill files deleted. Sensor count 73→72. Closes the oldest active carry item (5 consecutive audit cycles).
- **fix(context-review): reduce false positives in missing-skill detection** (f6961f5d): Three targeted fixes: (1) `trading-comp-mirror` removed from SKILL_KEYWORD_MAP (dead entry — skill uninstalled in same window). (2) PR review subject regex expanded to cover the "Review PR: repo#N - title" format from GitHub mention handlers. (3) "Escalate to whoabuddy:" subjects excluded from both FP checks — escalation task descriptions reflect the other party's obligations, not dispatch skill requirements.

### Step 2 — Delete

- **[RESOLVED]** trading-comp-mirror — removed (3c519fa3). [CARRY-WATCH ×5] fully closed.
- No new deletion candidates identified in this 2-commit window.

### Step 3 — Simplify

- Dead keyword entry and skill uninstall landed in same window — correct discipline.
- context-review now has 15+ skip conditions in `checkMissingSkillCoverage`. Still below ~20 refactor threshold. Monitor.
- **[CARRY-WATCH]** `MIN_STX_SEND_THRESHOLD` (100k µSTX) stale after `STX_AMOUNT` reduction to 10k. Better calibration: ~40k (BATCH_CAP × send + fees). Low urgency pending wallet refill.

### Step 4 — Accelerate

- Daily eval 2026-05-22 mid-day: 28/29 completed (96.5%), $0.195/task — pipeline nominal.
- trading-comp-mirror removal eliminates one 10-min polling cycle per sensor invocation.

### Step 5 — Automate

- No new automation opportunities this window.

### Flags

- **[RESOLVED]** trading-comp-mirror uninstall — 3c519fa3. [CARRY-WATCH ×5] closed.
- **[RESOLVED]** context-review FP reduction: PR review regex + escalation skip (f6961f5d).
- **[CARRY-WATCH]** MIN_STX_SEND_THRESHOLD stale (100k vs. 10k send). Calibrate post-wallet-refill.
- **[CARRY-WATCH]** STX wallet critically low (~89k µSTX) — escalated (task #17265).
- **[CARRY-WATCH]** amber-otter credential exposure — escalated (task #17266).
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — 26+ days stale, requires whoabuddy direct outreach.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge.
- **[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.

---

## 2026-05-21T20:47:00.000Z — no structural changes since 08:47Z; overnight brief review; 119 skills / 73 sensors

**Task #17230** | Diff: c3eccc57 → c3eccc57 (0 structural commits since last review) | Sensors: 73 | Skills: 119

Only commit since last review is 849aeedd (arch-review docs). No src/ or skills/ code changes. Sensor triggered by overnight brief (active reports).

### Step 1 — Requirements

No new structural commits. Overnight brief 2026-05-21T13:08Z: 11/11 completed, 0 failures, $3.56. Three escalation items remain active (all human-gated):
- gregoryford963-sys PR #391 second attack blocked — amber-otter creds still live and compromised
- STX wallet ~89k µSTX — below threshold, welcome-agent paused
- Payout disputes 21+ days stale

### Step 2 — Delete

- **[CARRY-WATCH → ACTION]** `trading-comp-mirror`: competition ended 2026-05-20T19:30Z, 6 days ago. Sensor self-disabled via COMP_END_TIMESTAMP but still installed. No value to keep. Creating uninstall task.

### Step 3 — Simplify

- **[CARRY-WATCH]** `MIN_STX_SEND_THRESHOLD = 100_000` µSTX stale after `STX_AMOUNT` reduction to 10k. Threshold is 10× send amount; should be ~40k (BATCH_CAP × send + fees). Low urgency pending wallet refill.
- Architecture review cost $0.89 overnight — "most expensive task overnight" per brief. Token overhead expected when diff files are large. AGENT.md already scopes to changed-files-only. Acceptable.

### Step 4 — Accelerate

- No new bottlenecks. 11/11 overnight confirms pipeline nominal.

### Step 5 — Automate

- No new automation opportunities.

### Flags

- **[ACTION → task created]** trading-comp-mirror uninstall — competition ended, sensor benign but unused. Uninstall at next housekeeping pass.
- **[CARRY-WATCH]** MIN_STX_SEND_THRESHOLD stale (100k vs. 10k send). Calibrate after wallet refill.
- **[CARRY-WATCH]** STX wallet critically low (~89k µSTX) — welcome-agent paused. Escalated to whoabuddy.
- **[CARRY-WATCH]** amber-otter credential exposure (PR #389, #391) — second attack confirms active exploitation. Escalated to whoabuddy.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — 21+ days stale, no platform response.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge.
- **[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.

---

## 2026-05-21T08:47:00.000Z — STX balance preflight gate; dispatch-stale PID-alive fix; 119 skills / 73 sensors

**Task #17206** | Diff: 205cbeac → c3eccc57 (2 structural commits) | Sensors: 73 | Skills: 119

### Step 1 — Requirements

- **feat(aibtc-welcome): STX balance preflight gate** (c3eccc57): `sensor.ts` now calls `getSelfStxBalanceMicroStx()` before any task queuing. If balance < `MIN_STX_SEND_THRESHOLD` (100k µSTX), sensor logs and returns early without queuing. Directly implements [sensor-preflight-gating] pattern from MEMORY.md [P] — triggered by the 6 welcome task failures overnight (Rugged Stork, Jade Core, Thin Monolith, Martian Hammer, Cyber Moose, Snappy Lemur) all failing with insufficient STX balance. Closes the "Sensor improvement needed" note on [stx-wallet-low-balance] in MEMORY.md [A].
- **fix(arc-service-health): skip stale-cycle alert when dispatch PID is alive** (c23777ea): `checkStaleCycle()` now reads `db/dispatch-lock.json` and calls `isPidAlive(lock.pid)` — if dispatch is actively running, returns `false` immediately. Fixes FP class: cycle_log only records *completed* cycles, so an in-flight dispatch session looks stale to the sensor. Daily eval 2026-05-21 noted 4× dispatch-stale FP — this fix closes that specific class.

### Step 2 — Delete

- No deletions this window.
- `trading-comp-mirror` sensor auto-disabled (COMP_END_TIMESTAMP fired 2026-05-20T19:30Z). Benign to leave, zero cost, minimal value. Carry forward for housekeeping uninstall.

### Step 3 — Simplify

- STX preflight gate: clean, minimal addition. Pattern is correct — fail-safe (returns -1 on API error, which skips the gate so sensor proceeds normally). No over-engineering.
- **[NEW-WATCH]** `MIN_STX_SEND_THRESHOLD = 100_000` µSTX was correct when `STX_AMOUNT = 100_000` µSTX. After (a1e4ddd0) reduced `STX_AMOUNT` to 10k µSTX, the threshold is now 10× the send amount. A balance of 50k µSTX would allow ~4 sends but the sensor still skips. Better threshold: `BATCH_CAP × (STX_AMOUNT + fee_buffer) ≈ 40k µSTX`. Low urgency — the wallet refill resolves the symptom regardless.
- PID-alive gate: uses existing `isPidAlive()` from `src/utils.ts`. Zero new dependencies. Right layer (sensor, not dispatch).

### Step 4 — Accelerate

- Welcome sensor: 6× wasted dispatch cycles/day eliminated. Tasks that would fail at preflight are now never queued.
- Service-health: dispatch-stale FPs for in-flight cycles eliminated. Reduces noise in alert queue.

### Step 5 — Automate

- No new automation opportunities this window. Both changes are sensor-layer guard additions.

### Flags

- **[RESOLVED]** Welcome sensor STX preflight gate — c3eccc57. Sensor-preflight-gating pattern applied.
- **[RESOLVED]** Dispatch-stale FP during active in-flight cycles — c23777ea. PID-alive check closes this class.
- **[NEW-WATCH]** `MIN_STX_SEND_THRESHOLD` (100k) stale after `STX_AMOUNT` reduction to 10k. Consider lowering to ~40k (BATCH_CAP × send + fees).
- **[CARRY-WATCH]** STX wallet critically low (~89k µSTX) — welcome tasks blocked, escalated to whoabuddy.
- **[CARRY-WATCH]** amber-otter credential exposure (PR #389) — unresolved.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — no response since 2026-04-26.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge.
- **[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.
- **[CARRY-WATCH]** trading-comp-mirror auto-disabled — uninstall at next housekeeping pass.

---

## 2026-05-20T20:45:36.000Z — no new structural changes; sensor re-triggered on already-reviewed SHA; 119 skills / 73 sensors

**Task #17184** | Diff: 6012ea3a → 205cbeac (0 structural commits) | Sensors: 73 | Skills: 119

Changes between trigger SHAs (6418d43 → a1e4ddd) — `skills/aibtc-welcome/cli.ts` (STX_AMOUNT reduction) and `src/dispatch.ts` (script blocked status) — were fully reviewed in task #17149 at 19:36Z. Only subsequent commits are arch-review docs (self-referential). State machine current; no architectural findings.

**[CARRY-WATCH]** STX wallet critically low (~89k µSTX) — welcome tasks blocked, escalated to whoabuddy.
**[CARRY-WATCH]** amber-otter credential exposure (PR #389) — unresolved.
**[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
**[CARRY-WATCH]** Payout disputes (11) — no response since 2026-04-26.
**[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge.
**[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.

---

## 2026-05-20T19:36:00.000Z — competition sunset; x-api dispatch pre-screen; welcome STX reduction; script blocked status; 119 skills / 73 sensors

**Task #17149** | Diff: 2709582a → 6012ea3a (4 structural commits) | Sensors: 73 | Skills: 119

### Step 1 — Requirements

- **fix(trading-comp-mirror): competition-end self-gate** (727751a1): `COMP_END_TIMESTAMP = 2026-05-20T19:30:00Z` added. Sensor now self-disables when competition ends — fires right now (current time 19:36Z). Directly implements [NEW-ACTION] from 2026-05-19 audit.
- **fix(x-api): dispatch-time tweet pre-screen** (6418d431): Three-part fix for 15 wasted X API cycles (2 nights). `arc-link-research/AGENT.md` + `arc-email-sync/AGENT.md` gain dispatch-time pre-screen guidance. `social-x-ecosystem/sensor.ts` filters x.com/twitter.com self-references from `extractUrls()`. Complements sensor-time pre-screen from task #17126. Resolves [CARRY-WATCH] x-api-sensor-prescreen from prior audit.
- **fix(dispatch): script blocked status for preflight failures** (a1e4ddd0): `dispatchScript()` now detects `preflight.safe_to_broadcast === false` and returns `status: "blocked"`. `runDispatch()` calls `markTaskBlocked()` instead of consuming retries or tripping the gate. Targets the 7× welcome STX-send preflight failures/day from stx-wallet-low-balance.
- **fix(aibtc-welcome): STX_AMOUNT 0.1→0.01 STX** (a1e4ddd0): Reduced from 100k µSTX to 10k µSTX per welcome. With ~89k µSTX balance, 0.1 STX was impossible; 0.01 STX allows ~7-8 more sends before depletion. Directly unblocks welcome pipeline.

### Step 2 — Delete

- `trading-comp-mirror`: sensor is now benign (always "skip"). No urgent deletion required — but can be uninstalled at next housekeeping pass. Zero cost to leave, minimal value to keep.
- No other deletions this window.

### Step 3 — Simplify

- dispatch blocked status: clean addition — 15 lines, imports one new function. No over-engineering.
- STX amount reduction: single constant change. The right fix for the immediate problem (wallet depleted) without requiring a wallet refill.
- x-api pre-screen: AGENT.md guidance is the correct layer — sensors already have the pre-screen logic; dispatch-time guidance covers the case where an orchestrator session creates subtasks inline.

### Step 4 — Accelerate

- Welcome task failure class: 7×/day → near-zero. Blocked tasks won't burn retries or trip the daily gate.
- Trading-comp-mirror: 10-min polling eliminated — reduces sensor cycle overhead.
- x-api pre-screen: dispatch cycles for inaccessible tweets now fail early (closed early from AGENT.md guidance) rather than after full task execution.

### Step 5 — Automate

- No new automation opportunities this cycle. All 4 changes are targeted bug/policy fixes.

### Flags

- **[RESOLVED]** trading-comp-mirror sunset — COMP_END_TIMESTAMP self-gate fired (competition ended 2026-05-20T19:30Z). Sensor auto-disabled (727751a1).
- **[RESOLVED]** x-api dispatch pre-screen gap — AGENT.md guidance shipped for arc-link-research + arc-email-sync (6418d431).
- **[NEW-WATCH]** script dispatch blocked status — verify welcome tasks appear as `blocked` (not `failed`) in next dispatch window. Check `arc tasks --status blocked`.
- **[NEW-WATCH]** aibtc-welcome 0.01 STX — at ~89k µSTX balance, ~7-8 sends possible. STX wallet still needs refill; escalated to whoabuddy.
- **[CARRY-WATCH]** STX wallet critically low (~89k µSTX) — 0.01 STX/send buys time but wallet must be refilled.
- **[CARRY-WATCH]** amber-otter credential exposure (PR #389) — unresolved.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — no response since 2026-04-26.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge.
- **[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.

---

## 2026-05-19T20:43:00.000Z — signal filing disabled policy (5 sensors); scheduled_for web visibility; 119 skills / 73 sensors

**Task #17110** | Diff: 2d4fa54c → 2709582a (4 structural commits) | Sensors: 73 | Skills: 119

### Step 1 — Requirements

- **chore(sensors): disable signal filing** (01daaa58): `SIGNAL_FILING_DISABLED = true` constant added to 5 sensors. whoabuddy directive (2026-05-19, task #17094) — aibtc.news EIC stepped down, trading competition winding down. Impact by sensor:
  - `aibtc-news-editorial`: streak task gated; inactivity/beat checks remain active
  - `bitcoin-macro`: all signal task creation gated; data collection/fetch continues
  - `arxiv-research`: aibtc-network + quantum signal tasks gated; digest fetch/compile active
  - `aibtc-news-deal-flow`: full sensor skip
  - `aibtc-agent-trading`: full sensor skip (ordinals-market-data already had `SIGNAL_FILING_SUSPENDED`)
  - Re-enable path: grep `SIGNAL_FILING_DISABLED`, flip to `false` in each of the 5 files
- **feat(web): surface scheduled_for** (12de85b7): Web dashboard task feed now includes `scheduled_for` column in all 4 query paths. Deferred tasks show a "⏰ in Xh" pill in feed rows and a Scheduled timestamp in detail panel. Previously invisible — pending + deferred tasks looked identical in the UI.
- **Overnight brief 2026-05-19T13:09Z**: 73/85 success (86%), $28.16. 8× X API failures (deleted tweets — known pattern, fix pending), 3× signal cancellations ("dont need to file signals anymore" — pre-dating disable commit), 1× cooldown rescheduled. AIBTC Tuesday deck shipped (2 cycles, $8.68). STX wallet ~89k microSTX (below 100k send threshold).

### Step 2 — Delete

- `trading-comp-mirror` sensor: competition is "winding down" per the same whoabuddy directive that triggered signal filing pause. Sensor continues polling `/api/competition/trades` every 10 min with no actionable output. **Promote from WATCH → ACTION**: disable or add `COMP_END_TIMESTAMP` self-gate. Creating follow-up task.
- 5-file `SIGNAL_FILING_DISABLED` scatter: minor code smell. When re-enable lands, 5 files need manual updates. Could be a single shared constant in `src/sensors.ts` or a DB flag. Acceptable for a temporary policy pause; the comment in each file points to the same task (#17094). Not worth adding shared infrastructure unless the pause extends >1 month or re-enable becomes error-prone.

### Step 3 — Simplify

- Signal disable pattern is consistent: same constant name, same comment format, same re-enable instruction in each sensor. Per-sensor granularity is intentional — allows partial re-enable (e.g., aibtc-network before bitcoin-macro). This is the right level of abstraction.
- `context-review` skip list: still at 13+ conditions (CARRY-WATCH from prior audit). No new conditions added this window — not growing.
- Web `scheduled_for` change: clean, minimal. 4 query paths updated uniformly.

### Step 4 — Accelerate

- Signal filing pause = ~0 signal tasks queued = lower nightly cost. Deliberate deceleration.
- `scheduled_for` UI visibility removes the need for DB queries to find deferred tasks — operational improvement for dispatch monitoring.
- Active bottlenecks unchanged: STX wallet (welcome tasks fail), Loom spiral (no runs), amber-otter PR #389.

### Step 5 — Automate

- `trading-comp-mirror` sunset: sensor should self-disable when competition ends. No automation path today — manual action required. Follow-up task created this cycle.

### Flags

- **[RESOLVED]** Signal filing disabled across 5 sensors (01daaa58) — policy implementation complete. Queue EMPTY at time of disable. Re-enable when "what's next" policy lands.
- **[NEW-ACTION]** trading-comp-mirror sunset — competition winding down. Disable sensor or add competition-end self-gate. Follow-up task created.
- **[CARRY-WATCH]** x-api-sensor-prescreen — 8 wasted cycles/night from deleted tweets. Fix: check tweet existence at sensor time (skip if 404). Task #17094 context: known pattern, no fix yet.
- **[CARRY-WATCH]** STX wallet critically low (~89k microSTX) — welcome tasks failing. Escalated to whoabuddy.
- **[CARRY-WATCH]** amber-otter credential exposure (PR #389 CHANGES_REQUESTED) — needs resolution and rotation.
- **[CARRY-WATCH]** context-review skip list growing (13+ conditions). Monitor; refactor if >20.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — no response since 2026-04-26.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge.
- **[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.
- **[CARRY-WATCH]** x402-sponsor-relay PRs #379/#380 — awaiting whoabuddy review.

---

## 2026-05-19T08:43:00.000Z — context-review PR/welcome skip; presentation title convention; 119 skills / 73 sensors

**Task #17070** | Diff: 16c82bbc → 2d4fa54c (2 structural commits) | Sensors: 73 | Skills: 119

### Step 1 — Requirements

- **fix(context-review): exclude multi-PR review tasks and welcome tasks from false-positive checks** (e69abb6a): `checkMissingSkillCoverage` in `skills/context-review/sensor.ts` gained two new skip conditions. (1) PR review tasks matching `/^Review (PR #\d+|[\w/-]+ PRs? #\d+)/` — PR titles embedded in task subjects contain domain keywords from the PR content, not from what the review task needs. (2) Welcome tasks (`source.startsWith("welcome:")` or `subject.startsWith("Welcome new AIBTC agent:")`) fail due to infrastructure issues (STX balance), not missing skill context — already excluded from `checkEmptySkillsFailed`, now also excluded from `checkMissingSkillCoverage`. Closes the PR-title false positive class.
- **feat/refactor(presentation)** (f26453ec + 2d4fa54c): AIBTC 2026-05-19 weekly deck generated then revised per whoabuddy feedback. Key changes: AIBTC-led title convention applied ("AIBTC trades."), trading-comp moved to front matter (slides 1–3), stats re-verified against source (88 PRs via gh search, 101 API-accepted signals vs. 187 local task count, 10 beats, 80 days), trading scoring mismatch (live sort ≠ frozen-snapshot reward basis) surfaced on slide 1. Title convention now documented in MEMORY.md as standing rule.
- **Watch report 2026-05-19T01:05Z**: 14/14 completed (0 failures), $5.47. Five x402-sponsor-relay PRs (#382–#386) reviewed and approved. Claude Code upgraded v2.1.141→v2.1.144 (Skill tool headless regression fix). Signals queued: aibtc-network #16987 (07:05Z), quantum #16988 (08:00Z, arXiv:2605.02276). STX wallet 89,332 microSTX — below 100k send threshold. Welcome tasks will fail until refilled.

### Step 2 — Delete

- No deletions this window.
- `drafts/` gitignored for presentation drafts (issue body + email reply pending whoabuddy sign-off) — correct pattern.

### Step 3 — Simplify

- **[CARRY-WATCH]** `context-review/sensor.ts` `checkMissingSkillCoverage` now has 13+ skip conditions. The list is growing incrementally as each new false-positive class is identified and patched. Each condition is justified by a concrete real case — no premature abstraction needed yet. If the count exceeds ~20, consider a `SKIP_SUBJECT_PATTERNS: Array<RegExp | ((task: RecentTask) => boolean)>` table to reduce function length. Not urgent.
- Presentation pipeline required two commits (feat + refactor) due to title convention violation in the initial draft. MEMORY.md now has the standing rule. Next deck should be clean in one commit.

### Step 4 — Accelerate

- 14/14 success, zero failures. Pipeline nominal.
- Signals self-scheduled via research task (#16984) — pipeline working as designed.
- STX wallet low balance is the active bottleneck: welcome tasks fail until wallet refilled. Escalated to whoabuddy.

### Step 5 — Automate

- No new automation opportunities this window.

### Flags

- **[RESOLVED]** context-review false positives for PR review tasks (e69abb6a). PR title keywords no longer trigger `missing_skill_coverage` findings.
- **[CARRY-WATCH]** context-review skip list growing (13+ conditions). Monitor; refactor if >20.
- **[CARRY-WATCH]** STX wallet critically low (~89k microSTX) — welcome tasks failing. Escalated. No STX sends until refilled.
- **[CARRY-WATCH]** amber-otter credential exposure (PR #389 CHANGES_REQUESTED) — needs resolution and rotation.
- **[CARRY-WATCH]** trading-comp-mirror sensor sunset — competition-end guard still needed.
- **[CARRY-WATCH]** x402-sponsor-relay PRs #379/#380 — #382–#386 approved this window; #379/#380 status unknown.
- **[CARRY-WATCH]** PR #387 (windleg yield rotator) — awaiting author.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — no response since 2026-04-26.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge.
- **[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.

---

## 2026-05-18T20:41:00.000Z — emailing→completed auto-transition fix; 119 skills / 73 sensors

**Task #16978** | Diff: 694e251f → 16c82bbc (1 structural commit) | Sensors: 73 | Skills: 119

### Step 1 — Requirements

- **fix(arc-workflows): auto-transition ceo-review emailing→completed after 30min** (16c82bbc): `CeoReviewMachine.states.emailing` returned `null` when `emailTaskCreated=true`, leaving workflows stuck indefinitely. Fix: stores `emailTaskCreatedAt` in context when email task is created; `emailing` state action checks elapsed time — if >30min, transitions to `completed`. Backlogged workflows (no `emailTaskCreatedAt`) use epoch=0 fallback so they transition immediately on next meta-sensor tick. **26 stuck CEO-review workflows cleared on deployment.**
- **Overnight brief 2026-05-18T14:00Z**: 14/14 tasks succeeded (0 failures), 15 cycles, $4.08, 6.58M tokens. Clean night. MCP v1.54.0 integrated (competition allowlist). Quantum signal arXiv:2605.12385 filed.
- **Security incident — amber-otter credential exposure**: PR #389 on aibtcdev/skills exposed amber-otter private key + mnemonic via GitHub diff. Arc posted CHANGES_REQUESTED at 20:06 UTC. Escalated to whoabuddy.

### Step 2 — Delete

- No deletions this window.

### Step 3 — Simplify

- The 30-minute timeout is correct defense-in-depth — email tasks should perform the `sent` transition themselves, but timeout guards against agent forgetfulness. Not over-engineered.
- `emailTaskCreatedAt: 0` epoch fallback for backlogged workflows is a minor code smell but intentional — "transition immediately" semantics are correct and documented in commit message.

### Step 4 — Accelerate

- 26 stuck workflows cleared. CEO-review pipeline now self-draining.
- Clean overnight (14/14). No new pipeline bottlenecks.

### Step 5 — Automate

- No new automation opportunities this cycle.

### Flags

- **[NEW-WATCH]** amber-otter credential exposure (PR #389) — private key public via GitHub diff. Escalated to whoabuddy. amber-otter must rotate + investigate `369sunray`.
- **[CARRY-WATCH]** competition `allowlist` pre-submit not automated — manual pre-flight required.
- **[CARRY-WATCH]** trading-comp-mirror sensor sunset — competition-end guard still needed.
- **[CARRY-WATCH]** x402-sponsor-relay PRs #379/#380 — awaiting whoabuddy review.
- **[CARRY-WATCH]** PR #387 (windleg yield rotator) — awaiting author.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — no response since 2026-04-26.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge.
- **[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.
- **[CARRY-WATCH]** PR #532–#536 bounty-farming flood watch.

---

## 2026-05-18T08:45:00.000Z — Sensor validator wire-in complete + competition allowlist; 119 skills / 73 sensors

**Task #16946** | Diff: 9328f609 → 694e251f (2 structural commits) | Sensors: 73 | Skills: 119

### Step 1 — Requirements

- **feat(sensors): validate signal subject patterns at queue time** (e3329e2b): All 3 signal-queuing sensors now call `validateSignalSubjectMatchesBeatPattern()` before inserting tasks. bitcoin-macro line 608; arxiv-research lines 287 (aibtc-network) + 324 (quantum); aibtc-news-editorial line 182 (streak). Subject mismatch is a hard failure at sensor time. This directly implements [CARRY-OPEN] from task #16921 — the utility existed but sensors weren't wired to call it.
- **feat(competition): add allowlist command** (694e251f): `skills/competition/cli.ts` and `SKILL.md` updated with `allowlist` subcommand. `GET /competition/allowlist` returns live `(contract_id, functions)` tuples the verifier accepts. Pre-flight pattern: call `allowlist` before `submit --txid` to avoid `contract_not_allowlisted` rejections.
- **Watch report 2026-05-17T13:00Z – 2026-05-18T01:01Z**: 29/30 completions (96.6%), $0.29/task. aibtc-network signal filed (native bounty launch). Quantum signal #16931 queued at P2, scheduled 07:10Z after cooldown. One failure: x402 404 on agent welcome (Grim Pax not in registry — fail-fast per policy). PR #532–#536 five consecutive reviews from same author cluster — bounty-farming flood pattern active; 6th+ = escalate to whoabuddy.

### Step 2 — Delete

- No deletions this window.

### Step 3 — Simplify

- **[RESOLVED ×11]** BEAT_SUBJECT_PATTERNS drift class fully closed: utility (9328f609) + sensor wire-in (e3329e2b). Eleven-cycle carry is done. No more silent cooldown drift.
- **[NEW-WATCH]** competition `allowlist` command exists but isn't wired into any automated pre-submit workflow. Currently manual. Could add pre-submit `allowlist` call to `submit --txid` flow to auto-check before posting.

### Step 4 — Accelerate

- No bottlenecks introduced. Validator adds O(1) per signal queue call — negligible.
- Quantum bounty #16931 at P2 with correct model (sonnet) — dispatch picks it up next cycle after cooldown.

### Step 5 — Automate

- No new automation this cycle. The validator wire-in IS the automation for BEAT_SUBJECT_PATTERNS — pattern drift now fails hard at sensor time rather than silently at dispatch.

### Flags

- **[RESOLVED]** Sensor wire-in for `validateSignalSubjectMatchesBeatPattern()` (e3329e2b). All 3 signal sensors enforce at queue time.
- **[RESOLVED ×11]** BEAT_SUBJECT_PATTERNS drift class fully closed. Eleven-cycle carry item done.
- **[NEW-WATCH]** competition `allowlist` pre-submit not automated — manual pre-flight required.
- **[CARRY-WATCH]** trading-comp-mirror sensor sunset — competition-end guard still needed.
- **[CARRY-WATCH]** x402-sponsor-relay PRs #379/#380 — awaiting whoabuddy review.
- **[CARRY-WATCH]** PR #387 (windleg yield rotator) — awaiting author.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — no response since 2026-04-26.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge.
- **[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.
- **[CARRY-WATCH]** PR #532–#536 bounty-farming flood watch — 6th+ iteration from same author = escalate.

---

## 2026-05-17T20:40:00.000Z — validateSignalSubjectMatchesBeatPattern utility shipped; 119 skills / 73 sensors

**Task #16921** | Diff: d07db40a → 9328f609 (1 structural file) | Sensors: 73 | Skills: 119

### Step 1 — Requirements

- **fix(db): add validateSignalSubjectMatchesBeatPattern utility** (9328f609): Two new functions in `src/db.ts` — `likePatternToRegex()` converts SQL LIKE patterns (%, _) to JS RegExp; `validateSignalSubjectMatchesBeatPattern(subject, beat)` checks a prospective task subject against `BEAT_SUBJECT_PATTERNS` for that beat. Exported for use by sensors. This directly implements the [NEW-ACTION] from task #16894: "add a validation utility: at sensor init time, assert all potential signal task subjects match a BEAT_SUBJECT_PATTERNS entry." Closes the BEAT_SUBJECT_PATTERNS ×10 carry item.
- **Active reports**: overnight brief 2026-05-17T13:05Z (40 completed, 1 failed — cooldown timing), watch report 2026-05-17T13:00Z. 41-task overnight window, multi-beat signal day. Quantum bounty 1btc-news active (#16901 pending).

### Step 2 — Delete

- No deletions this window.

### Step 3 — Simplify

- **[RESOLVED ×10]** `BEAT_SUBJECT_PATTERNS` carry — validation utility shipped. Drift class detectable at sensor time. *Remaining gap*: sensors not yet wired to call the validator before queueing. They could still queue with a non-matching subject and no error would fire. The utility is available; enforcement requires sensors to call it. Creating follow-up task.
- `likePatternToRegex()` could pre-compile patterns at module load to avoid regex construction per call. Minor optimization — patterns are called rarely, not hot path. Deferring.

### Step 4 — Accelerate

- No bottlenecks introduced. The validator adds O(n) regex match per signal queue operation — negligible.

### Step 5 — Automate

- **[NEW-ACTION]** Wire `validateSignalSubjectMatchesBeatPattern()` into signal-queuing sensors (bitcoin-macro, arxiv-research, aibtc-news-editorial streak sensor). Should throw/log error at task creation time if subject doesn't match — makes drift a hard failure instead of a silent bug. Creating follow-up task.

### Flags

- **[RESOLVED ×10]** BEAT_SUBJECT_PATTERNS manual sync — utility shipped; sensor wire-in is next.
- **[CARRY-OPEN]** Sensors not yet wired to call `validateSignalSubjectMatchesBeatPattern()` at queue time.
- **[CARRY-WATCH]** trading-comp-mirror sensor sunset — competition-end guard still needed.
- **[CARRY-WATCH]** x402-sponsor-relay PRs #379/#380 — nonce TTL alignment, awaiting whoabuddy review.
- **[CARRY-WATCH]** PR #387 (windleg yield rotator) — requested changes, awaiting author.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — no response since 2026-04-26.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge.
- **[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.

---

## 2026-05-17T08:45:00.000Z — Streak beat encoding fix; BEAT_SUBJECT_PATTERNS ×10; 119 skills / 73 sensors

**Task #16894** | Diff: 82604b1b → d07db40a (1 structural file) | Sensors: 73 | Skills: 119

### Step 1 — Requirements

- **fix(aibtc-news-editorial): streak task beat encoding** (d07db40a): Streak task subject was `"Maintain N-day streak on aibtc.news"` — didn't match any BEAT_SUBJECT_PATTERNS entry. `isBeatOnCooldown()` returned false while the streak task was pending/active, allowing bitcoin-macro and arxiv-research sensors to queue duplicate signal tasks for the same beat → dispatch-time cooldown failures. Fix: sensor now commits to the first available beat at creation time; subject becomes `"File <beat> signal: maintain N-day streak"` which matches existing patterns. Also: model haiku→sonnet (haiku times out on signal filing). Closes `signal-cooldown-fix-incomplete` from task #16869.
- **Watch report 2026-05-17T01:02Z**: 23/24 tasks (96%), $9.18, $0.37/task. 1 aibtc-network signal filed. 1 quantum cooldown failure at dispatch — correctly pre-composed signal rescheduled as #16859 for 01:15Z. Memory consolidated ~48t → ~32t. PURPOSE 3.80 (strongest recent score).

### Step 2 — Delete

- No deletions this window.

### Step 3 — Simplify

- **[CARRY-WATCH ×10]** `BEAT_SUBJECT_PATTERNS` in `db.ts` — at 10 cycles, this is the longest-running unresolved carry item after pre-commit hook (resolved ×22) and ACTIVE_BEATS (resolved ×13). Each fix is a patch that widens the manually-maintained string list; the root cause is that sensor task subjects and the cooldown-detection patterns are decoupled. Fix: derive patterns from a shared constant, or add a sensor-startup validation that every signal task subject matches at least one pattern. Creating a follow-up task this cycle.

### Step 4 — Accelerate

- Quantum dispatch-time cooldown (58 min) → pre-compose + scheduled_for recovery path worked correctly (watch report). No wasted cycle.
- No new pipeline bottlenecks.

### Step 5 — Automate

- **[NEW-ACTION]** BEAT_SUBJECT_PATTERNS (×10) — create task to add a validation utility: at sensor init time, assert all potential signal task subjects match a BEAT_SUBJECT_PATTERNS entry. Prevents the class of silent drift bugs that caused 3+ separate fixes (aibtc-network pattern missing, compose-task pattern missing, streak task pattern missing).

### Flags

- **[RESOLVED]** Streak task beat encoding — subject now matches BEAT_SUBJECT_PATTERNS (d07db40a).
- **[NEW-ACTION]** BEAT_SUBJECT_PATTERNS ×10 — follow-up task created to add pattern validation utility.
- **[CARRY-WATCH]** x402-sponsor-relay PRs #379/#380 — nonce TTL alignment, awaiting whoabuddy review.
- **[CARRY-WATCH]** PR #387 (windleg yield rotator) — requested changes, awaiting author.
- **[CARRY-WATCH]** social-x-ecosystem sensor — no recurrence data in this window.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — no response since 2026-04-26.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge.
- **[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.
- **[CARRY-WATCH]** trading-comp-mirror sensor sunset — competition-end guard still needed.

---

## 2026-05-16T20:35:00.000Z — No structural changes; sensor-time cooldown RESOLVED; x402-relay PRs opened; 119 skills / 73 sensors

**Task #16852** | Diff: 82604b1b → 82604b1b (no code changes) | Sensors: 73 | Skills: 119

### Step 1 — Requirements

- **No structural commits** since 82604b1b (last arch-review docs commit 8ceef002 was arch-review only). Sensor triggered because active reports existed (overnight brief + watch reports), which is correct per sensor design: "no active reports → skip."
- **Overnight brief 2026-05-16T13:05Z**: 33 completed / 2 failed (94.3%), $13.75, $0.393/task. 3 signals filed (bitcoin-macro difficulty + fee floor, aibtc-network Bitflow allowlist). Both failures were cooldown timing collisions — already patched by #16813 (fcb39755). x402-sponsor-relay PRs #379 + #380 opened (nonce TTL alignment + FALLBACK_NONCE_EXPIRY_MS constant).
- **Watch report 2026-05-16T13:00Z**: "Strongest 12-hour window in recent memory." Three signals across all three beats. Targets by 2026-05-17T15:00Z: x402 relay PRs merged or responded, ≥1 quantum signal, no 1.8M+ token tasks (token-explosion fix confirmed effective).

### Step 2 — Delete

- No deletions this window. All prior [OPEN] items resolved or human-gated.

### Step 3 — Simplify

- **[RESOLVED]** Sensor-time cooldown gap — fcb39755 + task #16813. All signal-filing sensors now gate on cooldown before queuing. Cooldown failures at dispatch are structurally impossible for all active beat sensors. Pattern closed.
- **[CARRY-WATCH ×9]** `BEAT_SUBJECT_PATTERNS` in `db.ts` — manual sync surface. Extended this cycle to cover compose-task half of hashrate decompose (fcb39755), but still a manually maintained list. Programmatic derivation from sensor constants would close this class permanently. This is the longest-running simplification carry.

### Step 4 — Accelerate

- Token explosion fix ($13.75 overnight vs. prior 1.8–2.9M token nights) — expect sustained improvement as fix holds.
- SHA-gate for arch-review reduces spurious cycle invocations. This cycle is the first in-window with no code changes — correctly triggered by reports, not phantom mtime delta.
- $2.28 for @mention #16830 noted in overnight brief — if heavy-research @mentions recur, decompose into research + reply pair (same pattern as hashrate decompose).

### Step 5 — Automate

- No new automation opportunities this cycle.

### Flags

- **[RESOLVED]** Sensor-time cooldown gap (fcb39755 + #16813). All signal sensors now gate at sensor time.
- **[NEW-WATCH]** x402-sponsor-relay PRs #379 + #380 — nonce TTL alignment, FALLBACK_NONCE_EXPIRY_MS. CI green, awaiting whoabuddy review. Blocking relay correctness.
- **[NEW-WATCH]** PR #387 (windleg yield rotator, aibtcdev/skills) — requested changes. Author needs to respond.
- **[CARRY-WATCH ×9]** BEAT_SUBJECT_PATTERNS manual sync surface (db.ts).
- **[CARRY-WATCH]** social-x-ecosystem sensor — no recurrence data in this window.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — no response since 2026-04-26.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge.
- **[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.
- **[CARRY-WATCH]** trading-comp-mirror sensor sunset — competition-end guard still needed.

---

## 2026-05-16T08:35:00.000Z — SHA-gate + token-explosion fix + cooldown patterns + sync-task skip; 119 skills / 73 sensors

**Task #16825** | Diff: 3a8b0f6f → 82604b1b | Sensors: 73 | Skills: 119

### Step 1 — Requirements

- **fix(arc-architecture-review): SHA-gate** (b5907974): sensor now reads `last_reviewed_src_sha` from hook state before `claimSensorRun`, compares to current code SHA. If unchanged and no active reports → skip without queuing. Diagram mtime was wrong gate — code SHA is the correct freshness signal. Prevents daily re-reviews with no new content.
- **fix(dispatch): token-explosion fix** (c6a82d76): Three AGENT.md/SKILL.md changes targeting the 1.8–2.9M token explosion in sensor-health, arch-review, and @mention tasks (tasks #16708/#16800/#16756). Arch-review AGENT.md now scopes to `git diff <last-sha>..HEAD` for changed files only. SKILL.md updated with `sensor-health-report` aggregate CLI guidance. Rule encoded: if a task reads >10 files, add a CLI aggregator first.
- **fix(arc-scheduler): date-scope overdue alert** (82604b1b): overdue alert source key now includes `YYYY-MM-DD`. Prevents the sensor re-alerting on the same persistent backlog every 5-minute cycle. Pattern matches beat-inactive date-scope fix (ab1273d0) — same principle.
- **fix(sensors): beat pattern expansion** (fcb39755): `BEAT_SUBJECT_PATTERNS` in db.ts extended with `"Compose bitcoin-macro%signal%"` alongside the existing `"File bitcoin-macro%signal%"`. The hashrate decompose creates a compose task + a file task; without the compose pattern, cooldown only counted the file half. Also: aibtc-news-editorial/sensor.ts confirmed already has sensor-time cooldown gate for streak sensor.
- **fix(context-review): sync-task skip** (61d96c06): `arc-opensource: sync N commit` tasks now excluded from SKILL_KEYWORD_MAP checks. Sync task descriptions embed commit messages verbatim; those commit messages may reference any skill domain (e.g., trading-comp, zest) because the commits touched those files — not because the sync task itself needs those skills.

### Step 2 — Delete

- No deletions this window.

### Step 3 — Simplify

- **[RESOLVED]** arch-review sensor mtime gate → SHA gate. Cleaner freshness signal; correct semantics.
- **[CARRY-WATCH]** `BEAT_SUBJECT_PATTERNS` in `db.ts` — manual sync surface. The new patterns are correct but it's still a manual list. No programmatic derivation yet.

### Step 4 — Accelerate

- SHA-gate eliminates spurious daily arch-review tasks when code is stable.
- Token explosion fix removes 1-3M token overhead per sensor-health or arch-review cycle. Rule now documented in both AGENT.md and SKILL.md — should hold across future dispatches.
- Date-scoped scheduler alert prevents alert floods that choke dispatch with low-value tasks.

### Step 5 — Automate

- No new automation opportunities this cycle. The sensor-time cooldown gap (watch report: filing sensors may still queue during active cooldown in some edge cases) remains open — documented in MEMORY.md [P] but no additional sensor fix landed this window.

### Flags

- **[RESOLVED]** arch-review sensor mtime gate → SHA gate (b5907974).
- **[RESOLVED]** Token explosion in sensor-health/arch-review/@mention (c6a82d76). AGENT.md + SKILL.md updated.
- **[RESOLVED]** arc-scheduler overdue alert daily flooding (82604b1b).
- **[RESOLVED]** context-review false positives for arc-opensource sync tasks (61d96c06).
- **[CARRY-WATCH]** Sensor-time cooldown gap (watch report 2026-05-16): signal filing sensors confirm partially fixed; watch for residual dispatch-time cooldown failures.
- **[CARRY-WATCH]** BEAT_SUBJECT_PATTERNS manual sync surface (db.ts).
- **[CARRY-WATCH]** social-x-ecosystem sensor — no recurrence data in this window.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — no response since 2026-04-26.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge.
- **[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.
- **[CARRY-WATCH]** trading-comp-mirror sensor sunset — competition-end guard still needed.

---

## 2026-05-15T20:34:00.000Z — trading-comp + trading-comp-mirror scaffolded; dedup two-layer; 119 skills / 73 sensors

**Task #16767** | Diff: ab1273d0 → 3a8b0f6f | Sensors: 73 | Skills: 119

### Step 1 — Requirements

- **feat(trading-comp)**: Strategy layer skill for AIBTC Trading Competition. No sensor — CLI + AGENT.md only. Composes `bitflow` (swap) + `competition` (scorer API) primitives. Owns metrics.md for daily snapshots. `submit` normalizes txid and posts to competition API. Fail-loud: POST failure or txid validation error creates P2/opus alert task (fc12f4b2) — surfaces immediately to next dispatch cycle.
- **feat(trading-comp-mirror)**: Competitor trade watcher with 10-min sensor. Polls `GET /api/competition/trades` per configured competitor address (quasar-garuda + amber-otter seeded). Caches last 500 trades to trades.json. Dedup via per-address seen_txids in hook state.
- **fix(trading-comp-mirror)**: Dedup extended to check trades.json cache at startup (4febce67). Hook-state loss on restart caused same txids to re-append every sensor cycle. Cache is now the durable dedup source; hook state is fast ephemeral layer. Two-layer dedup pattern validated.
- **fix(compliance)**: `err` → `fetchError`, `msg` → `errorMessage` in both skills (3a8b0f6f). Satisfies pre-commit hook variable naming rules. No behavioral change.
- **context-review SKILL_KEYWORD_MAP** updated for both skills at scaffold time (c4a8d690) — consistent with scaffold→keyword-map discipline.

### Step 2 — Delete

- No deletions this window.

### Step 3 — Simplify

- trading-comp-mirror two-layer dedup (hook state + trades.json) is intentionally redundant — not an over-engineering candidate. Hook state handles fast dedup per run; trades.json handles restart-loss recovery. Single-layer would reintroduce the re-append bug.
- **[CARRY-WATCH]** `BEAT_SUBJECT_PATTERNS` in `db.ts` — manual sync surface. No new data.

### Step 4 — Accelerate

- Sensor count +1 (trading-comp-mirror). No new pipeline bottlenecks.
- 10-min sensor cadence is aggressive but appropriate for a live competition. No timeout risk (sensor is pure data fetch, no LLM).

### Step 5 — Automate

- **[NEW-WATCH]** trading-comp-mirror is competition-scoped. When the competition ends, the sensor should be disabled or sunset. No automation path exists today — this is a manual action. Consider adding competition-end detection to the sensor (check `COMP_END_TIMESTAMP` or API status) so it self-disables.

### Flags

- **[NEW-WATCH]** trading-comp-mirror sensor sunset — competition ends at an unknown future date. Sensor will continue polling even post-competition unless manually disabled. Add competition-end guard.
- **[CARRY-WATCH]** BEAT_SUBJECT_PATTERNS manual sync surface (db.ts).
- **[CARRY-WATCH]** social-x-ecosystem sensor — no recurrence data in this window.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — no response since 2026-04-26.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge.
- **[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.

---

## 2026-05-15T08:36:00.000Z — PR merged-state pre-flight; streak cooldown gate; beat-inactive date-scope; 117 skills / 72 sensors

**Task #16725** | Diff: 639cc3f9 → ab1273d0 | Sensors: 72 | Skills: 117

### Step 1 — Requirements

- **fix(aibtc-repo-maintenance): merged-state pre-flight** (e6004278): AGENT.md step 1 added — `gh pr view NUMBER --repo OWNER/REPO --json state --jq '.state'` before any review work; MERGED or CLOSED → close as completed and skip. Root cause of 4/20 failures on 2026-05-14 (PRs merged between sensor queue time and dispatch pickup). Pattern: validate external resource state before doing work. Pattern now in MEMORY.md [P].
- **fix(aibtc-news-editorial): cooldown pre-check in streak sensor** (0b432ddc): Streak sensor now gates on cooldown before queuing. Consistent with sensor-time cooldown pattern (b5caf209). Closes last gap in the cooldown-at-sensor-time discipline across all signal-filing sensors.
- **fix(aibtc-news-editorial): date-scope beat-inactive alert source** (ab1273d0): Beat-inactive alert source now includes YYYY-MM-DD. Fixes 24h dedup suppressing legitimate daily re-alerts for persistently inactive beats. Pattern: daily-alert sources must include date in the dedup key.
- **fix(context-review): 5-skill keyword map update** (8ee85666): 5 skills added since last audit now have keyword coverage. Applies the scaffold → keyword-map-in-same-window discipline (MEMORY.md [P]).

### Step 2 — Delete

- No new deletions. All prior [OPEN] items resolved.

### Step 3 — Simplify

- **[CARRY-WATCH]** `BEAT_SUBJECT_PATTERNS` in `db.ts` — manual sync surface. No new data.

### Step 4 — Accelerate

- Merged-state pre-flight eliminates the 4/20 failure class (PRs merged before dispatch) — no wasted LLM cycles on closed PRs.
- Cooldown pre-check at sensor time for streak sensor closes the last unguarded signal-filing sensor. Cooldown failures at dispatch are now structurally impossible for all active beat sensors.

### Step 5 — Automate

- No new automation opportunities this cycle. The merged-state check and cooldown gate are both manual-discipline patterns now enforced structurally.

### Flags

- **[RESOLVED]** PR merged-state pre-flight — e6004278. Closes 4/20 failure class from 2026-05-14 retro.
- **[RESOLVED]** Streak sensor cooldown gap — 0b432ddc. Sensor-time cooldown discipline now complete across all signal sensors.
- **[CARRY-WATCH]** BEAT_SUBJECT_PATTERNS manual sync surface (db.ts).
- **[CARRY-WATCH]** social-x-ecosystem sensor — no recurrence data in this window.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — no response since 2026-04-26.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge.
- **[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.

---

## 2026-05-14T23:33:00.000Z — dispatch-gate quota auto-reset; 19h outage post-mortem; 117 skills / 72 sensors

**Task #16631** | Diff: 639cc3f9 → 0a62b3cf | Sensors: 72 | Skills: 117

### Step 1 — Requirements

- **fix(dispatch-gate) quota auto-reset** (0a62b3cf): `checkDispatchGate()` now parses 'resets HH:MM (Timezone)' from stop_reason for rate_limited class. Finds the first reset time after stopped_at; if now >= reset_time → auto-reset and proceed. Consecutive-failure stops still require manual `arc dispatch reset`. Addresses 19h dispatch outage on 2026-05-14 (quota hit 03:00Z, reset 17:00Z, no cycle until 22:40Z).
- **Overnight brief 2026-05-14** (7dc26640): 19.5h dispatch gap documented. Pre-sleep productive (21 tasks, $5.16): Claude Code v2.1.141 upgrade, arc-mcp restart loop confirmed resolved, bitcoin difficulty signal, PR #384 reviewed (3 passes). 13 tasks batch-failed on restart (CEO review, arXiv digest, watch report, PR reviews, health alerts). Post-reset 5.5h gap (17:00→22:40Z) root cause still open — auto-reset fix closes this class going forward.
- **Memory/pattern updates** (e0fb9d66, 99ac4fdd): Stacks address prefix correction (SP=standard, SM=multisig both mainnet); dispatch 19h outage post-mortem pattern added.

### Step 2 — Delete

- No deletions. All prior [OPEN] items resolved.

### Step 3 — Simplify

- **[RESOLVED]** Dispatch-gate quota recovery: was manual (`arc dispatch reset`). Now auto-resets for rate_limited class based on machine-readable stop_reason. Manual reset path preserved for consecutive-failure stops (legitimate — needs human review). Simpler operational model.
- **[CARRY-WATCH]** `BEAT_SUBJECT_PATTERNS` in `db.ts` — manual sync surface. No new data.

### Step 4 — Accelerate

- Auto-reset eliminates the manual recovery path for quota exhaustion. Future quota outages self-resolve at reset time rather than requiring human intervention.
- Batch-fail on restart (13 tasks) is expected dispatch-lock behavior — not a bottleneck to address.

### Step 5 — Automate

- No new automation opportunities this cycle. The quota auto-reset IS the automation — it converts a manual-recovery class into a self-healing one.

### Flags

- **[RESOLVED]** Claude usage quota = 19h dispatch outage — auto-reset fix (0a62b3cf). Pattern closed for rate_limited class.
- **[CARRY-WATCH]** BEAT_SUBJECT_PATTERNS manual sync surface (db.ts).
- **[CARRY-WATCH]** social-x-ecosystem sensor — no recurrence data in this window.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — no response since 2026-04-26.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge.
- **[CARRY-WATCH]** PR #511 mcp-server — awaiting author response.

---

## 2026-05-13T20:30:00.000Z — NewReleaseMachine auto-advance fix; integration flood closed; 117 skills / 72 sensors

**Task #16600** | Diff: 154f274b → 639cc3f9 | Sensors: 72 | Skills: 117

### Step 1 — Requirements

- **fix(workflows): auto-advance new-release states on task creation** (639cc3f9): `autoAdvanceState` added to both create-task actions in `NewReleaseMachine`. `detected→assessing` on assessment task queue, `integration_pending→integrating` on integration task queue. Closes the integration workflow flood root cause: without state advance, the sensor saw no pending task and re-queued each cycle — producing 41 no-op tasks overnight consuming ~$5–6 and 47% of cycle capacity on v1.52.0.
- **memory: add integration workflow flood pattern** (a88efd10): Pattern added to `memory/MEMORY.md [P]` — integration sensors must gate on `pendingOrCompletedTaskExistsForSource` for the same release version.
- **Overnight brief 2026-05-13T13:06Z**: 87/87 completed (100%), $18.05. Dominant workload: 41 flood tasks (all "already done"). Substantive: Bun 1.3.14, 8+ PR reviews, blog published, arch docs updated. arc0me-site catalog regenerated at 117 skills / 72 sensors.
- **Watch report 2026-05-13T13:00Z**: Aligned with overnight brief findings. No new architectural issues.

### Step 2 — Delete

- No new deletions. All prior [OPEN] items resolved.

### Step 3 — Simplify

- **[RESOLVED]** Integration workflow flood — `autoAdvanceState` closes the re-queue loop without needing a separate completed-task check. Simpler than `pendingOrCompletedTaskExistsForSource` for state-machine-owned workflows; the state machine is the authoritative source.
- **[CARRY-WATCH]** `BEAT_SUBJECT_PATTERNS` in `db.ts` — manual sync surface. No new data.

### Step 4 — Accelerate

- 100% overnight (87/87). Pipeline nominal. Integration flood fix eliminates the primary recurring waste class.
- Sensor count 73→72 and skill count 118→117 reflect arc0me-site catalog regeneration (accurate count).

### Step 5 — Automate

- No new automation opportunities this cycle.

### Flags

- **[RESOLVED]** Integration workflow flood (41 tasks, v1.52.0) — `autoAdvanceState` fix (639cc3f9).
- **[CARRY-WATCH]** BEAT_SUBJECT_PATTERNS manual sync surface (db.ts).
- **[CARRY-WATCH]** social-x-ecosystem sensor — no recurrence since 2026-05-08T12:56Z.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — no response since 2026-04-26.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge; borrow broken until merged.
- **[CARRY-WATCH]** PR #511 mcp-server — package rename + proprietary license + IPI blocklist. Awaiting author response.

---

## 2026-05-13T08:29:00.000Z — competition skill; --no-orphans dispatch; context-review map expanded; 118 skills / 73 sensors

**Task #16557** | Diff: bbeb57ac → 154f274b | Sensors: 73 | Skills: 118

### Step 1 — Requirements

- **competition skill** (21dcb5b2): New CLI-only skill for AIBTC trading competition. `status`, `submit`, `list` commands. No sensor — submit happens post-swap. Bitflow provider address wired in MCP v1.52.0 for on-chain attribution. +2 skills total.
- **--no-orphans dispatch** (2a4c1aff): Bun v1.3.14 `--no-orphans` flag added to dispatch systemd unit. Claude Code subprocesses now killed if dispatch is unexpectedly terminated. Zero config change needed — flag is transparent to running sessions.
- **context-review SKILL_KEYWORD_MAP** (eae91b0a + 35a466b8): `competition` and `bitflow-lp` added; stale `arc-cost-alerting` entry removed. Consistent with SKILL_KEYWORD_MAP discipline pattern: scaffold → keyword map in same PR.
- **Watch report 2026-05-13T01:02Z**: 30/30 completed (100%), $18.24. Security-heavy: Shai-Hulud IOC sweep clean across 19 lockfiles. 8 PR reviews approved. 1 aibtc-network signal filed. Zero failures.

### Step 2 — Delete

- No new deletions. All prior [OPEN] items resolved.

### Step 3 — Simplify

- **[CARRY-WATCH]** `BEAT_SUBJECT_PATTERNS` in `db.ts` — manual sync surface. No new data.

### Step 4 — Accelerate

- 100% success again (30/30 watch + 89/90 prior). Pipeline healthy.
- `--no-orphans` closes a long-standing orphan-process risk with minimal overhead.

### Step 5 — Automate

- No new automation opportunities this cycle.

### Flags

- **[CARRY-WATCH]** BEAT_SUBJECT_PATTERNS manual sync surface (db.ts).
- **[CARRY-WATCH]** social-x-ecosystem sensor — no recurrence since 2026-05-08T12:56Z.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — no response since 2026-04-26.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge; borrow broken until merged.
- **[CARRY-WATCH]** PR #511 mcp-server — package rename + proprietary license + IPI blocklist. Awaiting author response.

---

## 2026-05-12T20:30:00.000Z — arc-weekly-presentation Tuesday+Council+Bitcoin Faces; shai-hulud worm class; 100% overnight

**Task #16442** | Diff: 11c64e31 → bbeb57ac | Sensors: 74 | Skills: 116

### Step 1 — Requirements

- **arc-weekly-presentation Tuesday cadence** (4ecbbfbc): working group meets Tuesdays. `isMondayUTC → isTuesdayUTC`, `mondayOf → tuesdayOf`. Sensor now fires on Tuesdays UTC. Clean rename; no structural impact.
- **Council slide** (4ecbbfbc): optional `council` field in research file enables a new slide between Self Improvements and New Agents. Carries: cycles, actionableRate, agents (name+lens/backend), highlights, summary, repoUrl. Backward-compatible — omitted when field absent.
- **Bitcoin Faces** (3798e1e2): agent-grid face cards added to Council slide. Five face SVGs added to `src/web/faces/`. Fetched from bitcoinfaces.xyz keyed on native segwit addresses. Optional `closingTeaser` field for the closing slide.
- **shai-hulud npm worm class** (9273e231): TanStack CVE-2026-45321 supply-chain worm pattern documented in `memory/shared/entries/shai-hulud-npm-worm-class.md`. Includes dead-man's switch order-of-ops, defensive posture, and AIBTC clean-audit result. Security pattern now in shared memory — available for future supply chain triage tasks.
- **Overnight 2026-05-12 brief**: 100% success (30/30, 0 failures) — first fully clean overnight since before Resend sunset. Self-review triage pattern held across 3 triage runs.
- **Pending human actions**: Zest borrow PRs #512/#513 (CI green, awaiting whoabuddy merge); PR #511 mcp-server (3 blocking issues, awaiting author response); payout disputes (16+ days stale).

### Step 2 — Delete

- No new deletions. All prior [OPEN] items resolved.

### Step 3 — Simplify

- **[CARRY-WATCH]** `BEAT_SUBJECT_PATTERNS` in `db.ts` — manual sync surface. No new data.

### Step 4 — Accelerate

- 100% overnight (30/30). No pipeline bottlenecks. arXiv 50 papers / 35 relevant — strongest digest in recent history. Quantum signal opportunity pending.
- arc-weekly-presentation: Tuesday cadence aligns with actual meeting day — reduces day-off friction.

### Step 5 — Automate

- No new automation opportunities this cycle.

### Flags

- **[CARRY-WATCH]** BEAT_SUBJECT_PATTERNS manual sync surface (db.ts).
- **[CARRY-WATCH]** social-x-ecosystem sensor — no recurrence since 2026-05-08T12:56Z.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — no response since 2026-04-26.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge; borrow broken until merged.
- **[CARRY-WATCH]** PR #511 mcp-server — package rename + proprietary license + IPI blocklist. Awaiting author response.

---

## 2026-05-12T08:27:00.000Z — nostr-wot deleted; PostToolUse syntax guard; context-review extended; skill count 116

**Task #16400** | Diff: 3f015a39 → 11c64e31 | Sensors: 74 | Skills: 116

### Step 1 — Requirements

- **[RESOLVED] nostr-wot deleted** (8f7b4065): orphaned skill directory removed. Was superseded by `wot` skill (4cd1a26a). [NEW-OPEN] from last audit — closed.
- **PostToolUse TypeScript syntax guard** (0b388b1e): `.claude/hooks/pre-commit-syntax.sh` added, registered on `Bash(git commit*)`. `continueOnBlock:true` — Claude fixes syntax errors in-session rather than abandoning work. Session-level inner guard; complements dispatch-level SafeCommit outer guard. Two-layer defense.
- **Context-review SKILL_KEYWORD_MAP extended** (11c64e31): scaffold/skill-creation keywords → `arc-skill-manager`; email-routing/report_recipient keywords → `arc-email-sync`. Closes 3 missed-coverage gaps from task #16398.
- **Memory consolidation** (843dccdd, b35b8a55): MEMORY.md compressed to ~48t; [A] active items audited and pruned.
- **Claude Code v2.1.139** (10f0ccbf): stream idle timeout fix + autoAllowBashIfSandboxed + settings hot-reload deployed.

### Step 2 — Delete

- No new deletions. All prior [OPEN] items resolved or human-gated.

### Step 3 — Simplify

- **[CARRY-WATCH]** `BEAT_SUBJECT_PATTERNS` in `db.ts` — manual sync surface. No new data.

### Step 4 — Accelerate

- 97.8% success overnight (45/46). 4 signals / 3 beats. Throughput healthy.
- PostToolUse guard reduces dispatch-level rollback frequency (catches errors earlier).

### Step 5 — Automate

- No new automation opportunities this cycle.

### Flags

- **[RESOLVED]** nostr-wot orphaned — deleted (8f7b4065).
- **[CARRY-WATCH]** BEAT_SUBJECT_PATTERNS manual sync surface (db.ts).
- **[CARRY-WATCH]** social-x-ecosystem sensor — no recurrence since 2026-05-08T12:56Z.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — no response since 2026-04-26.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge; borrow broken until merged.

---

## 2026-05-11T20:27:00.000Z — Email simplified (Resend removed); skills v0.42.0 (+5 skills, +2 sensors); nostr-wot orphaned

**Task #16354** | Diff: d94699b3 → 3f015a39 | Sensors: 74 | Skills: 118

### Step 1 — Requirements

- **Email simplification** (f1bb3375): Resend backend removed from arc-email-sync. CF worker is the sole email path. `--via resend` flag + cmdSendViaResend removed from cli.ts. Blocked tasks #14771 + #16063 closed. This eliminates a dead code path that was causing chronic dispatch failures. Clean.
- **Skills v0.42.0** (4cd1a26a + 3f015a39): 3 new knowledge skills added — `lunarcrush` (pay-per-call social/market intelligence via x402, authored by Prime Spoke), `wot` (consolidated Web of Trust, adds trust-path/recommend/taproot-key sources), `ordinals-marketplace` (Magic Eden PSBT browse/buy/sell flow). None have sensors.
- **nostr-wot deprecated** (4cd1a26a): wot replaces nostr-wot, but nostr-wot skill directory still exists on disk. Not deleted — orphaned.
- **amber-otter contact** (3f015a39 + 4cd1a26a): Genesis Level 2 agent (369SunRay, 1744+ check-ins) registered as peer. Bitcoin-macro/aibtc-network/quantum beat overlap = potential collaboration.
- **sbtc-yield-maximizer**: HODLMM routing leg updated (d9446137). No structural impact.
- **Overnight brief (13:05Z)**: PURPOSE 3.60 (daily eval), 97.8% success (45/46). 4 signals/3 beats. 11 PR reviews. Resend chronic = sole failure.
- **Watch report (13:00Z)**: Aligned. Zest borrow PRs #512/#513 approved/CI green, awaiting whoabuddy merge. PR #511 mcp-server blocking issues unresolved.

### Step 2 — Delete

- **[NEW-OPEN]** `skills/nostr-wot/` orphaned — deprecated by wot (4cd1a26a) but directory still present. Remove to avoid confusion. Follow-up task created.

### Step 3 — Simplify

- **[RESOLVED]** Email Resend dead code path removed (f1bb3375). arc-email-sync now has a single delivery path.
- **[CARRY-WATCH]** `BEAT_SUBJECT_PATTERNS` in `db.ts` — manual sync surface, no new data.

### Step 4 — Accelerate

- Throughput healthy: 97.8% success, 4 signals/3 beats overnight. No bottlenecks. Sensor +2 / Skill +5 expand coverage without adding dispatch complexity.

### Step 5 — Automate

- No new automation opportunities this cycle.

### Flags

- **[NEW-OPEN]** nostr-wot orphaned — `skills/nostr-wot/` directory should be deleted after wot integration confirmed stable.
- **[RESOLVED]** Resend chronic failure loop — email-no-resend policy closes the 10+ failure chain.
- **[CARRY-WATCH]** BEAT_SUBJECT_PATTERNS manual sync surface (db.ts).
- **[CARRY-WATCH]** social-x-ecosystem sensor — no recurrence since 2026-05-08T12:56Z.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — no response since 2026-04-26.
- **[CARRY-WATCH]** Zest borrow PRs #512/#513 — awaiting whoabuddy merge; borrow broken until merged.

---

## 2026-05-11T08:25:00.000Z — Pre-commit hook versioned (×22 RESOLVED); 42/43 success; PURPOSE 2.80; no new structural gaps

**Task #16312** | Diff: d6016d6c → d94699b3 | Sensors: 72 | Skills: 113

### Step 1 — Requirements

- **[RESOLVED ×22] Pre-commit hook versioned** (8b144aeb): `skills/arc-skill-manager/hooks/pre-commit` now git-tracked. `install-hooks` symlinks `.git/hooks/pre-commit` → tracked path instead of writing inline script. Hook survives fresh clones; re-install is a no-op symlink update. Closes the oldest unresolved architectural carry item.
- **Memory pattern additions** (d94699b3, 5acfaf89): skill-name mapping rule for follow-up tasks + content-source-coverage gap pattern. No structural changes to sensors or dispatch.
- **Watch report (2026-05-10T13:00Z – 2026-05-11T01:03Z)**: 42/43 success (97.7%), $12.87. 3 signals filed (2 aibtc-network + 1 quantum). 17 PRs reviewed. 1 failure: Resend chronic (escalated as task #16254). PURPOSE 3.00 → 2.80.
- **Quantum signal filed (8c9c80ae)**: SPHINCS+ + BIP360 post-quantum HD wallet convergence. Pipeline healthy.

### Step 2 — Delete

- No new deletions. All prior [OPEN] items resolved or human-gated.

### Step 3 — Simplify

- **[CARRY-WATCH]** `BEAT_SUBJECT_PATTERNS` in `db.ts` — manual sync surface. No new data.

### Step 4 — Accelerate

- 97.7% success rate. No pipeline bottlenecks. Signal throughput healthy (3 signals, 3 beats active). arXiv pipeline fully operational.

### Step 5 — Automate

- No new automation opportunities this cycle.

### Flags

- **[RESOLVED]** Pre-commit hook not git-tracked (×22) — versioned at `skills/arc-skill-manager/hooks/pre-commit` (8b144aeb).
- **[CARRY-WATCH]** Resend credentials — 10+ failures, human-gated (escalated #16254).
- **[CARRY-WATCH]** BEAT_SUBJECT_PATTERNS manual sync surface (db.ts).
- **[CARRY-WATCH]** social-x-ecosystem sensor — no recurrence since 2026-05-08T12:56Z.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — no response since 2026-04-26.

---

## 2026-05-10T20:24:00.000Z — No structural changes; overnight 96.6%; PURPOSE 3.00; pre-commit hook ×22; follow-up task created

**Task #16250** | Diff: b837808f → d6016d6c | Sensors: 72 | Skills: 113

### Step 1 — Requirements

- **No structural commits** since 20f26c8b (08:23Z audit, 12h ago). All intervening commits are memory auto-persists, watch reports, and loop auto-commits. Architecture unchanged.
- **Overnight brief** (2026-05-10T13:04Z): 28/29 success (96.6%), $9.67 (elevated). Sole failure: Resend chronic. 15/28 tasks = PR reviews (D1 migration surge — by design). PR #701 took 3 review cycles; CF deploy was bottleneck, not code quality (pattern already in MEMORY [P]).
- **Watch report** (2026-05-10T13:00Z): Aligned. No new architectural issues raised.
- **Daily eval** (commit 6f1425b9): PURPOSE=3.00, Signal Quality=1. 0 quantum signals overnight — arXiv scan ran but no qualifying papers in current corpus.
- **Recurring [OPEN]**: Pre-commit hook not git-tracked — **×22 audits**. Oldest unresolved item. Follow-up task created this cycle (see Step 5).

### Step 2 — Delete

- **[OPEN]** Pre-commit hook not git-tracked — **×22 audits**. Follow-up task queued (task created below).

### Step 3 — Simplify

- **[CARRY-WATCH]** `BEAT_SUBJECT_PATTERNS` in `db.ts` — manual sync surface, no new data.

### Step 4 — Accelerate

- Throughput excellent: 96.6% success overnight. No pipeline bottlenecks. arXiv scan operational; quantum drought resumed (no qualifying papers, not a sensor failure).

### Step 5 — Automate

- **[ACTION THIS CYCLE]** Pre-commit hook (×22) — follow-up task created to store hook under `skills/arc-skill-manager/hooks/pre-commit` and symlink at install time.

### Flags

- **[OPEN → follow-up queued]** Pre-commit hook not git-tracked (×22). Task created.
- **[CARRY-WATCH]** Resend credentials — 10+ failures, waiting on whoabuddy.
- **[CARRY-WATCH]** BEAT_SUBJECT_PATTERNS manual sync surface (db.ts).
- **[CARRY-WATCH]** social-x-ecosystem sensor — no recurrence since 2026-05-08T12:56Z.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — no response since 2026-04-26.

---

## 2026-05-10T08:23:00.000Z — Hashrate decompose shipped; audit-log housekeeping resolved; pre-commit hook ×21

**Task #16210** | Diff: fb182d16 → b837808f | Sensors: 72 | Skills: 113

### Step 1 — Requirements

- **bitcoin-macro hashrate decompose** (b837808f): [ACTION] from Step 3 last audit CLOSED. `sensor.ts` now queues two tasks for hashrate-record signals — compose-only (writes draft + creates follow-up) and a separate file task. Eliminates the recurring 15-min dispatch wall confirmed ×2 on 2026-05-09.
- **audit-log.md housekeeping** (90523468): [OPEN since ×17 audits] CLOSED. Trimmed 1,517→228 lines, historical entries archived. Audit log is now operational.
- **Watch report (2026-05-09T13:01Z → 2026-05-10T01:03Z)**: 27/28 success (96.4%), $9.11. 1 aibtc-network CVE signal filed. PR #674 authored, #672/#678 reviewed. Services nominal.
- **Recurring [OPEN]**: Pre-commit hook not git-tracked — ×21 audits. Only remaining structural open item.

### Step 2 — Delete

- **[OPEN]** Pre-commit hook not git-tracked — **×21 audits**. Oldest open item. Install: `arc skills run --name arc-skill-manager -- install-hooks`. Version it under `skills/arc-skill-manager/hooks/pre-commit`, symlink at install time.
- **[RESOLVED]** audit-log.md size — 1,517→228 lines (90523468).

### Step 3 — Simplify

- **[RESOLVED]** bitcoin-macro hashrate decompose — sensor-level split eliminates manual decomposition at dispatch. Pattern now consistent with arXiv digest split and blog-publish decompose.
- **[CARRY-WATCH]** `BEAT_SUBJECT_PATTERNS` in `db.ts` — still a manual sync surface, prone to silent drift.
- `[CARRY-CONSIDER]` `checkPrExists()` uses synchronous `Bun.spawnSync` — no new data.

### Step 4 — Accelerate

- Throughput excellent: 96.4% success. Hashrate decompose removes the most frequent timeout class.
- No pipeline bottlenecks beyond the pre-commit hook (structural, not throughput).

### Step 5 — Automate

- **[OPEN]** Pre-commit hook (×21) — store under `skills/arc-skill-manager/hooks/pre-commit`, symlink at install time.
- **[PATTERN]** Decompose-at-sensor pattern now covers 3 workflows: arXiv digest, blog-publish, bitcoin-macro hashrate. Any future sensor that combines research + filing in one task should apply the same pattern.

### Flags

- **[RESOLVED]** bitcoin-macro hashrate timeout — sensor-level decompose shipped (b837808f).
- **[RESOLVED]** audit-log.md housekeeping — 1,517→228 lines, archived (90523468).
- **[OPEN]** Pre-commit hook not git-tracked (×21).
- **[CARRY-WATCH]** BEAT_SUBJECT_PATTERNS manual sync surface (db.ts).
- **[CARRY-WATCH]** Resend credentials — 10+ failures, waiting on whoabuddy.
- **[CARRY-WATCH]** social-x-ecosystem sensor — no recurrence since 2026-05-08T12:56Z. Continue monitoring.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — no response since 2026-04-26.

---

## 2026-05-09T20:24:00.000Z — Merge PR #26 into main; PURPOSE 3.70 (best); quantum drought broken; audit-log housekeeping critically overdue

**Task #16171** | Diff: db104089 → fb182d16 | Sensors: 72 | Skills: 113

### Step 1 — Requirements

- **Merge fb182d16**: PR #26 (X pre-screen, infra beat purge, cooldown order, arXiv retry) squash-merged into main. No new structural changes — all content was already audited in prior cycles. Clean baseline.
- **Daily eval (task #16161, 15:13Z)**: PURPOSE **3.70** (S:4 O:4 E:3 C:5 A:3 Co:2 Se:3) — best score since launch. 21/24 success (~88%), $0.314/task. **5 signals across 3 beats** (3 bitcoin-macro, 1 quantum, 1 aibtc-network). Quantum drought broken: BTQ paper arXiv:2603.25519v2, signal 9a477540, all 7 gates passed.
- **Overnight brief (13:09Z)**: 21 completed, 2 failed (hashrate timeout + Resend chronic), 3 blocked (Resend×2 + ALB cooldown). CVE-2026-6321 autonomously patched (PR #509).
- **Recurring [OPEN] items** from last audit carry forward unchanged: pre-commit hook ×19→×20, audit-log housekeeping critically overdue.

### Step 2 — Delete

- **[OPEN]** Pre-commit hook not git-tracked — **×20 audits**. Every audit cycle this resurfaces. Creating a follow-up task to close it finally.
- **[OPEN]** audit-log.md is **1,473 lines** — spec is max 5 active entries. Housekeeping task required; this file is structurally unusable at current size.

### Step 3 — Simplify

- **[ACTION]** bitcoin-macro sensor creates a single hashrate task that reliably hits the 15-min wall (confirmed ×2 same day). The sensor already knows the task type — it should create two tasks at queue time (research+compose / file) instead of one monolithic task. This would eliminate the recurring decomposition pattern from dispatch.
- **[CARRY-WATCH]** `BEAT_SUBJECT_PATTERNS` in `db.ts` still a manual sync surface. Now smaller post-purge but still present.

### Step 4 — Accelerate

- Dispatch throughput healthy: 88% success, $0.314/task, 5-signal day. No pipeline bottlenecks beyond the hashrate decomposition gap (Step 3).
- **[WATCH]** ALB signal (#16147) was cooldown-blocked mid-day; retry pending. Not a structural issue — normal cooldown behavior.

### Step 5 — Automate

- **[OPEN]** Pre-commit hook (×20) — store under `skills/arc-skill-manager/hooks/pre-commit`, symlink at install time. Version-controlled. Does not require re-install on each clone if symlinked from tracked path.
- **[CONSIDER]** bitcoin-macro sensor auto-decompose: emit `[hashrate-research, hashrate-file]` task pair instead of single hashrate task when signal type = hashrate-record. Eliminates recurring manual decomposition.

### Flags

- **[RESOLVED]** arXiv quantum signal drought — BTQ paper filed (signal 9a477540, task #16142). Pipeline end-to-end verified.
- **[WATCH]** social-x-ecosystem sensor — no new recurrence since 2026-05-08T12:56Z. Monitoring continues.
- **[OPEN]** Pre-commit hook not git-tracked (×20).
- **[OPEN]** audit-log.md 1,473 lines — housekeeping task created (follow-up below).
- **[CARRY-WATCH]** BEAT_SUBJECT_PATTERNS manual sync surface (db.ts).
- **[CARRY-WATCH]** Resend credentials — 9+ failures, human-gated on whoabuddy Resend signup.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, human decision pending.
- **[CARRY-WATCH]** Payout disputes (11) — no response since 2026-04-26.

---

## 2026-05-09T08:23:00.000Z — No structural changes; arXiv transient miss; PURPOSE 2.85; patterns.md timeout pattern x3

**Task #16152** | Diff: e35e3465 → db104089 | Sensors: 72 | Skills: 113

### Step 1 — Requirements

- **No structural commits** since 20:22Z audit (3 commits: all memory/loop auto-commits). Architecture unchanged. Sensor count and skill count stable at 72/113.
- **Watch report** (2026-05-08T13:02Z → 2026-05-09T01:02Z): 43/45 completed (2 failed, 2 blocked), $13.94. 2 signals filed (aibtc-network + bitcoin-macro hashrate ATH ~1ZH/s). 13 PR reviews across aibtcdev + bff-skills repos.
- **Claude Code v2.1.136 → v2.1.137**: Upgraded during watch window. v2.1.137 is VSCode Windows fix only — no Arc action needed.
- **arXiv transient unreachable** (task #16124): "Research signal-worthy topics" reported arXiv unreachable during a filing task. PR #25 retry fix is operational (confirmed 08:28Z), but transient network failure still possible. Watch for recurrence.
- **patterns.md consolidation timeout** (3rd instance): Documented in MEMORY.md [P] — do not queue as single dispatch, always split into (1) read+compress draft and (2) write+commit.
- **PURPOSE 2.85** (task #16125 eval): Slight dip from 3.10. Signal drought persists — arXiv fetching papers but 0 quantum-qualifying signals in current corpus. 10 PR reviews as primary work.

### Step 2 — Delete

- **[OPEN]** Pre-commit hook not git-tracked — **×19 audits**. Structural liability. Install: `arc skills run --name arc-skill-manager -- install-hooks`.
- **[OPEN]** audit-log.md ~1,500+ lines — spec: max 5 active entries. Housekeeping pass critically overdue.

### Step 3 — Simplify

- **[CARRY-WATCH]** `BEAT_SUBJECT_PATTERNS` in `db.ts` is a manual sync surface — prone to silent drift on beat changes.
- `[CARRY-CONSIDER]` `checkPrExists()` uses synchronous `Bun.spawnSync` — no new data.

### Step 4 — Accelerate

- No bottlenecks identified. arXiv pipeline operational but corpus not producing quantum signals. Watch next daily eval for score movement.

### Step 5 — Automate

- **[OPEN]** Pre-commit hook not git-tracked (×19). Could store hook script under `skills/arc-skill-manager/hooks/pre-commit` and symlink at install time — keeps content versioned without git tracking `.git/hooks/`.

### Flags

- **[WATCH]** arXiv transient unreachable (task #16124) — retry fix operational but isolated miss still occurred. Monitor for recurrence.
- **[WATCH]** social-x-ecosystem sensor error (2026-05-08T12:56Z) — no recurrence in watch window. Continue monitoring.
- **[OPEN]** Pre-commit hook not git-tracked (×19).
- **[OPEN]** audit-log.md ~1,500 lines — housekeeping critically overdue.
- **[CARRY-WATCH]** BEAT_SUBJECT_PATTERNS manual sync surface (db.ts).
- **[CARRY-WATCH]** Resend credentials — 8+ failures, waiting on whoabuddy.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — no response since 2026-04-26.

---

## 2026-05-08T20:22:00.000Z — arXiv confirmed operational; social-x-ecosystem error; PURPOSE 3.10

**Task #16110** | Diff: 1f951fdf → e35e3465 | Sensors: 72 | Skills: 113

### Step 1 — Requirements

- **No structural commits** since 08:22Z audit (5 commits: all memory/loop auto-commits). Architecture unchanged.
- **arXiv confirmed operational** (08:28Z, PR #25 fix): 30 new papers fetched, `lastSeenId: arxiv.org/abs/2605.06667v1`. Quantum signal pipeline restored. Closes [WATCH] carried from ×4 prior audits.
- **PURPOSE 3.10** (daily eval f82af37d): Improvement from 1.90 (morning eval). Signal pipeline restored = primary lever moving.
- **Claude Code v2.1.136** deployed (MEMORY.md [A] entry updated). Previously v2.1.133.
- **Overnight brief** (2026-05-08T13:09Z): 23/24 tasks completed (95.8%), $0.255/cycle. Sole failure: chronic Resend credentials block.

### Step 2 — Delete

- **[OPEN]** Pre-commit hook not git-tracked — **×18 audits**. Structural liability. Install: `arc skills run --name arc-skill-manager -- install-hooks`.
- **[OPEN]** audit-log.md ~1,400+ lines — spec: max 5 active entries. Housekeeping pass overdue.

### Step 3 — Simplify

- **[CARRY-WATCH]** `BEAT_SUBJECT_PATTERNS` in `db.ts` is a manual sync surface — drifted silently for weeks (fixed 28cb5e3f). Derive programmatically from sensor constants to prevent future drift.
- `[CARRY-CONSIDER]` `checkPrExists()` uses synchronous `Bun.spawnSync` — no new data.

### Step 4 — Accelerate

- Quantum signal pipeline restored (08:28Z). First quantum signals should now file via overnight arXiv digest. PURPOSE score is the primary signal; watch for uplift in next daily eval.

### Step 5 — Automate

- **[OPEN]** Pre-commit hook not git-tracked (×18).

### Flags

- **[RESOLVED]** arXiv 429 retry/timeout (PR #25) — confirmed operational 08:28Z, 30 papers, quantum drought ended.
- **[WATCH]** social-x-ecosystem sensor error at 12:56Z — unknown root cause. If fires again, create investigation task.
- **[OPEN]** Pre-commit hook not git-tracked (×18).
- **[OPEN]** audit-log.md ~1,400 lines — housekeeping pass needed.
- **[CARRY-WATCH]** BEAT_SUBJECT_PATTERNS manual sync surface (db.ts).
- **[CARRY-WATCH]** Resend credentials — 6+ failures, waiting on whoabuddy.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — no response since 2026-04-26.

---

## 2026-05-08T08:22:00.000Z — X prescreen shipped; infra beat dead code purged; hookstate guard; tag limit fix

**Task #16073** | Diff: 36ee2c24 → 1f951fdf | Sensors: 72 | Skills: 113

### Step 1 — Requirements

- **5 structural commits** since last audit (2026-05-07T20:19Z). Core theme: close [ACTION] items from prior audit; PR #26 review feedback addressed.
- **X link prescreen** (2bac6fc3 + 7240787c): [ACTION] from last audit closed. `prescreenXUrls()` extracted as shared helper; `prescreen` subcommand added. Eliminates 42% wasted dispatch spend (11/26 deleted/protected tweets ~$5/overnight batch). Also: lenient-default path logged (1f951fdf) for auth failure diagnostics.
- **Infrastructure beat dead code purged** (28cb5e3f): `BEAT_SUBJECT_PATTERNS` in `db.ts` matched `'File agent-trading signal%'` and `'File infrastructure signal%'` — not `'File aibtc-network signal%'`. **aibtc-network cooldown was never triggering** — silent drift for weeks. Fixed. Also: ordinals-market-data dead two-beat overflow logic to retired `infrastructure` beat removed. AGENT.md and cli.ts comment refs updated.
- **arXiv hookstate guard** (1f951fdf): `readHookState()` wrapped in try/catch in `arxiv-research/sensor.ts`. Disk error before `claimSensorRun()` no longer defeats interval-release logic — prevents sensor lockout on transient filesystem errors.
- **Tag limit 10→11** (1f951fdf): `file-signal` tag limit bumped from 10 to 11 (10 user tags + 1 auto-beat slug). Preserves prior user-facing budget; error message clarified. Closes PR #26 reviewer concern.
- **Claude Code v2.1.133** (76ca99bd): deployed; `worktree.baseRef: "head"` set in `.claude/settings.json`.
- **Watch report** (2026-05-08T01:02Z): "Infrastructure beat fully purged. Cooldown-before-payment bug closed." 14/15 tasks completed overnight. No new structural issues. Signal drought persists.

### Step 2 — Delete

- **[OPEN]** Pre-commit hook not git-tracked — **×17 audits**. This is a structural liability. Install: `arc skills run --name arc-skill-manager -- install-hooks`.
- **[OPEN]** audit-log.md is ~1,350+ lines — spec: max 5 active entries. Housekeeping pass overdue.

### Step 3 — Simplify

- **[NEW-WATCH]** `BEAT_SUBJECT_PATTERNS` in `db.ts` is a manual sync surface that drifted silently for weeks (28cb5e3f). Pattern strings must match actual sensor task subjects. Consider deriving patterns programmatically from sensor constants rather than maintaining a separate string list.
- `[CARRY-CONSIDER]` `checkPrExists()` uses synchronous `Bun.spawnSync` — no new data.

### Step 4 — Accelerate

- arXiv first overnight test was ~20:11Z 2026-05-07. Watch report (01:02Z 2026-05-08) does not report quantum signals filed. Still waiting for first confirmed result post-fix.

### Step 5 — Automate

- **[OPEN]** Pre-commit hook not git-tracked (×17).

### Flags

- **[RESOLVED]** X link pre-screening (2bac6fc3+7240787c). Closes [ACTION] from last audit.
- **[RESOLVED]** BEAT_SUBJECT_PATTERNS aibtc-network pattern drift (28cb5e3f). Cooldown now correctly gates aibtc-network tasks.
- **[RESOLVED]** Infrastructure beat dead code in ordinals-market-data (28cb5e3f).
- **[WATCH]** arXiv 429 retry (PR #25/#26 shipped) — awaiting first confirmed quantum signal post-fix.
- **[NEW-WATCH]** BEAT_SUBJECT_PATTERNS is a manual sync surface — prone to silent drift on beat changes.
- **[OPEN]** Pre-commit hook not git-tracked (×17).
- **[OPEN]** audit-log.md ~1,350 lines — housekeeping pass needed.
- **[CARRY-WATCH]** Resend credentials — 6+ failures, waiting on whoabuddy.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — no response since 2026-04-26.

---

## 2026-05-07T20:19:00.000Z — ACTIVE_BEATS → live /api/beats; cooldown guard; v4.1 slug; X link waste

**Task #16032** | Diff: 0d84bf9e → 36ee2c24 | Sensors: 72 | Skills: 113

### Step 1 — Requirements

- **5 structural commits** since last audit (2026-05-07T08:20Z). Core theme: eliminate manual beat maintenance; guard signal costs before payment; platform compliance.
- **ACTIVE_BEATS → live /api/beats** (cbd4fc5d): `fetchActiveBeatSlugs()` shared utility in `src/sensors.ts`. All 3 beat-dependent sensors updated. Beat retirement is now self-healing — no manual patching. Closes [ACTION] promoted ×13 prior audits.
- **arXiv timeout/interval fix** (4b7c7cf9 + 1c3ef3ed): PR #25 reviewed by secret-mars, feedback addressed. First live sensor test at ~20:11Z today (near-current time).
- **Cooldown-before-payment** (5cdcf339): `file-signal` now checks `/api/status canFileSignal=false` before any signing or x402 payment. Closes 100-sat loss in task #15946.
- **v4.1 beat slug compliance** (36ee2c24): `file-signal` always prepends beat slug to `tags[0]` per agent-news#634 strict enforcement.
- **arc-link-research cleanup** (2824ec4b): stale archive and cache files removed.
- **Watch report CEO horizon** (by 2026-05-08T15:00Z): (1) arXiv confirmed live + ≥1 quantum signal; (2) Resend escalation with deadline; (3) X link pre-screening implemented or tasked.
- **X API waste** observed: 11/26 links in research batch were deleted/protected tweets — 42% wasted spend. No guard currently exists at task creation.

### Step 2 — Delete

- **[OPEN]** Pre-commit hook not git-tracked — persistent carry (×16 audits). Install: `arc skills run --name arc-skill-manager -- install-hooks`.
- **[AUDIT-LOG SIZE]** audit-log.md is ~1,300 lines. AGENT.md spec: max 5 active entries, older archived by housekeeping. Housekeeping pass overdue.

### Step 3 — Simplify

- **[RESOLVED]** ACTIVE_BEATS manual constants — replaced by live `/api/beats` API cross-reference (cbd4fc5d). Closes the #1 simplification carry item after 13+ audits.
- `[CARRY-CONSIDER]` `checkPrExists()` uses synchronous `Bun.spawnSync` — no new latency data.

### Step 4 — Accelerate

- arXiv fix (PR #25) is the primary quantum signal lever — first live test at 20:11Z (near now). If quantum signals resume tonight, drought ends.
- **[NEW]** X link pre-screening: check tweet existence before dispatching research tasks. Eliminates 42% wasted spend in research batches sourced from X posts.

### Step 5 — Automate

- **[OPEN]** Pre-commit hook not git-tracked (×16).
- **[NEW-ACTION]** X link pre-screening — create task to implement at research task creation time.

### Flags

- **[RESOLVED]** ACTIVE_BEATS manual constants → live `/api/beats` (cbd4fc5d). 13+ audit carries closed.
- **[RESOLVED]** Cooldown-before-payment 100-sat loss (5cdcf339).
- **[RESOLVED]** v4.1 beat slug enforcement at tags[0] (36ee2c24).
- **[WATCH]** arXiv 429 retry (PR #25) — first live test ~20:11Z; verify quantum signals after tonight's window.
- **[NEW-WATCH]** CEO 24h horizon: by 2026-05-08T15:00Z — arXiv confirmed + Resend escalated + X pre-screening.
- **[ACTION]** X link pre-screening — implement before next research batch.
- **[OPEN]** Pre-commit hook not git-tracked (×16).
- **[OPEN]** audit-log.md ~1,300 lines — housekeeping pass needed.
- **[CARRY-WATCH]** Resend credentials — 6+ failures, waiting on whoabuddy.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** Payout disputes (11) — no response since 2026-04-26.

---
