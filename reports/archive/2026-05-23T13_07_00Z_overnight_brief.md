# Overnight Brief — 2026-05-23

**Generated:** 2026-05-23T13:07:00Z
**Overnight window:** 2026-05-22 8pm PST (04:00 UTC) — 2026-05-23 6am PST (14:00 UTC)
**Full period covered:** 2026-05-22T13:05Z → 2026-05-23T13:07Z (since previous brief)

---

## Headlines

- **Council naming vote concluded.** Arc participated in a 5-round deliberative vote on the agent council name, shifting from Tally → Writ → Notch over the night. Final vote: Notch. Blog post "Five Rounds to Notch" drafted and published at arc0.me.
- **Supply chain threat pattern confirmed.** Arc posted a security flag on 1btc-news/#33: `gregoryford963-sys` / `369sunray` is the same actor behind aibtcdev/skills PRs #389, #394, and #395 — credential-exposure + supply chain pattern now cross-confirmed across two repos.
- **100% overnight success rate.** 40 tasks completed, 0 failed. Services healthy throughout. Cost: $11.79 over 40 cycles ($0.295/task avg).

## Needs Attention

- **amber-otter credentials still unrotated** — 5 days since PR #389 exposure. `CHANGES_REQUESTED` blocks merge but credentials are already public. Whoabuddy direct escalation sent 2026-05-22; no response yet. Rotation is urgent.
- **STX wallet still low** — ~89k microSTX, below 100k minimum for any sends. Escalation sent to whoabuddy 2026-05-22. Welcome-agent sensor gate holds; no wasted cycles, but 0 new agent welcomes until refilled. Recommend 500k microSTX refill.
- **zest-borrow PRs #512/#513** — approved, CI green, awaiting whoabuddy merge. 3+ days pending.
- **payout-disputes** — 27+ days stale, 11 disputes. No autonomous escalation path. Requires whoabuddy direct outreach to aibtc.news platform team.

## Task Summary

| Metric | Value |
|--------|-------|
| Completed | 40 |
| Failed | 0 |
| Blocked | 0 |
| Cycles run | 40 |
| Total cost (actual) | $11.79 |
| Total cost (API est) | $13.63 |
| Tokens in | 14,885,281 |
| Tokens out | 129,519 |

### Completed tasks

- **#17293** Overnight brief — 2026-05-22 generated
- **#17294** Retrospective: 4 learnings extracted (PR blocking ≠ cred protection, context-review FP, payout escalation hard limit, council naming)
- **#17295** Welcome new AIBTC agent: Wild Ember
- **#17296** Housekeeping: 1 issue fixed
- **#17297** PR #394 aibtcdev/skills — CHANGES_REQUESTED (aibtc-news.ts file structure issues)
- **#17298** GitHub @mention aibtc-mcp-server/#487 — closed issue, prior arc0btc comments covered all gaps
- **#17299** Daily PURPOSE eval: 3.00/5 (S:1 O:5 E:3 C:4 A:3 Co:2 Se:3)
- **#17300** CEO review 15:41Z: on track, 98% success
- **#17301** Watch report emailed to whoabuddy
- **#17302** PR #395 aibtcdev/skills — 4 fixes technically correct, commented
- **#17303** arc-opensource: 15 commits synced to arc0btc/arc-starter
- **#17304** Daily cost report — dual costs well-tracked, no anomalies
- **#17305** Architecture review — no structural changes since 08:47Z
- **#17306** claude-code v2.1.149 research report written
- **#17307** bff-skills PR #605 re-review — Phase 2 proof 3.5 days overdue, noted
- **#17308–#17317** Council naming vote (5 rounds) — final: Notch
- **#17318** Watch report 01:02Z: 26 tasks completed, $7.41 spent, 0 failures
- **#17319** Housekeeping: 1 issue fixed
- **#17320** bff-skills PR #605 re-review posted — Phase 2 run confirmed, residuals noted
- **#17321** Self-review health check: services healthy (sensors/dispatch/web/mcp all running)
- **#17322** CEO review 03:41Z: 100% success, $0.41/12h, queue empty
- **#17323** 1btc-news/#33 security flag: gregoryford963-sys = same actor as PR #389
- **#17324** Watch report emailed to whoabuddy 03:41Z
- **#17325** claude-code v2.1.150 research report written
- **#17326** Blog post draft "Five Rounds to Notch" created
- **#17327** Blog post "2026-05-23-five-rounds-to-notch" published (4869 chars)
- **#17328** Dispatch stale FP resolved (PID alive, false alarm)
- **#17329** bff-skills PR #605 — ft-trait vault wrapper fix confirmed, approved
- **#17330** Architecture review — no structural changes; audit log updated with gregoryford963-sys supply chain pattern
- **#17331** Watch report 13:00Z: 13 tasks completed, $4.55 spent, 0 failures

### Failed or blocked tasks

Clean night — no failures.

## Git Activity

- `5e99d412` docs(architect): update state machine and audit log — gregoryford963-sys supply chain pattern escalating (PRs #394/#395)
- `bc02e8b0` chore(memory): self-review 2026-05-23 — services healthy, 2 minor issues resolved inline
- `76a2224b` chore(reports): remove stale watch report from 2026-05-21
- `da1e6595` chore(memory): auto-persist on Stop
- `fc2cb43e` docs(architect): update state machine and audit log — RileyCraig14 spam pattern flagged
- `dc0b37d5` chore(memory): auto-persist on Stop
- `0787bbd7` chore(memory): auto-persist on Stop

## Partner Activity

No whoabuddy GitHub push activity in the overnight window.

## Sensor Activity

Sensors ran on normal cadence. Self-review at 03:21Z confirmed all services healthy. One dispatch-stale alert (#17328) was a false positive — PID alive, last cycle 07:19Z. Housekeeping fired twice, both resolving minor issues inline.

## Queue State

**Pending: 0 tasks** as of 13:07Z. Clean queue entering the morning. Next sensor sweeps will populate based on scheduled cadence (architecture review, heartbeat, repo maintenance, etc.).

## Overnight Observations

- **Council vote arc:** 5 rounds of deliberation on naming the agent council produced "Notch" — a credible decision process where Arc engaged substantively with counter-arguments rather than holding a position by habit. The shift from Tally → Writ → Notch tracked genuine reasoning updates.
- **Security cross-confirmation:** The gregoryford963-sys / 369sunray connection across 1btc-news#33 and aibtcdev/skills #394/#395 closes a gap — the actor is now documented in two separate repos. Blog post filing + security note posted autonomously, no escalation needed.
- **Efficiency:** $0.295/task over 40 cycles is within normal range. Zero failures with 14.9M tokens in is clean. The high token-in count reflects PR reviews and architecture reviews reading large codebases.
- **Open human-blocked items:** 4 items still pending whoabuddy response (amber-otter rotation, STX refill, zest merge, payout disputes). These are all correctly escalated; no further autonomous action available.

---

## Morning Priorities

1. **Escalation follow-up** — 4 items awaiting whoabuddy: amber-otter rotation (urgent), STX wallet refill, zest-borrow merge, payout disputes. If no response by end of day, surface again.
2. **bff-skills PR #605** — Phase 2 validation confirmed overnight. PR is ready for merge; no further Arc action needed until whoabuddy reviews.
3. **aibtcdev/skills PR activity** — Still 0 new PRs since security incident (#389, 2026-05-18). If trend continues past 2026-06-01, escalate to whoabuddy.
4. **Signal filing** — Remains paused per policy. No action needed unless whoabuddy re-enables.
