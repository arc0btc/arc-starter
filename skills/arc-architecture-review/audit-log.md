## 2026-07-11T20:18:54.000Z — reservation-leak backstop lands: caller-driven fix (#22087) plus its own sweep-level fallback (#22089); 131 skills / 86 sensors

**Task #22111** | Diff: f91f4c4..f5f1eda (3 commits — 0 src/, 2 skills/; 1 data-sync-only) | Sensors: 86 | Skills: 131

### Changed files (substantive only)

- `skills/social-x-posting/cli.ts` (91714ebb) — `cmdPost`'s reserved-group send path only released reservations on the terminal-403 branch; any other `apiRequest()` failure (notably 402 CreditsDepleted, which throws a plain `Error` with no `.status`) fell straight through to `throw err` with zero release, leaking the row's own reservation and its atomic-group siblings' `reserved_count` forever. Fix broadens the release to any send failure before re-throwing, so the caller still sees the real error. Live-triggered by Edition 7's actual 402 (#22074/#22075).
- `skills/social-engine/admission.ts` (7ffc2960) — Backstop for the above: a root that dies WITHOUT the caller's synchronous catch block running (process kill, OOM, crash between `claimForSend()` and the try/catch) still orphaned its still-`queued` siblings, since `releaseGroupRemainder()` was only ever called from that one catch block. Extracted the per-row release logic into a transaction-agnostic `releaseGroupRemainderTx()` so both existing sweeps in `releaseAbandonedReservations()` (lease-expiry, window-closed) now also release orphaned group siblings inside their own transaction. `releaseGroupRemainder()` becomes a thin wrapper that opens/closes the transaction around the same shared function — correct extract-and-reuse, no logic duplicated between the caller-driven and sweep-driven paths.
- `skills/arc-article-pipeline/drafts/article-5-x-article.json` (f5f1eda0) — data-sync-only, no logic change.

### Steps 1–5

- **Step 1 — Requirements**: Both changes trace to a live incident (#22074/#22075/#22087) and its own follow-up (#22089). No speculative work.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: `releaseGroupRemainderTx()` extraction is the textbook shape this framework keeps rewarding — one transaction-agnostic function now serves both the original caller-driven release and the two sweep-driven releases, instead of the sweeps growing a second copy of the same flip/decrement logic.
- **Step 4 — Accelerate**: N/A this cycle.
- **Step 5 — Automate**: N/A this cycle — this is the sweep/backstop layer already being automatic; nothing new to automate.

### Flags

- **[RESOLVED]** Reserved-group reservation leak (both the caller-driven gap and its crash-path backstop) — #22087 and #22089 close both known leak surfaces for `atomic_group_id` siblings. Nothing carried forward on this thread.
- **[CARRY-WATCH]** context-review skip list ~20+ entries, still not refactored into a declarative `{pattern, reason}[]` array. Not touched this cycle — now the longest-carried watch item (5+ cycles). Recommend a bounded follow-up task next cycle given the streak length.

---

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
- **Step 2 — Delete**: `skills/social-engine/follow-curated.ts` — confirmed still dormant (bare script, no sensor.ts, zero active callers; grep hits are all comment references explaining why `follow-policy.ts` does NOT build on it). It targets a different criterion (curated "accounts of value" batch-follow) than `follow-policy.ts` (per-report research-source promotion), so not a clean duplicate — flagging as "needs investigation" per this skill's own escalation rule rather than recommending deletion outright. See follow-up task.
- **Step 3 — Simplify**: `candidate-spine.ts` centralizing `extractUrls`/`isHighSignal` (moved verbatim out of `social-x-ecosyston/sensor.ts`) gives 3 discovery lanes one scoring bar instead of 3 forks — same shape as the read-budget consolidation praised in the 2026-07-12 entry.
- **Step 4 — Accelerate**: `getMaturationBatch`'s 100-candidate cap matches X's `/tweets?ids=` per-call cap specifically so a full day's due candidates fit in ONE batched read instead of N — a real latency/cost win, not just a code shape choice.
- **Step 5 — Automate**: The whole quest IS a Step-5 move (automating discovery→maturation→research that was previously a broken at-birth judge) — correctly sequenced last, after Phase 1's metering (Step 3/4 work) and the store-not-judge redesign (Step 1) already landed in prior cycles.

### Flags

- **[SELF-DISCLOSED, not mine]** Both new hooks (`follow-policy.ts`, `nugget-bridge.ts`) already document their own known gaps in-file: two promotion thresholds now write `social_accounts` without reconciliation, and `nugget-bridge`'s `content_hash` join is "structurally near-inert across sources" (only `source_url` exact-match actually does the work, no URL normalization). Nothing to add — this cycle's own commits did the audit work usually left to this review.
- **[NEW-WATCH]** `getMaturationBatch`'s T/Z-vs-space-separated datetime comparison bug (caught via live-testing per the code's own comment) is the kind of silent-wrong-answer class this framework watches for elsewhere (see prior cycles' `sqlite-datetime-naive-parse-utc-skew` entry) — worth one cycle confirming no sibling query in the 4 new sensors has the same unconverted `datetime('now', ...)` vs ISO-string comparison.
- No carry-forward watch items from the prior 2 cycles — both were resolved or dropped.

---
