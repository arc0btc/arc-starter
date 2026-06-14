# Overnight Brief — 2026-04-23

**Generated:** 2026-04-23T13:07:00Z
**Overnight window:** 2026-04-22 20:00 PST to 2026-04-23 06:00 PST (03:00–13:00 UTC)

---

## Headlines

- **Blog-deploy OOM root cause confirmed and fixed**: Arc diagnosed opus + high-thinking + wrangler subprocesses causing kernel OOM kills. Model changed to sonnet (commit acd55530), then sensor converted to full script dispatch (commit 90df07f6) — removing LLM overhead entirely. First script-dispatch blog deploy succeeded (#13479).
- **x402-api boring-tx state machine adopted**: PR #107 reviewed and approved — merges closes three open issues (#99, #93, #84) including the `/registry/register` 500 transaction_held failure that's been open since April 1. Key infrastructure improvement.
- **38 GitHub mentions processed**: Active ecosystem presence overnight — 6 payout dispute threads, 5 PR reviews, 3 BitflowFinance skill validations, 2 Sales DRI IC check-ins. Ops running at ~90% success.

---

## Needs Attention

- **bitcoin-macro hashrate signals still firing**: 3 failures overnight (#13455, #13474, #13490) — sensor keeps queuing signals that cannot score above 65 floor (mempool.space = sourceQuality=10). Competition is over. Sensor should be gated or paused until Arc claims a new beat where these signals are viable. Consider disabling until new beat acquired.
- **hiro simulation:400**: #13488 shows one more failure (Twilight Swallow). Monitor task #13302 is still pending — verify deny-list is auto-healing this correctly.
- **aibtc-agent-trading beat slug**: Beat slug was wrong (`aibtc-network` vs `agent-trading`) — fixed overnight (#13492, commit e1853e83), but the signal filed before the fix (#13491, score=63) was likely routed incorrectly. First signal to correct beat still pending.
- **Multiple payout disputes escalating**: Issues #606, #608, #613, #625, #627, #628 all involve agents claiming unpaid earnings. Arc has commented with analysis on each. Platform-side action may be needed — worth flagging to whoabuddy.

---

## Task Summary

| Metric | Value |
|--------|-------|
| Completed | 52 |
| Failed | 6 |
| Blocked | 0 |
| Cycles run | 78 |
| Total cost (actual) | $30.13 |
| Total cost (API est) | $25.34 |
| Tokens in | 30.7M |
| Tokens out | 277K |

**Success rate**: 52/58 = 89.7%

### Completed tasks (highlights)

- **#13437** — Verified timeout mitigations (bbf36f1a + da130851) landed correctly
- **#13439** — Post-competition 24h baseline: 14 failures, 88% success, no new structural failure modes
- **#13443** — MEMORY.md consolidated (191→~130 lines, ~140t)
- **#13444** — OOM crash-recovery root cause: blog-deploy opus causing kernel OOM kills
- **#13445** — Blog-deploy model changed from opus to sonnet; PR #20 opened
- **#13447** — Karpathy autoresearch loops report emailed to whoabuddy
- **#13451** — PR #614 reviewed: SSR for agent/beat pages (approved phase 3)
- **#13453** — Context-review false positive guard added for GitHub mention tasks
- **#13456** — DISABLE_UPDATES=1 added to dispatch systemd unit
- **#13463** — patterns.md consolidated (155→~140 lines, 3 stale patterns pruned)
- **#13468** — Compliance: 4 abbreviated naming violations fixed (idx→slideIndex×3, cmd→subcommand×1)
- **#13470** — Architecture review updated; script dispatch pattern documented (5 sensors converted)
- **#13471** — 50 stuck health-alert workflows cleared (all stale-lock false positives)
- **#13472** — arXiv digest compiled: 50 papers, 23 relevant (LLM reasoning, multiagent, benchmarks)
- **#13473** — Blog-deploy converted to script dispatch (confirmed already done in 90df07f6)
- **#13475** — x402-sponsor-relay PR #349 nonce fix confirmed merged and deployed
- **#13476** — Skills/sensors catalog regenerated: 113 skills, 72 sensors
- **#13477/13478** — x402-api PR #107 reviewed and approved (boring-tx state machine)
- **#13479** — First script-dispatch blog deploy succeeded (ccefbae45d4c)
- **#13481–13483** — aibtcdev/landing-page + agent-news PRs reviewed (V2 RPC idempotency)
- **#13484–13486** — BitflowFinance skill validation support
- **#13487** — Reviewed #627: identified systemic payout pattern across 5+ disputes
- **#13489** — Sales DRI IC check-in on both assigned targets (both blocked)
- **#13492** — Fixed aibtc-agent-trading wrong beat slug
- **#13493** — Reviewed formal complaint #628 on premature reconciliation

### Failed or blocked tasks

- **#13438** (P7 opus) — Blog-deploy crash recovery: task left active from OOM crash. Expected; root cause fixed.
- **#13455** (P6 sonnet) — Bitcoin hashrate signal: competition ended, no active beats. Sensor still firing.
- **#13461** (P7 sonnet) — Blog-deploy timeout (sonnet): pre-fix task queued before script dispatch conversion. Expected.
- **#13474** (P6 sonnet) — Bitcoin hashrate signal: same as #13455 — dead end confirmed.
- **#13488** (P7 sonnet) — Welcome Twilight Swallow: simulation:400 (hiro deny-list, 1 remaining failure).
- **#13490** (P6 sonnet) — Bitcoin hashrate signal: 3rd repeat in window. Sensor needs gating.

---

## Git Activity

```
e1853e83 fix(aibtc-agent-trading): restore correct beat slug agent-trading (was aibtc-network)
```

One commit. Clean night for arc-starter itself. Most work was in partner repos (PR reviews/approvals).

---

## Partner Activity

- **aibtcdev/x402-sponsor-relay**: PR #349 merged+deployed (nonce fix, agent-news#578 closure)
- **aibtcdev/x402-api**: PR #107 (boring-tx state machine) reviewed and approved by Arc
- **aibtcdev/agent-news**: PRs #614, #620 (SSR perf), #624/#626 (V2 RPC), multiple dispute threads
- **aibtcdev/landing-page**: PR #635/#636 reviewed (inbox V2 RPC idempotency)
- **BitflowFinance/bff-skills**: Active skill submission + validation discussion

---

## Sensor Activity

- **blog-deploy**: 3 cycles overnight (1 script-dispatch success, 1 pre-fix timeout, 1 crash-recovery)
- **bitcoin-macro**: 3 hashrate signals queued — all failed at filing (sourceQuality=10, dead end post-competition)
- **aibtc-agent-trading**: 1 signal queued — filed with wrong beat slug (pre-fix); beat slug now corrected
- **arxiv-research**: Digest compiled (50 papers, 23 relevant)
- **github-mentions**: ~12 mention tasks processed
- **arc-housekeeping**: 1 old file archived
- **compliance-review**: 4 violations found and fixed
- **arc-architecture-review**: Diagram and audit log updated
- **arc-workflow-review**: 50 stuck workflows cleared
- **context-review**: False positive guard added

---

## Queue State

**Pending this morning**: 1 task
- #13302 (P4 sonnet) — monitor: hiro simulation:400 drain watch [from Apr 22]

Queue is essentially clear. First dispatch this morning will likely pick up sensor-generated tasks.

---

## Overnight Observations

1. **Script dispatch is working**: Blog-deploy conversion to model=script successfully ran overnight — no LLM overhead, no OOM risk. This is a significant pattern for subprocess-heavy skills (build tools, deploy scripts).

2. **Competition aftermath reverberations**: Bitcoin-macro and aibtc-agent-trading sensors continue firing signals to an empty beat registry. Post-competition cleanup needed: either gate sensors or acquire new beats.

3. **Payout dispute cluster growing**: 6+ disputes active simultaneously in agent-news. Arc is providing analysis but platform-side resolution is blocked on editors. Pattern: many agents haven't been paid for valid brief_inclusions from 1-3 weeks ago.

4. **x402 infrastructure improving**: PR #107 (boring-tx state machine) addresses 3 persistent x402-api issues. Combined with the nonce fix deployed overnight, the relay/API stack is in better shape than it's been in weeks.

5. **Memory consolidation healthy**: MEMORY.md down to ~140t, patterns.md trimmed. Context budget comfortably within target.

---

## Morning Priorities

1. **Gate bitcoin-macro hashrate sensor**: Disable or add beat-availability check before queuing. 3 failures overnight from dead-end signals.
2. **Monitor hiro simulation:400**: #13302 still pending — check if deny-list is fully self-healing.
3. **Beat opportunity scan**: Competition over, 0 active beats. Investigate what new beats are available via the platform.
4. **Watch x402-api PR #107 merge**: If merged, confirm `/registry/register` 500s resolve.
5. **aibtc-agent-trading first correct signal**: Beat slug fixed — first signal to correct beat pending. Monitor for quality.
