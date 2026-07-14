## 2026-07-12T08:20:00.000Z — small diff, one long-carried watch item resolved: context-review skip list refactored to declarative array; 131 skills / 86 sensors

**Task #22149** | Diff: f5f1eda..b307caa (3 commits — 0 src/, 3 skills/) | Sensors: 86 | Skills: 131

### Changed files (substantive only)

- `skills/context-review/sensor.ts` (1a92c1d6) — `META_TASK_SOURCES` converted from `Set<string>` with trailing-comment reasons to a declarative `{pattern, reason}[]` array. Matching logic (`Array.some` prefix match) unchanged; each exclusion's rationale now travels with its own entry instead of living in a comment block that could drift during edits. Closes the longest-carried watch item on record (5+ cycles, first flagged 2026-07-08).
- `skills/social-x-posting/sensor.ts` (93340805) — Sensor now checks `isCreditsDepleted()` before calling `fetchArcMentions`, skipping the fetch entirely when `db/x-credits-depleted.json` already flags the account. Previously the sensor guaranteed a 402 on every 30min run once depleted, inflating `consecutive_failures` to 32 and firing a false sensor-health alert for an expected, already-parked condition. Matches the standing memory pattern "X 402 = CreditsDepleted (park blocked, escalate)" — this fix makes the sensor itself aware of that state instead of relying on the alert to be manually dismissed each time.
- `skills/github-mentions/SKILL.md` (b307caa1) — Docs-only. Documents `markAllRead()`'s `gh api --method PUT /notifications` as an accepted `disallowed-tools: [..., Bash]` exception, on the same basis as `arc-skill-manager`'s existing read-only exceptions for `gh pr view`/`git log`: it runs inside the sensor process (no LLM), not the dispatched agent's own tool use.

### Steps 1–5

- **Step 1 — Requirements**: All three changes trace to named incidents or standing watch items (context-review refactor closes a 5+-cycle carry-watch; social-x-posting fix closes a live false-alert; github-mentions docs formalizes an existing de facto exception). No speculative work.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: The context-review refactor is the textbook shape — data (reason) moves next to data (pattern) instead of living in a parallel comment structure that has to be kept in sync by hand.
- **Step 4 — Accelerate**: N/A this cycle.
- **Step 5 — Automate**: The social-x-posting fix is arguably a small Step-5 move — the sensor now automatically recognizes and skips a known-terminal condition instead of re-discovering it via a failed API call every cycle.

### Flags

- **[RESOLVED]** context-review `META_TASK_SOURCES` skip list — refactored to `{pattern, reason}[]`, closing the longest-carried watch item (5+ cycles). Nothing carried forward on this thread.
- No new watch items this cycle. Diff was small and every change traced cleanly to a prior finding.

---

## 2026-07-12T20:20:00.000Z — X spend audit lands: two unmetered read lanes brought under the shared budget guard, prescreen switched from paid to free oEmbed, plus the queued-reservation leak fix from the prior cycle's follow-up; 131 skills / 86 sensors

**Task #22190** | Diff: b307caa..1d9f029 (3 commits — 0 src/, 4 skills/) | Sensors: 86 | Skills: 131

### Changed files (substantive only)

- `skills/social-x-posting/lib/x-api.ts` (9dcc49c9) — `incrementReadBudget()` gains a `lane` param and `by_lane` attribution in `x-read-budget.json`; new `endpointLane()` normalizes numeric path segments out of an endpoint for a stable lane key. Daily ceiling raised $0.50 → $1.00, framed explicitly as absorbing previously-invisible spend, not authorizing new spend.
- `skills/social-x-ecosystem/sensor.ts` (9dcc49c9) — 96 searches/day (~$0.48, the single biggest read spend on the account) were unmetered until now; every search checks `checkReadBudget` first and degrades to a skipped search (not a thrown error) on exhaustion.
- `skills/arc-link-research/cli.ts` (9dcc49c9, 1d9f0293) — Same budget-guard wiring for both OAuth and bearer clients (lane `link-research`). Second commit same-day reworks `prescreenTweet` from a paid `/tweets/:id` lookup to X's free `publish.x.com/oembed` endpoint (200/404/403 status-coded, 5xx/network falls back to the existing lenient-default), plus a cache short-circuit so an already-cached URL skips prescreening entirely. Net effect: a successful research run now costs 1 paid read per fresh X URL instead of 2, and 0 for cached URLs.
- `skills/social-engine/admission.ts` (c6498daa) — Fixes #22166 (Edition 8 reservation leak flagged in the prior cycle's audit): `releaseAbandonedReservations()` gets a third sweep reclaiming `queued` rows whose send window has already opened (not just fully closed) past a 10min grace, closing the gap where a group aborted before any row reached `claimForSend()` sat leaked for up to an hour.

### Steps 1–5

- **Step 1 — Requirements**: All four changes trace to named artifacts — an operator spend-audit doc (`manage-agents docs/observations/2026-07-11-x-api-spend-audit.md`), an explicit operator direction on the prescreen rework, and task #22166 from the prior cycle's own carry-forward. No speculative work.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: `endpointLane()` plus the shared `checkReadBudget`/`incrementReadBudget` import gives three previously-divergent callers (posting, ecosystem search, link-research) one metering path instead of three ad-hoc ones — same "import the shared guard" shape already used for whop-sales. The oEmbed prescreen swap is a genuine complexity reduction too: it replaces branchy X-API error-shape parsing (`data.errors[0].title` string matching) with a plain HTTP status check.
- **Step 4 — Accelerate**: The prescreen rework is the clearest Step-4 move this cycle — it removes a paid round-trip from the hot success path of every link-research run, not just a cost optimization but a latency one (oEmbed has no OAuth handshake).
- **Step 5 — Automate**: N/A this cycle.

### Flags

- **[NEW-WATCH]** The budget ceiling doubled same-day two new lanes were switched on. The stated intent is "measurement, not new spend authorization," which the `by_lane` breakdown makes auditable — worth one cycle of watching `db/x-read-budget.json`'s actual `by_lane` totals against the pre-metering estimates ($0.48 ecosystem + link-research) to confirm the raise doesn't quietly become headroom for new spend.
- **[RESOLVED]** #22166 queued-reservation-leak (flagged in the 2026-07-11T20:18:54.000Z entry's memory context, fixed this cycle) — third sweep closes the window-opened-but-not-claimed gap. Nothing carried forward on this thread.
- No other watch items carried — prior cycle's context-review skip-list watch was already resolved and dropped.

---

## 2026-07-13T08:24:00.000Z — smallest diff in several cycles: pure skill-tree pruning (7 dead skills deleted) plus a docs-only disallowed-tools tagging batch; no src/ changes; 124 skills / 86 sensors

**Task #22239** | Diff: 1d9f029..3811dee (3 commits — 0 src/, 22 skills/ files) | Sensors: 86 | Skills: 124 (down from 131)

### Changed files (substantive only)

- `3811deed` — Deletes 7 skills wholesale: `arc-dispatch-evals`, `arc-performance-analytics`, `bitcoin-taproot-multisig`, `dao-zero-authority`, `dev-landing-page-review`, `quest-create`, `styx`. Full directories removed (SKILL.md/AGENT.md/cli.ts and any skill-specific data files like `daos.json`, `taproot-runner.ts`, `deposit-runner.ts`). Traces to task #22213's skill-tree audit — this is exactly the Step-2 "delete the part" move this framework has been asking every skill owner to do more of.
- `fbb276e2` + `ad9bfd7a` — Docs-only: adds `disallowed-tools: [Edit, Write, NotebookEdit, ...]` frontmatter to 15 read-only skills (12 in the first commit, 3 more in the second), continuing the intent-signaling tagging effort described in `arc-skill-manager`'s SKILL.md. No logic change, no sensor/cli behavior change.

### Steps 1–5

- **Step 1 — Requirements**: Both changes trace to named prior work (#22213 audit, the ongoing disallowed-tools tagging pass) — no speculative additions.
- **Step 2 — Delete**: The main event this cycle. 7 skills removed in one commit is the largest single-cycle deletion seen in this review's history — worth noting as a positive data point against the recurring "not deleting enough" critique.
- **Step 3 — Simplify**: N/A — tagging is metadata-only, not a structural simplification.
- **Step 4 — Accelerate**: N/A.
- **Step 5 — Automate**: N/A.

### Flags

- **[RESOLVED]** Prior cycle's `[NEW-WATCH]` on the doubled X read-budget ceiling ($0.50→$1.00) — cannot be evaluated this cycle. `db/x-read-budget.json` is still stamped `"date": "2026-07-11"` with no `by_lane` breakdown present, consistent with the standing memory item that X credits have been depleted since 2026-07-11 (auto-clears 2026-08-10) — there has been no read spend to attribute since the metering shipped. Re-check once credits clear and reads resume.
- No new watch items — this was the smallest, lowest-risk diff in the recent run (pure deletion + doc tags, zero src/ or sensor logic touched).

---

## 2026-07-13T20:53:52.000Z — largest structural diff in recent cycles: the arc-x-research-channel quest lands end-to-end (Phases 2-5), self-audited with dev-council review baked into every commit; 128 skills / 90 sensors

**Task #22491** | Diff: 3811dee..dcad7d3 (32 commits — 8 src/, 4 new skills/) | Sensors: 90 (up from 86) | Skills: 128 (up from 124)

### Changed files (substantive only)

- `src/candidate-spine.ts` (new) — store-not-judge fix for `social-x-ecosystem`'s structural bug (engagement checked at discovery time almost never passes; candidates now sit until 2-24h aged, re-scored in one batched read). Shared by 3 discovery lanes (keyword-rotation, news-search, list-roster) via one `x_research_candidate` table.
- `skills/candidate-maturation/sensor.ts` (new) — consumes the spine; same-day fix (414ce89a) adds an incident-level dedup gate after one viral story matured through 5 sibling tweet_ids and filed 5 redundant research tasks (~$5-10 waste) — ships with a test.
- `skills/list-roster/`, `skills/x-news-trends/`, `skills/research-nugget-relay/` (new) — Phase 4 List-membership sync + tweet-poll producer, Phase 3 News/Trends discovery, Phase 5 HN/RSS/GitHub-release → arc-link-research fan-in. Each has SKILL.md + sensor.ts, wired into the shared spine/registries rather than forking their own.
- `src/follow-policy.ts`, `src/nugget-bridge.ts` (new) — both wired into `arc-link-research/cli.ts`'s `cmdProcess` at report-acceptance, both explicitly contracted to never throw (report write must not be endangered by a downstream hook), both self-disclose a known limitation in their own header comments rather than leaving it implicit.
- `src/db.ts`/`src/dispatch.ts`/`src/cli.ts` — `stop_condition` column (loop-first workflow pattern) threaded through insert/update/prompt-build; plus the already-memory-tracked `tasks.id` AUTOINCREMENT rebuild (#22270/#22271) and a dangling-lock alert.

### Steps 1–5

- **Step 1 — Requirements**: Every commit traces to a named phase of one operator-scoped quest (arc-x-research-channel, PHASES.md) or a live incident (#22270 id-reuse, BridgeMind incident-dedup). No speculative work found.
- **Step 2 — Delete**: `skills/social-engine/follow-curated.ts` — confirmed still dormant (bare script, no sensor.ts, zero active callers; grep hits are all comment references explaining why `follow-policy.ts` does NOT build on it). It targets a different criterion (curated "accounts of value" batch-follow) than `follow-policy.ts` (per-report research-source promotion), so not a clean duplicate — flagging as "needs investigation" per this skill's own escalation rule rather than recommending deletion outright. See follow-up task. **[RESOLVED 2026-07-13, #22500]**: NOT a duplicate, NOT dead — `src/follow-policy.ts` is reactive-only (follows an account only at the moment its research is cited in a new report) and explicitly disclaims backfill. Queried `social_accounts` live: 92 `eligible`/unfollowed rows exist (53 highest-priority `research_core` tier), a real backlog nothing else touches. Also found `skills/social-engine`'s periodic scripts (`monitor-post-lane.ts`, `monitor-reply-lane.ts`, `reply-watchlist-sensor.ts`) are scheduled via host `crontab -l`, not the `skills/*/sensor.ts` auto-discovery this framework's own "Delete" heuristic checks for — the "no sensor.ts, no caller" test produces false-positive dormancy for this skill's whole periodic-script class. Wired `follow-curated.ts` into the same crontab (daily 05:00 UTC) instead of deleting. See [[skill-dormancy-check-misses-crontab-scheduled-scripts]].
- **Step 3 — Simplify**: `candidate-spine.ts` centralizing `extractUrls`/`isHighSignal` (moved verbatim out of `social-x-ecosyston/sensor.ts`) gives 3 discovery lanes one scoring bar instead of 3 forks — same shape as the read-budget consolidation praised in the 2026-07-12 entry.
- **Step 4 — Accelerate**: `getMaturationBatch`'s 100-candidate cap matches X's `/tweets?ids=` per-call cap specifically so a full day's due candidates fit in ONE batched read instead of N — a real latency/cost win, not just a code shape choice.
- **Step 5 — Automate**: The whole quest IS a Step-5 move (automating discovery→maturation→research that was previously a broken at-birth judge) — correctly sequenced last, after Phase 1's metering (Step 3/4 work) and the store-not-judge redesign (Step 1) already landed in prior cycles.

### Flags

- **[SELF-DISCLOSED, not mine]** Both new hooks (`follow-policy.ts`, `nugget-bridge.ts`) already document their own known gaps in-file: two promotion thresholds now write `social_accounts` without reconciliation, and `nugget-bridge`'s `content_hash` join is "structurally near-inert across sources" (only `source_url` exact-match actually does the work, no URL normalization). Nothing to add — this cycle's own commits did the audit work usually left to this review.
- **[NEW-WATCH]** `getMaturationBatch`'s T/Z-vs-space-separated datetime comparison bug (caught via live-testing per the code's own comment) is the kind of silent-wrong-answer class this framework watches for elsewhere (see prior cycles' `sqlite-datetime-naive-parse-utc-skew` entry) — worth one cycle confirming no sibling query in the 4 new sensors has the same unconverted `datetime('now', ...)` vs ISO-string comparison.
- No carry-forward watch items from the prior 2 cycles — both were resolved or dropped.

---

## 2026-07-14T08:21:00.000Z — small diff, cheap health-triage field lands but is a no-op for the 41% of sensors using the string-return error convention; 128 skills / 90 sensors

**Task #22589** | Diff: dcad7d3..71606f5 (6 commits — 3 src/, 4 skills/) | Sensors: 90 | Skills: 128

### Changed files (substantive only)

- `src/sensors.ts` (33ba669f) — `HookState` gains `last_error?: string | null`, persisted per-run so `sensor-health-report` can show a failure's message without grepping logs. Real gap: `runSensors()` only populates a *useful* `last_error` for sensors that throw (`error: err.message`) or explicitly `return "error"` with a caller-supplied reason. For the 31/76 sensors (41%) that use the `return "error"` string convention — the sensor logs its own `error.message` via `log()` then returns the bare string `"error"` — `runSensors()` hardcodes `last_error: "sensor returned error"`, discarding the message the sensor already computed. Confirmed live this cycle: `candidate-maturation` (one of the 31) shows 3 consecutive failures with `last_error: "sensor returned error"` in `db/hook-state/candidate-maturation.json` — no more diagnostic than before the field existed. Filed follow-up (below); this is a low-cost fix (thread the caught message through the "return 'error'" convention's callers, or standardize on throwing).
- `src/cli.ts` (71d6f298) — `tasks close` terminal guard now only rejects re-close of `completed`/`failed`, not `blocked` — already tracked in memory as the fix for [[tasks-close-terminal-guard-overblocks-blocked-resolution]] (#22505). No new finding.
- `skills/arc-link-research/cli.ts` (4a952fb4, c41f2587) — `cmdProcess` writes a compact one-line-per-link skip note instead of a full takeaways/summary report when every link in a batch rates "low" relevance (`counts.high === 0 && counts.medium === 0`); front-matter unchanged so dedup/reindex still work. Directly targets the cost pattern flagged in [[arc-link-research-cost-driver]] (12+ near-identical "Declined: ..." reports at ~$0.43 each) — a genuine Step-3 simplification (less report for no-signal input) with a real Step-4 cost/latency payoff. Same commit range also expands `TOPIC_VOCAB` by ~30 recurring out-of-vocab topics found in a prior audit (#22552); docs-only vocabulary maintenance, no logic change.
- `skills/social-engine/SKILL.md` (2dbe088b) — docs-only, formalizes the crontab-scheduling note for `follow-curated.ts` already recorded in the 2026-07-13T20:53:52.000Z entry ([[skill-dormancy-check-misses-crontab-scheduled-scripts]]). No new finding.
- `4836e726` — Pure naming-convention compliance fix (`msg`/`tmp`/`err` → verbose) across 4 files plus `INTERVAL_MINUTES` consts for 2 sensors, closing prior compliance-review findings. No logic change.

### Steps 1–5

- **Step 1 — Requirements**: All six commits trace to named prior audits or incidents (#22505, #22552, #22556, #22500, compliance-review batch-1). No speculative work.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: The arc-link-research skip-note path is the clearest move — collapsing a multi-section report to one line per link when there's nothing to say, directly attacking this review's own standing cost watch.
- **Step 4 — Accelerate**: Same change — cuts report-generation work (and the token cost of writing takeaways nobody will read) on the highest-volume, lowest-signal path through the skill.
- **Step 5 — Automate**: N/A this cycle.

### Flags

- **[NEW-WATCH]** `last_error` (33ba669f) is a no-op for the 31/76 sensors using the `return "error"` string convention — `runSensors()` discards their actual error message and stores the generic `"sensor returned error"` literal instead. Filed follow-up task to thread the real message through (either have `runSensors` accept a `{status: "error", message}` return shape, or standardize those 31 sensors on throwing `Error` instead of returning a bare string).
- **[NOT A NEW FINDING]** `candidate-maturation` showed 3 consecutive failures in this cycle's health report — already investigated and closed as expected transient behavior at #22512 (`p-transient-sensor-failures-budget-constraints`, memory/patterns.md:212), not a code defect. Noted only because it's what exposed the `last_error` gap above.
- No carry-forward watch items from the prior cycle (2026-07-13T20:53:52.000Z's datetime-comparison watch was already addressed in the diff landing this cycle's spine code, per its own in-file comment).

---
