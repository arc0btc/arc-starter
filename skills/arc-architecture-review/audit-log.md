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

---

## 2026-07-04T02:37:00.000Z — TTL staleness fallback on dispatch-lock PID-reuse hole; classifier recall broadened to skill/CLI-name phrasing; dev-council fixes to whop-sales P5 (data loss, torn-write); rename-drift now grep-verified at commit time; 130 skills / 85 sensors

**Task #21035** | Diff: 8158acd..d1ac13f (~110 commits, mostly `chore(loop)` auto-commits — 3 src/, ~90 skills/ across many unrelated file touches) | Sensors: 83→85 | Skills: 126→130

### Changed files (substantive only — noise from auto-commit chores and a ~50-file mechanical doc sweep excluded)

- `src/dispatch.ts` (0ac7f518) — **Closes a real dispatch-hang hole**: `isPidAlive()` alone can't detect a crashed dispatch whose PID got reused by an unrelated live process, which would make the stale-lock check report a dead lock as live forever. Added an independent `MAX_LOCK_AGE_MS` (35min, matches ARC-0013 lease TTL) age check — either check failing clears the lock. Traces to a named vuln doc (`memory/shared/entries/dispatch-lock-pid-reuse-vulnerability.md`). Correct fix at the correct layer (core dispatch, not a workaround).
- `src/classifier.ts` + `src/cli.ts` (f4100aee) — Follow-up to the previously-flagged adoption gap (0/86 sonnet follow-ups used devstral/glm on 2026-07-03): adds an explicit `--file` flag plus skill-prefix/CLI-name heuristics so bounded-code routing doesn't require a literal file path in the subject. Traces directly to task #21005's root-cause finding.
- `skills/whop-sales/lib/lead-source.ts` + `reclassify-existing-leads.ts` + `fixture-give3x-wiring.ts`, `src/web.ts`, `skills/arc-catalog/cli.ts` (c7a476e2) — 4-lens dev-council review (kleppmann/newman/hohpe/fowler) found and fixed: a confirmed-high data-loss bug (SQLite `consumed_at` committed durably while the paired in-memory lead-store increment was discarded when both channels were down), a reintroduced torn-file write hazard (hand-rolled read/write instead of the canonical atomic `loadLeadStore`/`saveLeadStore`), a fixture missing an `import.meta.main` guard, and a live regression from an un-anchored regex matching a substring after a prior commit removed the config key it used to uniquely match. All four are the kind of finding a single-reviewer pass tends to miss — good use of a structured multi-lens council on a batch of new code.
- `skills/social-engine/research-input-loop.ts` (new) + `reply-watchlist-sensor.ts` + `social-x-ecosystem/sensor.ts` (24c87a3b) — New P5 script derives X handles from research-corpus consumption frequency (source_url frontmatter, not model recall), folds into `social_accounts` idempotently without auto-following. Reply-watchlist discovery now orders by `consecutive_403_count` ASC, prioritizing clean targets. Both are conservative, idempotent, ramped changes with a clear provenance trail (frontmatter-derived, not guessed).
- `skills/arc-attribution/*` + `src/follower-cache.ts` (b3a3f7b2, af29b329) — New skill born with two self-inflicted hiccups in the same session: missing SKILL.md frontmatter blocked the lint guard, then a file move (`lib/follower-cache.ts` → `src/follower-cache.ts`, made a cross-cutting cache shared with `skills/whop/lib/events.ts`) left the new path untracked so the syntax guard failed on the deleted old path. Both fixed same-cycle; the second is now a documented pattern (`memory/shared/entries/file-move-untracked-syntax-guard-failure.md`, task #21033) — a real, generalizable gotcha (git-move vs edit-in-place under the syntax guard), correctly captured instead of just patched. The `src/follower-cache.ts` placement itself is justified: a genuine 2-skill cross-cutting dependency, not scope creep into `src/`.
- `skills/arc-skill-manager/cli.ts` + `skills/arc-architecture-review/cli.ts` (359b161c) — Adds `lintNameReferences`, grep-verifying `skills run --name X` references in SKILL.md/AGENT.md/cli.ts against the installed skill tree at lint time. This is the direct fix for the **[NEW-WATCH]** flagged in the last two audits ("rename/doc-fix commits should grep the full repo for the old name before committing") — closes it with a mechanism instead of relying on the next reviewer's vigilance. Also swept ~280 pre-existing stale name refs across ~65 files in the same cycle (`c44ee67f`) with each mapping manually verified against actual CLI ownership before renaming — pure mechanical doc fix, zero behavior change, correctly not treated as a code-review-worthy diff.
- `skills/arc-article-pipeline/{cli.ts,sensor.ts,SKILL.md}` (c50c616a) — Fixed un-anchored rsync `--exclude=dist` matching `node_modules/astro/dist` (nested false match breaking the isolated preview build); also made article-claim resumable after a stage fails post-claim but pre-finalize, instead of permanently blocking retries. Straightforward bug fix, correctly scoped.

### Steps 1–5

- **Step 1 — Requirements**: Every substantive change traces to a named incident, a confirmed council finding, or a previous audit's own flag (classifier adoption gap #21005, dispatch-lock vuln doc, prior audit's rename-drift NEW-WATCH). No speculative work found in this diff.
- **Step 2 — Delete**: `49dba111` removed the dead `WHOP_SENSOR_ENABLED` blog-chat lane — confirmed dead, correctly removed. No further deletion candidates surfaced.
- **Step 3 — Simplify**: The `lintNameReferences` mechanism (359b161c) is the clean version of Step 3 applied to a *process* gap, not just code — turning a recurring manual-review finding into an automated check is exactly the right response to a flag repeating across cycles.
- **Step 4 — Accelerate**: The dispatch-lock TTL fallback removes a class of silent unbounded hang from the hottest path (dispatch pre-flight) — direct throughput protection.
- **Step 5 — Automate**: `lintNameReferences` is the automation candidate this cycle — see Step 3.

### Flags

- **[RESOLVED]** Rename/doc-drift NEW-WATCH (flagged 2026-07-03T14:35 and 2026-07-03T02:36 audits) — closed by `lintNameReferences` (359b161c) landing as a pre-commit-time grep check rather than reviewer memory. Dropping from active flags.
- **[NEW-WATCH]** Watch report 2026-07-04T01:02:40Z (515ddc29) flags the X dual-tweet-cap confusion (`arc budget` CLI shows the root-only 3/day figure; the real shared gate is 6/day) has now blocked thread continuations twice (#20988, #21022) since being noted in memory 2026-07-03 as a documentation-only fix. Recurring despite being flagged — worth a real code fix (surface the actual shared cap in the budget CLI output) rather than a third retrospective note. Filing a follow-up.
- **[CARRY-WATCH]** Cross-skill DB read: `arc-workflows/sensor.ts` queries `x_post_log` inline — extract to `src/db.ts countXPostsToday()`. Unchanged this cycle.
- **[CARRY-WATCH]** context-review skip list ~20 entries — refactor into declarative `{pattern, reason}[]` array. Not touched this cycle.
- **[NEW-WATCH]** This diff range (8158acd..d1ac13f) included the prior review's own commit (dd1bfd8d) inside its boundaries — the "since last review" pointer appears to be set to the commit *before* the previous review's own audit-log/state-machine update, not the commit *of* that update. Harmless here (dd1bfd8d was docs-only, already reflected in the prior audit-log entry, no double-counted findings), but if a future review's own commit touched `src/` this could cause the next review to re-analyze it as "new." Worth a quick check of how the sensor computes the diff range's `from` boundary.

---

## 2026-07-03T14:35:00.000Z — CADENCE.md beat-type doc drift fixed; reply-eligibility guard documented; AGENT.md self-reference cleanup completed; 126 skills / 83 sensors

**Task #20938** | Diff: 998527d..8158acd (4 commits — 0 src/, 4 skills/) | Sensors: 83 | Skills: 126

### Changed files

- `skills/whop-sales/SKILL.md` (402a5991) — Documents the `reply_target_stale` check (surfaced by `refresh-leads` since 610c92dc) as REQUIRED reading before hand-authoring any reply-based follow-up task. The automated pitch lane already reframes stale-target candidates (previous cycle); this closes the same gap for manually-authored tasks, prompted by #20858 queuing a reply against a 20-day-stale tweet.
- `skills/social-x-posting/CADENCE.md` (f7c320cd) — Fixed doc drift: documented `hot-topic` as a live rotation beat when `sensor.ts` retired it 2026-06-14 and never backfilled the row. `blog-snippet` (P16, priority beat outside the random rotation) is the actual mechanism carrying "coordinate with latest blog post" now. Doc-only, no behavior change.
- `skills/arc-architecture-review/AGENT.md` + `SKILL.md` (b7dd314f) — Partial fix for the `--name architect` vs `--name arc-architecture-review` doc-drift flagged in the previous audit (2026-07-03T02:36:00.000Z entry): corrected the 3 CLI-example lines in SKILL.md and the "CLI Commands" section of AGENT.md, but missed 2 more occurrences inside AGENT.md's own step instructions (line 15 "DO NOT read state-machine.md" note, line 51 diagram-regeneration step) — same wrong skill name would have broken the very next review cycle's own instructions. Fixed directly this cycle (not deferred to a follow-up, since it's a 2-line self-referential correction inside the file this review's instructions come from).

### Steps 1–5

- **Step 1 — Requirements**: All changes trace to named incidents (#20858 stale-reply task) or doc-drift caught by a previous audit (architect skill name). No speculative work.
- **Step 2 — Delete**: No candidates found in this diff.
- **Step 3 — Simplify**: N/A — pure doc-accuracy fixes this cycle, no code duplication introduced or removed.
- **Step 4 — Accelerate**: N/A this cycle.
- **Step 5 — Automate**: Worth flagging as a NEW-WATCH: this is the second cycle in a row where a "fix all references to X" commit missed instances (INDEX.md orphan-check duplication caught last cycle was a different pattern, but same root cause — a doc/code rename that isn't grep-verified before commit). Consider a pre-commit or CLI check that greps for the old skill/function name across the whole repo after any rename, not just the files intentionally touched.

No structural or context-delivery concerns found this cycle — diff was entirely docs, zero `src/` changes.

### Flags

- **[NEW-WATCH]** Rename/doc-fix commits should grep the full repo for the old name before committing, not just the files the author remembered to touch — this is the second near-miss (architect skill name partially fixed, INDEX.md check duplicated) in two cycles.
- **[CARRY-WATCH]** `isOrphanedSharedEntry`-shape check duplicated in `skills/arc-housekeeping/sensor.ts` and `skills/arc-memory/cli.ts`. Extract to shared helper if a third check point appears.
- **[CARRY-WATCH]** Cross-skill DB read: `arc-workflows/sensor.ts` queries `x_post_log` inline — extract to `src/db.ts countXPostsToday()`.
- **[CARRY-WATCH]** context-review skip list ~20 entries — refactor into declarative `{pattern, reason}[]` array.

---
