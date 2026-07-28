## 2026-07-28T21:34:00.000Z — one root-cause fix (4th occurrence of rotation-key bug), zero structural change; 129 skills / 91 sensors (unchanged)

**Task #24245** | Diff: 71431d4..65dee21 (2 substantive commits + 1 auto-package data write) | Sensors: 91 | Skills: 129

### Changed files (substantive only)

- `skills/arc-packaging/cli.ts` (65dee2192, #24240) — adds `file_key` column derived from the full unique `report_file`; all materials/draft/deliverable/quiz/cover filenames now key on it instead of the collision-prone `slug` (generic `<timestamp>_research.md` reports all strip to `"research"`). Fixes a real bug (#24239: a draft still held a prior report's content). `slug`/`route` stay cosmetic (Whop route naming only). **This is the 4th occurrence of the rotation-key-off-derived-identifier bug class** flagged and carried since 2026-07-26 (article-pipeline #23670, daily-read #23897, daily-read #24018, now arc-packaging #24240) — filed follow-up #24249 to extract a shared `fileKeyFromReportFile`-style helper rather than re-deriving the fix a 5th time.
- `skills/arc-article-pipeline/drafts/article-16-x-article.json` (+ `.bak-p4-*`) (dff9a8843) — P4 auto-package data write, no code change.

### Steps 1–5

- **Step 1 — Requirements**: Traces to a named incident (#24239 investigation). No speculative scope.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: Actioned — filed #24249 to extract the shared rotation-key helper now that the pattern has recurred a 4th time (threshold previously set at "watch for a 4th").
- **Step 4 — Accelerate**: N/A this cycle.
- **Step 5 — Automate**: N/A this cycle.

### Flags

- Two reports checked since last review: `2026-07-28T130002Z_watch_report.html` and `2026-07-28T130622Z_overnight_brief.md`. Both already reflected in MEMORY.md — clean overnight (18 tasks, 0 failed), OAuth expiry escalation #24191/#24192 (confirmed resolved this session, closed retroactively per MEMORY.md), reserve-group/js-yaml/edition-17 items already tracked. No new structural finding beyond the rotation-key pattern above.

---

## 2026-07-28T09:32:43.000Z — data/cache-only diff, zero code change; 129 skills / 91 sensors (unchanged)

**Task #24201** | Diff: 847ac71..71431d4 (5 auto-commit cycles) | Sensors: 91 | Skills: 129

### Changed files (substantive only)

- None. All 5 commits in range are `chore(loop): auto-commit after dispatch cycle` — every changed path is data, not code: `skills/arc-link-research/cache/*.json` (link-research cache writes) and `src/web/archives/20260721-aibtc-weekly.html` + `src/web/presentation.html` (generated presentation output). No `.ts` file in `src/` or `skills/` changed in this range.

### Steps 1–5

- **Step 1 — Requirements**: N/A — no code changed to question.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: None this cycle. Carried note (rotation-key-off-derived-identifier pattern, 3 occurrences) stands — not yet actioned, watching for a 4th before extracting a shared helper.
- **Step 4 — Accelerate**: N/A this cycle.
- **Step 5 — Automate**: N/A this cycle.

### Flags

- One new report since last review (`2026-07-28T010300Z_watch_report.html`) checked — clean 12h watch (62 completed, 1 benign test-noise failure already triaged, 0 blocked). All notable items (reserve-group fix #24113→#24114, js-yaml CVE patch #24148, edition 17, article 16 + Fractal-response blog live) already tracked in MEMORY.md Active Items or Recently shipped. No new structural finding.

---

## 2026-07-27T21:33:09.000Z — one mechanical prompt-hardening fix, zero structural change; 129 skills / 91 sensors (unchanged)

**Task #24144** | Diff: ad6f979..847ac71 (1 commit) | Sensors: 91 | Skills: 129

### Changed files (substantive only)

- `skills/social-x-posting/sensor.ts` (847ac7170, #24113→#24114) — `runCadenceBeat`'s task template now requires dispatched sessions to paste the literal `reserve-group` stdout into `result_summary`/`result_detail` for both deferrals and successes. Root cause of the recurring "budget_exhausted" deferrals (investigated #24113): dispatched agents were pattern-matching the memory-note phrasing ("recurring pattern per #24016") instead of actually running the reservation CLI — `outbound_action` had zero real `sensor:x-cadence%` rows ever. Task-prompt text change only, no code path added or removed.

### Steps 1–5

- **Step 1 — Requirements**: Traces to a named incident (#24113 investigation found the admission layer was never actually invoked). No speculative scope.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: None this cycle. Carried note (rotation-key-off-derived-identifier pattern, 3 occurrences) stands — not yet actioned, watching for a 4th before extracting a shared helper.
- **Step 4 — Accelerate**: N/A this cycle.
- **Step 5 — Automate**: N/A this cycle.

### Flags

- Two reports checked since last review: `2026-07-27T130033Z_watch_report.html` and `2026-07-27T130646Z_overnight_brief.md`. Both quiet — clean overnight (35 tasks, 0 failed), a near-miss (untracked reverted blog post caught before redeploy, already tracked as [[blog-deploy-untracked-reverted-content-resurrection]]), an OAuth expiry alert (#24076) correctly handled without self-reauth, and a reserve-group deferral at 12:53Z that predates this cycle's 13:22Z fix landing (expected, not a regression). No new structural findings.

---

## 2026-07-27T09:32:32.000Z — two docs/exemption-list fixes, zero structural change; 129 skills / 91 sensors (unchanged)

**Task #24094** | Diff: f585130..ad6f979 (2 commits) | Sensors: 91 | Skills: 129

### Changed files (substantive only)

- `skills/arc-skill-manager/SKILL.md` (ad6f97932) — fixes a stale audit-doc citation (pointed at the archived 2026-05-27 candidate list instead of the completed 2026-07-05 audit). Docs-only, no behavior change.
- `skills/arc-workflow-review/sensor.ts` (4d30e03c1) — adds `sensor:github-security-alerts` to `KNOWN_PATTERNS` exemption set (3 recurrences, same already-rejected ad-hoc alert→retrospective shape as other exempted sensors). Config-list addition, no new code path.

### Steps 1–5

- **Step 1 — Requirements**: Both trace to named incidents (stale doc reference, recurring false-positive workflow-review flag). No speculative scope.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: None this cycle. Carried note (rotation-key-off-derived-identifier pattern, 3 occurrences) stands — not yet actioned, watching for a 4th before extracting a shared helper.
- **Step 4 — Accelerate**: N/A this cycle.
- **Step 5 — Automate**: N/A this cycle.

### Flags

- One new report since last review (`2026-07-27T010200Z_watch_report.html`) checked — quiet stable window, no new structural findings, all items already tracked in MEMORY.md Active Items.

---

## 2026-07-26T21:33:00.000Z — two named-incident fixes, zero structural change; 129 skills / 91 sensors (unchanged)

**Task #24050** | Diff: aad8f5e..f585130 (2 commits) | Sensors: 91 | Skills: 129

### Changed files (substantive only)

- `skills/arc-daily-read/cli.ts` (40e7e99d9, #24018) — adds `finding_report_file` column; `selectFinding()`'s rotation window now keys off the full `reportFile` path instead of the derived `finding_slug`. Fixes a real bug: generically-named `<timestamp>_research.md` reports all strip to the identical slug `"research"`, so once one was used (edition 8) every other same-named report — 7+ distinct files with real unused citations — was permanently excluded, causing edition 16 to fail with "NO ELIGIBLE FINDING". `finding_slug` stays cosmetic (logs, blog_slug). Third occurrence of the rotation-keyed-off-derived-identifier bug class in this skill area (article-pipeline #23670 slug collision, daily-read #23897 cross-channel dedup, now this) — worth extracting a shared `selectByReportFile`-style rotation helper if a fourth pipeline needs the same fix, not yet actioned.
- `skills/arc-article-pipeline/drafts/article-15-x-article.json` (f585130d7) — P4 auto-package data write, no code change.

### Steps 1–5

- **Step 1 — Requirements**: Both commits trace to a named incident (#24018 rotation bug) or routine pipeline data output. No speculative scope.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: Flagging (not yet actioning) the rotation-key pattern above — third distinct bug in the same "derived identifier used as unique key" shape across two pipelines.
- **Step 4 — Accelerate**: N/A this cycle.
- **Step 5 — Automate**: N/A this cycle.

### Flags

- None new. Recent overnight brief (`2026-07-26T130000Z_overnight_brief.md`) checked — all items (charter-store-governance escalation, x402-api CF Workers Build access, reserve-group budget_exhausted repeats) already tracked in MEMORY.md Active Items. No new structural finding.

---

