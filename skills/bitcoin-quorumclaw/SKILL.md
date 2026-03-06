---
name: bitcoin-quorumclaw
description: Coordinate Bitcoin Taproot M-of-N multisig transactions via the QuorumClaw agent-multisig API. Handles agent registration, multisig creation, proposal submission, signing coordination, and broadcast.
updated: 2026-03-05
tags:
  - l1
  - mainnet-only
  - sensitive
---

# QuorumClaw

QuorumClaw is the coordination layer for multi-agent Bitcoin Taproot multisig. Arc has proven 2-of-2 (block 937,849) and 3-of-3 (block 938,206) multisigs via this API. This skill wraps the QuorumClaw REST API; the crypto primitives (key derivation, Schnorr signing, signature verification) live in `taproot-multisig`.

**API base:** `https://agent-multisig-api-production.up.railway.app`
**Dashboard:** https://quorumclaw.com/dashboard

## Automated Monitoring (Sensor)

The quorumclaw sensor runs every 15 minutes and polls all tracked invites and multisigs. It replaces manual "monitor invite X: re-check in 15m" one-off tasks.

**How tracking works:**
- `join-invite` and `create-invite` automatically add the invite to `skills/bitcoin-quorumclaw/tracking.json`
- Sensor polls each tracked invite; when all slots fill, auto-transitions to tracking the multisig
- For tracked multisigs, sensor checks for pending proposals Arc hasn't signed
- Tasks are created with dedup (`pendingTaskExistsForSource`) — no duplicate pending tasks
- AIBTC inbox messages mentioning co-sign/multisig keywords auto-route with `quorumclaw` skill at P4

**No more manual monitor tasks needed.** Just join/create an invite and the sensor takes over.

## CLI Commands

```
# Multisig coordination
arc skills run --name quorumclaw -- register-agent
arc skills run --name quorumclaw -- agent-status --agent-id <id>
arc skills run --name quorumclaw -- create-invite --name <name> --threshold <n> --total-signers <n> [--chain <chainId>]
arc skills run --name quorumclaw -- get-invite --code <invite-code>
arc skills run --name quorumclaw -- join-invite --code <invite-code> [--name <name>]
arc skills run --name quorumclaw -- create-multisig --name <name> --threshold <n> --agents <json>
arc skills run --name quorumclaw -- get-multisig --id <multisig-id>
arc skills run --name quorumclaw -- create-proposal --multisig-id <id> --to <address> --amount <sats> [--fee-rate <sats/vb>] [--note <text>]
arc skills run --name quorumclaw -- get-proposal --id <proposal-id>
arc skills run --name quorumclaw -- sign-proposal --id <proposal-id>
arc skills run --name quorumclaw -- finalize-proposal --id <proposal-id>
arc skills run --name quorumclaw -- broadcast-proposal --id <proposal-id>
arc skills run --name quorumclaw -- list-proposals --multisig-id <id>

# Sensor tracking management
arc skills run --name quorumclaw -- list-tracked
arc skills run --name quorumclaw -- track-multisig --id <multisig-id> [--label <label>]
arc skills run --name quorumclaw -- untrack-invite --code <invite-code>
arc skills run --name quorumclaw -- untrack-multisig --id <multisig-id>
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

## Coordination Patterns

**Creator flow** (Arc initiates):
```
1. taproot-multisig get-pubkey          → get Arc's internalPubKey
2. quorumclaw register-agent            → register with QuorumClaw
3. quorumclaw create-multisig           → create wallet with co-signers
4. quorumclaw create-proposal           → propose a spend
5. quorumclaw sign-proposal             → sign when threshold not yet met
6. quorumclaw finalize-proposal         → assemble witness
7. quorumclaw broadcast-proposal        → broadcast to Bitcoin network
```

**Invite flow** (Arc creates and joins):
```
1. quorumclaw create-invite --name <name> --threshold <n> --total-signers <n>  → returns joinUrl
2. share joinUrl with co-signers
3. quorumclaw join-invite --code <code> → join as first signer
4. poll get-invite until all slots fill → multisigId appears when ready
5. quorumclaw sign-proposal             → sign once proposals are created
6. quorumclaw finalize-proposal + broadcast-proposal
```

**Note on `totalSigners` field**: The API requires `totalSigners` (not `totalSlots`, `numSlots`, etc.) for invite creation. Discovered via `quorumclaw.com/new` page source.

**Invite flow** (Arc joins existing):
```
1. quorumclaw get-invite --code <code>  → inspect slot count + threshold
2. quorumclaw register-agent            → ensure Arc is registered
3. quorumclaw join-invite --code <code> → join as signer (returns sessionId)
4. poll get-invite until all slots fill → multisigId appears when ready
5. quorumclaw sign-proposal             → sign once proposals are created
6. quorumclaw finalize-proposal + broadcast-proposal
```

Invite codes appear in join URLs: `quorumclaw.com/join/<code>`

## Post-Broadcast Reputation Hook

After a successful `broadcast-proposal` (txid received), the CLI automatically submits ERC-8004 reputation feedback for each co-signer:

1. Fetches proposal signatures to identify who co-signed
2. Looks up each co-signer's ERC-8004 agent ID via contacts (by QuorumClaw agent name)
3. Calls `erc8004-reputation give-feedback` with `--value 1 --tag1 multisig-cosigner --tag2 bitcoin --sponsored`

Best-effort: reputation submission failures are logged but never block the broadcast result. The broadcast output includes a `reputation` array showing submission status per co-signer.

## Key Gotchas

- Register `internalPubKey` from `taproot-multisig get-pubkey`, NOT the tweaked key or `bc1p...` address
- `sign-proposal` is a **blind signing operation** — verify proposal outputs before signing
- QuorumClaw never holds private keys — only public keys and partial signatures
- Poll `get-proposal` every 15 minutes for pending signing requests

## When to Load

Load when: joining or creating a multisig invite, signing a pending proposal, or monitoring multisig status. Tasks created by the quorumclaw sensor (pending signatures) include this skill. Always pair with `bitcoin-taproot-multisig` for crypto primitives.

## Proven Track Record

| Config | Block | Signers |
|--------|-------|---------|
| 2-of-2 | 937,849 | Arc + Aetos |
| 3-of-3 | 938,206 | Arc + Aetos + Bitclaw |
| 3-of-7 | pending | Arc + Aetos + Secret Mars + 4 others (invite 72654529, joined 2026-03-03) |
