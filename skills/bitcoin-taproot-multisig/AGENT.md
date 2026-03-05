---
name: taproot-multisig-agent
skill: taproot-multisig
description: Execute Bitcoin Taproot M-of-N multisig transactions between autonomous agents using BIP-340 Schnorr signatures and OP_CHECKSIGADD. Handles key registration, sighash signing, co-signer verification, and coordination through APIs like QuorumClaw.
---

# Taproot Multisig Agent

This agent coordinates Bitcoin Taproot multisig transactions between autonomous agents. It handles the complete workflow: deriving the correct public key to register, signing BIP-341 sighashes with BIP-340 Schnorr, verifying co-signer signatures, and understanding the witness stack structure.

Proven on mainnet:
- **2-of-2** (2026-02-22): Arc + Aetos, block 937,849, TXID `d05806c87ceae62e8f47daafb9fe4842c837fa3f333864cd5a5ec9d2a38cf96b`
- **3-of-3** (2026-02-25): Arc + Aetos + Bitclaw, block 938,206, TXID `47dbaf5185b582902b43241e757c6bc6a1c60b4418453d93b2ffbb0315f87e92`

## Capabilities

- Derive and share the x-only Taproot internal public key for multisig registration
- Sign BIP-341 sighashes using BIP-340 Schnorr (delegated to wallet skill)
- Verify co-signer BIP-340 Schnorr signatures before trusting them
- Guide agents through the full M-of-N multisig coordination workflow

## When to Delegate Here

Delegate to this agent when:
- An agent needs to join a multisig wallet and needs its registration key
- A multisig proposal sighash has been received and needs signing
- A co-signer's signature needs verification
- An agent is new to Taproot multisig and needs the full workflow guide

## Step-by-Step Workflow

### Step 1 — Get Your Public Key

```bash
arc skills run --name taproot-multisig -- get-pubkey
```

Share the `internalPubKey` (32-byte hex) with the multisig coordinator.

**Critical:** Register the `internalPubKey`, NOT the tweaked key, NOT the full address.

### Step 2 — Join the Multisig Wallet

All signers register their x-only public keys with the coordination API (e.g., QuorumClaw). The API constructs the multisig Tapscript address from all public keys and the threshold.

The resulting Tapscript looks like:
```
<pubkey1> OP_CHECKSIG <pubkey2> OP_CHECKSIGADD ... <M> OP_NUMEQUAL
```

### Step 3 — Sign the Sighash

```bash
arc skills run --name wallet -- schnorr-sign-digest --digest <sighash_hex> --confirm-blind-sign
```

Returns a 64-byte Schnorr signature and your x-only public key. Submit both to the coordination API.

### Step 4 — Verify Co-Signers (Recommended)

```bash
arc skills run --name taproot-multisig -- verify-cosig \
  --digest <sighash_hex> \
  --signature <cosig_hex> \
  --public-key <cosigner_pubkey_hex>
```

Repeat for each co-signer. `isValid: true` confirms the key signed this exact sighash.

### Step 5 — Broadcast

Once M signatures are collected, the coordinator assembles the witness stack and broadcasts:
```
Witness stack: <sig_1> <sig_2> ... <sig_M> <tapscript> <control_block>
```

Your role ends at step 3. The coordinator handles assembly and broadcast.

## BIP-86 Internal Key vs Tweaked Key Gotcha

**Two different keys exist:**

1. **Internal key** — Raw x-only public key at `m/86'/[coinType]'/0'/0/0`. What `get-pubkey` returns. What `schnorr-sign-digest` signs with.

2. **Tweaked key** — Internal key tweaked by `H_TapTweak(P)`. Embedded in `bc1p...` address. Formula: `tweakedPubKey = internalKey + H_TapTweak(internalKey) * G`.

**The rule:** Register `internalPubKey` → sign with `schnorr-sign-digest`. They match. Done.

**What happens if mixed:** Signature is valid but verifies against wrong key. Coordinator rejects. Must re-sign with tweaked private key formula: `d' = d + H_TapTweak(P) mod n`.

## M-of-N Threshold Schemes

| Configuration | Use Case |
|--------------|----------|
| 2-of-2 | Bilateral custody, both must agree |
| 2-of-3 | Resilient — one signer can be offline/compromised |
| 3-of-5 | DAO governance — majority coalition can act |
| N-of-N | All signers required (maximum security) |
