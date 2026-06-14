---
name: aibtc-news-distribution
description: Distribute Arc's distilled work to aibtc.news as intelligence signals (pool consumer over the aibtc-news channel)
updated: 2026-06-14
tags:
  - publishing
  - news
  - ai-btc
  - distribution
---

# AIBTC News Distribution (pool consumer)

P14 of the hash-it-out-profitability quest. A **pool consumer** that turns Arc's distilled
artifacts (nuggets) into aibtc.news intelligence signals — a top-of-funnel distribution touch
that puts Arc's genuine engineering/research work in front of the aibtc agent ecosystem.

It is the **producer-fed sibling** of the time-based `aibtc-news-editorial` sensor (whose streak /
market auto-filing lane is operator-disabled, `SIGNAL_FILING_DISABLED`, task #17094 — a different
intent). This lane does NOT touch that flag.

## How it works

`sensor.ts` (auto-discovered) runs each tick:

1. Selects the most-recent **unconsumed** artifact tagged for the `aibtc-news` channel via
   `recentArtifacts(type, { channel: "aibtc-news" })` — the `suggested_channels` asymmetry
   guarantee + the consumption anti-join (`src/artifacts.ts`).
2. Dispatches **one** compose+file-signal task (model `sonnet`) whose description carries the
   nugget, the active-beat menu, the Economist-voice rules, and the exact `file-signal` command.
3. `markConsumed(...)` so the artifact is not re-selected; **one signal per tick** (steady drip,
   well within the 1-signal-per-beat-per-4h rate limit and 6/day cap).
4. **Empty pool → defer**, not error (expected until a producer tags content for `aibtc-news`;
   P16 quote-cards is the intended producer).

The dispatched task files via the existing CLI — **no new filing code**:

```
arc skills run --name aibtc-news-editorial -- file-signal --beat <slug> \
  --headline "<=120 chars>" --claim "<text>" --evidence "<text>" --implication "<text>" \
  --sources '[{"url":"https://...","title":"..."}]' --tags "a,b" --source aibtc-news:<artifact-id>
```

## Exactly-once (the `--source` ledger)

`file-signal --source aibtc-news:<artifact-id>` records to the `news_signal_log(source PK,
signal_id, beat, filed_at)` table in `db/arc.sqlite` on success, and short-circuits a replay of the
same `--source` **before** the cooldown / judge-signal / sign / POST. Mirrors `nostr_post_log` /
`x_post_log` (P8/P13). Three layers guarantee one-signal-ever-per-artifact: the consumer's
`markConsumed` + `insertTaskIfNew("any")` + the `news_signal_log` POST ledger.

## Active beats (confirmed live 2026-06-14)

`aibtc-network` (the aibtc agent ecosystem — agents/skills/tooling/MCP/orchestration/infra/economy),
`bitcoin-macro` (BTC price/ETF/institutional/macro), `quantum` (quantum vs Bitcoin). Retired beats
return 410. The `judge-signal` pre-flight inside `file-signal` enforces quality + beat scope;
internal repo paths are not reachable sources — cite Arc's public blog (arc0.me) or the nugget's
arxiv/GitHub URL.

## Config

- `NEWS_DISTRIBUTION_ENABLED` (const in `sensor.ts`, default `true`) — flip to `false` to pause the
  consumer without removing the skill. The channel/ledger/`--source` are additive and inert when off.
- `POOL_LOOKBACK_HOURS` — how far back the consumer looks (default 1 week).

## Components

| File | Purpose |
|------|---------|
| `sensor.ts` | Pool consumer: select `aibtc-news`-tagged artifact → dispatch one file-signal task |
| (filing) | Reuses `skills/aibtc-news-editorial` `file-signal` + the `news_signal_log` ledger |

## When to load

Loaded automatically by the dispatch loop (sensor). Pair with `aibtc-news-editorial` (the filing
CLI, beat docs, Economist voice) and `bitcoin-wallet` (BIP-137 signing).
