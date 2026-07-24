# Overnight Brief — 2026-07-20

**Generated:** 2026-07-20T13:04:07Z
**Overnight window:** 2026-07-19T20:00 PST to 2026-07-20T06:00 PST (2026-07-20T03:00Z to 13:00Z)

---

## Headlines

- Clean night: 79/79 tasks completed, 0 failures, 0 new blockers. $56.39 actual spend across 79 cycles.
- PR review load was heavy and productive: 12 aibtc-mcp-server/agent-news PRs reviewed or re-reviewed overnight, including catching and confirming the fix for a real fund-loss bug (USDCx sends routed as plain STX transfers, PR #616/#619) before merge.
- Whop SKU packaging pipeline shipped 3 new products from the arc-link-research backlog (agent-council-dsl-spec, h100envy swarm recipe, loop-engineering field notes), dropping the unpackaged backlog from 15 to 12.

## Needs Attention

- `reports/` was silently added to `.gitignore` in commit `b0dbd6c5` (part of last night's tmp/ cleanup), which breaks the watch-report/overnight-brief auto-commit step. Follow-up already filed and pending (#23295, priority 5, `openrouter:glm`) — this brief itself will need `git add -f` until that lands.
- 6 `arc-opensource` sync tasks (#22116 through #23135) remain blocked on the same root cause: `feat/x-api-pay-per-use-dollar-budget` diverged from main after PR #28's merge. Diagnosis has since been corrected (zero actual conflicts, branch is a strict superset of main) and narrowed to one decision — approve `gh pr create` + merge (#23159, #23150). Still awaiting whoabuddy sign-off; unblocks 7 dependent tasks total.
- arc-0015 (link-research grounding gate) sign-off nudge sent directly to whoabuddy@gmail.com overnight (#23257) after 4 consecutive eval cycles flagged it unactioned. No reply yet as of this brief.
- 3 other long-standing sign-off asks still open with no reply: X kill-switch re-enable (#22887), PR #28 push authorization (#21989), Whop SKU overlap decision (#21499).

## Task Summary

| Metric | Value |
|--------|-------|
| Completed | 79 |
| Failed | 0 |
| Blocked (new overnight) | 0 |
| Cycles run | 79 |
| Total cost (actual) | $56.39 |
| Total cost (API est) | $29.32 |
| Tokens in | 62,074,713 |
| Tokens out | 299,492 |

### Completed tasks

Highlights (full list is 79 tasks, dominated by PR reviews and their retrospectives):

- **PR reviews (aibtc-mcp-server x402 rework, #613 series):** #616 (requested changes → fixed → approved), #617 (approved, flagged merge-order coordination), #618 (requested changes, then re-reviewed and approved after correcting a misread), #619 (approved, byte-identical resubmit of #616), #620 (approved), #621 (approved), #622 (already merged, no-op).
- **PR reviews (agent-news):** #874 (approved w/ test-coverage suggestion), #876 (approved, lockfile-only dep bump), #877 (approved, flagged since/reviewed_at boundary question), #879 (approved w/ suggestions), #880 (approved), #882 (requested changes — stale test assertions CI wouldn't catch), #883 (requested changes — added test doesn't actually fail + lives outside CI's vitest glob).
- **Whop SKU packaging:** #23217 (agent-council-dsl-spec.md → prod_pB5Q7528DKCH5), #23218 (h100envy swarm recipe → prod_nVZWzNv2i9c1p, with a route-collision workaround), #23219 (loop-engineering field notes → prod_gFUsmze6tN028, same collision pattern).
- **Housekeeping/audits:** #23220 (report archiving already automatic, no action), #23221 (patterns.md already under threshold), #23222 (sensor-health audit, all 91 sensors healthy), #23223 (lint-skills full tree, zero violations), #23227/#23253 (self-review/daily-audit, clean), #23250 (cost efficiency review — no misrouted tasks found), #23254 (architecture review, 7th consecutive clean-diff cycle), #23255 (fixed 3 stuck workflow tasks that completed but never called their transition CLI), #23256/#23275 (skills catalog regenerated and deployed to arc0.me).
- **arXiv digest:** #23265 (50 papers fetched, 19 LLM/agent-relevant, digest compiled).
- **~30 haiku retrospectives** extracted reusable patterns into `memory/patterns.md` (type-widening/exhaustive-branch, stacked-branch PR review, byte-identical-resubmit carryover, data-contract test staleness, virtual-field filter validation, etc.) — see Overnight Observations.
- **Recurring `script`-model tasks:** x402 Worker sync (multiple, all no-op "use --entry mode"), housekeeping issue sweeps (4 runs, 1 fix each).

### Failed or blocked tasks

Clean night — no failures. No new blockers opened overnight (all 17 currently-blocked tasks are pre-existing, see Needs Attention and Queue State).

## Git Activity

52 commits overnight. Mix of routine `chore(loop): auto-commit after dispatch cycle` (the majority) and deliberate commits:

- `ac57b8ba` docs(memory): recurring signalContentFingerprint regression pattern (agent-news)
- `527ca794` docs(memory): new-release assess-task transition gap (#23255)
- `437000f8` docs(architect): update state machine and audit log
- `b0dbd6c5` chore: gitignore tmp/ scratch directory — **this is the commit that also caught `reports/` in the ignore pattern, see Needs Attention**
- `d1ad2135` chore(memory): daily-eval 2026-07-20 — 2.20/5 (#23251)
- `d275f69e` chore(memory): auto-persist on Stop
- `0cf1ba3e` docs(memory): stacked-unmerged-branch PR review pattern (#617)
- `953d0dc5` docs(report): watch report 2026-07-20T130012Z

## Partner Activity

No partner activity overnight — whoabuddy's public GitHub event feed shows zero events since 2026-07-20T03:00Z.

## Sensor Activity

91 sensors audited overnight (#23222), all healthy. Two known non-issues surfaced and correctly not actioned:

- `candidate-maturation`: 3 consecutive failures — X read-budget exhaustion (confirmed via `last_error`, spend $1.766/$2.00 cap), self-resolves at midnight UTC.
- `x-news-trends`: 1 transient 90s timeout, below the 3-failure pattern threshold.

`arc-research-decay` sensor confirmed running on schedule (24h interval), 536 files archived to date, 156 active reports all under the 30-day threshold.

## Queue State

3 pending tasks, 1 active (this brief), 17 blocked (all pre-existing, none new overnight — see Needs Attention for the highest-priority ones):

- #23295 (P5, `openrouter:glm`) — fix the `reports/` .gitignore regression from `b0dbd6c5`.
- #22262 (P6, `sonnet`) — re-check stale-task pileup after stop_condition field rollout.
- #23296 (P8, `haiku`) — retrospective for the 13:00Z watch report task.

Overall task counts: 20,471 completed / 2,763 failed (lifetime) / 17 blocked / 33 cancelled / 3 pending / 1 active.

## Overnight Observations

- **Retrospective yield was high and non-redundant tonight.** Of ~30 haiku retrospectives, most extracted genuinely new pattern variants (byte-identical-resubmit carryover, data-contract test-assertion staleness, virtual-field-filter validation, workaround-code-stale-shape gotcha) rather than restating existing patterns — a good sign the pattern library is still absorbing real signal, not just accumulating noise.
- **PR review volume (12 reviews/re-reviews) was concentrated on one cross-repo feature (`aibtc-mcp-server` x402 asset-selection rework, #613).** The stacked-branch pattern recurred multiple times (#617, #621) — external contributors branching off each other's unmerged work before merge, requiring Arc to distinguish "wrong code" from "correct code sitting on an unmerged base." This is now a documented pattern (`p-pr-lifecycle-audit-discipline` extension) rather than a one-off.
- **The `b0dbd6c5` gitignore regression is a good illustration of the auto-commit blind spot**: a broadly-scoped `chore: gitignore tmp/` commit had an unintended side effect (silently excluding `reports/`) that wasn't caught until the next report-generation task tried to commit and got worked around with `git add -f`. Worth considering whether cleanup-scoped commits that touch `.gitignore` should get an extra diff-review step.

---

## Morning Priorities

1. **Sign-off backlog is the single biggest lever right now.** Five distinct asks are sitting with no reply: the branch-merge decision (#23159/#23150, unblocks 7 tasks), arc-0015 grounding gate (#23257, cost driver for 4+ evals), X kill-switch re-enable (#22887), PR #28 push authorization (#21989), and the Whop SKU overlap call (#21499). None require deep investigation — all are narrowed to a single yes/no. Clearing even 2-3 of these would meaningfully shrink the blocked queue.
2. **Fix the `reports/` .gitignore regression (#23295)** — currently only priority 5, but every report-generation task will keep needing `git add -f` workarounds until it lands.
3. No urgent operational fires — spend, task success rate, and sensor health are all clean. Good morning to spend on the sign-off queue rather than new work.
