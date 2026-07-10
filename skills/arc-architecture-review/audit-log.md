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

---

## 2026-07-09T02:48:00.000Z — arc-day-n-publishing P1-P5 landed (new Day-N producer, subscriber email, moltbook mirror, canonical src-tag registry); Whop chat got a dev-council-reviewed injection-defense layer; worker-deploy sensor disabled (wrong checkout); 130 skills / 85 sensors

**Task #21776** | Diff: 66cb9b5..9ba7679 (19 commits — 1 src/, ~25 skills/) | Sensors: 85 | Skills: 130

### Changed files (substantive only)

- `skills/whop/lib/chat-sanitizer.ts` (new) + `skills/whop/sensor.ts` + `skills/whop/AGENT.md` (new) + `src/db.ts` — Whop chat member text was the last major untrusted-content lane with no code-level guard (only email/aibtc-inbox/peer-inbox had doc-only guards, per the 2026-07-06 security audit which didn't even inventory Whop chat). New module runs a labeled injection-pattern battery plus structural fence-wrapping (normalizing invisible chars + backtick homoglyphs before computing fence length) across all THREE Whop ingestion lanes (reply, synthesis, free-forum digest) and the persistent relationship store — the design went through a 5-lens dev-council review before wiring, and the module's own header honestly discloses what it does NOT cover (novel paraphrases with no keyword overlap, unlisted Unicode confusables) rather than overclaiming safety. `src/db.ts`'s `UNTRUSTED_CONTENT_SOURCE_PREFIXES` gained one `"sensor:whop"` entry (prefix match) instead of enumerating the three sub-sources separately — correct shape, avoids the exact enumeration-gap class this list exists to prevent. Good example of security work sized to disclosed risk rather than either skipping the gap or overbuilding a general solution.
- `skills/arc-daily-read/{cli.ts,lib/edition-metrics.ts,subscriber-email.ts}` + `skills/arc-workflows/{blog-render.ts,state-machine.ts,sensor.ts}` + `skills/arc-attribution/lib/src-tags.ts` (new) + `skills/social-engine/{moltbook-client.ts,moltbook-mirror-post.ts,quote-trigger-detect.ts}` — The arc-day-n-publishing quest (P1-P5): a merged Day-N producer, a gated (`DAYN_EMAIL_ENABLED`, off by default) real subscriber-list email path via `mail.arc0.me`, a Moltbook mirror-post lane, and a canonical `?src=` tag registry (`src-tags.ts`) collapsing 3 previously-independent copies of the same `url.includes("?") ? "&" : "?"` pattern into one formatter. `blog-render.ts`'s `buildBlogPublishTask` is now the single shared task-descriptor builder used by both the merged producer and `ContentCalendarMachine`'s blog-publish hop — extract-and-reuse instead of two copies drifting. Every new tag/toggle is single-value + instantly reversible (`agent_config` rows), matches the project's existing rollback convention.
- `skills/arc-workflows/state-machine.ts` (`paidRoomSeedingPaused`) — A `PAID_ROOM_SEEDING_PAUSED` gate added ahead of 4 `ContentCalendarMachine` hops (whop-chat-seed, X-thread's $49-CTA chaining branch, whop-forum-thread, public-forum-teaser) while an organic paid-room member doesn't yet exist. Each gated hop `transition`s to its normal next state rather than `noop`-ing, so downstream (non-paid) hops stay on schedule once the pause lifts — correct choice, avoids a stuck state machine.
- `skills/worker-deploy/sensor.ts` — Disabled: this sensor targets `~/arc0btc-worker`, a checkout proven (via CF Workers API deployment metadata — binding mismatch) to NOT be the live `arc0btc.com` deployment. A future commit landing there would have silently overwritten the actual live worker with 4-month-stale code. Correct fail-safe: disable now, don't guess which checkout to point at instead.
- `skills/arc-blocked-review/sensor.ts` — Adds a 48h per-task cooldown for signal-only (no stale-reason) re-review candidates, closing the #21499 5-consecutive-false-positive churn (the digest-marker fix from the prior cycle narrowed one variant but plain-prose mentions still matched). Matches this skill's now-recurring pattern: structural fix (cooldown by task, not by source name) over another one-off exemption.

### Steps 1–5

- **Step 1 — Requirements**: Every change traces to a named quest doc (`arc-day-n-publishing`, `arc-storefront-revamp`), a dev-council review record, or a named incident (#21499 churn, worker-deploy binding mismatch). No speculative work.
- **Step 2 — Delete**: `worker-deploy` sensor's live body is now dead code behind an early return rather than deleted outright — reversible-by-design (a future consolidation may re-arm it), acceptable given the explicit disable comment, but worth a light watch: if the two worker checkouts are never consolidated, this becomes permanent dead weight that should eventually be deleted rather than left disabled.
- **Step 3 — Simplify**: `src-tags.ts` and `blog-render.ts`'s shared task builder are both good Step-3 moves — collapsing duplicated logic that had already drifted (3 independent `?src=` implementations) into one call site each.
- **Step 4 — Accelerate**: N/A this cycle.
- **Step 5 — Automate**: The Day-N subscriber email is real new automation (real subscriber list, not a test), but it's gated off by default behind `DAYN_EMAIL_ENABLED` pending a careful-verify rollout — automate-last-and-gated is the right order here, not automate-first.

### Flags

- **[NEW-WATCH]** `worker-deploy/sensor.ts`'s disabled body: revisit once the `~/arc0btc-worker` vs `~/arc-starter/github/arc0btc/arc0btc-worker` checkout duplication is resolved — either re-arm pointed at the right checkout or delete the dead sensor body outright instead of leaving it disabled indefinitely.
- **[CARRY-WATCH]** Cross-skill DB read: `arc-workflows/sensor.ts` queries `x_post_log` inline — extract to `src/db.ts countXPostsToday()`. Unchanged for 4+ cycles now.
- **[CARRY-WATCH]** context-review skip list ~20+ entries, still not refactored into a declarative `{pattern, reason}[]` array. Not touched this cycle.
- **[RESOLVED]** Two parallel posting-authorization paths in `social-x-posting/cli.ts` — confirmed intentional design, dropped from watch last cycle; no new activity this cycle either.

---

## 2026-07-09T14:49:00.000Z — quiet cycle: admin recovery command, mainnet-address regex over-strictness fix, deploy-hold opt-in staging convention, all small and self-contained; 130 skills / 85 sensors

**Task #21847** | Diff: 9ba7679..64271ec (5 substantive commits — 0 src/, 5 skills/) | Sensors: 85 | Skills: 130

### Changed files (substantive only)

- `skills/arc-daily-read/cli.ts` (2c9c231c, 64271ec) — Two-part fix: `cmdPost` was importing `insertTaskDeduped` from `src/db.ts` without calling that module's own `initDatabase()` first (its singleton is separate from `cli.ts`'s own DB connection), crashing *after* posting had already succeeded and silently dropping the blog-publish queue step (#21827). Root cause fixed, then a `queue-blog-task --edition N` admin recovery command added to backfill the one edition (5) that crashed before the fix landed — mirrors `cmdPost`'s own blog-queue logic against the already-logged row, same `blog_slug`-is-null guard so it's safe to re-run. Correctly scoped: fix the bug, then provide recovery for the damage already done, not more.
- `skills/bitcoin-wallet/stx-send-runner.ts` (a90c753e) — Mainnet address regex relaxed from an exact `{39}` length match to `{1,}` after a real, checksum-valid mainnet address (`SP1PMPPVCMVW96FSWFV30KJQ4MNBMZ8MRWR3JWQ7`, 38 c32 chars) was rejected mid-operator-signed STX top-up. Correct fix: `validateStacksAddress()` upstream already checksum-validates via c32check, so this regex only needs to discriminate mainnet `SP` from testnet/mocknet prefixes, not re-derive length — length variability is expected (leading zero bytes in the underlying hash), same phenomenon as variable-length Base58Check. Good instance of a bug found live rather than in a test, with the fix scoped to what broke (prefix check) not padded with extra validation.
- `skills/blog-deploy/{SKILL.md,sensor.ts}` (46502780) — New opt-in `.deploy-hold` marker file convention: presence of `github/arc0btc/arc0me-site/.deploy-hold` makes the sensor skip queuing a deploy no matter how many commits land, until an operator removes it. Closes a real gap (`C-P7-1`) that silently defeated the "prod site-flip is a hard gate, never auto-approved" rule twice already (arc-storefront-revamp P3, arc-day-n-publishing P2) because neither quest's authors knew commit-to-main was an unconditional 5-minute auto-deploy with no way to stage. Default behavior (no hold file) is unchanged — deliberately opt-in, not a global switch, so routine blog publishing isn't affected. Also documents that `wrangler deploy` bundles the whole checkout, so uncommitted edits sitting in the tree during an unrelated deploy ship as a side effect — a sharp, correctly-flagged gotcha for anyone touching that checkout mid-quest.
- `skills/arc-workflow-review/sensor.ts` (074ea656) — One more `KNOWN_PATTERNS` bare-prefix entry (`sensor:arc-blocked-review`) for the same already-rejected ad-hoc retrospective-chain shape. Consistent with the established pattern of adding bare source-prefix entries rather than one-off subject matches.
- `skills/whop/cli.ts` (afd9a0ca) — Compliance rename (`msg` → `errorMessage`), no behavior change. `skills/arc-skill-manager/SKILL.md` (1d70ab25) — docs-only reframe of `disallowed-tools`, already reflected in MEMORY.md's `disallowed-tools-not-enforced` entry.

### Steps 1–5

- **Step 1 — Requirements**: All five changes trace to named incidents (#21827 crash, live STX top-up rejection, C-P7-1 quest finding) or standing compliance rules. No speculative work.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: The mainnet-regex fix is a good example of trusting an existing validator (`validateStacksAddress`'s checksum check) instead of re-deriving a property (length) that validator already guarantees correctness for — removes redundant, incorrect logic rather than patching around it.
- **Step 4 — Accelerate**: N/A this cycle.
- **Step 5 — Automate**: N/A this cycle — the deploy-hold convention is a manual opt-in gate, deliberately not automated further (matches the project's "gate first, automate later" posture).

### Flags

- **[CARRY-WATCH]** Cross-skill DB read: `arc-workflows/sensor.ts` queries `x_post_log` inline — extract to `src/db.ts countXPostsToday()`. Unchanged for 5+ cycles now — still low-impact, but this is the longest-carried watch item; worth a bounded follow-up task rather than continuing to carry it indefinitely.
- **[CARRY-WATCH]** context-review skip list ~20+ entries, still not refactored into a declarative `{pattern, reason}[]` array. Not touched this cycle.
- **[NEW-WATCH]** `blog-deploy`'s new `.deploy-hold` file is unenforced convention (a sensor check, not a lock) — nothing stops a second concurrent process or a forgetful future quest from deploying anyway via a different path (e.g. running `arc skills run --name blog-deploy -- deploy` directly). Fine for now given it's a single-operator system, but if a second deploy trigger path is ever added, the hold check needs to live there too, not just in the sensor.

## 2026-07-10T02:52:00.000Z — smallest diff on record: read-only drift-detection sensor closing the self-upgrade paradox gap, new cost-breakdown CLI, one already-known Whop field-limit fix landed in code; 131 skills / 86 sensors

**Task #21911** | Diff: 64271ec..0459eb9 (3 commits — 1 src/, 2 skills/) | Sensors: 86 | Skills: 131

### Changed files (substantive only)

- `skills/claude-cli-drift-watch/{SKILL.md,sensor.ts}` (new, 0459eb9) — Closes the blind spot found in #21901-#21905 (installed CLI 32 versions behind npm latest, no earlier warning) without re-triggering the self-upgrade task-queue paradox from #21905: reports drift only (`claude --version` vs npm registry `latest`, semver score-delta, 30-day cadence, threshold 5), never attempts a binary swap. Correctly scoped as comparison-only — matches the project's established pattern of separating detection sensors from action tasks when the action itself is unsafe to run from inside a dispatch subprocess.
- `src/cli.ts` (`arc tasks cost`, fc733314) — New `--days`/`--top` cost-breakdown command (by task, by model, by skill-set), filed by the prior cycle's cost-efficiency review (#21889) which found no CLI existed to check sonnet→haiku downgrade candidates against. Reuses the same `tasks` table columns (`cost_usd`, `api_cost_usd`, `tokens_in`/`tokens_out`) the existing `arc-cost-reporting` sensor SQL already aggregates — same shape as `arc status`'s existing cost surface, just windowed and top-N'd.
- `skills/arc-packaging/cli.ts` (c63230ca) — Adds `title` (80-char) and `description` (1500-char) length checks to `validateDraft()`, alongside the existing `headline` check. Both limits were hit live (title #21874, description #21744 — the latter was already documented in SKILL.md but never actually landed in code) as raw Whop 400/422s *after* `create-product` had already run. Straightforward: move a known external constraint from prose into a pre-flight check.

### Steps 1–5

- **Step 1 — Requirements**: All three changes trace to named incidents (#21901-05 drift discovery, #21889 cost-review tooling gap, #21874/#21744 live Whop rejections). No speculative work.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: N/A this cycle.
- **Step 4 — Accelerate**: N/A this cycle.
- **Step 5 — Automate**: N/A — the drift sensor is deliberately detection-only, not an upgrade automation; correct order given the self-upgrade paradox isn't solved yet.

### Flags

- **[CARRY-WATCH]** Cross-skill DB read: `arc-workflows/sensor.ts` queries `x_post_log` inline — extract to `src/db.ts countXPostsToday()`. Unchanged for 6+ cycles now — this is the longest-carried watch item on record; recommend a bounded follow-up task next cycle rather than continuing to carry it.
- **[CARRY-WATCH]** context-review skip list ~20+ entries, still not refactored into a declarative `{pattern, reason}[]` array. Not touched this cycle.
- **[RESOLVED]** `blog-deploy`'s `.deploy-hold` enforcement-gap watch from last cycle — no second deploy trigger path has been added since; nothing to act on yet, dropping from active watch until one is.

---

## 2026-07-10T20:27:00.000Z — smallest substantive diff on record: longest-carried watch item finally resolved, plus one workflow-review exemption and one daily-read pre-flight command; 131 skills / 86 sensors

**Task #21966** | Diff: 0459eb9..b9d5ca4 (5 commits — 1 src/, 4 skills/; 2 data-sync-only) | Sensors: 86 | Skills: 131

### Changed files (substantive only)

- `skills/arc-workflows/sensor.ts` + `src/db.ts` (7fc6536c) — Extracts the inline `x_post_log` cap-check SQL into a new `countXPostsToday(sourceLikePattern)` helper in `src/db.ts`, matching the existing `count*Today()` helper family. This is the **[CARRY-WATCH]** item that has been carried unresolved for 6+ consecutive review cycles — closing it here, dropping from active watch.
- `skills/arc-workflow-review/sensor.ts` (d0faf8cc) — Two more bare-prefix `KNOWN_PATTERNS` entries (`sensor:arc-article-pipeline`, `sensor:arc-catalog`) for the same already-rejected generic-retrospective-chain shape, this time surfacing via source-grouping rather than subject-grouping. Consistent with the established pattern (no new state machine, no enumeration of subject variants).
- `skills/arc-daily-read/{cli.ts,SKILL.md}` (b9d5ca47) — New `validate-draft --voice-file <path>` command: a cheap char-count-only pre-flight the drafting turn can run before `post`, catching an oversize tweet (edition 6, #21950, 278/240 chars) while there's still room to trim instead of falling to the 1-tweet NEVER-SKIP fallback and losing the finding. Deliberately scoped to only the char-count gate, not the full `composeBeat` validation — the one failure mode that's cheap to self-correct.
- `skills/arc-link-research/cache/*.json` (bc338170) + `skills/arc-article-pipeline/drafts/article-4-x-article.json` (7ea3eaf2) — data-sync-only, no logic change.

### Steps 1–5

- **Step 1 — Requirements**: All three substantive changes trace to named items — a 6-cycle-old audit-log watch, task #21912's pattern-detection gap, and a live edition-6 posting failure (#21950). No speculative work.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: The `countXPostsToday()` extraction is the textbook Step-3 move this framework has been asking for since 2026-07-04 — one parameterized helper replaces an inline query that would otherwise drift further from the `count*Today()` family each time a new cap check was added elsewhere.
- **Step 4 — Accelerate**: N/A this cycle.
- **Step 5 — Automate**: N/A this cycle — `validate-draft` is a manual pre-flight step the drafting turn must remember to run, not wired as an automatic gate before `post`. Worth a light watch (below).

### Flags

- **[RESOLVED]** Cross-skill DB read (`arc-workflows/sensor.ts` → `countXPostsToday()`) — the longest-carried watch item on record (6+ cycles) is closed. Dropping from active watch.
- **[NEW-WATCH]** `validate-draft` is opt-in and unenforced — nothing stops a future drafting turn from skipping straight to `post` and hitting the same oversize-tweet fallback again. Low priority: it's a cheap, fast command and the cost of forgetting it is graceful (fallback to 1-tweet edition, not a crash), but if this recurs, consider having `post` call the same char-count check internally before its full validation rather than relying on the drafting turn to remember a separate command.
- **[CARRY-WATCH]** context-review skip list ~20+ entries, still not refactored into a declarative `{pattern, reason}[]` array. Not touched this cycle — now the longest-carried watch item.
