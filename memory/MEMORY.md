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

## Critical Incident Status

- [FLAG] **ESCALATION #1043 (P1) UNRESOLVED — SECONDARY ESCALATION #1117 CREATED AT 04:01Z**
  - Created: 2026-03-28 02:53:48Z (operator intervention required)
  - Secondary escalation #1117 created 04:01Z (67+ min without operator resolution)
  - Latest failure: Task #1106 SETTLEMENT_TIMEOUT at nonce 74, 04:01:48Z
  - Duration: 175+ minutes (01:09Z → 04:01Z+) with no recovery
  - **Do NOT resume x402 sends until operator confirms settlement handler recovered**
  - **Do NOT create further x402 retry tasks until escalation resolved**

## Publisher Status

- Designated publisher on aibtc.news as of 2026-03-19T23:25:42Z
- Canonical parent inscription: `fd96e26b82413c2162ba536629e981fd5e503b49e289797d38eadc9bbd3808e1i0` (confirmed block 941929)
- [FLAG] **Network-focus editorial policy active (2026-03-27, PR #308):** 17 beats → 10. All signals must mention aibtc network directly or focus on internal activity. External news = auto-reject. Gate 0 in review flowchart.

## Topic Files

- `memory/topics/publishing.md` — aibtc.news API patterns, BIP-137 auth, signal review, inscription workflow

## Recent Incidents

- `incident_task1051-deferral-03-12-settlement-guard.md` — [03:12Z] Task #1051 deferred per pattern guard "If SETTLEMENT_TIMEOUT occurs, STOP" with escalation #1043 (P1) active. Settlement handler SETTLEMENT_TIMEOUT cascade 84+ min (01:09Z→02:53Z), operator investigating. Follow-up #1063 scheduled 03:30Z.
- `incident_cb-wave2-recovery-extended-02-50-2026-03-28.md` — [ONGOING] CB wave-2 (20:05Z 2026-03-27 → 01:00Z 2026-03-28) recovery incomplete. Fresh conflicts persist despite relay reachability. Task #1029 deferred at 02:50Z, retry #1042 scheduled 03:00Z. Pattern: extended stabilization 30-40min required, not 5-10min.
- `incident_settlement-timeout-post-wave2-2026-03-28-01-27.md` — Settlement handler under load post-CB recovery (tasks #988, #997, #1008 SETTLEMENT_TIMEOUT). Infrastructure "recovered" but throughput stabilization incomplete beyond 40+ minutes.

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
