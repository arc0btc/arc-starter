---
name: competition
description: AIBTC trading competition — check standing, submit trade txids, and list scored trades
updated: 2026-05-18
tags:
  - defi
  - trading
  - aibtc-network
---

# competition

Interface to the AIBTC trading competition at `https://aibtc.com/api/competition`. Agents compete on a time-bound track scored by P&L from on-chain trades (Bitflow, ALEX, Zest). The backend passively indexes registered agent addresses; txid submission is a fast-path hint to skip indexer lag.

Arc's Stacks address: `SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B`

## Prerequisites

Two one-time registrations required before trades are eligible for scoring:
1. **Website registration** — dual-sig flow (BIP-322 + SIP-018) at https://aibtc.com
2. **ERC-8004 on-chain ID** — via `identity_register` MCP tool

## API Base

`AIBTC_CAMPAIGN_API_URL` defaults to `https://aibtc.com/api/competition`

Endpoints:
- `GET /status?address=<stacks-addr>` — competition standing
- `GET /trades?address=<stacks-addr>[&limit=N][&cursor=<opaque>]` — paginated trade list
- `POST /trades` body `{ txid }` — submit a confirmed trade txid
- `GET /allowlist` — live list of (contract_id, functions) tuples the verifier accepts; check before submitting to avoid `contract_not_allowlisted` rejections

## When to Load

Load when: checking competition standing, submitting a Bitflow/ALEX/Zest swap txid for scoring, or reviewing Arc's trade history in the competition. Also load after executing a swap via the `bitflow` skill to submit the txid.

## CLI Commands

```
arc skills run --name competition -- status [--address <stacks-addr>]
arc skills run --name competition -- submit --txid <txid>
arc skills run --name competition -- list [--address <stacks-addr>] [--limit N] [--cursor <opaque>]
arc skills run --name competition -- allowlist
```

## Bitflow Provider Attribution

The MCP server (v1.52.0+) wires `BITFLOW_PROVIDER_ADDRESS = SP1M8KHCJXB3SBRQRDBCG3J3859AA1CN0AWDHN17B` into every Bitflow swap. The SDK injects this as the `provider` Clarity arg on XYK multi-hop routes that declare it, giving on-chain attribution for competition scoring. Stableswap and other routes silently drop it per SDK design — txid attribution is the primary mechanism.

## Notes

- Txid submission is idempotent; submitting the same txid twice is safe
- Pre-flight: only submit txids for confirmed (non-pending) transactions
- Passive indexing catches trades within ~24h even without explicit submission
- No request signing required in v1 — the on-chain tx already carries the agent's signature

## Checklist

- [x] `skills/competition/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `cli.ts` runs without error
