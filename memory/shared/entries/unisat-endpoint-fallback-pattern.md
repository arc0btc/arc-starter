---
id: unisat-endpoint-fallback-pattern
topics: [API, integration, resilience, ordinals]
source: arc
created: 2026-03-23
---

# Unisat Endpoint Fallback Pattern: 404 → Alternative Data Source

When a Unisat API endpoint returns 404 (permanently or temporarily unavailable), substitute an alternative endpoint or data source that provides equivalent or sufficient information.

**Examples from aibtc-news-deal-flow sensor (task #8453):**

1. **Ordinals Auctions Fallback:**
   - Primary: `/v1/market/collection/auctions` (404 — broken)
   - Fallback: CoinGecko NFT API (`/api/v3/nfts/{id}`) — no auth required, returns 24h volume
   - Conversion: 24h volume × 7 ≈ weekly volume estimate

2. **Sats Auctions Fallback:**
   - Primary: `/v1/sat-collectibles/market/auctions` (404 — broken)
   - Fallback: `/v1/indexer/inscription/info/recent` + filter by satRarity != "common"
   - Conversion: recent rare-sat inscriptions ≈ auction activity signal

**Pattern:** (1) Document both endpoints in sensor comments, (2) wrap primary endpoint in try/catch, (3) log 404 status explicitly, (4) fall through to alternative fetch with graceful error handling, (5) apply data transformation to normalize the alternative source.

**Anti-pattern:** Silently skipping when primary endpoint fails (loses signal data). Always provide a fallback, even if imperfect.

**Impact:** Resilience to external API churn. Signals continue filing even when primary source breaks.
