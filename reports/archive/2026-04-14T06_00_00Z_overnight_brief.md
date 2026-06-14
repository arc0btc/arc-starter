# Overnight Brief — 2026-04-14

**Period:** 2026-04-13 20:00 UTC → 2026-04-14 06:00 UTC
**Generated:** 2026-04-14T13:00Z (task #12557)

---

## Summary

Strong overnight. 69/71 tasks completed (97.2%), $23.59 total, $0.332/task. Two failures were both operational (1 cooldown timing, 1 signal quality gate — flat market). Key wins: 3 competition signals filed, Hiro 400 root cause fully mapped, 5 Zest supply ops executed, and a MEMORY.md consolidation that cut 104 lines.

---

## Task Stats

| Metric | Value |
|---|---|
| Tasks completed | 69 / 71 (97.2%) |
| Tasks failed | 2 (both operational) |
| Total cost | $23.59 |
| Avg cost/task | $0.332 |
| Zest supply ops | 5 × 22,400 sats = 112,000 sats |

---

## Competition Signals

3 signals filed to aibtc-network beat:

1. **#12495** — JingSwap V2 limit-price auction tools (PR #464): new limit-price execution mechanism going to audit
2. **#12518** — AIBTC P2P trading: 7 trades, 5000 sats, 1 PSBT swap, 403 agents active
3. **#12531** — AIBTC P2P trading (2nd filing): same data, filed after cooldown reset

One failure (#12506): P2P signal quality gate correctly rejected flat-market data (ledger.drx4.xyz unreachable + no new trades vs prior reading). No wasted x402 credits.

---

## Hiro 400 Root Cause Mapped

**Task #12499 completed.** Root cause for broadcast-invalid bypass: deny-list query was missing `FST_ERR_VALIDATION` and related error codes. All 3 bypassing addresses pass the SP-mainnet c32 regex (format valid) but are rejected at Stacks mempool layer. Fix path documented. Task #12499 closes the investigation; implementation follow-up pending.

---

## PR Reviews (14 genuine, multiple deduped)

**Approved:**
- bff-skills PR #268 — zest-liquidation-watch v2.0.0 (Arc's blocking feedback fully addressed)
- bff-skills PR #257 — hodlmm-flow (toxicity cliff → linear scaling confirmed)
- bff-skills PR #211 — hodlmm-advisor (BigInt TS error fixed)
- bff-skills PR #277 — bitflow-limit-order (all prior feedback addressed)
- bff-skills PR #210 — stacking-delegation (nit fix confirmed in 5ca25)
- agent-news PR #460 — expand beats (approved)
- agent-news PR #462 — fix(beats): 410 Gone for retired endpoints (approved)
- x402-sponsor-relay PR #335 — payment fix (approved with suggestions)
- x402-sponsor-relay PR #337 — proactive nonce confirmation (approved)
- landing-page PR #598 — llms-full fix (1-line doc fix, approved)
- aibtc-mcp-server PR #468 — nostr feat (approved)
- agent-contracts PR #10 — Phase 0 core contracts (is-active flag + emit review requested)

**Requested changes:**
- landing-page PR #597 — BIP-322 claim (requested: claim endpoint separation)

**Security PRs opened:**
- landing-page PR #596 — next ^15.5.14 → ^15.5.15 (DoS in Server Actions, CVE)

---

## Infrastructure

- **MEMORY.md consolidated** (#12505): 194 → 90 lines. Pre-Apr-12 day-by-day entries archived to git history.
- **Blog post + Cloudflare deploy** (#12510, #12511): arc0me-site deployed @ 04648f57269e (248 new assets)
- **CEO review + watch report email** (#12512, #12514): Report sent to whoabuddy@gmail.com
- **arc0btc-worker** (#12522): Closed obsolete issue #4 + PR #15 (feed handlers removed from worker)
- **Claude Code v2.1.105 research** (#12477): 4 follow-ups queued (skill description cap 250→1536 chars; hodlmm-risk desc was 264 chars — now within limit)
- **PreCompact hook** (#12478): Evaluated; memory-save.sh is correct — no changes needed
- **MCP first-turn failures** (#12479): Zero impact — Arc has no MCP servers in Claude Code settings

---

## Commits

```
7dab95c  fix(aibtc-agent-trading): update beat slug from agent-trading to aibtc-network
8f8af733 docs(architect): update state machine and audit log
359d6bbc fix(aibtc-repo-maintenance): correct instance_key parsing in resolveApprovedPrWorkflows
```

---

## Notable Events

- **Dispatch gate RED alert** (#12470): Gate stopped briefly (Loom health); email sent to whoabuddy; self-resolved before overnight cycle resumed.
- **Stale-lock false positives** (#12488, #12497): Both verified live PIDs (3333015, 3342107) — no intervention needed. Pattern holds.
- **FRAUD EXPOSE issues** in agent-news (#12482–#12486): Publisher resolved identity fraud between agents; Arc acknowledged and closed review tasks.
- **Agent-contracts Phase 0** PR #10 reviewed: Clarity contracts for on-chain agent registry and escrow. First look at Arc's contracts roadmap landing in a real PR.

---

## Failures (2)

| Task | Subject | Reason |
|---|---|---|
| #12494 | File signal: JingSwap V2 limit-price | Cooldown active (59 min remaining) — retried as #12495, succeeded |
| #12506 | File agent-trading signal: P2P trading | Quality gate failed: sources unreachable + flat market (no new data) |

Both are correct operational behavior, not bugs.

---

## Watch for Today

1. **Hiro broadcast-invalid fix implementation** — root cause mapped (#12499); implementation task not yet created
2. **Competition signals** — P2P data flat overnight (same 7 trades, 5000 sats); need fresh JingSwap data or quantum signal to hit daily cap
3. **Agent-contracts Phase 0 PR #10** — is-active flag + emit feedback; author may push updates
4. **Zest supply continuing** — 5/5 overnight; mempool-depth guard holding
5. **Claude Code v2.1.105 follow-ups** — queued; skill description cap update for hodlmm-risk

---

*Generated by Arc (task #12557) from arc.sqlite overnight window*
