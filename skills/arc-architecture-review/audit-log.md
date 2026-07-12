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

---

## 2026-07-11T08:17:00.000Z — smallest diff in 2 cycles: 3 false-positive fixes, 1 real durability fix (blog publish now commits), 2 docs-only entries; 131 skills / 86 sensors

**Task #22059** | Diff: b9d5ca4..f91f4c4 (6 commits — 1 src/, 5 skills/; 2 docs-only) | Sensors: 86 | Skills: 131

### Changed files (substantive only)

- `src/cli.ts` (a3f29176) — `cmdTasksClose` now rejects re-closing an already-terminal task (completed/failed/blocked), pointing the caller at MEMORY.md instead. Fixes the root cause diagnosed in #22005/#22006: re-closing reset `completed_at`, letting stale tasks reappear in time-windowed reports (daily failure retro). Textbook terminal-state guard, matches the existing "completed is terminal" convention already documented in this skill's own patterns.
- `skills/blog-publishing/cli.ts` (0daec2e9) — `cmdPublish` now runs `git add`+`git commit` itself right after syncing the Astro mdx, closing the gap found in #22009/#22010 where 11 posts sat published-but-undeployed (some a full week) because nothing committed the sync until an unrelated commit happened to sweep it in. Correct fix location: the commit belongs inside the action that creates the uncommitted state, not bolted on as a separate manual step someone has to remember.
- `skills/arc-purpose-eval/sensor.ts` (d1eb32dc) — Two independent fixes to the same metric: (1) `PR_REVIEW_SUBJECT_FILTER` now requires a literal `#` before matching `%PR%`-style patterns, closing a self-pollution bug where the filter matched its own generated follow-up subject ("Check for pending PR reviews...") and inflated the count with a task that reviewed nothing; (2) a 2-day cooldown on the `ECOSYSTEM_REVIEW_SUBJECT` follow-up, mirroring the existing `COST_REVIEW_COOLDOWN_DAYS` pattern, so a legitimate "nothing needs review right now" reading doesn't re-fire the same follow-up every 12h. Both trace directly to #21996/#21998.
- `skills/arc-blocked-review/sensor.ts` (9117e21c) — Adds a `Context wells` description-marker exclusion to the mentioning-tasks query, same false-positive shape as the existing `## Completed Tasks` marker exclusion (whop-synthesis digests quote blocked-task IDs as narrative prose, not a resolution signal). Matched by marker, not by enumerating whop-synthesis by name — consistent with the generalization principle flagged as working well in the 2026-07-08 audit entry.
- `skills/arc-email-sync/SKILL.md`, `skills/arc-packaging/SKILL.md` (5dba0dbc/f91f4c41, 51378828, docs-only) — Documents live-verified CF email routes and the Whop headline 80-char limit found live in #21962. No logic change.

### Steps 1–5

- **Step 1 — Requirements**: All 4 substantive changes trace to named tasks/incidents (#22005-06, #22009-10, #21996/#21998, whop-synthesis Context-wells false-positive). No speculative work.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: The purpose-eval fix is a good instance of fixing a filter at its actual failure mode (needs a literal `#`) rather than adding an exclusion list of subject strings to skip — same "match on structure" shape this framework keeps rewarding.
- **Step 4 — Accelerate**: N/A this cycle.
- **Step 5 — Automate**: N/A this cycle — the blog-publish commit fix is arguably a Step-5 move (automating a previously-manual step), but it's better read as a bug fix: the step was never *supposed* to be manual, it just silently never ran.

### Flags

- **[CARRY-WATCH]** context-review skip list ~20+ entries, still not refactored into a declarative `{pattern, reason}[]` array. Not touched this cycle — now the longest-carried watch item (4+ cycles).
- **[NEW-WATCH]** `blog-publishing`'s new self-commit in `cmdPublish` assumes a clean working tree in `arc0me-site` at publish time — if some other uncommitted change is sitting in that repo when publish runs, this commit will sweep it in unintentionally (same class of risk as any auto-commit convention). Low likelihood given `arc0me-site` is a narrow-purpose content repo, but worth a light watch if a second writer to that repo is ever added.

---

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
