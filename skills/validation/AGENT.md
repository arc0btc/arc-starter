---
name: validation-agent
skill: validation
description: ERC-8004 on-chain agent validation management — request and respond to validations, and query validation status, summaries, and paginated lists by agent or validator.
---

# Validation Agent

This agent manages ERC-8004 on-chain agent validation using the validation-registry contract. It handles requesting validations from validators, submitting validation responses, and all read-only queries for validation data. Read operations work without a wallet. Write operations require an unlocked wallet.

## Capabilities

- Request validation from a specific validator for an agent (request)
- Submit a validation response score as a validator (respond)
- Get the status of a validation request by its request hash (get-status)
- Get the aggregated validation summary (count + average score) for an agent (get-summary)
- Get a paginated list of validation request hashes for an agent (get-agent-validations)
- Get a paginated list of validation request hashes submitted to a validator (get-validator-requests)

## When to Delegate Here

Delegate to this agent when the workflow needs to:
- Submit a formal validation request to a trusted validator for an agent identity
- Respond to a pending validation request as a designated validator
- Check the current status and score of a specific validation request
- Retrieve an agent's overall validation score or count
- Page through all validations associated with an agent
- List all pending validation requests for a validator to process

## Key Constraints

- request and respond require an unlocked wallet
- respond: tx-sender must be the validator address specified in the original request
- --request-hash and --response-hash must be exactly 32 bytes (64 hex characters); use SHA-256
- --response must be an integer between 0 and 100 (inclusive); values outside this range are rejected
- respond can be called multiple times on the same request hash for progressive score updates
- Pagination is cursor-based; pass the cursor from one response into the next call to page through results
- Validation is a Stacks L2 operation — check transaction status with `stx get-transaction-status` after write calls

## Outputs

All commands return JSON with:
- `success` (boolean) — Operation succeeded or failed
- `network` (string) — Network (mainnet or testnet)
- For write operations: `txid` (string), `explorerUrl` (string)
- For read operations: Data relevant to the query (validation status, summaries, request hashes, etc.)

## Examples

Request validation from a validator:
```
arc skills run --name validation -- request --validator SP2... --agent-id 42 --request-uri ipfs://request-data --request-hash a3f2b1...64hex
```

Submit a validation response:
```
arc skills run --name validation -- respond --request-hash a3f2b1...64hex --response 85 --response-uri ipfs://response-data --response-hash b4e9c2...64hex --tag security
```

Get the status of a validation request:
```
arc skills run --name validation -- get-status --request-hash a3f2b1...64hex
```

Get the aggregated validation summary for an agent:
```
arc skills run --name validation -- get-summary --agent-id 42
```

List all validation request hashes for an agent:
```
arc skills run --name validation -- get-agent-validations --agent-id 42
```

List validation requests for an agent with pagination:
```
arc skills run --name validation -- get-agent-validations --agent-id 42 --cursor 14
```

List all validation requests submitted to a validator:
```
arc skills run --name validation -- get-validator-requests --validator SP2...
```

List validator requests with pagination:
```
arc skills run --name validation -- get-validator-requests --validator SP2... --cursor 14
```
