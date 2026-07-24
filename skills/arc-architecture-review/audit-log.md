## 2026-07-24T09:29:06.000Z — six named-incident fixes closing two active outage flags, zero speculative scope; 129 skills / 91 sensors (unchanged)

**Task #23728** | Diff: cb8268f..51924ee (10 commits — 6 substantive, 4 auto-commit cache-only) | Sensors: 91 | Skills: 129

### Changed files (substantive only)

- `skills/arc-service-health/sensor.ts` (d99ae2333) — proactive OAuth-expiry check (reads `~/.claude/.credentials.json` every 5min, alerts <2h before expiry via Discord + a pri-1 health-alert task with re-auth-specific steps). Directly closes the root cause of the standing `dispatch-oauth-42h-outage-2026-07-22` memory flag: dispatch previously had zero advance warning and only found out via a 401 after the fact.
- `skills/arc-service-health/sensor.ts` (9c40800ce) — `clearResolvedAlerts()` now records `triggeredAt`/`resolvedAt`/`durationMs` on the workflow context and sends a Discord resolution notice, instead of a bare `log()` line. Directly closes the same outage's second flagged gap: 9 correct alerts auto-cancelled silently at recovery, invisible without `journalctl`. Both service-health commits cite the incident number in-code (#23624/#23643) rather than reasoning from scratch — good provenance.
- `skills/arc-umbrel/{cli,sensor}.ts` + `SKILL.md` (c0c53c92f) — replaces hardcoded LAN IP/user/password with env vars (`UMBREL_HOST`/`UMBREL_USER`/`UMBREL_PASS`), fixing a real publish-blocker from a creds/IP scan (#23677) ahead of open-sourcing. Also touched `scripts/arc-p2-live-seed.ts`, `fixture-p6-entitlement.ts`, one web archive snapshot — all outside `skills/`, not re-verified here but same fix pattern.
- `skills/arc-article-pipeline/cli.ts` (3b99419c1, b1e633f6a) — two sequential fixes to `selectFinding()`/`parseIndexCandidates()`: (i) generic `research.md` filenames all collapsed to rotation slug `"research"`, permanently blocking every other finding sharing that default name once any one was staged; (ii) `article_queue_log` dedup only saw findings *this* pipeline staged, missing a finding published via another channel (content-calendar) and re-drafting it as a duplicate (#23635/#23669, live incident: 2026-06-29 finding re-drafted as Article 14 on 2026-07-23). Fix (ii) greps live blog bodies for the finding's frozen `file:line` citation — cheap, deterministic, cross-channel.
- `skills/arc-packaging/{cli,sensor}.ts` + `SKILL.md` (85759db75) — dedup-before-mint gate reuses `arc-link-research/lib/catalog.ts`'s `findCoverage()` instead of re-deriving overlap logic (explicit in-code rationale: two skills must never disagree on what "already covered" means), plus a 72h hidden-SKU auto-escalation sensor lane mirroring `arc-blocked-review`'s stale-then-cooldown pattern. Closes #23665 (a panel had claimed both fixes already shipped; neither had).
- `skills/arc-cost-reporting/sensor.ts` (51924ee9c) — parameterizes all queries and reports on yesterday's date instead of `date('now')`; sensor runs ~21:25 UTC before most dispatch tasks complete, so `cost_usd` (set only on completion) read as zero for tasks that finish hours later. Already logged in MEMORY.md as `[[sensor-daily-report-data-freshness]]`.

### Steps 1–5

- **Step 1 — Requirements**: All six substantive commits trace to a named live incident or standing memory flag (OAuth outage ×2, umbrel creds scan, article re-draft ×2, packaging panel claim, cost-report zero-cost bug). No speculative scope.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: arc-packaging's dedup gate explicitly reuses `findCoverage()` rather than reimplementing url/topic matching — a real instance of "can two things become one" applied proactively, not just noted for later.
- **Step 4 — Accelerate**: N/A this cycle — all fixes are correctness, not throughput.
- **Step 5 — Automate**: N/A this cycle.

### Flags

- **Two standing memory items now resolved by this diff**: the OAuth-outage flag's both open questions (no advance warning, silent auto-cancel) are addressed by the two service-health commits above. Memory's `dispatch-oauth-42h-outage-2026-07-22` entry still reads "unconfirmed whether the token refresh is stable long-term" — that line remains accurate (this diff adds *visibility* into expiry, not a fix to the refresh mechanism itself) and should stay open until a real-world proactive alert fires and is acted on.
- Ninth consecutive cycle with fully-traceable, single-incident-per-commit changes and zero unrelated scope.

---

## 2026-07-24T05:26:00.000Z — single data-only commit, zero code changes; 129 skills / 91 sensors (unchanged)

**Task #23597** | Diff: 9bc6711..cb8268f (1 commit, `chore(article-pipeline)` P4 auto-package data write) | Sensors: 91 | Skills: 129

### Changed files (substantive only)

- None. The one commit in range writes `skills/arc-article-pipeline/drafts/article-13-x-article.json` (+`.bak`) — pure data, no `src/` or skill code touched. Skill/sensor counts unchanged from the prior review (129/91).

### Steps 1–5

- **Step 1 — Requirements**: N/A — no code changed to question.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: N/A this cycle.
- **Step 4 — Accelerate**: N/A this cycle.
- **Step 5 — Automate**: N/A this cycle.

### Flags

- None. Two active reports checked (`2026-07-23T140000Z_overnight_brief.md`, `2026-07-24T010316Z_watch_report.html`) — the overnight brief's failures are all the already-tracked 42h OAuth outage (dispatch-oauth-42h-outage-2026-07-22, MEMORY.md), no new structural finding. No follow-up task warranted.

---

## 2026-07-20T21:30:00.000Z — quietest diff yet: two data-only auto-package commits, zero code changes; 128 skills / 91 sensors

**Task #23327** | Diff: 776f5b2..b546157 (2 commits, both `chore(article-pipeline)` auto-package data writes) | Sensors: 91 | Skills: 128

### Changed files (substantive only)

- None. Both commits (`9804cde2`, `b546157a`) are `arc-operator-loop` P4 auto-package writes to `skills/arc-article-pipeline/drafts/article-{11,12}-x-article.json` (plus `.bak` snapshots) — pure data, no `src/` or skill code touched. Skill/sensor counts unchanged from the prior review (128/91).

### Steps 1–5

- **Step 1 — Requirements**: N/A — no code changed to question.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: N/A this cycle.
- **Step 4 — Accelerate**: N/A this cycle.
- **Step 5 — Automate**: N/A this cycle.

### Flags

- None. Eighth consecutive cycle with fully-traceable, single-incident-per-commit (or zero-code) changes. No CEO/watch-report architectural feedback this cycle — the two active reports checked (`2026-07-20T130407Z_overnight_brief.md`, `2026-07-20T130012Z_watch_report.html`) surface known, already-tracked sign-off asks (PR #28 push, arc-0015 grounding gate, kill-switch re-enable, Whop SKU overlap) with no new structural findings.

---

## 2026-07-21T09:23:58.000Z — one net-new skill-tree entry (a self-inflicted deletion reversed), one narrow false-positive fix; 129 skills / 91 sensors

**Task #23412** | Diff: b546157..5576bd7 (2 substantive commits; 1 data-only weekly-deck generation; rest are arc-link-research cache auto-commits) | Sensors: 91 | Skills: 129 (up from 128)

### Changed files (substantive only)

- `skills/dev-landing-page-review/AGENT.md` + `SKILL.md` (52dbc7f1) — restores a skill deleted in error five days earlier by this very review process (3811deed, task #22213, "never invoked" audit). It was in fact live: `PrLifecycleMachine` (`skills/arc-workflows/state-machine.ts`) generates React-repo PR review tasks that load it, and `github-release-watcher/sensor.ts` references it. Task #23395 hit the dead reference reviewing `aibtcdev/landing-page#1043` before this restore landed.
- `skills/context-review/sensor.ts` (5576bd75) — adds a narrow subject-prefix exemption (`"Research:"` + `arc-link-research` loaded) to `checkMissingSkillCoverage`, joining two prior near-identical exemptions (`"Research X article:"`, `"Research orchestrator:"`) on the same function. Traces to a real false-flag (#23401, defi-zest topic misread as a skill requirement) — correctly reasoned (arc-link-research disallows Bash/Edit/Write, so it structurally cannot act on a topic name) rather than a blind allowlist add.

### Steps 1–5

- **Step 1 — Requirements**: Both substantive commits trace to named live incidents (#23395 dead reference, #23401 false-flag). No speculative scope.
- **Step 2 — Delete**: None recommended this cycle — but the dev-landing-page-review restore is itself a live data point on Step 2 risk: a prior review's "never invoked" deletion call was wrong because it checked direct-invocation traces, not generative call sites (a state-machine class dynamically producing tasks that load the skill). Deletion recommendations from this review should now explicitly check state-machine/generator call sites, not just static `--skills` grep hits, before recommending removal.
- **Step 3 — Simplify**: `checkMissingSkillCoverage` now carries three near-identical subject-prefix exemptions (`"Research X article:"`, `"Research orchestrator:"`, `"Research:"` + arc-link-research). Not yet consolidating — each has a distinct guard condition and a distinct named incident — but if a fourth prefix-based exemption lands on this function, it's worth generalizing to "any task loading a Bash/Edit/Write-disallowed research skill is exempt from missing-skill-coverage checks" instead of accumulating prefix strings.
- **Step 4 — Accelerate**: N/A this cycle.
- **Step 5 — Automate**: N/A this cycle.

### Flags

- **[LESSON]** See Step 2 above — this review's own prior deletion call (#22213) produced a 5-day-later user-visible failure (#23395) before being caught and reversed. Recommend: before this skill recommends deleting a skill as "unused," grep not just for `--skills <name>` CLI/task references but also for the skill's directory name appearing inside any `skills/*/state-machine.ts` or generator logic that might dynamically emit it.

---

## 2026-07-21T21:34:54.000Z — zero substantive commits, quietest diff on record; 129 skills / 91 sensors

**Task #23477** | Diff: 5576bd7..5576bd7 (zero-length range; the single intervening commit to HEAD is this skill's own prior docs-only update, excluded by design) | Sensors: 91 | Skills: 129

### Changed files (substantive only)

- None. No `src/` or `skills/` code changed since task #23412's review. Diagram regenerated with no structural delta (129/91, unchanged).

### Steps 1–5

- **Step 1 — Requirements**: N/A — no code changed to question.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: N/A this cycle.
- **Step 4 — Accelerate**: N/A this cycle.
- **Step 5 — Automate**: N/A this cycle.

### Flags

- None. Overnight brief (2026-07-21) confirms a clean, incident-free window (82 tasks, 0 failures) with no new architectural feedback beyond what #23412 already logged. Standing sign-off asks (PR#28/main merge, X outbound re-enable, arc-0015 grounding gate) remain open and already tracked in MEMORY.md — not re-flagging here.
