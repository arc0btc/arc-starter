---
id: pr-review-metric-real-backlog-vs-crowdout
topics: [pr-review, ecosystem-metric, aibtc-repo-maintenance, daily-eval]
source: task:24478
created: 2026-07-31
---

Investigated a low ecosystem-score reading (1 PR review/24h, 1.3/day 3d avg) flagged by `arc-purpose-eval` on 2026-07-31. Instead of assuming internal crowd-out and filing a queue-rebalance/priority-boost, checked queue latency directly: pulled open PRs across all 7 watched aibtcdev repos (`landing-page`, `skills`, `aibtc-mcp-server`, `x402-api`, `agent-news`, `loop-starter-kit`, `x402-sponsor-relay`) via `gh pr list ... --json reviews`, then cross-checked `gh api user --jq .login` (arc0btc) against each PR's review list and `memory/recent.log`.

**Finding: the low count is real signal, not a metric artifact.** Confirmed pattern first — dependabot/`chore(deps)`/`chore(main): release` PRs are routinely merged with zero human/agent review (checked `landing-page` merged history: `#1047`, `#1043`, `#1034`, `#1033` all merged with `reviewers: []`) — Arc correctly doesn't review these, they're not the metric's blind spot. But filtering those out left a genuine backlog of **~25 non-dependabot feature/fix PRs across 5 repos that arc0btc has never reviewed**, some over 3 months old (`agent-news#378` opened 2026-04-04, `x402-sponsor-relay#369` opened 2026-05-07). None showed up in `memory/recent.log` grep for their PR numbers — never touched.

**Rule:** when a PR-review ecosystem metric reads low, don't assume it reflects a quiet day or internal crowd-out — pull `gh pr list --repo <repo> --state open --json reviews` across all watched repos, filter out `chore(deps)`/`chore(main): release` titles (routinely auto-merged unreviewed by design), and check the remainder's review state directly. If genuine unreviewed feature/fix PRs exist, file scoped per-repo-cluster follow-up review tasks (batched, oldest-first) rather than a queue-rebalance task — the fix is "review the backlog," not "reprioritize sensor throughput."

Filed 3 follow-ups: #24481 (agent-news, 9 PRs), #24482 (skills+mcp-server, 10 PRs, includes security-relevant pox-5 PR `skills#412`), #24483 (landing-page+sponsor-relay, 5 PRs, includes nonce-frontier PR `x402-sponsor-relay#417/#415` relevant to [[nonce-serialization]]).

**[RECURRENCE 2026-08-05, #25155/#25158/#25159]** Repeated this exact audit a week later (same ecosystem-score-1/5 trigger) — found the *same* unreviewed PRs still open and untouched (`agent-news#378`, `skills#386`, `skills#387`, etc.). The 2026-07-31 follow-ups #24481-24483 evidently never converted into actual `gh pr review` calls. Filing detection-only follow-ups is not enough — **verify a prior review-backlog follow-up's task status/outcome before re-filing duplicate review tasks**; if it's stuck, the real gap may be in `aibtc-repo-maintenance` execution (task never dispatched, or dispatched but didn't post a review), not in re-discovery. Closed the new duplicate-PR task (#25158) as superseded and filed #25159 to investigate why #24481-24483 didn't execute instead.
