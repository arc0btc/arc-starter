---
name: maximumsats-wot
description: Nostr Web of Trust trust scoring via MaximumSats API for pre-transaction risk assessment
tags:
  - nostr
  - trust
  - risk
---

# maximumsats-wot

Pre-transaction counterparty risk assessment using MaximumSats Web of Trust scores (52K+ pubkeys, 2.4M+ trust edges). Check a Nostr pubkey's trust rank before committing to on-chain interactions.

## API

**Endpoint:** `POST https://maximumsats.com/api/wot-report`
**Payment:** 100 sats via L402 (Lightning). Free tier may exist for basic lookups.
**Request:** `{"pubkey": "<hex_pubkey>"}`
**Response:** `{pubkey, rank, position, in_top_100, report, graph: {nodes, edges}}`

No API key needed. Payment is per-request via L402 protocol.

## Identity Bridge

Stacks address -> Nostr pubkey via NIP-06 derivation path (`m/44'/1237'/0'/0/0`). The aibtc-mcp-server has the reference implementation. The aibtcdev/skills repo uses BTC-shared path (`m/84'/0'/0'/0/0`) instead. Both are supported — use `--derivation` flag.

Note: `check-agent` requires the agent's mnemonic to be available (wallet unlocked). For external counterparties, use `check` with their known npub/hex pubkey directly.

## Thresholds

Configurable via `db/hook-state/maximumsats-config.json`:
- `minRank`: minimum acceptable rank (lower = more trusted). Default: 10000
- `requireTop100`: if true, reject pubkeys not in top 100. Default: false

A pubkey that fails threshold checks returns `{trusted: false, reason: "..."}`.

## Cache

Results cached in `db/hook-state/maximumsats-cache.json`, keyed by hex pubkey, 1h TTL. Cached scores avoid redundant L402 payments.

## CLI

```
arc skills run --name maximumsats-wot -- check --npub <npub>
arc skills run --name maximumsats-wot -- check --pubkey <hex>
arc skills run --name maximumsats-wot -- check-agent --stacks-address <addr>
arc skills run --name maximumsats-wot -- config --min-rank 5000 --require-top100
arc skills run --name maximumsats-wot -- cache-status
```

## When to Load

Load when: evaluating counterparty trust before on-chain transactions (payments, DeFi, contract interactions). Also useful for Nostr social graph analysis.

## Checklist

- [x] `skills/maximumsats-wot/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `cli.ts` present and runs without error
- [ ] L402 payment integration tested with live API
- [ ] NIP-06 derivation tested with wallet unlock
