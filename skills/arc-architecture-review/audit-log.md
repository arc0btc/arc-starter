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

## 2026-07-03T02:36:00.000Z — shared/INDEX.md orphan-check parity; whop-sales reply-target-age guard mirrored at candidate time; 126 skills / 83 sensors

**Task #20894** | Diff: 77ff447..998527d (3 commits — 0 src/, 4 skills/) | Sensors: 83 | Skills: 126

### Changed files

- `skills/arc-housekeeping/sensor.ts` + `skills/arc-memory/cli.ts` (998527d4) — Both orphaned-shared-entry checks (sensor + `arc-memory health`) now also treat an inbound link from `memory/shared/INDEX.md` as valid, not just `MEMORY.md`. Follows the 2026-07-02 move of the Shared Entries Index out of MEMORY.md (task #20868) — without this, every entry only indexed in INDEX.md would false-positive as orphaned. Correct fix, but landed as two independently-maintained copies of the same `hasIndex` check (sensor.ts and cli.ts) — same duplication shape flagged previously for `arc-failure-triage`'s `ERROR_PATTERNS` (resolved 2026-07-01 by extracting to shared `patterns.ts`). Small today (one boolean expression), but worth extracting to a shared `isOrphanedSharedEntry()` helper before a third copy appears or the check drifts.
- `skills/whop-sales/cli.ts` + `skills/whop-sales/sensor.ts` (610c92dc) — `refresh-leads` candidates now carry `reply_target_at`/`reply_target_stale`, computed by mirroring the X reply lane's target-age guard (default 48h, `agent_config` override) at candidate-surfacing time. `buildPitchTask` reframes stale-X-reply candidates into a fresh standalone-post outreach instead of queuing a reply-to-tweet follow-up that reply-send would reject as `stale_target`. This is the exact fix flagged as the "Next" action in MEMORY.md's `whop-wedge` entry (task #20860, root-caused by #20858's endlessdomains ~20d-old tweet) — closes a real top-of-funnel gap, not speculative hardening.

### Steps 1–5

- **Step 1 — Requirements**: Both changes trace to named incidents (#20868 INDEX.md migration, #20858/#20860 stale-target rejection) — no speculative work.
- **Step 2 — Delete**: No candidates found in this diff.
- **Step 3 — Simplify**: The INDEX.md check duplication (sensor.ts + cli.ts) is a small instance of the same anti-pattern already fixed once for failure-triage — flagging now while it's cheap to fix (see Changed files above and new Flag below).
- **Step 4 — Accelerate**: whop-sales fix removes a guaranteed-to-fail step from the pipeline (candidate → pitch task → blocked send) — catches the failure one stage earlier, at candidate time instead of send time.
- **Step 5 — Automate**: N/A this cycle.

Also noticed while running this review: this skill's own AGENT.md documents its CLI as `arc skills run --name architect -- diagram`, but the actual skill name (directory + registered name) is `arc-architecture-review` — `--name architect` fails with "skill not found". Filing a doc-fix follow-up.

### Flags

- **[NEW-WATCH]** `isOrphanedSharedEntry`-shape check now duplicated in `skills/arc-housekeeping/sensor.ts` and `skills/arc-memory/cli.ts` (both check `MEMORY.md` OR `shared/INDEX.md` for an inbound link). Same drift risk as the failure-triage `ERROR_PATTERNS` split (fixed 2026-07-01). Extract to one shared helper if a third check point appears, or preemptively if either file changes again.
- **[RESOLVED]** `cache_hit_rate` mislabel — `src/cli.ts:140` already shows `accept_rate (7d)`, correctly computed. This carry-flag was stale (no pending/completed task found for it either) — dropping it from active flags.
- **[CARRY-WATCH]** Cross-skill DB read: `arc-workflows/sensor.ts` queries `x_post_log` inline — extract to `src/db.ts countXPostsToday()`.
- **[CARRY-WATCH]** context-review skip list ~20 entries — refactor into declarative `{pattern, reason}[]` array.

---

## 2026-07-02T14:40:00.000Z — dead-skill pruning sweep (7 deleted); doc fix; 126 skills / 83 sensors

**Task #20834** | Diff: 095a444..77ff447 (8 commits — 0 src/, 8 skills/) | Sensors: 83 | Skills: 126 (down from 133)

### Changed files

- Seven skills deleted, all confirmed zero-reference before removal: `stacking-delegation` (76d stale), `contract-preflight` (77d stale, no sensor), `code-audit` (37d stale, subsumed by `/code-review`), `defi-portfolio-scanner` (77d stale, no sensor), `hodlmm-risk` (95d stale, non-standard layout), `zest-auto-repay` (77d stale, non-standard layout), `arc0btc-email-worker` (34d stale, SKILL.md-only scaffold, pending upstream issue #2).
- `skills/arc-email-sync/SKILL.md` (db808515) — fixed CLI examples using wrong skill name (`--name email` → `--name arc-email-sync`); caught live during task #20782's watch report send.

### Steps 1–5

- **Step 1 — Requirements**: All 7 deletions trace to a concrete staleness signal (34–95 days unused, zero live references) rather than speculative pruning. This is Step 2 (Delete) already applied by a prior cycle — this review's job was to verify the deletions were clean, which they are: `grep -rl` across `src/` and `skills/` for all 7 deleted skill names returns zero live references (only the historical mention in `audit-log.archive.md`, expected).
- **Step 2 — Delete**: Confirmed clean — this cycle's diff *is* the delete step for 7 skills. No further deletion candidates surfaced.
- **Step 3 — Simplify**: N/A — no code restructuring this diff, just removal + one doc typo fix.
- **Step 4 — Accelerate**: Marginal — 126 vs 133 skills is a small reduction in `arc skills` list size and skill-tree audit surface, no measurable pipeline change.
- **Step 5 — Automate**: N/A this cycle.

No structural or context-delivery concerns found. This is the cleanest possible diff type for an architecture review — pure subtraction, pre-verified reference-free.

### Flags

- **[CARRY-FLAG] `cache_hit_rate` mislabel**: `src/cli.ts` shows `cache_hit_rate (7d)` but computes accept_rate. Rename to `accept_rate (7d)`. Carried 6 cycles now across multiple audits with no fix task filed — queuing one this cycle.
- **[CARRY-WATCH]** Cross-skill DB read: `arc-workflows/sensor.ts` queries `x_post_log` inline — extract to `src/db.ts countXPostsToday()`.
- **[CARRY-WATCH]** context-review skip list ~20 entries — refactor into declarative `{pattern, reason}[]` array.
- **[CARRY-WATCH]** X_THREAD_CHAINING_ENABLED re-enable (2026-07-01, flagged 2026-07-02 #20773) — per MEMORY.md, escalation #20820 already covers the whop-chat sign-off gap; X chaining itself has no new signal this cycle (still short of the "clean week" window, no new lock observed).

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
