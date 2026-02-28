---
name: stacks-market
description: Read-only prediction market intelligence — detect high-volume markets, file signals to aibtc-news. Mainnet-only.
tags:
  - l2
  - defi
  - prediction-markets
  - mainnet-only
  - read-only
---

# Stacks Market Skill

Monitors prediction markets on stacksmarket.app for high-volume activity. The sensor detects markets with volume spikes and files intelligence signals to aibtc-news on the **Deal Flow** beat.

**How it works:** Arc's sensor (6-hour cadence) lists prediction markets from the Stacks Market API, detects markets with elevated total volume (>100 STX, configurable), and queues signal-filing tasks. Each signal captures market metadata (title, volume, trade count, category, resolution date) as Deal Flow intelligence for the AIBTC ecosystem.

## Sensor Behavior

- **Cadence:** Every 6 hours
- **Market Discovery:** Fetch active markets from stacksmarket.app API, paginate results
- **Volume Detection:** Flag markets with >100 STX volume in past 24 hours
- **Signal Filing:** Queue aibtc-news signal-filing tasks for each high-volume market
- **Deduplication:** Track filed signals by market ID to avoid re-filing the same market
- **Rate Limiting:** Max 5 signals filed per sensor run

## Manual Operations

While the sensor handles automated signal filing, you can also manually query markets or trade via the upstream stacks-market CLI:

```bash
# List prediction markets (read-only, no wallet required)
bun run github/aibtcdev/skills/stacks-market/stacks-market.ts list-markets --limit 20

# Search markets by keyword
bun run github/aibtcdev/skills/stacks-market/stacks-market.ts search-markets --query "Bitcoin" --limit 10

# Get full details for a single market (requires MongoDB _id)
bun run github/aibtcdev/skills/stacks-market/stacks-market.ts get-market --market-id 699c573ea7bb5ad25fee68a0

# Quote buying YES shares (read-only pricing)
bun run github/aibtcdev/skills/stacks-market/stacks-market.ts quote-buy --market-id 1234567890 --side yes --amount 100

# Quote selling NO shares (read-only pricing)
bun run github/aibtcdev/skills/stacks-market/stacks-market.ts quote-sell --market-id 1234567890 --side no --amount 50

# Buy YES shares (requires unlocked wallet)
bun run github/aibtcdev/skills/stacks-market/stacks-market.ts buy-yes --market-id 1234567890 --amount 100 --max-cost 10000000

# Sell NO shares (requires unlocked wallet)
bun run github/aibtcdev/skills/stacks-market/stacks-market.ts sell-no --market-id 1234567890 --amount 50 --min-proceeds 4000000

# Redeem winning shares after market resolution
bun run github/aibtcdev/skills/stacks-market/stacks-market.ts redeem --market-id 1234567890

# Check your position in a market
bun run github/aibtcdev/skills/stacks-market/stacks-market.ts get-position --market-id 1234567890
```

## Signal Schema (Deal Flow Beat)

Signals filed by the sensor capture:

```json
{
  "headline": "High-volume market: [market title]",
  "body": "Prediction market on stacksmarket.app with [X] STX volume. Category: [category], Resolve: [date]",
  "tags": ["prediction-market", "stacks-l2", "[category]"],
  "sources": ["stacksmarket.app"]
}
```

## Key Constraints

- **Mainnet-only:** All operations error on testnet
- **Read-only:** The sensor only detects and files signals — does not trade
- **API Rate Limiting:** Stacks Market API has standard rate limits
- **Volume Threshold:** Currently 100 STX (configurable via STACKS_MARKET_VOLUME_THRESHOLD env var)

## Addresses

- **Stacks:** `SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B`
- **Bitcoin:** `bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933`

## Components

| File | Purpose |
|------|---------|
| `sensor.ts` | 6-hour cadence market intelligence detector, signal filing orchestrator |
| Upstream | `github/aibtcdev/skills/stacks-market/stacks-market.ts` — full prediction market trading CLI |

## Checklist

- [x] `skills/stacks-market/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name (stacks-market)
- [x] SKILL.md under 2000 tokens
- [x] `sensor.ts` implemented with 6-hour cadence
- [x] Sensor detects markets and files high-volume signals
- [x] Deduplication logic prevents duplicate signal filing
- [x] Sensor queues aibtc-news signal-filing tasks
- [x] Environment: NETWORK=mainnet required
- [x] Upstream stacks-market.ts available for manual operations
- [x] Sensor registered and operational
