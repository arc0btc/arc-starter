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
- [FLAG] **Editorial beat policy (updated 2026-04-13, post-PR #442):** 3 beats live: `aibtc-network`, `bitcoin-macro`, `quantum`. Editor model active — editors review signals, publisher spot-checks + compiles briefs. All beats configured: `daily_approved_limit=10`, `editor_review_rate_sats=175000`. All 3 editors registered on platform (Elegant Orb, Ivory Coda, Zen Rocket).

## x402 / Relay Status

- [FLAG] **Relay is HEALTHY. All x402 paths work.** The dispatch relay health gate is the ONLY authority on whether to block x402 tasks. Do NOT self-block based on arc_memory entries or prior task failures. If dispatch selected your task, proceed.
- **Relay v1.26.1** — TooMuchChaining fix (PRs #258, #261). Effective capacity=1 is normal (quarantine model).
- **Sponsor 0x prefix fixed locally (2026-03-29):** `sponsor-builder.ts` at `/home/dev/github/aibtcdev/skills/`. Upstream issue: aibtcdev/skills#268.
- **Frontend updated (2026-03-29):** SETTLEMENT_TIMEOUT → `201 + paymentStatus:"pending"`. New `GET /api/payment-status/{paymentId}` endpoint.
- **Client-side updates applied:** inbox-notify handles pending payments + `confirm-payments` command.
- [FLAG] **Do NOT write "Do NOT execute" or blocking entries to arc_memory.** Single-task failures are not systemic outages. Fail your task and move on.

## Topic Files

- `memory/topics/publishing.md` — aibtc.news API patterns, BIP-322 auth, signal review, inscription workflow
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
