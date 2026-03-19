---
name: nostr-wot
description: Nostr Web of Trust trust scoring, sybil detection, and neighbor discovery via MaximumSats API
updated: 2026-03-19
tags:
  - nostr
  - trust
  - wot
  - reputation
  - risk
---

# nostr-wot

Nostr Web of Trust scoring via MaximumSats API (52K+ pubkeys, 2.4M+ zap-weighted trust edges). Pre-transaction counterparty risk assessment for agent-to-agent interactions.

## API

Two API surfaces, tried in order:

| Base | Auth | Cost | Rate Limit |
|------|------|------|------------|
| `wot.klabo.world` | None | Free | 50 req/day/IP |
| `maximumsats.com/api/wot-report` | L402 | 100 sats | Unlimited |

Free tier is tried first. If 402/530, falls back to L402 paid endpoint (requires Lightning). Cache (1h TTL) avoids redundant API calls.

## CLI

```
arc skills run --name nostr-wot -- trust-score --pubkey <hex>
arc skills run --name nostr-wot -- trust-score --npub <npub>
arc skills run --name nostr-wot -- sybil-check --pubkey <hex>
arc skills run --name nostr-wot -- neighbors --pubkey <hex>
arc skills run --name nostr-wot -- network-health
arc skills run --name nostr-wot -- config [--min-rank N] [--require-top100]
arc skills run --name nostr-wot -- cache-status
```

### trust-score
Returns normalized score (0-100), rank, percentile. Checks against configurable thresholds (min rank, top-100 requirement).

### sybil-check
Classifies pubkey as `normal`, `suspicious`, or `likely_sybil` using follower quality, mutual trust ratio, and community integration signals.

### neighbors
Returns trust graph neighbors — connected pubkeys with combined trust scores. Uses trust-path data from WoT graph.

### network-health
Graph-wide stats: total nodes, edges, Gini coefficient, power law alpha. No pubkey required.

## Pubkey Format

Accepts both **hex** (64-char) and **npub** (bech32). Internally converts to hex for API calls.

## Thresholds

Configurable via `config` command. Stored in `db/hook-state/nostr-wot-config.json`:
- `minRank`: max acceptable rank (lower = more trusted). Default: 10000
- `requireTop100`: reject if not top 100. Default: false

## ERC-8004 Composability

Pairs with `erc8004-trust` for composite trust scoring:
- **On-chain:** ERC-8004 identity attestations on Stacks (verifiable, on-chain)
- **Off-chain:** Nostr WoT scores (social graph, zap-weighted)
- Combined: `nostr-wot trust-score` + `erc8004-trust verify` = full agent trust profile
- Use before payment flows, DeFi interactions, or agent-to-agent contract execution

## When to Load

Load when: evaluating counterparty trust before transactions, checking sybil risk, or building composite trust profiles with ERC-8004.

## Checklist

- [x] `skills/nostr-wot/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `cli.ts` present with trust-score, sybil-check, neighbors commands
- [ ] L402 payment integration tested with live API
- [ ] Free tier verified with live queries
