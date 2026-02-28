---
name: identity
description: ERC-8004 on-chain agent identity management — register agent identities, update URI and metadata, manage operator approvals, set/unset agent wallet, transfer identity NFTs, and query identity info.
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

Register a new agent identity on-chain using the ERC-8004 identity registry. Returns a transaction ID. Check the transaction result to get the assigned agent ID. Requires an unlocked wallet.

Options:
- `--uri` (optional) — URI pointing to agent metadata (IPFS, HTTP, etc.)
- `--metadata` (optional) — JSON array of `{"key": "...", "value": "<hex>"}` pairs (values are hex-encoded buffers)
- `--fee` (optional) — Fee preset (`low`, `medium`, `high`) or micro-STX amount
- `--sponsored` (flag) — Submit as a sponsored transaction

### get

Get agent identity information from the ERC-8004 identity registry. Returns owner address, URI, and wallet if set. Does not require a wallet.

Options:
- `--agent-id` (required) — Agent ID to look up (non-negative integer)

### set-uri

Update the URI for an agent identity. Caller must be the agent owner or an approved operator. Requires an unlocked wallet.

Options:
- `--agent-id` (required) — Agent ID to update (non-negative integer)
- `--uri` (required) — New URI pointing to agent metadata (IPFS, HTTP, etc.)
- `--fee` (optional) — Fee preset (`low`, `medium`, `high`) or micro-STX amount
- `--sponsored` (flag) — Submit as a sponsored transaction

### set-metadata

Set a metadata key-value pair for an agent identity. Value must be a hex-encoded buffer (max 512 bytes). The key `agentWallet` is reserved and will be rejected by the contract. Caller must be the agent owner or an approved operator. Requires an unlocked wallet.

Options:
- `--agent-id` (required) — Agent ID to update (non-negative integer)
- `--key` (required) — Metadata key (string)
- `--value` (required) — Metadata value as a hex-encoded buffer (e.g., `616c696365` for "alice")
- `--fee` (optional) — Fee preset (`low`, `medium`, `high`) or micro-STX amount
- `--sponsored` (flag) — Submit as a sponsored transaction

### set-approval

Approve or revoke an operator for an agent identity. Approved operators can update URI, metadata, and wallet on behalf of the owner. Only the NFT owner can call this. Requires an unlocked wallet.

Options:
- `--agent-id` (required) — Agent ID to update (non-negative integer)
- `--operator` (required) — Stacks address of the operator to approve or revoke
- `--approved` (flag) — Grant approval (omit to revoke)
- `--fee` (optional) — Fee preset (`low`, `medium`, `high`) or micro-STX amount
- `--sponsored` (flag) — Submit as a sponsored transaction

### set-wallet

Set the agent wallet for an identity to tx-sender (the active wallet address). This links the active Stacks address to the agent ID without requiring a separate signature. Caller must be the agent owner or an approved operator. Requires an unlocked wallet.

Options:
- `--agent-id` (required) — Agent ID to update (non-negative integer)
- `--fee` (optional) — Fee preset (`low`, `medium`, `high`) or micro-STX amount
- `--sponsored` (flag) — Submit as a sponsored transaction

### unset-wallet

Remove the agent wallet association from an agent identity. Caller must be the agent owner or an approved operator. Requires an unlocked wallet.

Options:
- `--agent-id` (required) — Agent ID to update (non-negative integer)
- `--fee` (optional) — Fee preset (`low`, `medium`, `high`) or micro-STX amount
- `--sponsored` (flag) — Submit as a sponsored transaction

### transfer

Transfer an agent identity NFT to a new owner. The active wallet (tx-sender) must equal the current owner. Transfer automatically clears the agent wallet association. Requires an unlocked wallet.

Options:
- `--agent-id` (required) — Agent ID (token ID) to transfer (non-negative integer)
- `--recipient` (required) — Stacks address of the new owner
- `--fee` (optional) — Fee preset (`low`, `medium`, `high`) or micro-STX amount
- `--sponsored` (flag) — Submit as a sponsored transaction

### get-metadata

Read a metadata value by key from the ERC-8004 identity registry. Returns the raw buffer value as a hex string. Does not require a wallet.

Options:
- `--agent-id` (required) — Agent ID to query (non-negative integer)
- `--key` (required) — Metadata key to read

### get-last-id

Get the most recently minted agent ID from the ERC-8004 identity registry. Returns null if no agents have been registered. Does not require a wallet.

## Requires

- wallet (for write operations)

## When to Use

- Register a new on-chain ERC-8004 agent identity after AIBTC API registration
- Look up an agent's on-chain identity info
- Update agent metadata or URI as part of an upgrade workflow
- Delegate identity management to an operator address
- Link or unlink a Stacks wallet address to an agent identity
- Transfer identity ownership to a new address

## Notes

- Read operations (get, get-metadata, get-last-id) work without a wallet
- Write operations require an unlocked wallet
- Agent IDs are assigned by the contract upon registration — check the transaction result to find your assigned ID
- Operator approvals allow a delegate address to update URI, metadata, and wallet for an agent
- Transfer automatically clears the agent wallet association; use `set-wallet` after transfer if needed
- The `agentWallet` key is reserved — use `set-wallet` / `unset-wallet` subcommands instead
- Identity is a Stacks L2 operation — check transaction status after write calls
