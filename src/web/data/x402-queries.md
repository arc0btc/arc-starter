# x402 / message-volume queries

aibtc.news and agentslovebitcoin both store data in **Cloudflare Durable Objects** (NewsDO, GlobalDO, AgentDO) — not D1. That means `wrangler d1 execute` won't work; the SQLite is internal to each DO and only reachable via worker code or RPC.

## Options to get the numbers

### A. Add a temporary admin endpoint
Cleanest. In `aibtcdev/agent-news` add a `GET /api/admin/x402-stats` route that calls `NewsDO.getStats()` (already exists). Same in ALB for `GlobalDO.getStats()`. Gate on `ADMIN_API_KEY`.

```ts
// agent-news: src/index.ts
if (path === "/api/admin/x402-stats" && env.ADMIN_API_KEY === request.headers.get("X-Admin-Key")) {
  const id = env.NEWS_DO.idFromName("singleton");
  const stub = env.NEWS_DO.get(id);
  return stub.fetch(new Request("https://internal/admin/x402-stats"));
}

// in NewsDO:
async fetch(req: Request) {
  if (new URL(req.url).pathname === "/admin/x402-stats") {
    const total = this.sql.exec("SELECT COUNT(*) AS n FROM payment_staging").one();
    const byDay = this.sql.exec(`
      SELECT date(staged_at) AS day, COUNT(*) AS n
      FROM payment_staging
      WHERE staged_at >= datetime('now', '-42 days')
      GROUP BY day ORDER BY day DESC
    `).toArray();
    return Response.json({ total: total.n, byDay });
  }
}
```

### B. Use Cloudflare Analytics Engine / Workers Analytics
If the workers already log payment events to AE, query via the GraphQL Analytics API. Pull events filtered by `dataset = "agent_news_x402"` (or whatever the binding uses).

```bash
curl -X POST https://api.cloudflare.com/client/v4/graphql \
  -H "Authorization: Bearer $CF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "{ viewer { accounts(filter: {accountTag: \"<acct>\"}) { workersAnalyticsEngineEvents(filter: {datetime_geq: \"2026-04-28T00:00:00Z\"}, limit: 10000) { sum { count } } } } }"}'
```

### C. wrangler tail + count (manual, for spot-checks only)
Won't give weekly history.

```bash
cd /home/dev/aibtcdev/agent-news
npm run wrangler -- tail --format=json | grep -c '"x402"'
```

## What we already know from public APIs

- `GET https://aibtc.news/api/report` → `signalsToday: 231`, `totalSignals: 28,951`, `activeCorrespondents: 67`.
- `GET https://aibtc.news/api/leaderboard` → ranked correspondents with signal counts (rolling 30-day window).
- `GET https://aibtc.com/api/agents` → directory; we use `verifiedAt` to bucket signups by week.
- `GET https://agentslovebitcoin.com/api/onboarding` works; `GET /api/me/profile` requires BIP-322 auth.

## ALB sign-up count

Same problem — `GlobalDO.getStats()` exists internally but no admin route surfaces it. Either add one (Option A above) or expose a public `GET /api/stats` that returns `{ total_agents }` with no auth.

## Recommendation

Open `aibtcdev/agent-news#PR` adding the admin stats route — 30 min of work, unblocks every weekly deck after this one. Same for ALB. Until then: paste the numbers from operator console / wrangler tail snapshots into `src/web/data/network-stats.json` under `x402_messages`.
