---
name: pr-review-metric-self-review-blind-spot
metadata:
  node_type: memory
  topics:
    - arc-purpose-eval
    - metrics
    - pr-lifecycle
    - queue-diagnosis
    - aibtc-repo-maintenance
  source: task
  created: 2026-07-11
---

Second consecutive zero-PR-review-day alarm (2026-07-09/07-10, escalated via #21996
2026-07-11) — different root cause than [[pr-review-crowdout-false-alarm]] (2026-07-06,
which was pure PR-open-volume burstiness). This time there IS a real backlog of open
PRs with zero formal `reviews[]` entries — but investigating each one showed no actual
gap in judgment coverage:

**What direct inspection found across 7 watched aibtcdev repos:**
1. Every zero-review PR is either a Dependabot/Renovate auto-bump or a release-please
   `chore(main): release` PR — routine, no judgment needed, and Arc has no merge rights
   regardless (whoabuddy merges).
2. Several zero-`reviews[]` PRs are Arc's own self-authored CVE-fix PRs (e.g.
   `x402-api#130`, `x402-sponsor-relay#420/#418`, `agent-news#831`,
   `landing-page#997`) that Arc already verified via a PR **comment**, not a formal
   review — GitHub blocks self-approval via the reviews API, so `arc0btc`-authored PRs
   can never show up as reviewed by `arc0btc` in `pr.reviews`, no matter how thoroughly
   checked.
3. The substantive non-Dependabot PRs that actually need judgment (nonce-frontier fix
   `x402-sponsor-relay#415/#417`, SIP-018 tolerance `#369`, signals filter
   `agent-news#821`) were already reviewed and approved by other trusted org agents
   (Quasar Garuda / secret-mars) — real coverage exists, just not attributed to
   `arc0btc`.

**Pattern:** a "0 reviews by arc0btc" count conflates three distinct states that need
different responses: (a) no substantive PR exists to review (true idle — do nothing),
(b) Arc reviewed but via comment on its own PR (scorer blind spot — fix the scorer), (c)
another trusted agent already covered it (scorer blind spot — fix the scorer). None of
these three warrant a queue-priority boost or rebalance; only (b)/(c) warrant fixing
`scoreEcosystem()` itself. Don't stop at "check queue latency" (the 07-06 fix) — also
check PR *authorship* and *comment history*, not just the formal `reviews[]` array,
before concluding review coverage is actually missing.

**Fix filed:** #21998 — `scoreEcosystem()` should credit self-authored-PR comment
verifications and detect other-org-agent review coverage, not just `arc0btc`'s formal
GraphQL review submissions in a 24h window.

**Recurrence in a different code path, 2026-08-09 (#25463):** the same blind spot
exists independently in `cmdStatus()` (`skills/aibtc-repo-maintenance/cli.ts`, the
`arc skills run --name aibtc-repo-maintenance -- status` CLI command) — the #21998 fix
targeted `scoreEcosystem()` only, not this command. `cmdStatus`'s `unreviewedPrs` count
still just checks "does `arc0btc` appear in `pr.reviews[]`" with no exclusion for
self-authored or bot/automated-pattern PRs. Verified: reported 40 total `unreviewedPrs`
across 6 watched repos, but manual filtering (author != arc0btc, not bot, title doesn't
match `AUTOMATED_PR_PATTERNS`) found 0 genuinely actionable ones — confirming the 0-PR-
review ecosystem score reflected a real absence of new external PRs, not a queue gap.
Fix filed: #25468 — extract a shared `shouldSkipPrReview`-equivalent filter (already
implemented in `skills/arc-workflows/state-machine.ts`) that both `scoreEcosystem()` and
`cmdStatus()` call, instead of fixing each call site independently as the gap resurfaces.
