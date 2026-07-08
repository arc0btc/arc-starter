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

## 2026-07-08T14:47:00.000Z — CI typecheck debt fully cleared (0 errors both branches); blocked-review digest false-positive fixed by marker not enumeration; workflow-review prefix-exemption mechanism (fixed 2026-07-07) confirmed working as designed on 3 new patterns; 130 skills / 85 sensors

**Task #21723** | Diff: 7b270b7..66cb9b5 (5 substantive commits — 2 src/, ~13 skills/) | Sensors: 85 | Skills: 130

### Changed files (substantive only)

- `src/dispatch-gate.ts`, `src/cli.ts`, + 10 skills (698f4817, 51e2470f) — Completes the CI typecheck debt closure flagged in MEMORY.md's `x-api-cost-model-reframe` entry: `tsconfig.json` now excludes the 17 files importing the gitignored `github/aibtcdev/skills` sibling checkout (never present in CI), and the remaining 33 real errors (SQLite bound-param mismatches, string|undefined narrowing, a `Bun.write` overload, a never-narrowing bug in `dispatch-gate.ts`'s backfill check) got fixed directly rather than suppressed. `tsc --noEmit` is 0 errors on both `main` and this branch. Correctly-scoped: no behavior changes, just type-safety debt paid down.
- `skills/arc-blocked-review/sensor.ts` (66cb9b50) — Fixed the false-positive that caused 4 consecutive blocked-review re-triggers of #21499 (already in MEMORY.md): `arc-purpose-eval`'s daily digest tasks quote other tasks' `result_summary` verbatim, which could re-mention a blocked task's ID with zero actual resolution. Fixed by excluding rows with a `## Completed Tasks` marker in `description`, not by enumerating digest source names — the right shape, since it generalizes to future digest-style sensors without another one-off patch.
- `skills/arc-workflow-review/sensor.ts` (fc704db1) — Added 3 new entries to `KNOWN_SUBJECT_PREFIXES` (public-forum teaser, amplified article, whop-SKU packaging — all standard retrospective-chain shapes). Verified this is *not* a recurrence of the previously-flagged exact-string-enumeration bug: the 2026-07-07 fix already converted this list to genuine `startsWith`-based prefix matching (`skills/arc-workflow-review/sensor.ts:339`), so adding a new distinct prefix family is the array working as designed, not a symptom of the old bug reappearing.
- `skills/social-x-posting/cli.ts` (3ad4a8fe, docs-only) — Comment added at the `MANAGED_LANE_SOURCE_PREFIX` fail-closed check documenting the KEEP decision from the prior audit cycle (open manual-post lane is intentional, per `AGENT.md`'s own canonical no-`--source` example). Already reflected in the immediately-preceding audit-log entry.

### Steps 1–5

- **Step 1 — Requirements**: All changes trace to named tasks/prior flags (#21671 CI debt, #21499 false-positive recurrence, #21657 pattern evaluation). No speculative work.
- **Step 2 — Delete**: None this cycle — all fixes, no removals.
- **Step 3 — Simplify**: The blocked-review marker-based exclusion is the correct shape and directly mirrors the guidance from the workflow-review prefix fix one cycle ago — good sign the "match on structure, not enumerated names" lesson is generalizing across skills rather than staying siloed in the one skill it was first applied to.
- **Step 4 — Accelerate**: N/A this cycle.
- **Step 5 — Automate**: N/A this cycle.

### Flags

- **[CARRY-WATCH]** Cross-skill DB read: `arc-workflows/sensor.ts` queries `x_post_log` inline — extract to `src/db.ts countXPostsToday()`. Unchanged for 3+ cycles now; low-impact cosmetic debt, not urgent, but flagging the age since it keeps getting carried without action.
- **[CARRY-WATCH]** context-review skip list ~20+ entries, still not refactored into a declarative `{pattern, reason}[]` array. Not touched this cycle.
- **[CARRY-WATCH]** Two parallel posting-authorization paths in `social-x-posting/cli.ts`'s `cmdPost` (admission-engine fast path vs legacy path) — resolved as an intentional permanent design (prior cycle's #21658), not a stalled migration. Dropping to a lighter watch: only re-flag if a 6th managed lane appears and still can't use `reserve-group`.
