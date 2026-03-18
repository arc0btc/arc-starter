# MaximumSats AGENT — API Integration Details

## API Base URL

```
https://wot.klabo.world
```

All endpoints are GET requests with query parameters. The `wot.klabo.world` domain may return HTTP 530 (Cloudflare origin error) if intermittently down. The MCP route at `https://maximumsats.com/mcp` is the more stable alternative but requires MCP client setup.

## Endpoints

### GET /score
```
GET https://wot.klabo.world/score?pubkey=<hex64>
```
Response:
```json
{
  "normalized_score": 87.3,
  "rank": 4821,
  "percentile": 0.906
}
```
`normalized_score` is 0-100. `percentile` is fraction of nodes scored lower (higher = more trusted).

### GET /sybil
```
GET https://wot.klabo.world/sybil?pubkey=<hex64>
```
Response:
```json
{
  "classification": "normal"
}
```
Classification values: `"normal"`, `"suspicious"`, `"likely_sybil"`

Detection signals: follower quality, mutual trust ratio, follow diversity, temporal patterns, community integration.

### GET /trust-path
```
GET https://wot.klabo.world/trust-path?source=<hex64>&target=<hex64>
```
Response:
```json
{
  "connected": true,
  "paths": [["pubkeyA", "pubkeyB", "pubkeyTarget"]],
  "combined_trust": 0.74
}
```
`combined_trust` is 0-1. `paths` is array of pubkey arrays showing hop-by-hop routes.

### GET /predict
```
GET https://wot.klabo.world/predict?source=<hex64>&target=<hex64>
```
Response:
```json
{
  "probability": 0.83,
  "signals": {
    "common_neighbors": 12,
    "adamic_adar": 3.7,
    "preferential_attachment": 450,
    "jaccard": 0.15,
    "wot_proximity": 0.61
  }
}
```
`probability` is 0-1 likelihood of a future trust edge forming.

### GET /network-health
```
GET https://wot.klabo.world/network-health
```
Response (always free, no pubkey needed):
```json
{
  "graph_nodes": 51551,
  "graph_edges": 622402,
  "gini_coefficient": 0.049,
  "power_law_alpha": 2.0
}
```

## L402 Payment Flow

When free tier (50 req/day per IP) is exhausted, any endpoint returns HTTP 402:

```http
HTTP/1.1 402 Payment Required
WWW-Authenticate: L402 token="...", invoice="lnbc210n..."
```

To pay:
1. Parse `invoice` from `WWW-Authenticate` header
2. Pay via NWC (`MAXIMUMSATS_NWC_URL` credential)
3. Retry with `?payment_hash=<hash>` query parameter appended

## Pubkey Validation

- Must be exactly 64 lowercase hex characters
- npub (bech32) format is NOT accepted — must convert first
- Example: `82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2`

## Error Handling

- HTTP 530 = Cloudflare origin error (service temporarily down) — retry after 60s or use MCP route
- HTTP 402 = Free tier exhausted — L402 payment required
- HTTP 404 = Pubkey not in WoT graph (only 52K+ pubkeys indexed, not all Nostr users)
- HTTP 4xx/5xx = Log and fail gracefully, do not retry

## Sensor Consideration

Periodic reputation polling is NOT recommended:
- Free tier is only 50 req/day per IP — sensors would exhaust this quickly
- Reputation changes slowly (graph refreshes periodically)
- Only query on-demand (before payment flows, agent contracts, fleet routing decisions)

## MCP Alternative

For tasks that can use MCP tooling:
```json
{
  "mcpServers": {
    "maximumsats": { "url": "https://maximumsats.com/mcp" }
  }
}
```
MCP tools: `wot_score`, `wot_top` (free), `wot_report` (100 sats).

## Contact

max@klabo.world — has offered API access for aibtcdev integrations (see aibtcdev/skills#24). Reach out for higher rate limits or partnership on agent trust infrastructure.
