## 2026-08-11T09:57:00.000Z — arc-link-research cache hygiene shipped + one real bug caught; 129 skills / 91 sensors (unchanged)

**Task #25771** | Diff: 40168b9..d7eb868 | Sensors: 91 | Skills: 129

### Changed files (substantive only)

- `skills/arc-link-research/cli.ts` (73e48c573, #25742) — new `sweep-cache --ttl-days N [--dry-run]` (default 90d) evicts raw fetch cache by `fetchedAt`, falling back to file mtime for legacy entries. Report-linkage (`cached_path`) was correctly rejected as the eviction key — only 12% of reports populate it. Ran once: 316/1739 stale entries swept.
- `skills/arc-housekeeping/{SKILL.md,cli.ts}` (7b5221361) — wires `sweep-cache --dry-run` into `check`'s issue count and `sweep-cache` (real) into `fix`, following the existing `archivalNeeded` pattern. Closes the loop opened by the previous commit — a one-shot cleanup would've re-accumulated unbounded otherwise.
- `skills/arc-housekeeping/cli.ts` (bfe6b158d) — **real bug, now fixed**: the 2026-03-04 skill-rename refactor (4ffd1a658) silently renamed `ARCHIVAL_DIRS` from `research` to `arc-link-research`, pointing the ISO-8601 archival check at an unused legacy dir instead of the real `research/` output. `research/` grew to 218 unarchived reports over 5 months with zero automated archival and no error signal — a rename that broke a check by string-matching a dir name that no longer existed, silently. Restored, ran fix, archived 202 backlogged reports.
- `skills/arc-link-research/cli.ts` (44596416a) — added self-improvement/fleet keywords to the relevance heuristic after a retrospective (#25713) found a paper on Arc's own beat false-negatived for lacking a BTC/crypto token. Targeted addition, not a broad scope expansion.
- Remaining commits in range are non-structural: this skill's own prior diagram commit, an `arc-weekly-presentation` deck generation, and ~75 `arc-link-research` cache-file auto-commits (data, not code — now subject to the new TTL sweep).

### Steps 1–5

- **Step 1 — Requirements**: All four fixes trace to named issues (#25742, #25713) or a concretely observed defect (silent rename) — not speculative.
- **Step 2 — Delete**: Applied by proxy — 316 stale cache files + 202 backlogged reports evicted/archived this cycle, and both are now recurring housekeeping fixes rather than one-shots.
- **Step 3 — Simplify**: N/A this cycle — no new abstraction added; `sweep-cache` follows the existing `archivalNeeded` check/fix pattern instead of introducing a new one.
- **Step 4 — Accelerate**: N/A this cycle.
- **Step 5 — Automate**: N/A this cycle — automation only added after the TTL-vs-report-linkage design question (step 1) was settled first, correct ordering.

### Flags

- **Pattern worth naming**: `bfe6b158d` is a second confirmed case (after `misplaced-brace-scoped-out-normal-path` and `sensor-health-report-blind-spots` in shared memory) of a refactor silently disabling a check by renaming a string constant with no test/assertion tying it to the real directory. Housekeeping-style checks that key off literal path/dir strings are a recurring blind spot — no follow-up filed since housekeeping's own audit now caught and fixed it, but future skill-rename tasks should grep for string-literal directory/skill-name references, not just import paths.
- Audit findings this cycle (14: 0 error, 6 warn, 8 info) are all pre-existing SKILL.md token-limit warnings and AGENT.md-without-sensor/cli infos, unrelated to this diff's changed files — no new findings introduced by this cycle's commits.
- No new reports since last review beyond the routine weekly deck generation (non-substantive, data only).
- All existing blocked items (charter-store-governance #23833, Cloudflare Workers Builds #23977, news-legion mainnet sBTC ask #24776, X kill-switch #22885/87, whop-sku #21499, claude-cli drift #25383/90) correctly held, already tracked in MEMORY.md.

---
## 2026-08-10T21:56:00.000Z — empty diff range (self-referential), zero structural change; 129 skills / 91 sensors (unchanged)

**Task #25682** | Diff: 40168b9..40168b9 (0 commits) | Sensors: 91 | Skills: 129

Diff range collapsed to the same commit — no `src/`/`skills/` changes to walk since the last review. Diagram regenerated (129 skills, 91 sensors, unchanged counts). Checked reports since last review (2026-08-10T01:02:41Z watch report): two new reports (2026-08-10T13:00/13:01 watch report, 2026-08-10T14:00Z overnight brief) — clean overnight window, housekeeping/memory consolidation dominated, no failures, no new architecture-relevant CEO/whoabuddy feedback, no new blocks. No findings, no follow-ups filed. All existing blocked items (charter-store-governance #23833, Cloudflare Workers Builds #23977, news-legion mainnet sBTC ask #24776, X kill-switch #22885/87, whop-sku #21499, claude-cli drift #25383/90) correctly held, already tracked in MEMORY.md.

---

## 2026-08-10T09:56:00.000Z — cache-only diff (arc-link-research), zero structural change; 129 skills / 91 sensors (unchanged)

**Task #25633** | Diff: 1d08f66..40168b9 (5 commits) | Sensors: 91 | Skills: 129

### Changed files (substantive only)

- None. All 5 commits in range are `chore(loop): auto-commit after dispatch cycle` touching only `skills/arc-link-research/cache/*.json` (55 files total) — link-research response cache entries, not code. No `src/`, `cli.ts`, `sensor.ts`, or `SKILL.md` changes.

### Steps 1–5

- **Step 1 — Requirements**: N/A this cycle — no code changed to question.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: N/A this cycle.
- **Step 4 — Accelerate**: N/A this cycle.
- **Step 5 — Automate**: N/A this cycle.

### Flags

- New reports since last review (2026-08-09T13:00/13:01, 2026-08-10T01:02) contain routine ops summaries only, no new architecture-relevant CEO/whoabuddy feedback.
- All existing blocked items (charter-store-governance #23833, Cloudflare Workers Builds #23977, news-legion mainnet sBTC ask #24776, X kill-switch #22885/87, whop-sku #21499, claude-cli drift #25390) correctly held, already tracked in MEMORY.md.

---

## 2026-08-09T21:55:00.000Z — data-only diff (article auto-package), zero structural change; 129 skills / 91 sensors (unchanged)

**Task #25574** | Diff: 88bf15e..1d08f66 (1 commit) | Sensors: 91 | Skills: 129

### Changed files (substantive only)

- None. The single commit in range (`1d08f666e chore(article-pipeline): auto-package article 22`) touches only `skills/arc-article-pipeline/drafts/article-22-x-article.json` (+ `.bak` sibling) — generated draft data, not code. No `src/`, `cli.ts`, `sensor.ts`, or `SKILL.md` changes.

### Steps 1–5

- **Step 1 — Requirements**: N/A this cycle — no code changed to question.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: N/A this cycle.
- **Step 4 — Accelerate**: N/A this cycle.
- **Step 5 — Automate**: N/A this cycle.

### Flags

- New reports since last review (2026-08-09T13:00Z overnight brief, 2026-08-09T13:01Z watch report): clean overnight window, 73/74 cycles completed, 100% success, no new architecture-relevant CEO/whoabuddy feedback, no new blocks.
- All existing blocked items unchanged, tracked in MEMORY.md (news-legion #24776, X kill-switch #22885/87, whop-sku #21499, arc-0015 grounding gate, claude-cli drift #25383/90, store-governance injection #23833).

---

## 2026-08-09T09:55:00.000Z — one bounded single-file bug fix, zero structural change; 129 skills / 91 sensors (unchanged)

**Task #25523** | Diff: 9a72a69..88bf15e | Sensors: 91 | Skills: 129

### Changed files (substantive only)

- `skills/aibtc-repo-maintenance/cli.ts` (7eed877eb, follow-up to #25463) — `cmdStatus`'s `unreviewedPrs` count only checked for an `arc0btc` review, which is structurally impossible on arc0btc-authored PRs (GitHub disallows self-review) and noisy for dependabot/chore(deps) PRs already auto-skipped elsewhere by `arc-workflows`' `shouldSkipPrReview`. Now filters both out, reusing the existing `AUTOMATED_PR_PATTERNS` export from `arc-workflows/state-machine.ts` rather than duplicating the pattern list. Bounded, single decision point (status metric computation), correct reuse of an existing cross-skill export instead of a new one.
- Remaining commits in range are non-structural: this skill's own prior diagram/audit-log commit, an `arc-opensource` sync (69 commits pushed, no src/skills content), and ~30 `arc-link-research` cache-file auto-commits (data, not code).

### Steps 1–5

- **Step 1 — Requirements**: Fix traces to a named false-positive (#25463, status metric inflated by self-authored/bot PRs) — not speculative.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: N/A — reuses an existing export instead of adding one; correct move, no further simplification available.
- **Step 4 — Accelerate**: N/A this cycle.
- **Step 5 — Automate**: N/A this cycle.

### Flags

- One new report since last review (2026-08-09T01:01:35Z watch report): quiet 12h window, 59 tasks/0 failures, one article published, no new architecture-relevant CEO/whoabuddy feedback.
- All existing blocked items (charter-store-governance #23833, Cloudflare Workers Builds #23977, news-legion mainnet sBTC ask #24776, X kill-switch #22885/87, whop-sku #21499, claude-cli drift #25383/90) correctly held, already tracked in MEMORY.md.

---

