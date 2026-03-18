---
name: maximumsats
description: Nostr Web of Trust scoring via MaximumSats API — lookup trust rank, score pubkeys, and verify NIP-05 identities before Lightning payments or agent contracts
updated: 2026-03-18
tags:
  - nostr
  - trust
  - wot
  - lightning
  - identity
---

# MaximumSats — Nostr Web of Trust

Provides Nostr Web of Trust (WoT) scoring for counterparty trust decisions. Uses MaximumSats' PageRank-based trust graph (51K+ pubkeys, 621K+ trust edges, zap-weighted) to score Nostr pubkeys before Lightning payments, trade execution, or agent contracts.

## How It Works

MaximumSats runs PageRank over the Nostr social/zap graph. Higher rank = more trusted by the network. The basic score lookup (rank + position) is **free**. Full AI-generated trust report costs 100 sats via L402 Lightning payment.

**API endpoint:** `POST https://maximumsats.com/api/wot-report`
**Pricing:** Free basic lookup | 100 sats for full report (L402)
**Auth:** L402 (Lightning invoice in WWW-Authenticate header on 402 response)

## ERC-8004 vs MaximumSats

These are complementary, not duplicates:

| Dimension | ERC-8004 | MaximumSats |
|-----------|----------|-------------|
| Network | Stacks L2 (on-chain) | Nostr social graph |
| Identity | Numeric agent ID / Stacks address | Nostr pubkey (hex/npub) |
| Trust model | Explicit feedback submissions | Derived PageRank from zaps/follows |
| Cost | STX gas (write) | Free lookup, 100 sats for report |
| Use case | Agent registry reputation | Counterparty pre-screening |

**Composite trust check:** Use MaximumSats (Nostr WoT) + ERC-8004 (on-chain feedback) together for strong counterparty validation. Neither alone is sufficient.

## CLI Commands

```
# Free: basic rank and position lookup
arc skills run --name maximumsats -- lookup --pubkey <hex64>

# Free: normalized 0-100 score
arc skills run --name maximumsats -- score --pubkey <hex64>

# Paid (100 sats, L402): full AI-generated trust report
arc skills run --name maximumsats -- report --pubkey <hex64>

# Paid (20 sats, L402): NIP-05 identity verification
arc skills run --name maximumsats -- verify-nip05 --address <user@domain>
```

## Subcommands

### lookup

Free. Returns rank, position, in_top_100, and graph metadata.

Options:
- `--pubkey` (required) — Nostr public key as 64-character hex string

Output fields:
- `rank` — PageRank score (higher = more trusted)
- `position` — Position in global ranking (1 = most trusted)
- `in_top_100` — Boolean
- `graph` — `{ nodes, edges }` counts for the trust graph

### score

Free. Returns a normalized 0-100 trust score derived from rank.

Options:
- `--pubkey` (required) — Nostr public key as 64-character hex string

Output fields:
- `score` — 0-100 normalized score (clamped)
- `rank`, `position`, `in_top_100`, `graph`

### report

Paid (100 sats, L402). Returns full AI-generated trust analysis text.

Options:
- `--pubkey` (required) — Nostr public key as 64-character hex string

Output fields:
- `report` — Full text trust analysis
- `rank`, `position`, `in_top_100`, `graph`

### verify-nip05

Paid (20 sats, L402). Verifies a NIP-05 identifier resolves to a valid Nostr pubkey.

Options:
- `--address` (required) — NIP-05 address in `user@domain` format

## Pubkey Format

MaximumSats accepts **hex format only** (64 lowercase hex characters). To convert from npub (bech32), use a Nostr library or `bech32` CLI tool before calling this skill.

Example hex: `82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2`

## When to Load

Load when:
- Screening a counterparty before a Lightning payment or trade
- Validating agent identity in an x402 or LNURL flow
- Running pre-contract trust checks on an unknown Nostr pubkey
- Combining with `erc8004-trust` for composite trust scoring

Do NOT load for tasks that don't involve Nostr identity or counterparty screening.

## Notes

- Basic lookup is free — no L402/payment setup needed
- L402-gated endpoints return HTTP 402 with a BOLT11 invoice in `WWW-Authenticate`
- The trust graph refreshes periodically; scores reflect the last crawl
- No API key or account required — fully sovereign, pay-per-call
- Contact: max@klabo.world (has offered API access for aibtcdev integrations — see aibtcdev/skills#24)
