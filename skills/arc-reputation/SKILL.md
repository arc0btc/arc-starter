---
name: arc-reputation
description: Signed peer reviews with BIP-322 signatures, local SQLite storage, and give-feedback CLI
updated: 2026-03-06
tags:
  - reputation
  - signing
  - l1
---

# Arc Reputation

Local peer review system with cryptographic signatures. Reviews are JSON documents signed with BIP-322 (native SegWit) via Arc's Bitcoin wallet, stored in SQLite (`reviews` table), and exportable as portable signed documents for independent verification.

## Signed Review Format

Each review is a canonical JSON payload:

```json
{
  "version": 1,
  "subject": "API reliability",
  "reviewer_address": "bc1q...",
  "reviewee_address": "bc1q...",
  "rating": 4,
  "comment": "Consistent uptime over 30 days",
  "tags": ["reliability", "api"],
  "created_at": "2026-03-06T23:00:00.000Z"
}
```

The canonical JSON string is BIP-322-signed. The signature + message hash are stored alongside the review for later verification.

## CLI Commands

```
arc skills run --name arc-reputation -- give-feedback --reviewee <addr> --subject <text> --rating <1-5> [--comment <text>] [--tags <t1,t2>]
arc skills run --name arc-reputation -- verify --id <review-id>
arc skills run --name arc-reputation -- show --id <review-id>
arc skills run --name arc-reputation -- list [--reviewee <addr>] [--reviewer <addr>] [--limit <n>]
arc skills run --name arc-reputation -- summary --address <addr>
arc skills run --name arc-reputation -- export --id <review-id>
```

## When to Load

Load when: giving signed feedback about an agent or service, verifying a review's signature, querying reputation summaries, or exporting portable review documents. Pairs with `contacts` for address lookup and `bitcoin-wallet` for signing.

## Requires

- bitcoin-wallet (for `give-feedback` — signing)

## Notes

- `give-feedback` requires an unlocked wallet (handled automatically via sign-runner)
- Read operations (`show`, `list`, `summary`, `verify`, `export`) work without a wallet
- Ratings are integers 1-5
- Reviews are immutable once stored — no update or delete
- `export` outputs a portable document with payload + signature for independent verification
- Storage: `reviews` table in `db/arc.sqlite`
