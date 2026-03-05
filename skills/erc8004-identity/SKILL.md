---
name: erc8004-identity
description: ERC-8004 on-chain agent identity management — register agent identities, update URI and metadata, manage operator approvals, set/unset agent wallet, transfer identity NFTs, and query identity info.
updated: 2026-03-05
tags:
  - erc8004
  - identity
  - l2
  - write
---

# Identity Skill

Provides ERC-8004 on-chain agent identity operations using the identity-registry contract. Read operations (get, get-metadata, get-last-id) work without a wallet. Write operations (register, set-uri, set-metadata, set-approval, set-wallet, unset-wallet, transfer) require an unlocked wallet.

## CLI Commands

```
arc skills run --name identity -- register [--uri <uri>] [--metadata <json>] [--fee <fee>] [--sponsored]
arc skills run --name identity -- get --agent-id <id>
arc skills run --name identity -- set-uri --agent-id <id> --uri <uri> [--fee <fee>] [--sponsored]
arc skills run --name identity -- set-metadata --agent-id <id> --key <key> --value <hex> [--fee <fee>] [--sponsored]
arc skills run --name identity -- set-approval --agent-id <id> --operator <address> [--approved] [--fee <fee>] [--sponsored]
arc skills run --name identity -- set-wallet --agent-id <id> [--fee <fee>] [--sponsored]
arc skills run --name identity -- unset-wallet --agent-id <id> [--fee <fee>] [--sponsored]
arc skills run --name identity -- transfer --agent-id <id> --recipient <address> [--fee <fee>] [--sponsored]
arc skills run --name identity -- get-metadata --agent-id <id> --key <key>
arc skills run --name identity -- get-last-id
```

## Subcommands

### register

Returns a transaction ID; check the result to get the assigned agent ID.

Options:
- `--uri` (optional) — URI pointing to agent metadata (IPFS, HTTP, etc.)
- `--metadata` (optional) — JSON array of `{"key": "...", "value": "<hex>"}` pairs (values are hex-encoded buffers)
- `--fee` (optional) — Fee preset (`low`, `medium`, `high`) or micro-STX amount
- `--sponsored` (flag) — Submit as a sponsored transaction

### get

Returns owner address, URI, and wallet if set.

Options:
- `--agent-id` (required) — Agent ID to look up (non-negative integer)

### set-uri

Options:
- `--agent-id` (required) — Agent ID to update (non-negative integer)
- `--uri` (required) — New URI pointing to agent metadata (IPFS, HTTP, etc.)
- `--fee` (optional) — Fee preset (`low`, `medium`, `high`) or micro-STX amount
- `--sponsored` (flag) — Submit as a sponsored transaction

### set-metadata

Value must be hex-encoded buffer (max 512 bytes). Key `agentWallet` is reserved — use `set-wallet` instead.

Options:
- `--agent-id` (required) — Agent ID to update (non-negative integer)
- `--key` (required) — Metadata key (string)
- `--value` (required) — Metadata value as a hex-encoded buffer (e.g., `616c696365` for "alice")
- `--fee` (optional) — Fee preset (`low`, `medium`, `high`) or micro-STX amount
- `--sponsored` (flag) — Submit as a sponsored transaction

### set-approval

Only NFT owner can call. Omit `--approved` to revoke.

Options:
- `--agent-id` (required) — Agent ID to update (non-negative integer)
- `--operator` (required) — Stacks address of the operator to approve or revoke
- `--approved` (flag) — Grant approval (omit to revoke)
- `--fee` (optional) — Fee preset (`low`, `medium`, `high`) or micro-STX amount
- `--sponsored` (flag) — Submit as a sponsored transaction

### set-wallet

Links active Stacks address to the agent ID.

Options:
- `--agent-id` (required) — Agent ID to update (non-negative integer)
- `--fee` (optional) — Fee preset (`low`, `medium`, `high`) or micro-STX amount
- `--sponsored` (flag) — Submit as a sponsored transaction

### unset-wallet

Options:
- `--agent-id` (required) — Agent ID to update (non-negative integer)
- `--fee` (optional) — Fee preset (`low`, `medium`, `high`) or micro-STX amount
- `--sponsored` (flag) — Submit as a sponsored transaction

### transfer

Clears agent wallet association on transfer; run `set-wallet` after if needed.

Options:
- `--agent-id` (required) — Agent ID (token ID) to transfer (non-negative integer)
- `--recipient` (required) — Stacks address of the new owner
- `--fee` (optional) — Fee preset (`low`, `medium`, `high`) or micro-STX amount
- `--sponsored` (flag) — Submit as a sponsored transaction

### get-metadata

Returns raw buffer as hex string.

Options:
- `--agent-id` (required) — Agent ID to query (non-negative integer)
- `--key` (required) — Metadata key to read

### get-last-id

Returns null if no agents have been registered.

## When to Load

Load when: registering or updating Arc's on-chain agent identity, managing operator approvals, or querying another agent's identity record. Write operations require `bitcoin-wallet` skill. Read-only queries (get, get-metadata) can run without skill context using `arc skills run --name identity`.

## Requires

- wallet (for write operations)

## Notes

- Read operations (get, get-metadata, get-last-id) work without a wallet
- Write operations require an unlocked wallet
- Agent IDs are assigned by the contract upon registration — check the transaction result to find your assigned ID
- Operator approvals allow a delegate address to update URI, metadata, and wallet for an agent
- Transfer automatically clears the agent wallet association; use `set-wallet` after transfer if needed
- The `agentWallet` key is reserved — use `set-wallet` / `unset-wallet` subcommands instead
- Identity is a Stacks L2 operation — check transaction status after write calls
