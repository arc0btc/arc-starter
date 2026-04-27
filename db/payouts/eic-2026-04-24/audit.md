# EIC Trial — Payout Audit (2026-04-24 onwards)

Tracking daily 400K sBTC payouts to Dual Cougar (`SP105KWW31Y89F5AZG0W7RFANQGRTX3XW0VR1CX2M` / `bc1q9p6ch73nv4yl2xwhtc6mvqlqrm294hg4zkjyk0`) under the EIC trial activated 2026-04-24 per `plans/2026-04-24-eic-trial-activation.md`. Trial window 2026-04-24 → 2026-05-01 EOD.

This folder follows the same audit-style pattern used for the Round A (Mar 24 – Apr 9) and Round B (Apr 10 – Apr 20) periods (see flat `db/payouts/2026-MM-DD.json` files for those windows). One JSON per payout date here, plus narrative markdowns covering the recovery work this trial period required up front.

## Per-payout files

| File | Date | Status |
|---|---|---|
| `2026-04-24.json` | Day 1 | initial broadcast 2026-04-25T09:03Z failed (nonce 1964, 31-ahead of chain); retry 2026-04-27T14:54Z at nonce 1941, txid `601359…`, confirmed bh=7765320 |
| `2026-04-25.json` | Day 2 | broadcast at nonce 1933 with txid `53a67f5a…`, confirmed bh=7765150 at 2026-04-27T14:29:50Z after Phase C gap-fill |
| `2026-04-26.json` | Day 3 | broadcast at nonce 1940 with txid `0x8ff46eaf…`, confirmed bh=7765275 after Phase C-bis gap-fill (cycle ran during recovery window) |

## Narrative (2026-04-26)

The EIC trial activated 2026-04-24 (plan: `plans/2026-04-24-eic-trial-activation.md`). DC's editorial pipeline has been operating cleanly — functional approval test passed 2026-04-24T23:51Z, daily briefs compiled by sensor on schedule, signal volumes reasonable. **Our outflow is what failed.**

**Day 1 (2026-04-24 brief)** — `eic-payout` sensor fired 2026-04-25T09:01Z, attempted broadcast at nonce **1964**, returned generic "sBTC transfer failed" within 1.5s. Nonce 1964 was 31 ahead of chain head (`last_executed_tx_nonce=1923`), guaranteeing rejection. `eic_payouts` row marked `status=failed`, no txid recorded. DC received 0 sats from Day 1.

**Day 2 (2026-04-25 brief)** — `eic-payout` sensor fired 2026-04-26T09:27Z. Local nonce-manager state had been re-synced in the interim (probably manually after the Day 1 failure), so this attempt landed at nonce **1933** — broadcast accepted by relay, currently in mempool with `tx_status: "pending"` and no block height. Stuck behind nonces 1924–1932 which Hiro reports as `detected_missing_nonces` (broadcast but never confirmed; mempool-dropped). DC has not received Day 2 either, until the gap closes.

**Briefs themselves are inscribed on-chain.** Both 2026-04-24 (`ae2e32ae57a56fb055beda3a09a9923c4fda1dbd962dd9683bdc0339e565dbdfi0`) and 2026-04-25 (`e236c02cb4ffcaa2a2afe174124ccd243bc3eb4bbefab956b0355e17a50c4429i0`) are recorded on aibtc.news — but only at `inscription.inscriptionId`. The platform's `inscribedAt` and `inscription.inscribedTxid` top-level fields are null, which has been the case for every brief back to at least 2026-04-10 (this is not a regression). DC's "doesn't see briefs inscribed" complaint is reading those null fields. Phase H of the recovery plan files a platform issue + backfill SQL.

## Root cause (refined 2026-04-27 after Day 3 reproduction)

There are **two distinct failure modes** that produce the same symptom (chain gaps + stuck mempool tx). Both contributed to this incident.

### Mode 1 — Manager bypass (caused Day 1)

The publisher Stacks wallet is consumed by multiple independent paths. Most go through the local nonce-manager (`eic-payout`, `inbox-notify`, `round-b-overnight.ts`, `brief-payout`). One major path does **not** — `agent-welcome` (90 tasks 2026-04-23 → 2026-04-25) calls `scripts/send-agent-welcome.ts`, which invokes `bitcoin-wallet x402 send-inbox-message` without a `--nonce` flag. The `bitcoin-wallet` skill internally fetches a nonce from Hiro for each call. Since the local nonce-manager doesn't see those acquisitions, its `nextNonce` drifts — and when `eic-payout` later acquires through the manager, it gets a number 30+ ahead of chain reality.

This caused **Day 1**: nonce 1964 acquired, chain head 1923, broadcast rejected pre-mempool, generic "sBTC transfer failed" returned. Phase A paused this sensor; Phase L wires it through the manager.

### Mode 2 — Failure-classification bug (caused Day 2 + Day 3)

`nonce-store.ts` distinguishes `"broadcast"` (nonce consumed) from `"rejected"` (nonce reusable, rolled back). The design is correct. **Callers don't classify reliably.**

Two specific paths are confirmed wrong:

**2a. `skills/inbox-notify/cli.ts` `executeBatch` failure branch (line 478):**
```ts
} else {
  await releaseManagedNonce(currentNonce, false);  // ← rejected=undefined → defaults to "broadcast"
  msg.status = "failed";
```
When a batch send fails for any reason that isn't a recognized nonce error, the nonce is marked consumed even when the tx never reached mempool. Each such failure leaves a phantom nonce.

**2b. `skills/inbox-notify/cli.ts` `sendWithRetry` SENDER_NONCE_DUPLICATE branch (line 229):**
```ts
if (isNonceDuplicate(err) && attempt < MAX_RETRIES) {
  await releaseManagedNonce(currentNonce, false, false); // released as "broadcast" — consumed
  currentNonce = await acquireManagedNonce();
```
When the x402 sponsor relay returns `SENDER_NONCE_DUPLICATE`, the code assumes the nonce is consumed on chain. But the relay's "duplicate" can be its own internal-state collision rather than a real chain-side conflict — particularly during the `TooMuchChaining` quarantine window or sponsor index lag. Result: nonce is not actually consumed on chain (Hiro reports it missing), but we walk forward as if it were.

**Reproduction during Phase C (2026-04-27 ~08:56Z):** Task #6804 ran `inbox-notify send-batch` for `brief-inscribed-2026-04-26.json` with 3 messages. All three failed at the relay. Each failure released its nonce as "broadcast" via path 2a or 2b. That generated phantoms 1937, 1938, 1939. Then Day 3 EIC payout fired at 09:02Z, acquired the next available nonce (1940), broadcast successfully — but stuck in mempool behind the 6-nonce gap (1934-1939: three pre-existing phantoms 1934-1936 from earlier inbox-notify runs, three new ones 1937-1939 from this batch).

The on-disk state of `db/inbox-notify/brief-inscribed-2026-04-26.json` confirms — all three messages have `status: null` (the writeState call in the failure branch wrote it back, but the in-memory `msg.status = "failed"` was apparently overwritten or lost on a subsequent write). Whatever the secondary bug, the nonce-release classification is the operative one for chain integrity.

### Layered: stale `inFlight` GC

`nonce-store.ts` tracks `inFlight` per address but has no garbage collector pruning entries the chain has either confirmed or dropped. We came into this recovery with 12 stale entries (1924–1932, 1934–1936) — a mix of post-confirmation accumulation (1924-1932) and post-failure phantoms (1934-1936). After Phase C-bis + Phase E manual cleanup, the local state is reconciled. But without a GC, this drift will reaccumulate.

## Recovery plan reference

Full plan: `plans/2026-04-26-eic-recovery-and-nonce-hygiene.md` (last updated 2026-04-27).

| Phase | State |
|---|---|
| A — Pause agent-welcome | ✅ done (2026-04-26) |
| B — Audit folder | ✅ done (2026-04-26) |
| C — Gap-fill 1924-1932 | ✅ done (2026-04-27) |
| C-bis — Gap-fill 1934-1939 (new) | ✅ done (2026-04-27) |
| D — Day 2 + Day 3 audit captures | ✅ done (2026-04-27) |
| E — Local in-flight cleanup | ✅ done (2026-04-27) |
| F — Day 1 retry | ✅ confirmed (2026-04-27, nonce 1941, txid `601359…`, bh 7765320) |
| G — #634 comment | ⏸ pending Day 1 confirmation |
| H — Platform `inscribedAt` issue | ⏸ pending |
| I — Code audit nonce coverage | ⏸ pending |
| J — Historical incident catalogue | ⏸ pending |
| K — `arc wallet` first-class CLI | ⏸ pending |
| L — Nonce-store + caller fixes | ⏸ pending (this is the durable fix) |
| M — PR + close-out | ⏸ pending |

## Recovery log

See `recovery-2026-04-26.md` for step-by-step execution as the lettered phases progress.
