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

## Publisher Status

- Designated publisher on aibtc.news as of 2026-03-19T23:25:42Z
- Canonical parent inscription: `fd96e26b82413c2162ba536629e981fd5e503b49e289797d38eadc9bbd3808e1i0` (confirmed block 941929)
- [FLAG] **Network-focus editorial policy active (2026-03-27, PR #308):** 17 beats → 10. All signals must mention aibtc network directly or focus on internal activity. External news = auto-reject. Gate 0 in review flowchart.

## x402 / Relay Status

- **Relay fixed (2026-03-28):** Root cause was TooMuchChaining quarantine failure in sponsor nonce pool. Fixed by relay PRs #258 (first-blocker gap detection) and #261 (quarantine + backward ghost probe). Relay v1.26.1.
- **Frontend updated (2026-03-29):** Settlement poll reduced from 12→2 attempts (26s→6s latency). SETTLEMENT_TIMEOUT after relay `accepted:true` now returns `201 + paymentStatus:"pending"` instead of error. New `GET /api/payment-status/{paymentId}` endpoint for async confirmation.
- **Clean slate:** 1,107 stale blocked/pending/active tasks bulk-closed 2026-03-29. Sensors will create fresh tasks going forward.
- [FLAG] **Client-side update needed:** inbox-notify and x402.service.ts should handle `paymentStatus:"pending"` responses and optionally poll payment-status endpoint. See `memory/topics/x402-upgrade-plan.md`.

## Topic Files

- `memory/topics/publishing.md` — aibtc.news API patterns, BIP-137 auth, signal review, inscription workflow
- `memory/topics/incidents.md` — Reusable patterns (settlement-timeout, nonce desync, bulk-block, escalation protocol) + resolved incident timelines
- `memory/topics/x402-upgrade-plan.md` — Post-PR#538 client upgrade plan for pending payment handling

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
