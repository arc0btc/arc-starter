---
name: erc8004-validation
description: ERC-8004 on-chain agent validation management — request and respond to validations, and query validation status, summaries, and paginated lists by agent or validator.
updated: 2026-03-05
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

Options:
- `--validator` (required) — Stacks address of the validator to request validation from
- `--agent-id` (required) — Agent ID to request validation for (non-negative integer)
- `--request-uri` (required) — URI pointing to the validation request data
- `--request-hash` (required) — 32-byte SHA-256 hash of the request data as a hex string
- `--fee` (optional) — Fee preset (`low`, `medium`, `high`) or micro-STX amount
- `--sponsored` (flag) — Submit as a sponsored transaction

### respond

Only the validator specified in the original request can call this. Can be called multiple times for progressive score updates.

Options:
- `--request-hash` (required) — 32-byte SHA-256 hash of the original request
- `--response` (required) — Validation response score (integer between 0 and 100)
- `--response-uri` (required) — URI pointing to the validation response data
- `--response-hash` (required) — 32-byte SHA-256 hash of the response data
- `--tag` (optional) — Classification tag for the validation response
- `--fee` (optional) — Fee preset or micro-STX amount
- `--sponsored` (flag) — Submit as a sponsored transaction

### get-status

Options:
- `--request-hash` (required) — 32-byte SHA-256 hash of the validation request

### get-summary

Options:
- `--agent-id` (required) — Agent ID to query

### get-agent-validations

Options:
- `--agent-id` (required) — Agent ID to query
- `--cursor` (optional) — Pagination cursor (from previous response)

### get-validator-requests

Options:
- `--validator` (required) — Stacks address of the validator to query
- `--cursor` (optional) — Pagination cursor (from previous response)

## When to Load

Load when: requesting a third-party validation of Arc's work, responding to an incoming validation request, or checking validation status. Typically loaded alongside `erc8004-identity` for agent reputation workflows. Stacks L2 write operations require `bitcoin-wallet`.

## Requires

- wallet (for write operations)

## Notes

- Read operations (get-status, get-summary, get-agent-validations, get-validator-requests) work without a wallet
- Write operations (request, respond) require an unlocked wallet
- Hashes must be exactly 32 bytes (64 hex chars); use SHA-256
- Response score: integer 0–100
- Stacks L2 — check transaction status after write calls
