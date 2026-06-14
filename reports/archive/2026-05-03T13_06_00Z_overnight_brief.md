# Overnight Brief — 2026-05-03

**Generated:** 2026-05-03T13:06:00Z
**Overnight window:** 2026-05-03T03:00Z to 2026-05-03T13:00Z (8pm–6am PST)

---

## Headlines

- **501 PR reviews in 10 hours** — Massive throughput: 406 first-reviews + 95 re-reviews processed overnight across aibtcdev/agent-news, aibtcdev/landing-page, aibtcdev/x402-sponsor-relay, aibtcdev/loop-starter-kit, and aibtcdev/tx-schemas. This is Arc's highest single-session review volume.
- **17 failures all from stale/non-existent PR numbers** — Sensor is creating review tasks for PRs that don't exist (numbers not found in repo, or merged before task ran). Systematic issue: no pre-queue existence check.
- **Whoabuddy shipped significant perf work** — PR #731 on agent-news: materialise `correspondent_stats` for hot-path reads. Targets Cloudflare D1 rows-read reduction from 202.7M/h to tens of M/h. Two push events at 06:33 and 08:16 UTC iterating on the branch.

## Needs Attention

- **Resend email credentials not set** — `Send IC email confirmation test via Resend to mars@drx4.xyz` (task #14776) failed. Whoabuddy must: complete Resend signup, set up DNS, then run `arc creds set --service resend --key api_key --value <key>` and `arc creds set --service resend --key from_address --value arc@arc0btc.com`. Blocking IC email channel setup required by 2026-05-02 deadline (already past).
- **arc0btc.com blog freshness timed out** — Task #14343 ("Fix arc0btc.com health issue(s): freshness: latest post 2d ago") timed out on sonnet. Blog is stale; needs a fresh post or freshness fix.
- **Stale PR sensor problem** — 17 task failures overnight, all from the pattern "PR #N does not exist on repo/X." The review-task sensor is not checking PR existence before queuing. Consider adding an existence gate or expiry to the sensor.

## Task Summary

| Metric | Value |
|--------|-------|
| Completed | 508 |
| Failed | 17 |
| Blocked | 0 |
| Cycles run | 526 |
| Total cost (actual) | $123.43 |
| Total cost (API est) | $123.43 |
| Tokens in | 165,166,311 |
| Tokens out | 990,966 |

### Completed tasks (notable non-review work)

| ID | Subject | Summary | Cost |
|----|---------|---------|------|
| #14428 | CEO review — 2026-05-03T03:13 | On track — 40 completed, 97%+ success, dispatch-stale suppression shipped, 10 PR reviews | $0.27 |
| #14436 | Email watch report to whoabuddy | Watch report emailed to whoabuddy@gmail.com | $0.37 |
| #14460 | GitHub @mention — Sales DRI live board #570 | Posted IC #4 check-in: RFC T-4d, BlockRun.ai window passed, payout backlog pending | $0.25 |
| #14635 | GitHub @mention — EIC Daily Sync #720 | Corroborated Secret Mars wallet addresses; confirmed old SP4DXVEC address compromised | $0.24 |
| #14660 | GitHub @mention — secret-mars/drx4 IC pool email gate | Commented on #34 with Resend blocker; created task #14771 for whoabuddy | $0.26 |
| #14473 | GitHub @mention — Zen Rocket inquiry | Marked resolved: 31 on-chain txids posted, Eclipse Luna apologized | $0.18 |
| #14718 | health alert: stale lock | False positive handled — lock PID alive (current dispatch) | $0.21 |
| #14796 | health alert: stale lock | False positive handled — same pattern | $0.17 |
| #14327 | Assess release: bedrock-sdk-v0.29.1 | Patch bug fix; Arc doesn't use Bedrock SDK — no action | $0.22 |
| #14349 | Assess release: bedrock-sdk-v0.29.0 | Auth header for mantle client; no action | $0.20 |

**PR reviews: 501 total** ($114.95) — across agent-news (90+), landing-page (90+), x402-sponsor-relay (40+), loop-starter-kit (30+), tx-schemas (20+). See task list for individual review decisions.

**Skills integration ghost tasks:** Multiple duplicate tasks for `skills-v0.40.0` and `skills-v0.37.0` integration — all completed as "already integrated." These are workflow-dedup ghost row pattern recurrences; integration was done months ago.

### Failed or blocked tasks

| ID | Subject | Root cause |
|----|---------|-----------|
| #14343 | Fix arc0btc.com health: freshness | Timed out after 15min on sonnet |
| #14776 | Send IC email via Resend | Resend credentials not set |
| #14338 | Review PR #667 (agent-news) | PR doesn't exist (latest is #729) |
| #14387 | Review PR #584 (landing-page) | PR not found in repo (wrong repo/number) |
| #14405 | Review PR #291 (x402-sponsor-relay) | PR gap — skipped number |
| #14476 | Review PR #99 (x402-api) | PR doesn't exist (highest is #118) |
| #14543 | Review PR #267 (x402-sponsor-relay) | PR not found (repo at #368) |
| #14560 | Review PR #561 (landing-page) | PR doesn't exist — 3 attempts total (#14560, #14677, #14795) |
| #14570 | Review PR #677 (agent-news) | PR doesn't exist |
| #14730 | Review PR #592 (landing-page) | PR doesn't exist |
| #14731 | Review PR #595 (landing-page) | PR doesn't exist |
| #14763 | Review PR #291 (x402-sponsor-relay) | PR gap — skipped number |
| #14780 | Review PR #320 (agent-news) | PR not found (repo at #730+) |
| #14782 | Review PR #254 (skills) | PR doesn't exist; #264 already merged |
| #14829 | Review PR #499 (agent-news) | PR doesn't exist (404) |

Pattern: sensor is creating tasks from stale PR sources. No existence check before queuing.

## Git Activity

```
cc22eb86 feat(email): add Resend backend for outbound email to external addresses
```

Resend email backend shipped overnight — but credentials not yet set, so the first use (IC email test) failed.

## Partner Activity

Whoabuddy was active overnight (PST evening):

- **06:17–08:16 UTC**: Created and iterated on branch `fix/correspondent-stats-materialized` in aibtcdev/agent-news
- **PR #731 opened** (06:18 UTC): "fix: materialise correspondent_stats for hot-path bounded reads" — materialised aggregate table for correspondent stats. Targets Cloudflare D1 rows-read reduction from 202.7M/h → tens of M/h. Migration 29 backfill, 4 read-site rewrites, recon endpoint added. Tests: 28 passing.
- **Two push iterations** at 06:33 and 08:16 UTC — iterating on the branch.

This is a significant performance PR that Arc should review and approve promptly.

## Sensor Activity

- **arc-service-health**: Dispatch-stale suppression holding — 2 stale-lock alerts auto-resolved as false positives. No actual stalls.
- **PR review sensor**: Running — but creating tasks for non-existent PRs at ~3% failure rate overnight.
- **aibtc-heartbeat / aibtc-inbox-sync**: Ran normally; no anomalies detected.
- **bitcoin-macro sensor**: No signals triggered overnight — price and hashrate within normal bounds.
- **Skills integration sensor**: Ghost tasks for v0.37.0 and v0.40.0 continuing to re-trigger despite completion. Workflow-dedup ghost row pattern (committed fix 2482db11) may not have caught all cases.

## Queue State

**Pending now (morning):**
- 1 re-review at P4 (PR #588 landing-page beat consolidation)
- 14+ PR reviews at P5 across agent-news, landing-page, x402-sponsor-relay, loop-starter-kit, aibtc-mcp-server
- Active task: this overnight brief (#14947)

Morning priority: clear the PR review backlog, review PR #731 (whoabuddy's correspondent_stats perf fix), then address the Resend/blog freshness blockers.

## Overnight Observations

- **Cost spike**: $123.43 for this window vs $4.02 for previous overnight. The entire difference is explained by 501 PR reviews at ~$0.23/each. Prior overnight had 12 tasks. The review sensor is running at full throttle.
- **Stale PR task problem is real**: 17/525 failures (3.2%) are all the same root cause. Each one burns $0.18–0.30 in dispatch cost before failing. A pre-queue existence check would eliminate these entirely.
- **Ghost integration tasks**: skills-v0.40.0 triggered 8+ duplicate tasks overnight. Workflow dedup fix (pendingTaskExistsForSource) must not be catching integration workflow sources. Worth investigating.
- **IC email deadline slipped**: 2026-05-02 mandatory email channel deadline passed; Resend setup still pending whoabuddy action. This is escalating.

---

## Morning Priorities

1. **Review PR #731** (whoabuddy's correspondent_stats materialisation) — significant infra work deserves prompt review
2. **Resend setup** — escalate to whoabuddy: IC email deadline already past
3. **arc0btc.com freshness** — create a targeted follow-up task (smaller scope, not "fix everything")
4. **PR review sensor audit** — investigate stale PR number sources; add existence check or expiry gate
5. **Skills integration ghost rows** — investigate why v0.37.0 and v0.40.0 workflows are still re-triggering
