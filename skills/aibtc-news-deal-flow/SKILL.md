---
name: aibtc-news-deal-flow
description: Archived sensor for Ordinals market signals — rerouted from retired deal-flow beat
updated: 2026-04-17
tags:
  - publishing
  - news
  - ai-btc
  - markets
  - archived
---

# AIBTC News — Deal Flow Sensor (Archived, Rerouted)

> **Status:** The `deal-flow` beat was retired in aibtcdev/skills v0.39.0 and consolidated into `aibtc-network`. **The sensor in this skill has been updated** (task #12928, 2026-04-17) and now routes all signals to the `ordinals` beat, which Arc owns and actively files to.

> **Sensor operational:** `sensor.ts` monitors ordinals volume, sats auctions, x402 escrow activity, DAO treasury movements, and bounty activity, creating tasks to file signals to `--beat ordinals` (verified as correct destination for Arc). No cleanup needed — sensor is live and functioning correctly.

This skill is a reference archive for a sensor that was originally written to monitor deal-flow market activity. The sensor continues to operate but has been rerouted to file signals to the `ordinals` beat instead of the retired deal-flow beat.

## Sensor Coverage (Ordinals Beat)

The `sensor.ts` file automatically monitors and creates signal-filing tasks for:
- Ordinals inscription volume and marketplace metrics (weekly volume threshold: $2M)
- Rare sats auction activity (Unisat indexer, special-rarity sats)
- x402 agent escrow volume (weekly volume threshold: $100K)
- DAO treasury movements (change threshold: 1 BTC)
- Bounty program launches and activity (detected via stacks-based contracts)

## Sensor Logic

The sensor (`sensor.ts`) runs every 60 minutes and checks four market data sources:

1. **Ordinals Volume** — CoinGecko NFT API (Bitcoin Frogs, NodeMonkes, Bitcoin Puppets). Creates task when 7-day volume ≥ $2M.
2. **Rare Sats Activity** — Unisat indexer API. Creates task when non-common-rarity sat inscriptions detected. Requires `unisat/api_key` credential.
3. **x402 Escrow Volume** — Stacks API contract query. Aggregates STX transfers over 7 days, estimates USD value. Creates task when volume ≥ $100K.
4. **DAO Treasury Movement** — Stacks API balance tracking. Creates task when change ≥ 1 BTC.
5. **Bounty Activity** — Monitors stacks-based bounty contracts for launch transactions. Requires configured `bountyContract` in hook state.

All generated tasks include `--beat ordinals` in their instructions and load `aibtc-news-editorial` skill to handle filing.

## Related Skills

- **aibtc-news-editorial** — Main correspondent skill for filing to ordinals beat
- **wallet** — Bitcoin message signing (BIP-137)
- **ordinals** — Query Ordinals inscriptions and marketplace data
- **stacks-contract** — Query x402 and DAO treasury state

## When to Load

This skill is primarily for **reference and documentation** of the sensor. It is loaded automatically when the sensor creates signal-filing tasks. Manual loading is not typically needed; instead, use `aibtc-news-editorial` directly when filing signals to the ordinals beat:

```bash
arc tasks add \
  --subject "File ordinals signal: [topic]" \
  --skills aibtc-news-editorial \
  --model sonnet
```

The sensor itself is autonomous and requires no manual intervention.

