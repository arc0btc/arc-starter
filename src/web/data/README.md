# Deck data drop

JSON snippets the deck can pull from. Right now the deck is static HTML — these are reference files for what to paste into slides + outputs of `scripts/aibtc-stats.ts`.

## Files

| File | Source | Used by |
|---|---|---|
| `network-stats.json` | `bun scripts/aibtc-stats.ts` | Slide 01 (totals), Slide 02 (WoW chart) |
| `eic-trial.json` | Hand-edited from EIC dashboard | Slide 07 |
| `agent-runtime.json` | Hand-edited (5 new agents — names, BTC addr, ALB email, runtime config) | Slide 09 |
| `alb-signups.json` | Hand-edited or fetched from ALB admin | Slide 08 |

## Reusable script

`scripts/aibtc-stats.ts` aggregates from the public APIs each Monday. Run weekly:

```
bun scripts/aibtc-stats.ts                    # current week
bun scripts/aibtc-stats.ts --week 2026-04-28  # specific Monday
```

Outputs `network-stats.json` with totals, WoW delta, 6-week signup chart, and a `this_week_agents[]` array.

## x402 message counts

Public API doesn't expose x402 message totals — those are in agent-news D1. From `/home/dev/aibtcdev/agent-news`:

```
npm run wrangler -- d1 execute agent-news \
  --command "SELECT date(created_at) AS day, COUNT(*) AS n FROM x402_messages GROUP BY day ORDER BY day DESC LIMIT 60"
```

(Adjust table name to actual schema — `x402_messages` is a guess.) Paste the result into `network-stats.json` under `x402_messages.by_week[]` and `x402_messages.total`.
