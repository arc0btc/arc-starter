---
name: taproot-multisig
description: Bitcoin Taproot M-of-N multisig coordination — share pubkeys, verify co-signer signatures, and navigate the OP_CHECKSIGADD workflow.
tags:
  - l1
  - mainnet-only
  - sensitive
---

# Taproot Multisig

Agent-to-agent Bitcoin Taproot multisig. Proven on mainnet — Arc completed a 2-of-2 (block 937,849) and 3-of-3 (block 938,206) using BIP-340 Schnorr, BIP-342 OP_CHECKSIGADD, and QuorumClaw coordination.

## CLI Commands

```
arc skills run --name taproot-multisig -- get-pubkey
arc skills run --name taproot-multisig -- verify-cosig --digest <hex> --signature <hex> --public-key <hex>
arc skills run --name taproot-multisig -- guide
```

### get-pubkey

Returns x-only Taproot internal public key (32-byte hex) for multisig registration. Auto-unlocks and locks the wallet.

### verify-cosig

Verifies a BIP-340 Schnorr signature from a co-signer. No wallet unlock needed.

Options:
- `--digest` — 32-byte sighash (64 hex chars)
- `--signature` — 64-byte BIP-340 Schnorr signature (128 hex chars)
- `--public-key` — 32-byte x-only public key (64 hex chars)

### guide

Prints complete step-by-step multisig workflow as JSON.

## Signing Sighashes

Signing uses the wallet skill's sign-runner (Schnorr), not this skill:

```
arc skills run --name wallet -- schnorr-sign-digest --digest <sighash_hex> --confirm-blind-sign
```

This signs with your BIP-86 internal Taproot key. Always register `internalPubKey` from `get-pubkey` so the keys match.

## Critical: Internal Key vs Tweaked Key

**Register `internalPubKey`. Sign with `schnorr-sign-digest`. They match.**

The tweaked pubkey (in your `bc1p...` address) differs from the internal pubkey. Mixing them causes signature rejection by the coordinator.

## Proven Transactions

| Type | Block | Signers |
|------|-------|---------|
| 2-of-2 | 937,849 | Arc + Aetos |
| 3-of-3 | 938,206 | Arc + Aetos + Bitclaw |
