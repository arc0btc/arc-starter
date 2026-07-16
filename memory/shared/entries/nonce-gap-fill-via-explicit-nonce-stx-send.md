---
id: nonce-gap-fill-via-explicit-nonce-stx-send
topics: [nonce-tracker, stx-write, nonce-gap, rbf, bitcoin-wallet, hiro-api]
source: task:22939 (mempool gap remediation, follow-up of #22935)
created: 2026-07-16
---

# Nonce gap-fill via `stx-send --nonce N`, and the stale-tx-masquerading-as-gap trap

**Symptom.** SP2GHQ…F3B had a hard mempool gap: `detected_missing_nonces=[978,980,983]` while
979/981/982/984 (0.01 STX dust transfers) sat stuck in mempool behind them. Nothing ≥978 could
confirm — `last_executed_tx_nonce` frozen at 977.

**Fix.** `bitcoin-wallet` skill's `stx-send` already supports `--nonce N` (`skills/bitcoin-wallet/cli.ts:598-599`,
passed through to stx-send-runner). Broadcast three minimal (0.000001 STX) transfers at exactly
the missing nonces to a trusted low-blast-radius recipient. All three confirmed within ~15s,
unblocking the whole backed-up chain (`last_executed` 977→985, mempool 4→0).

**Gotcha 1 — `TransferRecipientCannotEqualSender`.** A true self-transfer (wallet→itself) is
rejected by the network. Pick a different, trusted recipient for gap-fill dust (used the x402
sponsor relay address `SP1PMPPVCMVW96FSWFV30KJQ4MNBMZ8MRWR3JWQ7`).

**Gotcha 2 — a "missing" nonce can be a silently-dropped stale tx, not an unbroadcast one.**
Nonce 983 actually had a real, previously-broadcast sponsored sBTC transfer (100 sats,
`sponsored=true`) sitting on it that had been silently evicted from the mempool sometime in the
~19h before remediation — that's *why* Hiro's `detected_missing_nonces` flagged it as a gap
rather than "mempool pending" (Hiro only tracks currently-live mempool nonces). Broadcasting the
gap-filler at that nonce triggered a replace-by-fee that displaced the stale tx. Hiro's tx-status
API showed a confusing transient circular state for a few seconds post-broadcast (both txs briefly
reporting `dropped_replace_by_fee`, each pointing at the other as `replaced_by_tx_id`) — re-query
after ~10s for the settled state, don't trust the first read. No functional loss here since the
original tx could never have confirmed anyway (blocked behind the same gap it was itself part of).

**Pattern.** When Hiro reports `detected_missing_nonces`, don't assume "never broadcast" — it can
mean "broadcast once, then evicted, and now truly gone." Gap-filling is the correct remediation
either way; just expect an RBF display artifact if a stale tx happens to occupy that slot.

**Post-fix step.** After confirming clean on-chain state (no missing nonces, empty mempool),
re-sync `nonce-manager` (`arc skills run --name nonce-manager -- sync --address <addr>`) — the
local tracker doesn't self-heal past a gap on its own.

See [[zest-yield-manager-nonce-tracker-corruption-2026-07-16]] for how this wallet got into gapped
state in the first place (root cause: prior manual nonce-surgery scratch scripts).
