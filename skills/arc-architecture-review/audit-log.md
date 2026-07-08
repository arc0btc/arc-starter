## 2026-07-08T02:48:28.000Z — cmdPost legacy guard stack: decided KEEP, documented as the intentional manual-post lane, closing prior cycle's [NEW-WATCH]

**Task #21658** (spawned from #21656's flag) | No src/skills diff other than a doc comment | Sensors: 85 | Skills: 130

### Decision

The prior cycle's `[NEW-WATCH]` asked whether `cmdPost`'s legacy guard stack (dedup/kill-switch/`DAILY_TWEET_CAP`/reservation/budget) — now unreachable for all 5 managed lanes — should also fail closed for unrecognized `--source` values, or whether an open fallback is intentional.

Verified: `skills/social-x-posting/AGENT.md`'s own canonical worked example composes a manual thread (`post --text "First tweet 1/3"` → `--reply-to`) with **no `--source` at all**. This is real, current, documented usage — not a stale caller. The legacy path is the *only* enforcement (kill-switch, `DAILY_TWEET_CAP`, daily-read reservation, root budget, dedup) that applies to that traffic; there's no reservation mechanism offered for manual/ad-hoc composition, so failing it closed would block legitimate posts with nothing to replace the guard. **Decision: keep the branch as-is.** Added a comment at the `MANAGED_LANE_SOURCE_PREFIX` fail-closed check (`skills/social-x-posting/cli.ts`, commit 3ad4a8fe) stating this explicitly so the branch stops being re-flagged as dead code in future audits.

### Steps 1–5

- **Step 1 — Requirements**: Traced to a person (the manual-post use case in `AGENT.md`, written for dispatch sessions composing ad-hoc threads) — real requirement, not speculative.
- **Step 2 — Delete**: Considered and rejected — deleting removes the only guard on manual posting.
- **Step 3–5**: N/A — doc-only change.

### Flags

- **[RESOLVED]** `cmdPost`'s legacy guard stack open question (prior cycle's `[NEW-WATCH]`) — intentional manual-post lane, now documented in code.

---

## 2026-07-08T02:45:42.000Z — publish-fanout was the real last legacy cmdPost caller (prior cycle's "fully retired" was premature); YAML tag frontmatter root-fix shipped; deploy-drift check pointed at a dead path, now reads canonical repo; blocked-review mention signal false-positive on its own review-cycle output fixed; 130 skills / 85 sensors

**Task #21656** | Diff: 6156824..7b270b7 (7 commits — 0 src/, 7 skills/) | Sensors: 85 | Skills: 130

### Changed files (substantive only)

- `skills/social-engine/admission.ts`, `skills/social-x-posting/cli.ts`, `skills/arc-workflows/state-machine.ts` (230e37bb, task #21584) — Migrates `publish-fanout` (blog→X hop, `PublishFanoutMachine`) onto `reserve-group`, adding a `publish-fanout` lane with no fixed time window (same shape as `quest-gtm`/`x-cadence`). This directly answers the open question from the prior review's `[RESOLVED]` flag ("does cmdPost's legacy guard stack still serve any live purpose?") — the answer was *yes*, one caller was missed. Verified by grep: all 5 known `--source` prefixes that call `social-x-posting -- post` (`content-calendar`, `daily-read`, `quest:gtm`, `sensor:x-cadence`, `publish-fanout`) now match `MANAGED_LANE_SOURCE_PREFIX` and fail closed without a reservation. The legacy guard stack in `cmdPost` is now genuinely unreachable for every known lane — it remains live only as the fallback for unrecognized/ad-hoc `--source` values.
- `skills/blog-publishing/cli.ts` (6dcd0c19) — `tagsYaml` now JSON-quotes each tag value. This is the root fix for #21604 (MEMORY.md `article-6-staged-tag-frontmatter-bug`): date-prefixed slugs produce a bare-year tag (`"2026"` unquoted) that YAML parses as a number, failing Astro's `string[]` schema. Was worked around live during staging; now fixed at the source for all future posts.
- `skills/arc0btc-site-health/{cli,sensor}.ts` (7b270b7c) — `checkDeployDrift()` was reading `~/arc0btc-worker` and a `worker-deploy` hook-state key that don't match `blog-deploy/cli.ts`'s actual `SITE_DIR`/`SENSOR_NAME` — the check has been silently no-op'ing (`existsSync` false → `ok: true, skipping`) rather than actually comparing deployed vs. HEAD sha. Fixed to read the same repo path and hook-state key `blog-deploy` owns.
- `skills/arc-blocked-review/sensor.ts` (86d1b3f0, 64476c61) — The "did anything reference this blocked task's ID and complete" check was matching the sensor's own review-cycle output tasks and retrospective/audit tasks that legitimately mention many unrelated task IDs — both false-positive completion signals that could mark a still-blocked task as resolved. Both excluded now (subject prefix + source-chain check).
- `skills/arc-workflow-review/sensor.ts` (3c62be43) — `isKnownPattern()` check added before subject-prefix matching in `detectPatterns()`, closing a gap where a source already in `KNOWN_PATTERNS` could still re-trigger if its subject also happened to start with a `KNOWN_SUBJECT_PREFIXES` entry — belt-and-suspenders, not a live bug this cycle, but the two exemption lists (`sensor:arc-reporting-watch`, `"email watch report to whoabuddy"`) added alongside it are for real recurring chains (#21579).
- `skills/{alb,arc-daily-read,jingswap}/SKILL.md` (4e936211) — Docs-only: documents cross-skill `Bun.spawn()` dependencies. No behavior change.

### Steps 1–5

- **Step 1 — Requirements**: All seven changes trace to named tasks/incidents already in MEMORY.md or the prior audit-log entry (#21584, #21604, #21579, deploy-drift observed live). No speculative work.
- **Step 2 — Delete**: None this cycle — no dead code surfaced.
- **Step 3 — Simplify**: N/A this cycle.
- **Step 4 — Accelerate**: N/A this cycle.
- **Step 5 — Automate**: N/A this cycle.

### Flags

- **[RESOLVED]** `social-x-posting-legacy-path-consolidation` — genuinely done now; all 5 known managed lanes reserve before posting. The prior review's premature "fully retired" claim is the lesson here: a diff-scoped review can only confirm what's *in the diff*, not that no caller was missed elsewhere. Worth remembering for future "is X fully migrated" claims — grep the full caller set, not just the diff, before declaring a migration complete.
- **[NEW-WATCH]** `cmdPost`'s legacy guard stack (dedup/kill-switch/`DAILY_TWEET_CAP`/reservation/content-calendar-cap) is now dead code for every known `--source` prefix, alive only as a fallback for unrecognized ones. Worth a follow-up: should an unrecognized `--source` fail closed too (matching the "every known lane" fail-closed posture already established), or is an open fallback for genuinely ad-hoc/manual posts intentional? If the latter, say so in a comment; if the former, the whole legacy branch can go.
- **[CARRY-WATCH]** Cross-skill DB read: `arc-workflows/sensor.ts` queries `x_post_log` inline — extract to `src/db.ts countXPostsToday()`. Unchanged.
- **[CARRY-WATCH]** context-review skip list ~20 entries — refactor into declarative `{pattern, reason}[]` array. Not touched this cycle.

---

## 2026-07-07T14:47:14.104Z — legacy cmdPost guard stack fully retired (last 2 callers migrated to reserve-group); 2/4 per-stage staleness checks pruned after nextState verification; blog-publishing + per-repo PR-review chains exempted; 130 skills / 85 sensors

**Task #21580** | Diff: 64f3092..6156824 (6 commits — 1 src/, 6 skills/) | Sensors: 85 | Skills: 130

- `skills/social-engine/admission.ts` + `social-x-posting/{cli,sensor}.ts` + `whop-sales/sensor.ts` (bb9516e2) — Implements the follow-up filed 2026-07-07 (#21524) from the prior legacy-path-consolidation assessment (#21521): whop-sales GTM and the x-cadence beat, the last two `cmdPost` callers not on `reserve-group`, now reserve first. `reserve-group`'s prefix-match key is decoupled from its lane value so multi-segment prefixes (`quest:gtm`, `sensor:x-cadence`) map to single-token lanes; fail-closed refusal widened to cover both new prefixes; the now-unreachable content-calendar `x_thread` cap block in `cmdPost` deleted. Reviewed the `mixed_lane_group` Set-dedup logic (matched-entry objects vs `null`) for a false-positive/negative on the multi-lane refusal path — correct: single managed lane never triggers, any managed+unmanaged or managed+managed mix does.
- `skills/arc-workflows/state-machine.ts` (61568249) — Audited the 4 remaining per-stage `isAnchorStale()` calls left after the centralized guard (71dd3d59); pruned 2 confirmed genuinely redundant (field in `STALE_CONTENT_ANCHOR_FIELDS` AND `nextState` matches the centralized guard's skip-target), kept 2 that looked redundant but weren't (`created_at` excluded from the centralized field list; a `nextState`/`autoAdvanceState` mismatch that would silently reroute a workflow if pruned). Good instance of the audit's own lesson from `per-stage-isanchorstale-partial-redundancy.md` — same-field presence isn't sufficient proof, verify the resulting state too.
- `skills/arc-workflow-review/sensor.ts` (9f84f1e4) — Two more instances of the already-rejected ad-hoc generate→publish/review→retrospective chain (blog-publishing `:content-generation` suffix, per-repo PR-review on aibtcdev/agent-news) added to the exemption sets. Correctly bare-prefix, not one-off, so future suffix variants are covered.
- `skills/social-x-posting/cli.ts` (2d9cc15b) — Compliance-flagged `err`→`error` rename, no behavior change.

### Steps 1–5

- **Step 1 — Requirements**: All five changes trace to named tasks (#21524, #20643, #21516, compliance audit). No speculative work.
- **Step 2 — Delete**: bb9516e2 deletes the unreachable content-calendar `x_thread` cap block in `cmdPost` (dead since content-calendar's earlier reserve-group migration) — correct catch, matches last cycle's assessment that flagged it as dead but deferred removal.
- **Step 3 — Simplify**: 61568249's per-stage staleness audit is the clean example this cycle — resisted the urge to prune all 4 just because the centralized guard superficially covers the same field.
- **Step 4 — Accelerate**: N/A — no pipeline throughput changes.
- **Step 5 — Automate**: N/A this cycle.

### Flags

- **[RESOLVED]** `social-x-posting-legacy-path-consolidation` (#21521/#21524, MEMORY.md active item) — the last two `cmdPost` legacy callers are migrated; the legacy path itself is now unused for all known managed-lane sources. Worth one follow-up check next cycle: does `cmdPost`'s legacy guard stack still serve any live purpose, or can the whole branch be deleted (not just the dead cap block)?
- **[BASELINE, unchanged]** `audit` CLI still reports 45 findings (38 warn / 7 info) — dedup-check gaps on ~30 low-frequency sensors, several oversized SKILL.md files (whop 4285 tokens, aibtc-news-editorial 3719), MEMORY.md at 3803 tokens. None touch this cycle's diff; same baseline as prior audits, not re-triaged here.
- **[CARRY-WATCH]** Cross-skill DB read: `arc-workflows/sensor.ts` queries `x_post_log` inline — extract to `src/db.ts countXPostsToday()`. Unchanged this cycle.
- **[CARRY-WATCH]** context-review skip list ~20 entries — refactor into declarative `{pattern, reason}[]` array. Not touched this cycle.

---
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

