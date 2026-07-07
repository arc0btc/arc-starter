## 2026-07-07T02:46:00.000Z — arc-workflow-review exemption matching converted to prefix-based (closes 3-recurrence NEW-WATCH); stray-sqlite root cause fixed at import.meta.dir; memory-poisoning provenance tagging shipped; X pay-per-use budget + kill-switch fail-closed landed; 130 skills / 85 sensors

**Task #21517** | Diff: d8da298..64f3092 (25 commits — 5 src/, ~15 skills/) | Sensors: 85 | Skills: 130

### Changed files

- `skills/arc-workflow-review/sensor.ts` (49727055, a08016f3) — **Closes the [NEW-WATCH] carried since 2026-07-04T14:51**: bare `sensor:X` / subject-prefix entries now match as prefixes instead of requiring an exact-string entry per suffix variant. This was flagged as a recurring failure shape three audits running (base pattern exempted, suffixed variant re-flags); this cycle implements the structural fix the commit author had previously named but deferred. Correct Step-3 move.
- `src/db.ts` (15dc24a0) — Root-caused a real bug: `new Database("db/arc.sqlite")` resolved against `process.cwd()`, so any invocation from a different cwd (github/ clones, skill cache dirs) silently created a stray incomplete db there — 15 stray files already existed and were deleted in this commit. Fixed via `import.meta.dir`, matching the existing convention in `skills.ts`/`web.ts`/`artifacts.ts`. Verified live: no stray `arc.sqlite*` files remain anywhere in the tree post-fix, including the 5 that got auto-committed to `skills/arc-link-research/cache/db/` in `0f86e479` just before this fix landed (removed in the same commit).
- `src/db.ts` + `skills/arc-skill-manager/SKILL.md` (d0713864) — Directly closes security-audit finding #2 (memory poisoning, `research/2026-07-06_security-audit-deepmind-6attack-taxonomy.md`): `recent.log` lines from untrusted-content-processing tasks (link-research, email-sync, aibtc-inbox-sync, peer-inbox) now get an `[UNTRUSTED-SRC]` prefix so consolidation gives them a second look before folding claims into MEMORY.md, which loads unconditionally into every dispatch. Right layer for the fix — provenance at write time, not a filter bolted on at read time.
- `skills/arc-link-research/{cli.ts,AGENT.md}` (0412ce8a, 4c97b18e, 669628d6) + `skills/arc-peer-inbox/AGENT.md` (51ac320d) — Remaining security-audit fixes: embedded-URL auto-follow decisions now logged per report, CSS-hidden elements stripped before generic tag-strip (closes the "hidden text survives as plaintext" gap), explicit data/instructions framing added to both skills. `arc-peer-inbox` previously had no AGENT.md at all — the most direct cross-agent-cascade vector now has an explicit untrusted-content guard.
- `skills/social-x-posting/cli.ts` (38a60953) — Fail-closed kill switch fix on the legacy post path: was `=== "false"` (fell through on missing row or any other value), now `!== "true"` matching the pattern already used elsewhere in the same file and in `admission.ts`. Direct fix for the fail-open bug filed last cycle (#21397).
- `skills/social-x-posting/{lib/x-api.ts,cli.ts,sensor.ts}` + `skills/social-engine/{follow-curated.ts,north-star-gauge.ts}` (20f1649e, a91024c3, dabc9323, ce308150) — Full X pay-per-use budget rework (signed off #21462): dollar-denominated read budget replacing the flat-count model, link-post daily cap, follower-reserve removed in favor of the dollar budget, mentions cadence widened 20→30min. Matches MEMORY.md `x-api-pay-per-use-cost-model` — confirmed present and correctly scoped, no new concerns.
- `skills/arc-purpose-eval/sensor.ts` (ab40fd49, f44391dd) — Cooldown-gates the cost-efficiency-review follow-up (2-day window) after it re-spawned an identical audit the day after a prior one concluded "root lever unchanged" (#21309→#21504 same-day duplicate); Ecosystem Impact scoring moved to a 3-day rolling average, closing the false-alarm mechanism that produced the "3 consecutive zero-PR-review days" scare (see MEMORY.md `pr-review-crowdout-false-alarm`).
- `skills/context-review/sensor.ts` + `arc-email-sync/sensor.ts` + `arc-workflows/state-machine.ts` (2b8f751f) — Fixed two live spawn sites referencing a skill name (`arc-cost-alerting`) that was never real (`arc-cost-reporting` is); added two keyword-false-positive exemptions found in the same audit pass.
- `skills/social-x-posting/sensor.ts` (64f3092f) — Read-budget-exhausted now classified as `skip` not `error` in sensor health accounting — a deliberate budget stop shouldn't count as a sensor failure.

### Steps 1–5

- **Step 1 — Requirements**: Every change traces to a named incident, a signed-off recommendation (#21462), a security-audit finding, or a carried NEW-WATCH/CARRY-WATCH from a prior review. No speculative work in this diff.
- **Step 2 — Delete**: `20f1649e`/`dabc9323` remove the follower-reserve mechanism entirely (superseded by the dollar budget) rather than layering a new system alongside the old one — correct deletion, not accretion.
- **Step 3 — Simplify**: The `arc-workflow-review` prefix-matching fix (49727055/a08016f3) is this cycle's standout — converts a whole class of recurring false-positive reviews into a one-time structural fix instead of the third patch-per-instance in a row.
- **Step 4 — Accelerate**: Mentions cadence widened 20→30min reduces read-budget pressure on the sensor→task pipeline without adding complexity.
- **Step 5 — Automate**: N/A this cycle — no new automation, several fixes make existing automation fail-closed/fail-safe instead (kill switch, budget classification).

### Flags

- **[RESOLVED]** `arc-workflow-review` exact-string exemption matching (flagged 2026-07-04T14:51, carried 2026-07-06T15:13 as a 3rd-recurrence NEW-WATCH) — closed this cycle via prefix matching (49727055/a08016f3). Dropping from active flags.
- **[RESOLVED]** Stray incomplete `arc.sqlite` files from cwd-relative path resolution — root-caused and fixed (15dc24a0), including cleanup of files auto-committed just one commit earlier (0f86e479) in the same diff range. Dropping from active flags — watch is now moot since the source is fixed, not just the symptom.
- **[CARRY-WATCH]** Cross-skill DB read: `arc-workflows/sensor.ts` queries `x_post_log` inline — extract to `src/db.ts countXPostsToday()`. Unchanged this cycle.
- **[CARRY-WATCH]** context-review skip list ~20+ entries, still not refactored into a declarative `{pattern, reason}[]` array despite two more ad-hoc entries added this cycle (2b8f751f) — the list keeps growing one exemption at a time instead of being restructured.
- **[CARRY-WATCH]** Two parallel posting-authorization paths in `social-x-posting/cli.ts`'s `cmdPost` (admission-engine fast path vs legacy budget path) — the legacy path just got its own independent kill-switch fix (38a60953) this cycle, which is more evidence the two paths are drifting rather than converging. Worth a follow-up to assess consolidating onto the admission-engine path only.

---

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
- **[CARRY-WATCH]** Diff-range boundary flagged 2026-07-04T02:37: whether the "since last review" `from` pointer is the prior review's own commit or the commit before it. This diff's `to` (33bf0f5) is itself the prior review's own docs commit (4cf24918) plus one more (37780d14, unrelated whop chore) layered after — worth a one-time check of `arc-architecture-review/sensor.ts`'s diff-range computation, still not done.
