---
name: wot
description: "Web of Trust operations for Nostr pubkeys — trust scoring, sybil detection, trust path analysis, neighbor discovery, follow recommendations, and network health. Free tier (wot.klabo.world, 50 req/day) with paid fallback (maximumsats.com, 100 sats via L402). Covers 52K+ pubkeys and 2.4M+ zap-weighted trust edges. Use --key-source to select nip06 (default), taproot, or stacks derivation path."
tags:
  - read-only
---

# Web of Trust (WoT) Skill

Pre-transaction counterparty risk assessment using Nostr Web of Trust scores. Accepts Nostr hex pubkeys or `npub1...` bech32 addresses only.

Consolidated replacement for `nostr-wot` (deprecated) — adds taproot/stacks key sources, trust-path and recommend endpoints, and unified paid fallback.

- **52K+ pubkeys** indexed with **2.4M+ trust edges**
- Trust edges weighted by zap receipts (economic signal, harder to fake)
- Free tier: `wot.klabo.world` (50 req/day per IP), no key required
- Paid fallback: `maximumsats.com/api/wot-report` (100 sats via L402) when free tier exhausted
- 1-hour local cache to avoid redundant API calls

This is a doc-only MCP-tool skill. Agents derive the Nostr pubkey via `nostr_get_pubkey` and then call external WoT APIs directly. There is no `wot.ts` CLI entrypoint.

## Key Derivation

Use `nostr_get_pubkey` to get the agent's Nostr pubkey before calling WoT API endpoints:

```
nostr_get_pubkey({})
```

Returns `{ pubkey: "2b4603d2...", npub: "npub1abc..." }`.

## Key Source

| Value | Path | Description |
|-------|------|-------------|
| `nip06` (default) | `m/44'/1237'/0'/0/0` | NIP-06 standard — compatible with Alby, Damus, Amethyst |
| `taproot` | `m/86'/coin_type'/0'/0/0` | Taproot x-only key — same keypair as bc1p address |
| `stacks` | `m/84'/coin_type'/0'/0/0` | BTC SegWit path — backward-compat with pre-NIP-06 agents |

## What WoT Accepts

| Format | Example | Works |
|--------|---------|-------|
| Nostr hex pubkey | `2b4603d2...` (64 hex chars) | Yes |
| Nostr npub bech32 | `npub1abc...` | Yes |
| Stacks address | `SP1ABC...` | **No** — hashed |
| BTC address (bc1q/bc1p) | `bc1q...` | **No** — hashed |

## Subcommands

### trust-score
```
GET https://wot.klabo.world/api/trust-score?pubkey=<hex>
```
Returns: `{ trusted, normalized_score, rank, percentile }`

### sybil-check
```
GET https://wot.klabo.world/api/sybil-check?pubkey=<hex>
```
Returns: `{ classification: "normal"|"suspicious"|"likely_sybil", is_sybil, is_suspicious }`

### neighbors
```
GET https://wot.klabo.world/api/neighbors?pubkey=<hex>
```
Returns: array of connected pubkeys with trust scores and edge weights.

### trust-path
```
GET https://wot.klabo.world/api/trust-path?from=<hex>&to=<hex>
```
Returns: ordered list of pubkeys forming the trust path, hop count, per-hop scores.

### recommend
```
GET https://wot.klabo.world/api/recommend?pubkey=<hex>
```
Returns: array of recommended pubkeys with trust scores.

### network-health
```
GET https://wot.klabo.world/api/network-health
```
Returns: `{ total_nodes, total_edges, gini_coefficient, power_law_alpha }`

## Trust Thresholds

| Rank | Meaning |
|------|---------|
| 1–100 | Elite (top 100 Nostr users by WoT) |
| 101–1000 | Well-connected, high economic activity |
| 1001–10000 | Active community member |
| >10000 | Low trust, new account, or no Nostr activity |

## API Details

| Base | Auth | Cost | Rate |
|------|------|------|------|
| `https://wot.klabo.world` | None | Free | 50 req/day/IP |
| `https://maximumsats.com/api/wot-report` | L402 | 100 sats | Unlimited |

Store L402 credentials:
```
arc creds set --service wot --key l402-token --value "<token>:<preimage>"
```
