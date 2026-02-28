# Stacks Market Skill — Subagent Guide

This skill monitors prediction markets on stacksmarket.app for high-volume activity. The autonomous sensor detects market intelligence and files signals to aibtc-news.

## Architecture

**Sensor (6-hour cadence):**
1. Fetch active markets from stacksmarket.app REST API
2. Analyze volume data (track 24-hour volume per market)
3. Detect high-volume markets (>100 STX threshold, configurable)
4. File intelligence signals to aibtc-news on Deal Flow beat
5. Track filed signals to prevent duplicates

**CLI (Manual Operations):**
- Delegates all trading commands to upstream `github/aibtcdev/skills/stacks-market/stacks-market.ts`
- Provides quote, buy/sell, redeem, and position-checking commands

## Sensor Implementation Details

### Market Discovery

```typescript
// Fetch from stacksmarket.app API
const url = "https://api.stacksmarket.app/api/polls";
const params = { limit: 50 }; // Paginate if needed

// Response contains array of market objects with:
// - _id (MongoDB ID for get-market calls)
// - title (market question)
// - description (market details)
// - totalVolume (total volume in micro-STX, integer)
// - totalTrades (number of trades)
// - isResolved (boolean)
// - endDate (ISO timestamp)
// - category (e.g., "Crypto", "Sports")
```

### Volume Detection Logic

```typescript
const VOLUME_THRESHOLD = 100; // STX (configurable via STACKS_MARKET_VOLUME_THRESHOLD)

for (const market of markets) {
  if (market.volume_24h > VOLUME_THRESHOLD && !market.resolved) {
    // File signal task
  }
}
```

### Signal Filing

Create task with skill `["stacks-market", "aibtc-news"]`:

```typescript
insertTask({
  subject: `File Deal Flow signal: [market title] — ${market.volume_24h} STX volume`,
  description: `Arc detected high-volume prediction market on stacksmarket.app...

  Market: ${market.title}
  Volume (24h): ${market.volume_24h} STX
  Liquidity: ${market.liquidity} STX
  Category: ${market.category}
  Resolves: ${market.resolves_at}
  MongoDB ID: ${market._id}

  Command to file:
  arc skills run --name aibtc-news -- file-signal \\
    --beat "Ordinals Business" \\
    --headline "High-volume prediction market: ${market.title}" \\
    --body "Stacks L2 prediction market on stacksmarket.app with ${market.volume_24h} STX 24h volume. Category: ${market.category}. Resolves: ${market.resolves_at}" \\
    --sources "stacksmarket.app" \\
    --tags "prediction-market,stacks-l2,${market.category.toLowerCase()}"
  `,
  skills: JSON.stringify(["stacks-market", "aibtc-news"]),
  priority: 6,
  status: "pending",
  source: `sensor:stacks-market:signal:${market._id}`,
});
```

### Deduplication

Track filed signals in a simple source-based approach:

```typescript
const filedSource = `sensor:stacks-market:signal:${market._id}`;
const alreadyFiled = pendingTaskExistsForSource(filedSource);

if (!alreadyFiled) {
  // File new signal
}
```

### Rate Limiting

Limit signals filed per run to avoid overwhelming aibtc-news queue:

```typescript
const MAX_SIGNALS_PER_RUN = 5;
let signalCount = 0;

for (const market of highVolumeMarkets) {
  if (signalCount >= MAX_SIGNALS_PER_RUN) break;
  // File signal
  signalCount++;
}
```

## API Reference (Upstream)

The upstream `github/aibtcdev/skills/stacks-market/stacks-market.ts` provides these commands:

### Read-Only Commands (No Wallet Required)

```bash
# List markets (returns array of market objects)
list-markets [--limit N] [--status active|ended|resolved] [--category CATEGORY] [--featured]

# Search markets by keyword
search-markets --query KEYWORD [--limit N]

# Get single market details
get-market --market-id MONGODB_ID

# Quote buy price
quote-buy --market-id ID --side yes|no --amount SHARES

# Quote sell price
quote-sell --market-id ID --side yes|no --amount SHARES

# Check position (no address = uses active wallet)
get-position --market-id ID [--address STACKS_ADDRESS]
```

### Trading Commands (Requires Unlocked Wallet)

```bash
# Buy shares with slippage protection
buy-yes --market-id ID --amount SHARES --max-cost USTX
buy-no --market-id ID --amount SHARES --max-cost USTX

# Sell shares with minimum proceeds guard
sell-yes --market-id ID --amount SHARES --min-proceeds USTX
sell-no --market-id ID --amount SHARES --min-proceeds USTX

# Redeem winning shares after resolution
redeem --market-id ID
```

## Environment Variables

```bash
NETWORK=mainnet         # Required (errors if testnet)
STACKS_MARKET_VOLUME_THRESHOLD=100  # Volume threshold in STX (default 100)
```

## Testing the Sensor

```bash
# Run sensor manually
bun run skills/stacks-market/sensor.ts

# Monitor sensor runs
arc tasks --status pending | grep "stacks-market"

# Check filed signals
arc tasks --status pending | grep "Deal Flow signal"
```

## Error Handling

**API Failures:**
- Log error, return early (don't fail entire sensor run)
- Network timeouts: retry once with 2-second delay
- 404 errors: market not found, skip

**Task Creation Failures:**
- Log to stderr, continue with next market
- If 3+ failures in a single run, fail the sensor run

## Integration with aibtc-news

The sensor queues tasks with `["stacks-market", "aibtc-news"]` skills. Those tasks:
1. Are claimed by dispatch
2. Load both skill contexts
3. Call aibtc-news `file-signal` command with Deal Flow beat and market metadata

The signal structure follows the economist-style format: observation (market exists) → evidence (volume, liquidity, category) → implication (ecosystem participation signal).

## Cost Considerations

- API calls: ~0 (read-only, no gas)
- Task queue usage: 1 task per high-volume market detected
- Signal filing: 100 sats per aibtc-news signal (billed when filed)
