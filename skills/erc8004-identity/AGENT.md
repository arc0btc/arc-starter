---
name: erc8004-identity-agent
skill: erc8004-identity
description: ERC-8004 on-chain agent identity management — register agent identities, update URI and metadata, manage operator approvals, set/unset agent wallet, transfer identity NFTs, and query identity info.
---

# Identity Agent

This agent manages ERC-8004 on-chain agent identities using the identity-registry contract. It handles registration (minting a sequential agent ID), updating identity attributes (URI, metadata, approvals, wallet), NFT transfers, and read-only queries. Read operations (get, get-metadata, get-last-id) work without a wallet. Write operations require an unlocked wallet.

## Capabilities

- Register a new agent identity on-chain, returning a sequential agent ID and transaction ID
- Query identity info (owner, URI, wallet) by agent ID
- Update an agent's URI to point to new metadata
- Set or update metadata key-value pairs on an agent identity
- Grant or revoke operator approval for a delegate address
- Link a Stacks address as the agent wallet (set-wallet uses tx-sender directly)
- Remove the agent wallet association (unset-wallet)
- Transfer the identity NFT to a new owner (clears wallet automatically)
- Read a metadata value by key (get-metadata)
- Get the most recently minted agent ID (get-last-id)

## When to Delegate Here

Delegate to this agent when the workflow needs to:
- Mint an on-chain ERC-8004 identity after AIBTC API registration
- Look up an agent's on-chain identity before trusting it
- Update agent metadata or URI as part of an upgrade workflow
- Delegate identity management to an operator address
- Link or unlink a Stacks wallet address to an agent identity
- Transfer identity ownership to a new address

## Key Constraints

- register, set-uri, set-metadata, set-approval, set-wallet, unset-wallet, and transfer all require an unlocked wallet
- Operator approvals (set-approval) can only be set by the NFT owner, not a delegated operator
- Transfer clears agent wallet — use set-wallet after transfer if the new owner needs a wallet linked
- Registration is a Stacks L2 transaction — check status with `stx get-transaction-status` or `query get-account-transactions`
- The `agentWallet` metadata key is reserved by the contract; use set-wallet / unset-wallet instead

## Outputs

All commands return JSON with:
- `success` (boolean) — Operation succeeded or failed
- `network` (string) — Network (mainnet or testnet)
- For write operations: `txid` (string), `explorerUrl` (string)
- For read operations: Data relevant to the query (owner, URI, wallet, metadata, etc.)

## Examples

Register a new on-chain agent identity with a metadata URI:
```
arc skills run --name erc8004-identity -- register --uri https://myagent.example.com/metadata.json
```

Look up an agent's identity by agent ID:
```
arc skills run --name erc8004-identity -- get --agent-id 42
```

Get the most recently minted agent ID:
```
arc skills run --name erc8004-identity -- get-last-id
```

Update an agent's URI:
```
arc skills run --name erc8004-identity -- set-uri --agent-id 42 --uri ipfs://newmetadata
```

Set a metadata value (hex-encoded):
```
arc skills run --name erc8004-identity -- set-metadata --agent-id 42 --key name --value 616c696365
```

Read a metadata value:
```
arc skills run --name erc8004-identity -- get-metadata --agent-id 42 --key name
```

Link active wallet as agent wallet:
```
arc skills run --name erc8004-identity -- set-wallet --agent-id 42
```

Transfer identity NFT to a new owner:
```
arc skills run --name erc8004-identity -- transfer --agent-id 42 --recipient SP3...
```

Approve an operator to manage an identity:
```
arc skills run --name erc8004-identity -- set-approval --agent-id 42 --operator SP2... --approved
```

Revoke operator approval:
```
arc skills run --name erc8004-identity -- set-approval --agent-id 42 --operator SP2...
```
