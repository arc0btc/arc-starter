---
name: reputation-agent
skill: reputation
description: ERC-8004 on-chain agent reputation management — submit and revoke feedback, append responses, approve clients, and query reputation summaries, feedback entries, and client lists.
---

# Reputation Agent

This agent manages ERC-8004 on-chain agent reputation using the reputation-registry contract. It handles submitting and revoking feedback, appending responses to feedback entries, approving clients, and all read-only queries for reputation data. Read operations work without a wallet. Write operations require an unlocked wallet.

## Capabilities

- Submit feedback for an agent with value, tags, and optional hash (give-feedback)
- Revoke previously submitted feedback as the original submitter (revoke-feedback)
- Append a response to an existing feedback entry (append-response)
- Approve a client to submit feedback up to an index limit (approve-client)
- Get aggregated reputation summary (count + WAD average) for an agent (get-summary)
- Read a specific feedback entry by agent ID, client, and index (read-feedback)
- Get a paginated list of all feedback entries with optional tag filtering (read-all-feedback)
- Get a paginated list of clients who gave feedback for an agent (get-clients)
- Get the total feedback count for an agent (get-feedback-count)
- Check the approved feedback index limit for a client on an agent (get-approved-limit)
- Get the last feedback index submitted by a client for an agent (get-last-index)

## When to Delegate Here

Delegate to this agent when the workflow needs to:
- Record on-chain feedback about an agent's performance or behavior
- Revoke inaccurate or outdated feedback previously submitted
- Allow an agent to respond to feedback on its own record
- Grant a client permission to submit feedback for an agent
- Retrieve an agent's current reputation score or feedback history
- Paginate through all feedback or clients for analytics or display
- Check whether a client is authorized to submit more feedback

## Key Constraints

- give-feedback, revoke-feedback, append-response, and approve-client all require an unlocked wallet
- revoke-feedback: tx-sender must be the original feedback submitter (the client address)
- approve-client: tx-sender must be the agent owner or an approved identity operator
- --feedback-hash and --response-hash must be exactly 32 bytes (64 hex characters); use SHA-256
- Feedback values are signed integers (negative values are allowed for negative feedback)
- Use --value-decimals to express fractional precision (e.g., value=5, value-decimals=1 means 0.5)
- Pagination is cursor-based; pass the cursor from one response into the next call to page through results
- Reputation is a Stacks L2 operation — check transaction status with `stx get-transaction-status` after write calls

## Outputs

All commands return JSON with:
- `success` (boolean) — Operation succeeded or failed
- `network` (string) — Network (mainnet or testnet)
- For write operations: `txid` (string), `explorerUrl` (string)
- For read operations: Data relevant to the query (agents, feedback counts, etc.)

## Examples

Submit positive feedback:
```
arc skills run --name reputation -- give-feedback --agent-id 42 --value 5 --tag1 helpful
```

Submit feedback with supporting evidence hash:
```
arc skills run --name reputation -- give-feedback --agent-id 42 --value 8 --value-decimals 1 --feedback-uri ipfs://evidence --feedback-hash a3f2b1...64hex
```

Revoke feedback you previously submitted:
```
arc skills run --name reputation -- revoke-feedback --agent-id 42 --index 0
```

Append a response to a feedback entry:
```
arc skills run --name reputation -- append-response --agent-id 42 --client SP2... --index 0 --response-uri ipfs://myresponse --response-hash b4e9c2...64hex
```

Approve a client to submit feedback:
```
arc skills run --name reputation -- approve-client --agent-id 42 --client SP3... --index-limit 5
```

Get reputation summary:
```
arc skills run --name reputation -- get-summary --agent-id 42
```

Get all feedback with pagination:
```
arc skills run --name reputation -- read-all-feedback --agent-id 42 --cursor 14
```

Get all clients who gave feedback:
```
arc skills run --name reputation -- get-clients --agent-id 42
```
