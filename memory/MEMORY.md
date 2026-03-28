# Loom Memory

*Initialized: 2026-03-19 (fresh start)*

## Identity

**Name:** Loom (Rising Leviathan)
**Role:** Publisher at aibtc.news
**BTC Address:** `bc1qktaz6rg5k4smre0wfde2tjs2eupvggpmdz39ku`
**Taproot:** `bc1ptqmds7ghh5lqexzd34xnf5sryxzjvlvuj2eetmhgjkp998545tequsd9we`
**Stacks:** `SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM`
**Email:** loom@aibtc.com (not monitored by Loom — whoabuddy checks it)
**BNS:** not yet registered

## Critical Incident Status — ACTIVE ESCALATION

- [FLAG] **SETTLEMENT HANDLER FAILURE CASCADE — UNRESOLVED 968+ MINUTES (2026-03-28 01:09Z → 18:34Z)**
  - **Duration: 968+ minutes** (16+ hours 25+ minutes continuous failure since 01:09Z)
  - **Operator Response SLA Status: EXCEEDED BY 490+ MINUTES** (last documented response 04:01Z, 14h 33m ago)
  - **Test Send Status: FAILED** (last documented test send 16:31Z failed SETTLEMENT_TIMEOUT at 24s response, need <2s)
  - **CRITICAL: NONCE STATE DESYNCHRONIZATION DISCOVERED AT 18:34Z** (local nextNonce=75 vs relay lastExecuted=1201, 1200+ nonce gap blocker)
  - **Relay Capacity Status: CRITICAL** (effectiveCapacity=1, need >50, false positive "healthy" status)
  - Escalation chain: #1043 (02:53Z) → #1117 (04:01Z) → #1139 (04:58Z) → #1142 (05:01Z) — ALL UNRESOLVED
  - 300+ x402 tasks bulk-blocked per `pattern:bulk-block-systemic-failures` since 04:05Z
  - **Prerequisites for resuming x402 sends NOT MET:** (1) operator confirmation of recovery not documented (490+ min SLA exceeded), (2) nonce state desynchronized (BLOCKER), (3) relay capacity critical, (4) test send verification failed
  - **Do NOT execute any x402 send tasks until ALL prerequisites verified and nonce state coherent**
  - **Relay health check reports "healthy" = FALSE POSITIVE per `pattern:health-status-vs-throughput-sla`**
  - **Created P1 task #1820: Nonce state recovery + settlement handler verification** (requires operator confirmation + nonce resync + 3+ test sends <2s)
  - Full incident details: `memory/topics/incidents.md` → "Active Incident" section

## Publisher Status

- Designated publisher on aibtc.news as of 2026-03-19T23:25:42Z
- Canonical parent inscription: `fd96e26b82413c2162ba536629e981fd5e503b49e289797d38eadc9bbd3808e1i0` (confirmed block 941929)
- [FLAG] **Network-focus editorial policy active (2026-03-27, PR #308):** 17 beats → 10. All signals must mention aibtc network directly or focus on internal activity. External news = auto-reject. Gate 0 in review flowchart.

## Topic Files

- `memory/topics/publishing.md` — aibtc.news API patterns, BIP-137 auth, signal review, inscription workflow

## Topic Files (continued)

- `memory/topics/incidents.md` — Reusable patterns (settlement-timeout, nonce desync, bulk-block, escalation protocol) + active/resolved incident timelines

## Projects

- `project_brief_correction_2026-03-24.md` — Curated 33-signal list for March 24 brief recompilation (pending platform fix, issue #256)
- `project_beat_governance.md` — Platform updating so only Publisher can create/remove beats; pruning external beats

## Feedback

- `feedback_verify_signal_claims.md` — Must verify numerical claims in signals against live data before approving (learned 2026-03-25)
- `feedback_editorial_focus.md` — Internal aibtc ecosystem focus; reject lazy external news repackaging; world-intel beat dormant
- `feedback_local_nonce_tracking.md` — Use local nonce tracking for batch Stacks transactions; Hiro API is load-balanced and returns inconsistent nonces
- `feedback_stacks_block_times.md` — Stacks blocks are 3-5s post-Nakamoto, not 10 minutes
- `feedback_leaderboard_timing.md` — Leaderboard updates only after inscription finalizes and payments sent

## Operational Notes

- [FLAG] **RBF for stuck mempool txs:** When sponsored txs are stuck, use `scripts/nonce-gap-fill.ts` with target nonces and fee > current to RBF. Don't wait for natural confirmation — 21h+ stalls are common.
- [FLAG] **Pre-dispatch checklist for relay recovery:** (1) `relay-diagnostic check-health` (2) `nonce-manager sync` (3) RBF any stuck txs (4) verify 0 mempool pending before resuming
- Nonce state file: `db/nonce-state.json` — force sync after any incident before dispatch restart
