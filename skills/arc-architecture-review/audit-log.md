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

## 2026-07-14T20:21:00.000Z — both carried watch items close in one diff: Phase 8 URL-expansion lands (root cause of the standing cost-driver flag), plus the last_error no-op fix for all remaining sensors; 128 skills / 90 sensors

**Task #22656** | Diff: 71606f5..79f5954 (7 commits — 4 src/, 6 skills/, migration script) | Sensors: 90 | Skills: 128

### Changed files (substantive only)

- `src/candidate-spine.ts`, `src/db.ts`, `db/migrations/018-p8-url-expansion-mechanical-filter.ts` (d0f0c6db) — Phase 8 containment pass, root-causes [[arc-link-research-cost-driver]]: neither list-roster nor candidate-maturation ever requested `entities`/`referenced_tweets` in `tweet.fields` (X bills per resource, not per field — free to add), so every t.co-shortlinked candidate was stored with `urls=[]` and correctly-but-wastefully declined at full LLM dispatch cost — 125 of 195 sensor-filed tasks in 24h were exactly this class. `extractExpandedUrls`/`classifyReferencedTweets` now read the real `expanded_url`/`referenced_tweets` fields (self-reference dropped, quote-tweet targets kept as followable). Migration adds 5 columns (additive `ALTER TABLE`, guarded by `user_version`, mirrors migration 016's shape); verified live — `db/arc.sqlite` is at `user_version: 16` with all 5 columns present. New `countSensorResearchDispatchesToday()` (recursive CTE over `parent_id`) counts full triage→fan-out lineage, not just top-level `sensor:%` rows — the number that actually tracks $ spend under the new two-stage model.
- `src/research-brief.ts`, `skills/candidate-maturation/sensor.ts` (d0f0c6db) — New `buildTriageBrief()` replaces one-dispatch-per-candidate with a two-stage shape modeled directly on a proven live exemplar (task #20093: one `process` call across a 21-link batch, consolidated to 14 real topics, fanned out survivors individually) — the fix behind $115.08/24h from that incident. Surviving story-clusters (post mechanical pre-filter + cross-run cluster collapse) get ONE triage task; the triage agent runs `arc-link-research process` once across all links, then fans out per-topic tasks only for RESEARCH verdicts.
- `skills/arc-skill-manager/sensor.ts`, `skills/candidate-maturation/sensor.ts` (79f59547) — New `CUSTOM_DEDUP_MARKER` opt-out (mirrors existing `STUB_EXEMPTION_MARKER`) for sensors whose dedup is a state-machine (cluster-key collapse + daily dispatch cap) rather than a source-string lookup — `candidate-maturation`'s triage source deliberately embeds a per-run timestamp, so the generic `pendingTaskExistsForSource` check would never have matched by design. Fixes the validator, not the sensor.
- `src/sensors.ts` (2a337f7d) — Closes last cycle's own `[NEW-WATCH]`: threads real error messages through for the 21 sensors that returned a bare stub `error: ` (empty interpolation) and 3 more (`ordinals-market-data`, `aibtc-heartbeat`, `research-nugget-relay`) that returned bare `"error"` with no message at all. `last_error` is now diagnostic for effectively all sensors using the string-return convention, not just the ones that already happened to interpolate correctly.
- `skills/arc-workflow-review/sensor.ts` (d047aefb) — Adds `"research"` to `KNOWN_SUBJECT_PREFIXES` as the 9th recurrence of the already-rejected generic-RetrospectiveMachine shape (candidate-maturation's per-candidate research tasks vary subject text, so only surface via prefix grouping).

### Steps 1–5

- **Step 1 — Requirements**: All seven commits trace to a named incident or standing memory flag — Phase 8 to [[arc-link-research-cost-driver]]'s own 125/195-decline measurement, the triage brief to a live exemplar task (#20093), the dedup marker to a validator false-positive on already-correct code, the error-threading fix to this review's own prior-cycle watch item, the workflow-review exemption to an already-rejected pattern. No speculative work.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: The triage brief is the standout — collapsing N per-candidate LLM dispatches into one triage dispatch that fans out only real survivors, same shape as the read-budget consolidation and skip-note fixes praised in prior cycles, but at the architecture level instead of one call site.
- **Step 4 — Accelerate**: Phase 8's URL expansion removes a whole class of doomed-to-decline dispatches from the pipeline before they're ever created — the cheapest possible fix (free field on an existing batched read) for the single largest cost driver this review has tracked across 3+ cycles.
- **Step 5 — Automate**: The two-stage triage model is a Step-5 move done in the correct order — it rides on top of Phase 8's mechanical filtering (Step 3/4) rather than substituting for it.

### Flags

- **[RESOLVED]** Prior cycle's `[NEW-WATCH]` on `last_error` being a no-op for 41% of sensors — 2a337f7d threads real messages through all remaining cases same-day. Nothing carried forward on this thread.
- **[WATCH]** Phase 8 + two-stage triage together are the most direct structural response yet to [[arc-link-research-cost-driver]] (measured 2026-07-14: 51% of daily spend, $103.57/$201.39). The 2026-07-15 17:38 UTC re-measurement already scheduled at #22520 (for the incident-dedup fix) should now also capture this cycle's landing — worth explicitly re-checking `arc tasks cost --days 1 --top N` broken out by skill against the pre-Phase-8 baseline once it fires, since two independent fixes are stacking in the same measurement window.
- No other carry-forward watch items — prior cycle's only open item is resolved above.

---

## 2026-07-15T08:23:00.000Z — auto-commit regression broke arc-blocked-review's task-creation call; fixed same-cycle

**Task #22717** | Diff: 79f5954..2411114 (86 commits, mostly memory/docs/cache; 1 substantive src change) | Sensors: 90 | Skills: 128

### Changed files (substantive only)

- `skills/arc-blocked-review/sensor.ts` (52d5cf59, an unreviewed "chore(loop): auto-commit after dispatch cycle" commit) — landed the intended cooldown fix (SIGNAL_REVIEW_COOLDOWN_HOURS now applies regardless of stale-reason presence, closing the #22689-review gap already tracked in MEMORY.md) but *also* rewrote the `insertTaskIfNew` call incorrectly: first arg changed from the `TASK_SOURCE` string to the `db` handle, `skills` passed as a raw array instead of a JSON string, and the `model` field dropped entirely. Since `pendingTaskExistsForSource`/`insertTask` bind `source` as a SQLite parameter, passing a `Database` object there throws at runtime — the sensor has been unable to create any new blocked-task review since this commit landed (2026-07-14 21:11 MDT). Bun's transpile-only pre-commit guard (CLAUDE.md's "Pre-commit syntax guard") does not catch this class of bug — it's a type/runtime mismatch, not a syntax error, and this was an auto-commit with no dispatch-session review. Fixed this cycle: restored `insertTaskIfNew(TASK_SOURCE, {...})` signature, JSON-stringified skills with the valid-skill-name filter, and restored `model: "sonnet"` (tasks without an explicit model are rejected at dispatch per CLAUDE.md). Verified via `bunx tsc --noEmit -p .` — no errors on this file post-fix.

### Steps 1–5

- **Step 1 — Requirements**: The cooldown-regardless-of-stale-reason change traces to a named incident (#22689-review, already in MEMORY.md); valid. The rest of the diff (signature/skills/model breakage) traces to no requirement — it's incidental damage from whatever authored the auto-commit, not a deliberate change.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: N/A.
- **Step 4 — Accelerate**: N/A.
- **Step 5 — Automate**: N/A — but see Flags below re: a real gap in the auto-commit safety net.

### Flags

- **[NEW-WATCH]** The dispatch resilience doc (CLAUDE.md "Dispatch resilience") only names two safety layers: pre-commit syntax guard (transpile-only, doesn't type-check) and post-commit service health check (checks if a service died, not whether task-creation silently started failing). Neither layer would have caught this bug, and it shipped via an unattended "chore(loop): auto-commit after dispatch cycle" commit rather than a reviewed dispatch session. A sensor that periodically runs `bunx tsc --noEmit` against files touched by auto-commits (not full transpile) and flags new errors would close this gap. Filing a follow-up.
- **[RESOLVED]** Prior cycle's only carry-forward (#22656's Phase 8 + two-stage triage re-measurement watch) is unaffected by this diff — no action needed here, already tracked at #22699/[[arc-link-research-dedup-measurement]].

---

## 2026-07-15T20:23:00.000Z — smallest diff yet: arc-typecheck-guard ships end-to-end, closing the prior cycle's own [NEW-WATCH]; 129 skills / 91 sensors

**Task #22793** | Diff: 2411114..69e2895 (3 commits — 4 new skills/ files, 1 fix, 1 cache auto-commit) | Sensors: 91 (up from 90) | Skills: 129 (up from 128)

### Changed files (substantive only)

- `skills/arc-typecheck-guard/{SKILL.md,check.ts,cli.ts,sensor.ts}` (f3469b19, new skill) — direct fix for the prior cycle's own flagged gap: a 30-min sensor runs `tsc --noEmit`, diffs per-file error counts against a persisted baseline (`db/tsc-baseline.json`), and flags only INCREASES touched by unattended auto-commits (reviewed/human commits are ignored — CI covers those). Flags via follow-up task, does not revert (type errors don't crash a running Bun service, so revert-on-error would be over-aggressive here — correctly distinguished from `revertOnServiceDeath`'s justified aggression on actual service death). `bunx tsc --noEmit -p .` run this cycle shows zero errors attributable to this skill.
- `skills/arc-blocked-review/sensor.ts` (56e2e766) — the actual fix for #22717 (restores correct `insertTaskIfNew(TASK_SOURCE, {...})` signature, JSON-stringified skills, `model: "sonnet"`). Verified clean via `tsc --noEmit` this cycle.
- `69e2895d` — auto-commit, cache file only (`arc-link-research/cache/*.json`), no code.

### Steps 1–5

- **Step 1 — Requirements**: Both substantive commits trace to a single named incident (#22717) already tracked in MEMORY.md — the guard closes the exact gap this review flagged last cycle, no speculative scope added.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: N/A — new capability, not a consolidation.
- **Step 4 — Accelerate**: N/A — sensor is explicitly kept off the dispatch hot path (30-min cadence, not per-commit) to avoid adding ~10-30s of `tsc` latency to every auto-commit.
- **Step 5 — Automate**: Correctly sequenced last — automates detection of a failure class only after the concrete incident (#22717) was understood and manually fixed same-cycle, not built speculatively ahead of a real case.

### Flags

- **[RESOLVED]** Prior cycle's `[NEW-WATCH]` (auto-commit safety net has no type-check layer) — closed same-day by this diff. Nothing carried forward on this thread.
- No new watch items — this is the tightest, most directly-traceable diff seen in this review's recent history (one incident, one fix, one preventive guard, zero unrelated changes).

---
