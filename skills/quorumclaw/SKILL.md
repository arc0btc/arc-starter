---
name: quorumclaw
description: Coordinate Bitcoin Taproot M-of-N multisig transactions via the QuorumClaw agent-multisig API. Handles agent registration, multisig creation, proposal submission, signing coordination, and broadcast.
tags:
  - l1
  - mainnet-only
  - sensitive
---

# QuorumClaw

QuorumClaw is the coordination layer for multi-agent Bitcoin Taproot multisig. Arc has proven 2-of-2 (block 937,849) and 3-of-3 (block 938,206) multisigs via this API. This skill wraps the QuorumClaw REST API; the crypto primitives (key derivation, Schnorr signing, signature verification) live in `taproot-multisig`.

**API base:** `https://agent-multisig-api-production.up.railway.app`
**Dashboard:** https://quorumclaw.com/dashboard

## CLI Commands

```
arc skills run --name quorumclaw -- register-agent
arc skills run --name quorumclaw -- agent-status --agent-id <id>
arc skills run --name quorumclaw -- create-multisig --name <name> --threshold <n> --agents <json>
arc skills run --name quorumclaw -- get-multisig --id <multisig-id>
arc skills run --name quorumclaw -- create-proposal --multisig-id <id> --to <address> --amount <sats> [--fee-rate <sats/vb>] [--note <text>]
arc skills run --name quorumclaw -- get-proposal --id <proposal-id>
arc skills run --name quorumclaw -- sign-proposal --id <proposal-id>
arc skills run --name quorumclaw -- finalize-proposal --id <proposal-id>
arc skills run --name quorumclaw -- broadcast-proposal --id <proposal-id>
arc skills run --name quorumclaw -- list-proposals --multisig-id <id>
```

### register-agent

Registers Arc with QuorumClaw using Arc's Taproot internal public key. Reads pubkey via `taproot-multisig get-pubkey`. Agent ID defaults to `arc0btc`.

### create-multisig

Create an M-of-N multisig. `--agents` is a JSON array of `{id, publicKey, provider}` objects. Response includes the generated Taproot address (`bc1p...`).

### create-proposal

Propose a spend from a multisig. Returns `sighashes` array — each must be signed by threshold signers.

### sign-proposal

Fetches the sighash from a pending proposal, signs with Arc's Taproot key (via `wallet schnorr-sign-digest`), and submits. Requires wallet unlock.

### finalize-proposal + broadcast-proposal

Called once threshold signatures are collected. Finalize assembles the witness stack; broadcast sends to the Bitcoin network.

## Coordination Pattern

```
1. taproot-multisig get-pubkey          → get Arc's internalPubKey
2. quorumclaw register-agent            → register with QuorumClaw
3. quorumclaw create-multisig           → create wallet with co-signers
4. quorumclaw create-proposal           → propose a spend
5. quorumclaw sign-proposal             → sign when threshold not yet met
6. quorumclaw finalize-proposal         → assemble witness
7. quorumclaw broadcast-proposal        → broadcast to Bitcoin network
```

## Key Gotchas

- Register `internalPubKey` from `taproot-multisig get-pubkey`, NOT the tweaked key or `bc1p...` address
- `sign-proposal` is a **blind signing operation** — verify proposal outputs before signing
- QuorumClaw never holds private keys — only public keys and partial signatures
- Poll `get-proposal` every 15 minutes for pending signing requests

## Proven Track Record

| Config | Block | Signers |
|--------|-------|---------|
| 2-of-2 | 937,849 | Arc + Aetos |
| 3-of-3 | 938,206 | Arc + Aetos + Bitclaw |
