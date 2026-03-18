---
name: maximumsats
description: Nostr Web of Trust (WoT) scoring via MaximumSats API — trust scores, sybil detection, and trust paths for Nostr pubkeys.
updated: 2026-03-18
tags:
  - nostr
  - trust
  - wot
  - reputation
  - read-only
---

# MaximumSats — Nostr Web of Trust

Wraps the MaximumSats WoT API (`wot.klabo.world`) to query trust scores, detect sybil accounts, and trace trust paths between Nostr pubkeys. Covers 52K+ pubkeys and 2.4M+ trust edges weighted by zap receipts.

Complements `erc8004-trust` (on-chain Stacks identity) with off-chain Nostr WoT signals. Useful before payment flows or agent-to-agent trade execution.

## CLI Commands

```
arc skills run --name maximumsats -- wot-score --pubkey <hex>
arc skills run --name maximumsats -- sybil-check --pubkey <hex>
arc skills run --name maximumsats -- trust-path --source <hex> --target <hex>
arc skills run --name maximumsats -- predict --source <hex> --target <hex>
arc skills run --name maximumsats -- network-health
```

## Subcommands

### wot-score
Returns a normalized WoT trust score (0-100), global rank, and percentile for a Nostr pubkey.

Options:
- `--pubkey` (required) — Nostr pubkey in **hex** format (not npub)

Output: `normalized_score` (0-100), `rank`, `percentile`

### sybil-check
Classifies a pubkey as `likely_sybil`, `suspicious`, or `normal` using follower quality, mutual trust ratio, follow diversity, temporal patterns, and community integration.

Options:
- `--pubkey` (required) — Nostr pubkey in hex format

Output: `classification`

### trust-path
Finds the hop-by-hop trust path between two pubkeys and returns combined trust score.

Options:
- `--source` (required) — Source pubkey (hex)
- `--target` (required) — Target pubkey (hex)

Output: `connected`, `paths`, `combined_trust`

### predict
Predicts link probability between two pubkeys using graph signals (common neighbors, Adamic-Adar, Jaccard, WoT proximity).

Options:
- `--source` (required) — Source pubkey (hex)
- `--target` (required) — Target pubkey (hex)

Output: `probability`, `signals`

### network-health
Returns graph-wide stats — total nodes, edges, Gini coefficient, power law alpha. No pubkey required. Always free.

## Authentication

- **Free tier:** 50 requests/day per IP — no API key required
- **Paid tier (L402):** After free tier, API returns HTTP 402 with a BOLT11 Lightning invoice. ~21 sats per call.
- Set `MAXIMUMSATS_NWC_URL` credential to enable automatic L402 payment.

## Pubkey Format

All pubkeys **must be hex-encoded** (64 hex chars), not npub bech32.

## Integration

- Pair with `erc8004-trust` for composite on-chain + off-chain agent trust scoring
- Sybil check before accepting payment from new counterparties
- Trust path useful for discovering indirect trust relationships in fleet routing

## When to Load

Load when verifying Nostr identity trust, checking for sybil risk, or tracing trust paths. Read-only — no wallet required for free tier queries. Contact: max@klabo.world (aibtcdev/skills#24).
