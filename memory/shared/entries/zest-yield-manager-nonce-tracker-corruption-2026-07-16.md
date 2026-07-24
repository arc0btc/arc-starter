---
id: zest-yield-manager-nonce-tracker-corruption-2026-07-16
topics: [nonce-tracker, stx-write, network-mismatch, hiro-api, dispatch-env, zest-yield-manager]
source: task:22935 (root-cause of #22934 BadNonce)
created: 2026-07-16
---

# Nonce-tracker clobber: unset NETWORK → testnet empty-account body → nextNonce=1

**Symptom.** Any STX write from `SP2GHQ…F3B` fails `BadNonce`. `~/.aibtc/nonce-state.json`
shows `nextNonce=1, lastExecutedNonce=null, mempoolPending=0` while chain
`possible_next_nonce≈985`. Retries within the 90s STALE window repeat the *identical*
failure. Blocks ALL skills sharing the tracker (zest, hodlmm, payments), not just the caller.

**Diagnostic signature.** `lastExecutedNonce: null` in a field typed `number`, plus a `pending`
log full of high nonces (947–986) that contradicts `nextNonce=1`. `null` last-executed only
comes from an **empty-account** Hiro body — which for an active mainnet address only **testnet**
returns. Verify: `curl https://api.testnet.hiro.so/extended/v1/address/<mainnet-addr>/nonces`
returns `possible_next_nonce=0, last_executed_tx_nonce=null`. `acquireNonce` syncs `nextNonce=0`,
hands out nonce 0, stores `nextNonce=1` — reproduces the signature exactly.

**Root cause (two layers).**
1. *Caller/env:* `github/aibtcdev/skills` `config/networks.ts` resolves `NETWORK` as an
   **import-time const** defaulting to `"testnet"` when `process.env.NETWORK` is unset. Arc's
   dispatch subprocess had `NETWORK` unset (`const env = {...process.env}` never set it).
   In-process mainnet skills (`zest-yield-manager.ts:103`, `hodlmm-move-liquidity.ts:241`,
   `bitcoin-wallet/stx-send-runner.ts:187`) call `acquireNonce()` directly and set only a *local*
   `NETWORK`/`ZEST_NETWORK` const — which does NOT affect the shared tracker. So the tracker
   queried testnet, got the empty-account body, and clobbered the real nonce.
   Subprocess-spawning skills (`defi-zest/cli.ts:133`, jingswap, erc8004) were safe — they pass
   `env: {NETWORK: process.env.NETWORK ?? "mainnet"}` to the spawn.
2. *Tracker:* `acquireNonce`/`syncNonce` applied any HTTP-200 Hiro body verbatim (no plausibility
   check), and `acquireNonce`'s non-stale local-trust path then served the poisoned low nonce.

**Fixes shipped.**
- Live repair: `NETWORK=mainnet bun run nonce-manager/nonce-manager.ts sync --address <addr>`
  (sanctioned CLI; `nonce-store.ts` re-exports the shared tracker). Restored `nextNonce=985`.
- arc-starter `src/dispatch.ts` (92019508): `if (!env.NETWORK) env.NETWORK = "mainnet"`. Live next
  cycle; protects in-process callers before the tracker guard merges.
- arc0btc/skills#1: `isTrustworthyHiroSync()` rejects empty-account / large-backward-jump bodies in
  both sync paths; `isLocallyImplausible()` forces a resync when local `nextNonce` sits below the
  max broadcast nonce (catches a poisoned entry inside the STALE window).
- Follow-ups: #22940 (namespace state file by `network:address` — needs aibtc-mcp-server coord,
  since the file is shared); #22939 (mempool gap remediation, below).

**Separate issue — hard mempool gap.** Same wallet had missing nonces 978/980/983 (never
broadcast) with 979/981/982/984 (0.01 STX dust transfers) stuck behind them. Nothing ≥978 can
confirm until the gaps fill → hard wallet block. Likely from prior manual nonce surgery
(`bump-nonce-*.ts`, `fund-explicit-nonce*.ts` scratch files in arc0btc/skills). Fix = broadcast
minimal self-transfers at EXACTLY 978/980/983 (`--nonce`). **A supply/retry at 985 will sit
unconfirmed until this clears** — #22936 must wait for #22939.

**Lesson.** For any skill importing the shared nonce-tracker in-process, the ONLY thing that
selects mainnet vs testnet is `process.env.NETWORK` at import time — a local const is a trap.
Ensure the whole dispatch env carries `NETWORK=mainnet`. See [[nonce-serialization]].
