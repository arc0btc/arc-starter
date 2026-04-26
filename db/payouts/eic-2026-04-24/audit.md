# EIC Trial — Payout Audit (2026-04-24 onwards)

Tracking daily 400K sBTC payouts to Dual Cougar (`SP105KWW31Y89F5AZG0W7RFANQGRTX3XW0VR1CX2M` / `bc1q9p6ch73nv4yl2xwhtc6mvqlqrm294hg4zkjyk0`) under the EIC trial activated 2026-04-24 per `plans/2026-04-24-eic-trial-activation.md`. Trial window 2026-04-24 → 2026-05-01 EOD.

This folder follows the same audit-style pattern used for the Round A (Mar 24 – Apr 9) and Round B (Apr 10 – Apr 20) periods (see flat `db/payouts/2026-MM-DD.json` files for those windows). One JSON per payout date here, plus narrative markdowns covering the recovery work this trial period required up front.

## Per-payout files

| File | Date | Status |
|---|---|---|
| `2026-04-24.json` | Day 1 | failed initial broadcast 2026-04-25T09:03Z; retry pending Phase F of recovery plan |
| `2026-04-25.json` | Day 2 | broadcast at nonce 1933 with txid `53a67f5a…`, mempool-pending behind a 9-nonce gap (1924–1932) |

## Narrative (2026-04-26)

The EIC trial activated 2026-04-24 (plan: `plans/2026-04-24-eic-trial-activation.md`). DC's editorial pipeline has been operating cleanly — functional approval test passed 2026-04-24T23:51Z, daily briefs compiled by sensor on schedule, signal volumes reasonable. **Our outflow is what failed.**

**Day 1 (2026-04-24 brief)** — `eic-payout` sensor fired 2026-04-25T09:01Z, attempted broadcast at nonce **1964**, returned generic "sBTC transfer failed" within 1.5s. Nonce 1964 was 31 ahead of chain head (`last_executed_tx_nonce=1923`), guaranteeing rejection. `eic_payouts` row marked `status=failed`, no txid recorded. DC received 0 sats from Day 1.

**Day 2 (2026-04-25 brief)** — `eic-payout` sensor fired 2026-04-26T09:27Z. Local nonce-manager state had been re-synced in the interim (probably manually after the Day 1 failure), so this attempt landed at nonce **1933** — broadcast accepted by relay, currently in mempool with `tx_status: "pending"` and no block height. Stuck behind nonces 1924–1932 which Hiro reports as `detected_missing_nonces` (broadcast but never confirmed; mempool-dropped). DC has not received Day 2 either, until the gap closes.

**Briefs themselves are inscribed on-chain.** Both 2026-04-24 (`ae2e32ae57a56fb055beda3a09a9923c4fda1dbd962dd9683bdc0339e565dbdfi0`) and 2026-04-25 (`e236c02cb4ffcaa2a2afe174124ccd243bc3eb4bbefab956b0355e17a50c4429i0`) are recorded on aibtc.news — but only at `inscription.inscriptionId`. The platform's `inscribedAt` and `inscription.inscribedTxid` top-level fields are null, which has been the case for every brief back to at least 2026-04-10 (this is not a regression). DC's "doesn't see briefs inscribed" complaint is reading those null fields. Phase H of the recovery plan files a platform issue + backfill SQL.

## Root cause (confirmed 2026-04-26)

The publisher Stacks wallet is consumed by multiple independent paths. Three go through the local nonce-manager (`eic-payout`, `inbox-notify`, `round-b-overnight.ts`); one major path does **not** — `agent-welcome` (90 tasks 2026-04-23 → 2026-04-25) calls `scripts/send-agent-welcome.ts`, which invokes `bitcoin-wallet x402 send-inbox-message` without a `--nonce` flag. The `bitcoin-wallet` skill internally fetches a nonce from Hiro for each call. Since the local nonce-manager doesn't see those acquisitions, its `nextNonce` drifts — and when `eic-payout` later acquires through the manager, it gets a number 30+ ahead of chain reality.

Layered on top: the manager has no garbage collector for `inFlight` entries the chain has either confirmed or dropped. We currently see 12 stale entries (1924–1932, 1934–1936). And `inbox-notify`'s catch path defaults rejected-tx releases to `"broadcast"` (consumed) rather than distinguishing pre-broadcast rejection from mempool-dropped — over many failures, this leaks reusable nonces into the in-flight set.

Full plan: `plans/2026-04-26-eic-recovery-and-nonce-hygiene.md`. Phases A–G are recovery (we are here); H is the platform-side fix; I–J are audits; K–M are durable tooling so this stops being a recurring class of incident.

## Recovery log

See `recovery-2026-04-26.md` for step-by-step execution as the lettered phases progress.
