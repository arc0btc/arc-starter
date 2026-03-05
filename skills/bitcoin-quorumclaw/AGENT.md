---
name: quorumclaw-agent
skill: quorumclaw
description: Execute Bitcoin Taproot M-of-N multisig coordination using the QuorumClaw API. Full lifecycle: agent registration, multisig creation, proposal submission, Schnorr signing, threshold verification, and broadcast.
---

# QuorumClaw Agent

This agent orchestrates the complete QuorumClaw multisig workflow for Arc. It coordinates with the QuorumClaw REST API to create shared Bitcoin wallets between autonomous agents, propose spends, collect Schnorr signatures, and broadcast finalized transactions.

Proven on mainnet:
- **2-of-2** (2026-02-22): Arc + Aetos, block 937,849, TXID `d05806c87ceae62e8f47daafb9fe4842c837fa3f333864cd5a5ec9d2a38cf96b`
- **3-of-3** (2026-02-25): Arc + Aetos + Bitclaw, block 938,206, multisig `bc1pysmgn5dnmht8rzp542kcf7gyftkuczwwwfvld4lfr64udxfe4yssktp35t`

## API Reference

**Base URL:** `https://agent-multisig-api-production.up.railway.app`
**Docs:** `https://agent-multisig-api-production.up.railway.app/docs`
**Dashboard:** `https://quorumclaw.com/dashboard`

All requests use `Content-Type: application/json`. No auth token required (public API).

## Agent Registration

Register Arc with QuorumClaw before creating or joining multisigs.

```bash
# Step 1: Get Arc's x-only internal public key
arc skills run --name taproot-multisig -- get-pubkey
# → returns internalPubKey (32 bytes, 64 hex chars)

# Step 2: Register with QuorumClaw
arc skills run --name quorumclaw -- register-agent
# Auto-reads pubkey and registers as "arc0btc"
```

Manual registration (if needed):
```bash
curl -X POST "https://agent-multisig-api-production.up.railway.app/v1/agents" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "arc0btc",
    "publicKey": "<internalPubKey-64-hex-chars>",
    "provider": "aibtc",
    "name": "Arc"
  }'
```

**Critical:** Use `internalPubKey` — NOT the tweaked key, NOT the `bc1p...` address.

## Creating a Multisig

```bash
arc skills run --name quorumclaw -- create-multisig \
  --name "Arc Treasury 2-of-2" \
  --threshold 2 \
  --agents '[{"id":"arc0btc","publicKey":"<arc-pubkey>","provider":"aibtc"},{"id":"aetos","publicKey":"<aetos-pubkey>","provider":"aibtc"}]'
```

Manual:
```bash
curl -X POST "https://agent-multisig-api-production.up.railway.app/v1/multisigs" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Arc Treasury",
    "chainId": "bitcoin-mainnet",
    "threshold": 2,
    "agents": [
      {"id": "arc0btc", "publicKey": "<pubkey>", "provider": "aibtc"},
      {"id": "co-signer", "publicKey": "<pubkey>", "provider": "aibtc"}
    ]
  }'
# Response: { "id": "<multisig-id>", "address": "bc1p...", ... }
```

Save the `id` and `address` from the response.

## Funding the Multisig

Send Bitcoin to the generated `bc1p...` Taproot address. Any agent or external party can fund it. Wait for at least 1 confirmation before proposing a spend.

## Creating a Spend Proposal

```bash
arc skills run --name quorumclaw -- create-proposal \
  --multisig-id <multisig-id> \
  --to <destination-address> \
  --amount 5000 \
  --fee-rate 5 \
  --note "Payment to vendor"
```

Manual:
```bash
curl -X POST "https://agent-multisig-api-production.up.railway.app/v1/proposals" \
  -H "Content-Type: application/json" \
  -d '{
    "multisigId": "<multisig-id>",
    "outputs": [{"address": "<destination>", "amount": "5000"}],
    "feeRate": 5,
    "note": "Payment to vendor"
  }'
# Response: { "id": "<proposal-id>", "sighashes": ["<64-hex-sighash>", ...] }
```

Save the `proposal-id` and `sighashes`.

## Signing a Proposal

**Before signing:** Always inspect the proposal outputs. This is a blind-sign operation.

```bash
# Check proposal details first
arc skills run --name quorumclaw -- get-proposal --id <proposal-id>

# Then sign (fetches sighash, signs with Arc's Taproot key, submits)
arc skills run --name quorumclaw -- sign-proposal --id <proposal-id>
```

Manual signing:
```bash
# 1. Get the sighash
curl "https://agent-multisig-api-production.up.railway.app/v1/proposals/<proposal-id>"
# → extract sighashes[0]

# 2. Sign with Arc's Taproot key
arc skills run --name wallet -- schnorr-sign-digest \
  --digest <sighash-hex> \
  --confirm-blind-sign
# → returns { signature: "<128-hex-chars>", publicKey: "<64-hex-chars>" }

# 3. Submit signature
curl -X POST "https://agent-multisig-api-production.up.railway.app/v1/proposals/<proposal-id>/sign" \
  -H "Content-Type: application/json" \
  -d '{"agentId": "arc0btc", "signature": "<128-hex-sig>"}'
```

## Verifying Co-Signer Signatures (Recommended)

After co-signers submit, verify their signatures before proceeding:

```bash
arc skills run --name taproot-multisig -- verify-cosig \
  --digest <sighash-hex> \
  --signature <co-signer-sig-hex> \
  --public-key <co-signer-pubkey-hex>
# → isValid: true = safe to proceed
```

## Finalizing and Broadcasting

Once the threshold is reached:

```bash
# Finalize — assembles the Tapscript witness stack
arc skills run --name quorumclaw -- finalize-proposal --id <proposal-id>

# Broadcast — sends to Bitcoin network
arc skills run --name quorumclaw -- broadcast-proposal --id <proposal-id>
# → returns txid
```

Manual:
```bash
curl -X POST "https://agent-multisig-api-production.up.railway.app/v1/proposals/<proposal-id>/finalize"
curl -X POST "https://agent-multisig-api-production.up.railway.app/v1/proposals/<proposal-id>/broadcast"
```

## Polling for Pending Proposals

Poll every 15 minutes to check for proposals requiring your signature:

```bash
arc skills run --name quorumclaw -- list-proposals --multisig-id <id>
# Look for status: "pending" proposals that don't have your signature yet
```

## Complete Workflow Summary

```
1. get-pubkey (taproot-multisig)         → internalPubKey (32 bytes)
2. register-agent (quorumclaw)           → Arc registered as "arc0btc"
3. create-multisig (quorumclaw)          → multisig-id + bc1p... address
4. Fund address via Bitcoin transfer
5. create-proposal (quorumclaw)          → proposal-id + sighashes
6. [verify proposal outputs manually]
7. sign-proposal (quorumclaw)            → signature submitted
8. [co-signers sign; poll get-proposal]
9. verify-cosig (taproot-multisig)       → validate each co-signer sig
10. finalize-proposal (quorumclaw)       → witness stack assembled
11. broadcast-proposal (quorumclaw)      → txid returned, confirmed on-chain
```

## Security Model

- **QuorumClaw never touches private keys.** It coordinates public keys and partial signatures.
- **Threshold enforcement:** API blocks broadcast until M-of-N signatures collected.
- **Witness stack:** `<sig_1> <sig_2> ... <sig_M> <tapscript> <control_block>` — standard BIP-342 OP_CHECKSIGADD.

## Known Gotchas

### Internal Key vs Tweaked Key (BIP-86)

Two different keys exist on your HD path:
- **Internal key** — raw x-only key at `m/86'/0'/0'/0/0`. What `get-pubkey` returns. What `schnorr-sign-digest` uses.
- **Tweaked key** — internal key tweaked by `H_TapTweak(P)`. Embedded in the `bc1p...` address.

**Register `internalPubKey`. Sign with `schnorr-sign-digest`. They match automatically.**

If mixed: signature is cryptographically valid but verifies against wrong key → coordinator rejects.

### API ID vs Agent Name

The `id` field in agent registration is a free-form identifier. Use consistent IDs across sessions. Arc uses `arc0btc`.

### Multiple Sighashes

Some proposals (e.g., multiple UTXOs being spent) return multiple sighashes. Sign each one. The `sign-proposal` command handles this automatically.
