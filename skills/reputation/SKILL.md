---
name: reputation
description: ERC-8004 on-chain agent reputation management — submit and revoke feedback, append responses, approve clients, and query reputation summaries, feedback entries, and client lists.
tags:
  - erc8004
  - reputation
  - l2
  - write
---

# Reputation Skill

Provides ERC-8004 on-chain agent reputation operations using the reputation-registry contract. Read operations (get-summary, read-feedback, read-all-feedback, get-clients, get-feedback-count, get-approved-limit, get-last-index) work without a wallet. Write operations (give-feedback, revoke-feedback, append-response, approve-client) require an unlocked wallet.

## CLI Commands

```
arc skills run --name reputation -- give-feedback --agent-id <id> --value <value> [--value-decimals <decimals>] [--tag1 <tag>] [--tag2 <tag>] [--endpoint <endpoint>] [--feedback-uri <uri>] [--feedback-hash <hex>] [--fee <fee>] [--sponsored]
arc skills run --name reputation -- revoke-feedback --agent-id <id> --index <index> [--fee <fee>] [--sponsored]
arc skills run --name reputation -- append-response --agent-id <id> --client <address> --index <index> --response-uri <uri> --response-hash <hex> [--fee <fee>] [--sponsored]
arc skills run --name reputation -- approve-client --agent-id <id> --client <address> --index-limit <limit> [--fee <fee>] [--sponsored]
arc skills run --name reputation -- get-summary --agent-id <id>
arc skills run --name reputation -- read-feedback --agent-id <id> --client <address> --index <index>
arc skills run --name reputation -- read-all-feedback --agent-id <id> [--tag1 <tag>] [--tag2 <tag>] [--include-revoked] [--cursor <cursor>]
arc skills run --name reputation -- get-clients --agent-id <id> [--cursor <cursor>]
arc skills run --name reputation -- get-feedback-count --agent-id <id>
arc skills run --name reputation -- get-approved-limit --agent-id <id> --client <address>
arc skills run --name reputation -- get-last-index --agent-id <id> --client <address>
```

## Subcommands

### give-feedback

Submit feedback for an agent in the ERC-8004 reputation registry. Requires an unlocked wallet.

Options:
- `--agent-id` (required) — Agent ID to give feedback for (non-negative integer)
- `--value` (required) — Feedback value (signed integer, e.g., 5 for positive, -2 for negative)
- `--value-decimals` (optional, default 0) — Decimal precision for the value (non-negative integer)
- `--tag1` (optional) — Primary classification tag (e.g., "helpful", "accuracy")
- `--tag2` (optional) — Secondary classification tag
- `--endpoint` (optional) — Endpoint or context identifier for the feedback
- `--feedback-uri` (optional) — URI pointing to detailed feedback data
- `--feedback-hash` (optional) — 32-byte SHA-256 hash of the feedback data as a hex string
- `--fee` (optional) — Fee preset (`low`, `medium`, `high`) or micro-STX amount
- `--sponsored` (flag) — Submit as a sponsored transaction

### revoke-feedback

Revoke previously submitted feedback. Only the original feedback submitter can revoke their own feedback. Requires an unlocked wallet.

Options:
- `--agent-id` (required) — Agent ID whose feedback you want to revoke
- `--index` (required) — Feedback index to revoke
- `--fee` (optional) — Fee preset or micro-STX amount
- `--sponsored` (flag) — Submit as a sponsored transaction

### append-response

Append a response to a feedback entry. Any principal can append a response. Requires an unlocked wallet.

Options:
- `--agent-id` (required) — Agent ID associated with the feedback
- `--client` (required) — Stacks address of the original feedback submitter
- `--index` (required) — Feedback index to respond to
- `--response-uri` (required) — URI pointing to the response data
- `--response-hash` (required) — 32-byte SHA-256 hash of the response data
- `--fee` (optional) — Fee preset or micro-STX amount
- `--sponsored` (flag) — Submit as a sponsored transaction

### approve-client

Approve a client address to submit feedback for an agent. Requires an unlocked wallet.

Options:
- `--agent-id` (required) — Agent ID to configure approval for
- `--client` (required) — Stacks address of the client to approve
- `--index-limit` (required) — Maximum number of feedback entries the client may submit
- `--fee` (optional) — Fee preset or micro-STX amount
- `--sponsored` (flag) — Submit as a sponsored transaction

### get-summary

Get the aggregated reputation summary for an agent. Does not require a wallet.

Options:
- `--agent-id` (required) — Agent ID to query

### read-feedback

Read a specific feedback entry by agent ID, client address, and feedback index. Does not require a wallet.

Options:
- `--agent-id` (required) — Agent ID to query
- `--client` (required) — Stacks address of the feedback submitter
- `--index` (required) — Feedback index to read

### read-all-feedback

Get a paginated list of all feedback entries for an agent. Does not require a wallet.

Options:
- `--agent-id` (required) — Agent ID to query
- `--tag1` (optional) — Filter by primary tag
- `--tag2` (optional) — Filter by secondary tag
- `--include-revoked` (flag) — Include revoked feedback entries
- `--cursor` (optional) — Pagination cursor

### get-clients

Get a paginated list of client addresses that have given feedback for an agent. Does not require a wallet.

Options:
- `--agent-id` (required) — Agent ID to query
- `--cursor` (optional) — Pagination cursor

### get-feedback-count

Get the total feedback count for an agent. Does not require a wallet.

Options:
- `--agent-id` (required) — Agent ID to query

### get-approved-limit

Check the approved feedback index limit for a client on an agent. Does not require a wallet.

Options:
- `--agent-id` (required) — Agent ID to query
- `--client` (required) — Stacks address of the client

### get-last-index

Get the last feedback index for a client on an agent. Does not require a wallet.

Options:
- `--agent-id` (required) — Agent ID to query
- `--client` (required) — Stacks address of the client

## Requires

- wallet (for write operations)

## When to Use

- Record on-chain feedback about an agent's performance or behavior
- Revoke inaccurate or outdated feedback
- Allow an agent to respond to feedback
- Grant a client permission to submit feedback
- Retrieve an agent's current reputation score or feedback history
- Paginate through all feedback or clients for analytics

## Notes

- Read operations work without a wallet
- Write operations require an unlocked wallet
- `revoke-feedback`: tx-sender must be the original feedback submitter
- `approve-client`: tx-sender must be the agent owner or an approved identity operator
- Feedback hashes must be exactly 32 bytes (64 hex characters); use SHA-256
- Pagination uses cursor-based navigation
- Reputation is a Stacks L2 operation — check transaction status after write calls
