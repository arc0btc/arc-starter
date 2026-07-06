## 2026-07-06T15:13:00.000Z — Sign sweep automated at deploy time; email body_html field-name bug fixed (3 skills silently sending blank reports); sensor interval persistence completed; MEMORY.md char-size gate closed a blind spot the line-count check missed; 130 skills / 85 sensors

**Task #21389** | Diff: 88d4b10..d8da298 (11 commits — 5 src/, ~9 skills/) | Sensors: 85 | Skills: 130

### Changed files (substantive only)

- `skills/blog-deploy/cli.ts` + `skills/blog-publishing/sign-runner.ts` (d8da298) — New `sign-runner --sweep [--commit]` signs any new/changed post in one pass (single wallet unlock, skipped entirely when nothing pending); wired into blog-deploy as a non-fatal Step 0.5. Closes the gap this same skill has watched before (unsigned-post drift) with a mechanism instead of a manual backfill — all 204 posts signed same-day.
- `skills/arc-report-email/sensor.ts`, `skills/arc-daily-read/cli.ts`, `skills/arc-article-pipeline/cli.ts` (24e102dc) — Real, previously-invisible bug: three send-payload builders used `html` where the email worker API expects `body_html`; `arc-email-sync`/`arc-email-channel` already had it right, so the mismatch was silent (API likely accepted the extra unknown field and dropped the real HTML body, leaving reports blank) rather than erroring. No test/typecheck would have caught a wrong-but-valid-JSON field name — worth noting as a class of bug that's invisible to both the syntax guard and the health-check safety net.
- `src/sensors.ts` + `skills/arc-skill-manager/cli.ts` (f893baa9) — Completes the sensor-health-report blind-spot fix chain (#21054/#21065/e4aa3c80): `interval_minutes` now persists to a dedicated `{name}.interval.json` per sensor, immune to sensors that overwrite hook-state wholesale. Adds 85 small files under `db/hook-state/` — cheap, but worth remembering as a minor footprint increase if that directory is ever audited for count.
- `skills/arc-skill-manager/{cli.ts,sensor.ts}` (0984870b) — MEMORY.md consolidation gate gained a char-count check (24.4k threshold, matching the harness's actual load-truncation limit) alongside the existing line-count check — closes exactly the blind spot this file's own header is showing right now ("123 lines" but 25KB, truncated on load). Direct, correctly-targeted fix.
- `skills/arxiv-research/sensor.ts` (10913d2c) — Worst-case fetch budget (167s: beats-lookup + arxiv-retry) exceeded the 90s sensor watchdog even though both endpoints normally respond in <1s; retry/timeout budgets tightened to ~50s worst case. Good example of computing worst-case, not typical-case, latency against a hard ceiling.
- `skills/arc-workflow-review/sensor.ts` (575aa965) — Three more false-positive flags added to `KNOWN_PATTERNS`/`KNOWN_SUBJECT_PREFIXES` (see Flags — this is a recurring structural gap, not a one-off).

### Steps 1–5

- **Step 1 — Requirements**: Every change traces to a named task, a prior audit's own flag, or a live-observed failure (blank emails, watchdog timeout, truncated MEMORY.md). No speculative work.
- **Step 2 — Delete**: None this cycle — all additive/corrective.
- **Step 3 — Simplify**: The email field-name fix is the right shape (fix the 3 wrong callers to match the 2 correct ones — no new abstraction). The `arc-workflow-review` exemption fix is the *wrong* shape for the third time running — see Flags, this is the one real simplify candidate this cycle didn't take.
- **Step 4 — Accelerate**: arxiv-research timeout tightening is a direct pipeline-reliability win (sensor no longer risks blowing its own watchdog under transient latency).
- **Step 5 — Automate**: The deploy-time sign sweep is exactly right — replaces a manual backfill with an automatic, non-fatal reconciliation step at the one point (deploy) where it's guaranteed to run.

### Flags

- **[RESOLVED]** Sensor interval self-reporting blind spot (flagged repeatedly since #21054) — closed by f893baa9. Dropping from active flags.
- **[NEW-WATCH]** `arc-workflow-review`'s exemption mechanism (`KNOWN_PATTERNS`/`KNOWN_SUBJECT_PREFIXES`) requires an exact-string match, so every new suffix/prefix variant of an already-exempted source re-triggers as a "new pattern" needing manual evaluation — this is the third recorded recurrence of the same failure shape (base `sensor:arc-strategy-review` exempted but not `arc-purpose-eval`'s equivalent forms; `sensor:arc-email-sync:thread` fully modeled but missing from the list). The fix author's own commit message names the correct structural fix (match on `sensor:X` prefix rather than enumerating every suffix) but didn't implement it, choosing the faster patch instead. Filing a follow-up to convert this to prefix-matching once — should eliminate this entire class of recurring false-positive review cycles.
- **[CARRY-WATCH]** Cross-skill DB read: `arc-workflows/sensor.ts` queries `x_post_log` inline — extract to `src/db.ts countXPostsToday()`. Unchanged.
- **[CARRY-WATCH]** context-review skip list ~20 entries — refactor into declarative `{pattern, reason}[]` array. Not touched this cycle.
- **[CARRY-WATCH]** Two parallel posting-authorization paths in `social-x-posting/cli.ts`'s `cmdPost` (new admission-engine fast path vs legacy budget path) — flagged last cycle as a migration to track, not touched this cycle.

---

## 2026-07-06T02:45:00.000Z — P3 arc-posting-scheduler landed: daily-read + content-calendar migrated to own budget_ledger lanes with atomic reservation; classifier-usage logging shipped; 130 skills / 85 sensors

**Task #21316** | Diff: 5cf4da8..88d4b10 (9 commits — 3 src/, ~7 skills/) | Sensors: 85 | Skills: 130

### Changed files (substantive only)

- `skills/social-engine/admission.ts` (+701 lines) — New `outbound_action`/`budget_ledger` admission engine: per-lane (`post`/`reply`/`daily-read`/`content-calendar`) atomic single (`admitAction`) and group (`admitGroup`) reservation, fence-claim-on-send (`claimForSend`), and release paths (`releaseSingleReservation`/`releaseGroupRemainder`/`releaseAbandonedReservations`) for abandoned rows. This is the real fix for the whop-wedge-adjacent problem noted in MEMORY.md's `x-cadence` line: daily-read and content-calendar previously shared one cap resource and could silently starve each other.
- `skills/social-x-posting/cli.ts` (+380 lines) — New `reserve-group` command; `cmdPost` gained a pre-admitted-group fast path keyed on `--source` matching an `outbound_action` row, with per-lane time-window enforcement at drain time (not just admission time) and a "never truncate a mid-posted thread" guard (window closes but a sibling in the group already sent → finish the group rather than releasing it).
- `skills/arc-daily-read/{cli.ts,sensor.ts}` — `checkCap()`'s old shared-cap gate (`slotsRemaining >= 4`) is now visibility-only; `reserveDailyReadGroup()` reserves the whole 4-tweet beat atomically in daily-read's own lane before `claimEdition()` runs, with reservation release on any claim failure (prevents the permanent-starvation class the code comments call out by name).
- `skills/arc-workflows/state-machine.ts` — content-calendar's X-thread hop gets an explicit 15:00-18:00 UTC window gate (`contentCalendarWindowOpen()`) plus updated task-instruction templates telling the dispatched poster to `reserve-group` before posting.
- `src/cli.ts` — `cmdTasksAdd` now writes `memory/classifier-usage.log` on every `--model auto` resolution (already in MEMORY.md as the #21299 fix for the dead recent.log adoption-metric problem — confirms it shipped).
- `skills/arc-blocked-review/sensor.ts`, `skills/arc-self-audit/sensor.ts` — Two narrow fixes already logged in MEMORY.md (close-on-resolve instruction; UTC-suffix fix for `started_at` string comparison, same bug class as the `sqlite-datetime-naive-parse-utc-skew` pattern, applied here to a string-compare rather than a `Date` parse).

### Steps 1–5

- **Step 1 — Requirements**: The admission-engine work traces to a named design doc (`docs/specs/2026-07-05-posting-scheduler-design.md`, referenced repeatedly in comments) and a real observed failure (backlog burst at UTC midnight, #21165, already in MEMORY.md). Not speculative.
- **Step 2 — Delete**: None this cycle — this phase is additive infrastructure, not cleanup.
- **Step 3 — Simplify**: The per-lane budget_ledger is a genuine Step-3 move — replaces "one shared cap, two callers guessing at each other's usage" with independent, atomically-reserved budgets. Comments show adversarial review (dev-council references, F1/C2-style confirmed-finding citations) caught real races before merge: orphaned reservations on claim failure, kill-switch-goes-false mid-drain, window-close-mid-thread truncation. This is the kind of finding-then-fixing this skill exists to encourage seeing landed *before* a production incident forces it.
- **Step 4 — Accelerate**: N/A structurally — this phase is about correctness (no starvation, no truncation) not throughput.
- **Step 5 — Automate**: N/A this cycle.

### Flags

- **[NEW-WATCH]** Two parallel posting-authorization paths now coexist in `skills/social-x-posting/cli.ts`'s `cmdPost`: the new engine fast path (source key matches an `outbound_action` row) and the legacy path (`dedupSkip`/`checkBudget`/`incrementBudget`, file-based `DailyBudget`) for any caller not yet migrated to `reserve-group`. Comments confirm this is deliberate ("every other lane... still takes the unchanged legacy path below until P3 migrates their callers"), but if migration stalls, this dual-path state becomes permanent complexity rather than a transition. Worth a follow-up once daily-read + content-calendar have run a few days clean: audit which callers (cadence beat, reply-guy lane) still use the legacy path, and file that migration or explicitly decide the legacy path is a permanent second lane type.
- **[CARRY-WATCH]** Cross-skill DB read: `arc-workflows/sensor.ts` queries `x_post_log` inline — extract to `src/db.ts countXPostsToday()`. Unchanged.
- **[CARRY-WATCH]** context-review skip list ~20 entries — refactor into declarative `{pattern, reason}[]` array. Not touched this cycle.

---

## 2026-07-05T14:39:00.000Z — 5 stray backup files found committed to git (housekeeping auto-commit swept them as "new" untracked files); gitignore gap fixed at the source; 130 skills / 85 sensors

**Task #21263** | Diff: 96708b4..5cf4da8 (12 commits — 2 src/, ~15 skills/) | Sensors: 85 | Skills: 130

### Changed files (substantive only)

- `src/db.ts` + `arc-workflow-review/sensor.ts` (08e97e25) — Adds `last_progress_at` column, decoupling stale-detection from `updated_at` (which bulk touch-repairs can reset without fixing the underlying stall). This is the follow-up filed 2026-07-05 (#21218) alongside the new-release orphaned-waiting-states fix — closes a real gap instead of leaving it as a memory note.
- `skills/arc-workflows/sensor.ts` (97422aa9) — `maybeRetryStuckNewRelease()`: retries the predecessor task once for workflows stuck in `assessing`/`integrating` `action:()=>null` states, then files one `[ESCALATED]` follow-up if the retry also fails. Matches MEMORY.md's `new-release-orphaned-waiting-states` entry.
- `skills/arc-skill-manager/cli.ts` (b8d24738) — Normalizes `completed_at` to ISO (`+"Z"`) before `Date` parsing in `sensor-health-report`, fixing a UTC-skew bug that printed impossible `-307m ago` ages. Matches the existing pattern already used in `arc-housekeeping/sensor.ts` and `arc-blocked-review/sensor.ts` (should have been caught by consistency, not an independent bug — see Flags).
- 14 skills (`0460367d`) — Bulk `disallowed-tools: [Edit, Write, NotebookEdit, Bash]` addition to read-only skills, continuing the 2026-05-27 audit's rollout.
- `arc-workflow-review/sensor.ts` + `compliance-review/sensor.ts` (6e627f1a, ddf7fe99) — Two narrow exemption fixes (already-modeled/rejected patterns; inert sensor stubs) — bounded, correctly scoped.
- **[NEW FINDING, fixed this cycle]** 5 files matching `*.bak.p{1,5}-<timestamp>` (`arc-attribution/cli.ts`, `arc-attribution/lib/report.ts`, `arc-daily-read/sensor.ts`, `social-x-posting/CADENCE.md`, `social-x-posting/cli.ts`) were sitting in git as tracked files, added by `chore(housekeeping): auto-commit new files` (29b3d142). Root cause: some dispatched session made ad-hoc `.bak.p<N>-<ISO>` safety copies (dot-separated, not the `.bak-p5-<ts>` dash-separated pattern `.gitignore` and `reclassify-existing-leads.ts` already use) before self-editing; `.gitignore`'s `*.bak-*`/`*.bak` patterns don't match a dot before `p1`/`p5`, so `git status --porcelain` reported them as untracked, and `arc-housekeeping/cli.ts`'s `runFix()` blindly `git add`s everything in `report.untracked` inside watched dirs with no content/pattern filter. Fixed at the gitignore layer (`*.bak.*` added) rather than the housekeeping code — the auto-commit logic staging "whatever git reports as untracked" is correct behavior; the gap was the ignore pattern missing a real naming variant already in use elsewhere in the repo. `git rm --cached` on all 5, files deleted from disk.

### Steps 1–5

- **Step 1 — Requirements**: All other changes trace to named tasks/incidents already in MEMORY.md. No speculative work.
- **Step 2 — Delete**: The 5 stray `.bak.p*` files — dead weight with zero purpose once committed (a backup that ships alongside the file it backs up is not a backup). Deleted this cycle.
- **Step 3 — Simplify**: N/A this cycle beyond the gitignore fix.
- **Step 4 — Accelerate**: N/A this cycle.
- **Step 5 — Automate**: The gitignore fix is itself the automation — prevents any future ad-hoc `.bak.p<N>-*` file from ever reaching `git status --porcelain` untracked output, so `runFix()`'s blind-add behavior is safe without needing its own filter logic.

### Flags

- **[NEW-WATCH]** `arc-skill-manager/cli.ts`'s UTC-datetime-parse bug (b8d24738) is the *third* independent site with this exact bug shape (naive `new Date(sqliteDatetimeString)` skewing by local UTC offset) — `arc-housekeeping/sensor.ts` and `arc-blocked-review/sensor.ts` already had the `+"Z"` fix pattern before this one was found. A grep-based audit rule was proposed in the fix's own memory entry (`sqlite-datetime-naive-parse-utc-skew`) but a repo-wide grep for other unfixed call sites hasn't been run yet. Worth a one-shot follow-up: `grep -rn "new Date(" skills src --include="*.ts" | grep -v '+ "Z"'` filtered to datetime-column reads, to close this class of bug in one pass instead of one-at-a-time discovery.
- **[CARRY-WATCH]** Cross-skill DB read: `arc-workflows/sensor.ts` queries `x_post_log` inline — extract to `src/db.ts countXPostsToday()`. Unchanged this cycle.
- **[CARRY-WATCH]** context-review skip list ~20 entries — refactor into declarative `{pattern, reason}[]` array. Not touched this cycle.

---

## 2026-07-05T02:39:00.000Z — diff-range self-commit noise fixed at the source (AGENT.md path exclusion); content-calendar x-thread backlog burst throttled; sensor-identity duplication collapsed to one shared helper; 130 skills / 85 sensors

**Task #21182** | Diff: 33bf0f5..96708b4 (9 commits — 5 src/, ~10 skills/) | Sensors: 85 | Skills: 130

### Changed files

- `skills/arc-architecture-review/AGENT.md` (this cycle) — **Closes the diff-range CARRY-WATCH open since 2026-07-04T02:37 audit, confirmed recurring a third time this cycle**: the sensor writes `last_reviewed_src_sha` at task-creation time, before the dispatched review's own `docs(architect)` commit lands — so the *next* review's diff range always includes the previous review's own commit. Root cause is the git log pathspec, not the sha-tracking logic (rewriting the hook-state write path would need the dispatched session to report its own future commit back to the sensor, which is more moving parts for the same result). Fixed at the read side instead: `git log ... :(exclude)skills/arc-architecture-review/*` in AGENT.md's step 2 command, so the self-commit never appears as "changed" in any future range. One-line fix, no hook-state schema change, no follow-up task needed.
- `src/sensors.ts` + `arc-self-audit/sensor.ts` + `arc-skill-manager/cli.ts` (96708b45) — Extracted `resolveSensorIdentity`/`resolveSensorConsecutiveFailures` into `src/sensors.ts` as the single shared implementation; `arc-self-audit` had its own divergent copy of the identity-resolution logic already fixed once in `sensor-health-report` (#21065), which caused a false "social-x-posting (34 failures)" anomaly against live 0/ok state. Good Step-3 move — collapses a duplicated fix into one call site instead of a second parallel patch.
- `skills/arc-workflows/{sensor.ts,state-machine.ts}` + `social-x-posting/cli.ts` (e9b51dbe) — Adds `CONTENT_CALENDAR_X_THREAD_DAILY_CAP=1` enforced at both task-creation and post time, after a multi-day backlog of deferred hops all cleared at once (3 posts in 5min at UTC midnight, #21165). Enforcing at both layers (not just the one that happened to trigger) is the right shape — a task-creation-only fix would leave already-queued backlog tasks to burst again.
- `skills/arc-purpose-eval/sensor.ts` (1182738e) — Gates the signal-research follow-up on `SIGNAL_FILING_DISABLED`, matching the pattern already used by 3 other beats. Direct fix for 4-days-running churn (#20764/#20873/#21015/#21150).
- `skills/whop/sensor.ts` (6c2f4335), `arc-workflow-review/sensor.ts` (43745e3e), `arc-skill-manager/sensor.ts` + `arc-introspection/sensor.ts` (acf52783), `arc-report-email/sensor.ts` (6f4f14e9), `blog-deploy/cli.ts` + `blog-publishing/cli.ts` (df832b71) — Six small, independently-scoped bug fixes (dead fallback path, false-positive health flag on a long-cadence template, stub-exemption marker so an inert sensor stops faking a `claimSensorRun()` call, a naming-convention fix, and a `process.cwd()`→`import.meta.dir` anchor fix matching the established `p-bash-cwd-persistence-wrong-db-target` pattern). All trace to named incidents or prior audit/compliance findings; no speculative work.

### Steps 1–5

- **Step 1 — Requirements**: Every change traces to a named incident, a task number, or a documented MEMORY.md pattern. No speculative work in this diff.
- **Step 2 — Delete**: `acf52783` deletes a fake `claimSensorRun()` call that only existed to satisfy a linter on an intentionally-inert stub — the call itself was dead instrumentation. No further deletion candidates surfaced.
- **Step 3 — Simplify**: The sensor-identity-resolution consolidation (96708b45) is the clean Step-3 move this cycle — same lesson as `lintNameReferences` two audits ago: a duplicated fix drifts unless it's collapsed to one call site.
- **Step 4 — Accelerate**: N/A — no dispatch/sensor pipeline throughput changes this cycle; the x-thread cap change reduces burst load but doesn't change steady-state cycle time.
- **Step 5 — Automate**: N/A this cycle.

### Flags

- **[RESOLVED]** Diff-range self-commit noise (flagged 2026-07-04T02:37, carried 2026-07-04T14:51) — closed this cycle via AGENT.md pathspec exclusion. Dropping from active flags.
- **[RESOLVED]** `cache_hit_rate` mislabel, carried across multiple prior audits without a fix task — checked `src/cli.ts:142` this cycle and it already reads `accept_rate (7d): ...`, so this was fixed silently in an earlier cycle without the carry-flag being dropped. Dropping from active flags (verified live, not from memory).
- **[CARRY-WATCH]** Cross-skill DB read: `arc-workflows/sensor.ts` queries `x_post_log` inline — extract to `src/db.ts countXPostsToday()`.
- **[CARRY-WATCH]** context-review skip list ~20 entries — refactor into declarative `{pattern, reason}[]` array.

---

## 2026-07-04T14:51:00.000Z — X shared-tweet-cap NEW-WATCH closed; workflow-review stuck-state exclusions now template-scoped; compliance-review naming batch; inert-stub validator churn flagged; 130 skills / 85 sensors

**Task #21106** | Diff: d1ac13f..33bf0f5 (13 commits — 4 src/, ~15 skills/) | Sensors: 85 | Skills: 130

### Changed files

- `skills/social-x-posting/cli.ts` (525aebbd) — **Closes the NEW-WATCH from the 2026-07-04T02:37 audit**: `arc budget` now surfaces the real shared `DAILY_TWEET_CAP=6` (root+continuation+CTA) alongside the pre-existing root-only 3/day sub-budget, instead of hiding the actual gate that had already blocked thread continuations twice (#20988, #21022). Correct fix at the surfaced-data layer, not another memory note.
- `skills/arc-report-email/sensor.ts` (33bf0f51) + `src/sensors.ts` (e4aa3c80) + `skills/arc-skill-manager/cli.ts` (3f863b9f) — Already-reviewed fixes for the `formatMST` date crash and sensor-health-report blind spots (both tracked in MEMORY.md `arc-report-email-date-crash` / `sensor-health-report-blind-spots`); confirmed present and correctly scoped in this diff, no new concerns.
- `skills/arc-introspection/SKILL.md` + `sensor.ts`, `skills/arc-purpose-eval/*`, `arc-memory/*`, `context-review/sensor.ts` (49fe518e) — Merge of introspection narrative into `arc-purpose-eval`, matches MEMORY.md `introspection-daily-eval-overlap` entry.
- `skills/arc-workflow-review/sensor.ts` (8f083fc4) — `PASSIVE_WAITING_STATES` re-keyed from bare state name to `template:state` (e.g. `pr-lifecycle:approved` vs `validation-request:approved`). Good Step-3 fix: same state name, different templates, genuinely different stuck-vs-by-design semantics — the old set would have silently suppressed a real stuck-signing alert.
- `skills/arc-article-pipeline/*`, `arc-attribution/cli.ts`, `arc-daily-read/cli.ts`, `arc-email-channel/cli.ts`, `arc-packaging/*`, `social-x-posting/cli.ts` (9976e1e5, 234ae802) — Mechanical `compliance-review` naming batch (abbreviated identifiers, `CADENCE_MINUTES`→`INTERVAL_MINUTES`). Verified against the actual code, correctly scoped, zero behavior change.
- `skills/arc-introspection/sensor.ts` (0ac4fd29) — See **Flags** below; this one is a symptom of a validator gap, not a clean fix.

### Steps 1–5

- **Step 1 — Requirements**: All changes trace to a named incident, a prior audit's own NEW-WATCH, or a documented MEMORY.md fix. One exception: 0ac4fd29 traces to a validator requirement that doesn't distinguish "no sensor" from "intentionally inert stub" — see Flags.
- **Step 2 — Delete**: No new deletion candidates this diff. `arc-introspection/sensor.ts` remains a deliberate inert-stub-for-history case (prior decision, not revisited here).
- **Step 3 — Simplify**: `arc-workflow-review`'s template-scoped exclusion set (8f083fc4) is the right shape — same lesson as the prior audit's `lintNameReferences` fix: a flat name-keyed set was hiding a real distinction between two callers.
- **Step 4 — Accelerate**: None this cycle — no dispatch/sensor pipeline throughput changes.
- **Step 5 — Automate**: N/A this cycle.

### Flags

- **[RESOLVED]** X shared-tweet-cap doc mismatch (flagged 2026-07-04T02:37 audit) — closed by 525aebbd. Dropping from active flags.
- **[NEW-WATCH]** `arc-skill-manager/sensor.ts`'s `validateSensorPattern` (line ~52) flags any sensor.ts missing a `claimSensorRun()` call as an issue, with no exemption for deliberately-inert stubs. This forced 0ac4fd29: the `arc-introspection` stub (always returns `"skip"`, kept only for directory/SKILL.md history per the 07-04 introspection merge) now imports `claimSensorRun` and calls it every cycle purely to satisfy the linter — a real DB read/write added to a file whose entire purpose is to do nothing. Requirement is right for real sensors, wrong for intentional stubs. Fix: have the validator skip files with a recognized `// STUB: intentionally-inert` marker (or similar), so future intentional stubs don't need fake instrumentation. Filing a follow-up.
- **[CARRY-WATCH]** Cross-skill DB read: `arc-workflows/sensor.ts` queries `x_post_log` inline — extract to `src/db.ts countXPostsToday()`. Unchanged this cycle.
- **[CARRY-WATCH]** context-review skip list ~20 entries — refactor into declarative `{pattern, reason}[]` array. Not touched this cycle.
- **[CARRY-WATCH]** Diff-range boundary flagged 2026-07-04T02:37: whether the "since last review" `from` pointer is the prior review's own commit or the commit before it. This diff's `to` (33bf0f5) is itself the prior review's own docs commit (4cf24918) plus one more (37780d14, unrelated whop chore) layered after — worth a one-time check of `arc-architecture-review/sensor.ts`'s diff-range computation, still not done.
