---
name: erc8004-reputation
description: ERC-8004 on-chain agent reputation management — submit and revoke feedback, append responses, approve clients, and query reputation summaries, feedback entries, and client lists.
updated: 2026-03-05
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

Options:
- `--agent-id` (required) — Agent ID whose feedback you want to revoke
- `--index` (required) — Feedback index to revoke
- `--fee` (optional) — Fee preset or micro-STX amount
- `--sponsored` (flag) — Submit as a sponsored transaction

### append-response

Options:
- `--agent-id` (required) — Agent ID associated with the feedback
- `--client` (required) — Stacks address of the original feedback submitter
- `--index` (required) — Feedback index to respond to
- `--response-uri` (required) — URI pointing to the response data
- `--response-hash` (required) — 32-byte SHA-256 hash of the response data
- `--fee` (optional) — Fee preset or micro-STX amount
- `--sponsored` (flag) — Submit as a sponsored transaction

### approve-client

Options:
- `--agent-id` (required) — Agent ID to configure approval for
- `--client` (required) — Stacks address of the client to approve
- `--index-limit` (required) — Maximum number of feedback entries the client may submit
- `--fee` (optional) — Fee preset or micro-STX amount
- `--sponsored` (flag) — Submit as a sponsored transaction

### get-summary

Options:
- `--agent-id` (required) — Agent ID to query

### read-feedback

Options:
- `--agent-id` (required) — Agent ID to query
- `--client` (required) — Stacks address of the feedback submitter
- `--index` (required) — Feedback index to read

### read-all-feedback

Options:
- `--agent-id` (required) — Agent ID to query
- `--tag1` (optional) — Filter by primary tag
- `--tag2` (optional) — Filter by secondary tag
- `--include-revoked` (flag) — Include revoked feedback entries
- `--cursor` (optional) — Pagination cursor

### get-clients

Options:
- `--agent-id` (required) — Agent ID to query
- `--cursor` (optional) — Pagination cursor

### get-feedback-count

Options:
- `--agent-id` (required) — Agent ID to query

### get-approved-limit

Options:
- `--agent-id` (required) — Agent ID to query
- `--client` (required) — Stacks address of the client

### get-last-index

Options:
- `--agent-id` (required) — Agent ID to query
- `--client` (required) — Stacks address of the client

## When to Load

Load when: submitting feedback for another agent, responding to feedback received, or checking reputation summaries. Pair with `erc8004-identity` when both identity and reputation operations are needed in the same task. Read-only queries work without this skill loaded.

## Requires

- wallet (for write operations)

## Notes

- Read operations work without a wallet
- Write operations require an unlocked wallet
- `revoke-feedback`: tx-sender must be the original feedback submitter
- `approve-client`: tx-sender must be the agent owner or an approved identity operator
- Feedback hashes must be exactly 32 bytes (64 hex characters); use SHA-256
- Pagination uses cursor-based navigation
- Reputation is a Stacks L2 operation — check transaction status after write calls
