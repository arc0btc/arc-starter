# Overnight Brief — 2026-05-29

**Generated:** 2026-05-29T13:08:00Z
**Overnight window:** 2026-05-28T20:00 PST (2026-05-29T04:00 UTC) to 2026-05-29T06:00 PST (2026-05-29T14:00 UTC)

---

## Headlines

- **RFC 0007-0010 Phase 1 complete** — All four agent-runtime RFC tasks shipped: Verification Gate (0007), 5 reference skills (0008), Lessons Layer (0009), and Loom VM handover Phase 1 (0010). Arc-starter paused; agent-runtime cloned and running.
- **CF quota crisis diagnosed and partially fixed** — arc-email-worker was burning 4.67M DO row reads/day vs 5M free-tier limit. Root cause: no `since` cursor in `/api/messages` poll → full re-scan 1440×/day. Fix shipped (`b7c5f4b8`); PR #8 (composite index + COUNT drop) open. Row reads should drop from 4.67M → ~5k/day.
- **Three dispatch resilience fixes landed overnight** — sent-folder dedup guard, rate_limit_event informational classification, and default backoff for unparseable reset time all committed and live.

## Needs Attention

- **arc-email-worker still not deployed** — PR #3 (schema-health + stats cache) merged but no CI/CD pipeline exists. Filed issue #5. Manual deploy needed before any verification tasks.
- **Task #17895 pending** — Opus token reduction verification for v2.1.154 (`tokens_in` vs 352k–554k baseline). Only 1 pending task this morning; queue otherwise empty.
- **Task #17916 blocked** — Awaiting #17895 completion to close the token reduction verification loop.

## Task Summary

| Metric | Value |
|--------|-------|
| Completed | 117 |
| Failed | 4 |
| Blocked | 0 |
| Cycles run | 124 |
| Total cost (actual) | $44.75 |
| Total cost (API est) | $49.70 |
| Tokens in | 77,875,416 |
| Tokens out | 593,189 |

### Completed tasks (key items)

| ID | Model | Subject | Summary |
|----|-------|---------|---------|
| #17836 | sonnet | Email dedup guard | Sent-folder dedup live; normalizes Re:/Fwd:, --force bypass |
| #17843 | sonnet | Overnight brief 2026-05-28 | Previous brief generated successfully |
| #17844 | opus | Email from whoabuddy (dispatch restart) | FP — dispatch already self-recovered; replied no-op |
| #17857 | sonnet | RFC 0007-0010 review + publish | Committed to proposals/0007-0010-batch; awaiting push approval |
| #17858 | sonnet | RFC 0007 Verification Gate Phase 1 | Landed on feat/rfc-0007-verification-gate; 18 tests pass |
| #17859 | sonnet | RFC 0008 reference skills | 5 skills with SKILL.md + AGENT.md + 5 evals each |
| #17860 | sonnet | RFC 0009 Lessons Layer Phase 1 | src/memory.ts, patterns/ dir, dead-ends.jsonl |
| #17861 | sonnet | Loom VM handover Phase 1 | arc-starter paused (c33d41b6), agent-runtime live at /home/dev/agent-runtime |
| #17862–17865 | sonnet | Port skills (credentials, worktrees, mcp-server, peer-inbox) | All 4 ported to agent-runtime under RFC 0008 contract |
| #17870 | sonnet | Dispatch-gate default backoff | 60min DEFAULT_RATE_LIMIT_BACKOFF_MS; auto-recovery on unparseable reset |
| #17872 | sonnet | arc0me freshness fix | Published "The Resurrection Bug"; all 4 health checks pass |
| #17891 | sonnet | SDK v0.100.0 integration | claude-opus-4-8 model ID updated in MODEL_IDS.opus |
| #17913 | sonnet | arc0btc/worker-logs PR #2 | Merged — daily_stats folded into DO log(), eliminates 2nd DO fetch |
| #17917 | sonnet | arc0btc-worker PR #24 | Merged — log only non-2xx responses; cuts AppLogsDO load >95% |
| #17928 | sonnet | arc-email-sync since-cursor | CF quota fix live — expected drop from 4.67M → ~5k row reads/day |
| #17929 | sonnet | arc-email-worker composite index PR | PR #8 open — drops COUNT(*) + adds (folder, received_at) index |
| #17930 | sonnet | Watch report 2026-05-29T13:01Z | 116 tasks, $44.07, CF crisis addressed |
| 17+ FP stale alerts | sonnet | health alert: dispatch stale | All false positives — dispatch was running in all cases |

### Failed or blocked tasks

| ID | Subject | Root cause |
|----|---------|-----------|
| #17797 | Aggregate research batch email to whoabuddy | Crash-recovery artifact from rate-limit outage; idempotency check blocked re-send; manually closed |
| #17893 | Verify arc-email-worker §1 (PR #3 schema-health) | No CI/CD pipeline — worker never deployed; filed issue #5 |
| #17894 | Verify arc-email-worker §3 (PR #3 /api/stats cache) | Same root cause; no deployment; filed issue #7 |
| #17907 | Deploy arc0me-site (701ec80b) | MDX JSX parse error in catalog/index.mdx:24 — fixed by #17912 |

## Git Activity

Key commits overnight (excluding chore/loop auto-commits):

```
b7c5f4b8 fix(arc-email-sync): add since-cursor to /api/messages poll (CF quota)
651120e6 feat(arc-email-sync): add sent-folder dedup guard to send path
510b9e67 fix(dispatch): don't classify informational rate_limit_event as failure
1d0395c0 fix(dispatch): log full rate_limit_event payload before extracting reset
e423f55f fix(dispatch-gate): default backoff when rate_limit_event has no parseable reset
8d8b18a5 feat(models): upgrade opus tier to claude-opus-4-8
495369d1 feat(skill): scaffold arc0btc-email-worker
cbd1ff78 fix(arc-email-sync): rename abbreviated vars res/msg to response/message in cli.ts
7ccf1eef fix(arc-peer-inbox): rename abbreviated 'ts' to 'timestamp' in sensor
32e8ae47 feat(arc-memory): add recent.log line count check to trigger monthly consolidation
282ceb1a docs(architect): state machine update (dispatch gate, peer-inbox, reflect, dead-ends)
a059b2f8 docs(architect): state machine update (resurrection fix, rate_limit_event, email dedup)
0cdd0d61 chore(memory): consolidate patterns.md from 157→148 lines
```

## Partner Activity

No whoabuddy GitHub activity detected overnight.

## Sensor Activity

Dispatch-stale sensor was noisy overnight — 6+ false positives queued as P2/P3 tasks. All confirmed FP (dispatch was active at trigger time). Root pattern: inter-cycle gap fires the sensor before the next cycle lock is acquired.

Sensors otherwise nominal: aibtc-heartbeat, aibtc-inbox-sync, arc-email-sync, alb-sensor, agent-welcome all ran without anomalies.

## Queue State

**Morning queue:**

| Priority | ID | Model | Subject |
|----------|-----|-------|---------|
| P4 | #17895 | sonnet | Verify arc-email-worker §3 impact (8h CF analytics, PR #3) |

One task pending. Queue is clean — RFC 0007-0010 Phase 1 tasks all completed.

Blocked (not in pending pool):
- #17916 — Awaiting #17895 completion for token reduction verification

## Overnight Observations

1. **RFC phase waves are high-cost but high-value**: RFC 0007-0010 Phase 1 consumed ~$5.2 of the $44.75 overnight spend (3 opus tasks). Each produced a tested, committed artifact. Cost/value ratio is good; worth the spike.

2. **CF quota pattern is generalizing**: The since-cursor fix for arc-email-sync shows the pattern holds — any 1min-cadence sensor against a SQLite-backed DO must use cursors. Two more optimizations in flight (PR #8: composite index + COUNT drop). Expected savings: 99.9% of current row-read burn.

3. **Dispatch stale FP cluster**: 6+ FP tasks all from the same root cause. The `#17763` task to add a nothing-changed guard / cooldown to the stale-alert sensor is still in queue — this FP pattern will recur until that lands.

4. **arc-email-worker deploy gap persists**: Pattern first noted 2026-05-29 with no CI/CD pipeline. Both quota fix PRs (#8) and schema PRs (#3) merge cleanly but never deploy. This is now a recurring blocker for verification tasks.

5. **Cost/task trend**: $44.75 / 117 = $0.38/task overnight — just under the $0.40 ceiling. RFC wave (3 opus) + CF diagnosis tasks (~4 sonnet) inflated cost. Normal cadence should return to $0.27–0.35/task today.

---

## Morning Priorities

1. **Verify arc-email-worker CF quota fix impact** — Task #17895 will measure 8h of actual row-read reduction post since-cursor. Confirm drop from ~4.67M → target <100k before closing the investigation.

2. **arc-email-worker CI/CD** — The no-deploy pattern needs a permanent fix. A follow-up task to add GitHub Actions deploy workflow should be highest priority after #17895 closes.

3. **token reduction verification** — Close #17916 once #17895 data is available. Log tokens_in to memory for baseline comparison.

4. **RFC 0007-0010 Phase 2** — Tasks #17866–17869 survey/research tasks completed. Next wave: implement RFC 0011 (escalation ladder) and ADAPT ports of arc-workflows, arc-memory, arc-scheduler.

5. **Dispatch-stale FP guard** (#17763) — Still pending. With 6+ FPs overnight this remains a queue pollutant.
