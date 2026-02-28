---
name: validation
description: ERC-8004 on-chain agent validation management — request and respond to validations, and query validation status, summaries, and paginated lists by agent or validator.
tags:
  - erc8004
  - validation
  - l2
  - write
---

# Validation Skill

Provides ERC-8004 on-chain agent validation operations using the validation-registry contract. Read operations (get-status, get-summary, get-agent-validations, get-validator-requests) work without a wallet. Write operations (request, respond) require an unlocked wallet.

## CLI Commands

```
arc skills run --name validation -- request --validator <address> --agent-id <id> --request-uri <uri> --request-hash <hex> [--fee <fee>] [--sponsored]
arc skills run --name validation -- respond --request-hash <hex> --response <value> --response-uri <uri> --response-hash <hex> [--tag <tag>] [--fee <fee>] [--sponsored]
arc skills run --name validation -- get-status --request-hash <hex>
arc skills run --name validation -- get-summary --agent-id <id>
arc skills run --name validation -- get-agent-validations --agent-id <id> [--cursor <cursor>]
arc skills run --name validation -- get-validator-requests --validator <address> [--cursor <cursor>]
```

## Subcommands

### request

Request validation from a validator for an agent. Requires an unlocked wallet.

Options:
- `--validator` (required) — Stacks address of the validator to request validation from
- `--agent-id` (required) — Agent ID to request validation for (non-negative integer)
- `--request-uri` (required) — URI pointing to the validation request data
- `--request-hash` (required) — 32-byte SHA-256 hash of the request data as a hex string
- `--fee` (optional) — Fee preset (`low`, `medium`, `high`) or micro-STX amount
- `--sponsored` (flag) — Submit as a sponsored transaction

### respond

Submit a validation response for a pending validation request. Only the validator specified in the original request can call this. Can be called multiple times for progressive updates. Requires an unlocked wallet.

Options:
- `--request-hash` (required) — 32-byte SHA-256 hash of the original request
- `--response` (required) — Validation response score (integer between 0 and 100)
- `--response-uri` (required) — URI pointing to the validation response data
- `--response-hash` (required) — 32-byte SHA-256 hash of the response data
- `--tag` (optional) — Classification tag for the validation response
- `--fee` (optional) — Fee preset or micro-STX amount
- `--sponsored` (flag) — Submit as a sponsored transaction

### get-status

Get the status of a validation request by its 32-byte request hash. Does not require a wallet.

Options:
- `--request-hash` (required) — 32-byte SHA-256 hash of the validation request

### get-summary

Get the aggregated validation summary for an agent. Does not require a wallet.

Options:
- `--agent-id` (required) — Agent ID to query

### get-agent-validations

Get a paginated list of validation request hashes for an agent. Does not require a wallet.

Options:
- `--agent-id` (required) — Agent ID to query
- `--cursor` (optional) — Pagination cursor (from previous response)

### get-validator-requests

Get a paginated list of validation request hashes submitted to a validator. Does not require a wallet.

Options:
- `--validator` (required) — Stacks address of the validator to query
- `--cursor` (optional) — Pagination cursor (from previous response)

## Requires

- wallet (for write operations)

## When to Use

- Submit a formal validation request to a trusted validator for an agent identity
- Respond to a pending validation request as a designated validator
- Check the current status and score of a specific validation request
- Retrieve an agent's overall validation score or count
- Page through all validations associated with an agent
- List all pending validation requests for a validator to process

## Notes

- Read operations work without a wallet
- Write operations require an unlocked wallet
- `respond`: tx-sender must be the validator address specified in the original request
- Validation request and response hashes must be exactly 32 bytes (64 hex characters); use SHA-256
- Response score must be an integer between 0 and 100 (inclusive)
- `respond` can be called multiple times for progressive score updates
- Pagination uses cursor-based navigation
- Validation is a Stacks L2 operation — check transaction status after write calls
