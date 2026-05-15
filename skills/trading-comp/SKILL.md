---
name: trading-comp
description: AIBTC Trading Competition strategy — competition-submit wrapper, daily metrics, hooks for competitor/pair/ecosystem sensors
updated: 2026-05-15
tags:
  - defi
  - trading
  - competition
  - aibtc-network
  - mainnet-only
---

# trading-comp

Arc's strategy layer for the AIBTC Trading Competition on aibtc.com/leaderboard. This skill is the **competition-aware** wrapper around the lower-level primitives:

- `bitflow` — executes the swap (wraps `BITFLOW_PROVIDER_ADDRESS` attribution)
- `competition` — submits a confirmed txid to the scorer (`POST /api/competition/trades`)

`trading-comp` composes those two into a single `submit` primitive, tracks daily metrics, and is the load-target for upcoming competitor/pair/ecosystem sensors.

**Distinction from `competition`:** `competition` is a thin API client (status/submit/list). `trading-comp` is Arc's strategic layer — daily metrics, settlement-aware logic, and the cohesion point for the competition build order.

## When to Load

Load when: submitting a Bitflow swap for competition scoring with structured result tracking; reading or updating `metrics.md`; running competitor-mirror, pair-watch, or ecosystem-listener sensors (build #2+).

Do NOT load for: ad-hoc one-off txid submissions (use `competition` directly), Arc's own LP management (`bitflow`), or DCA / market intel (`defi-bitflow`).

## CLI Commands

```
arc skills run --name trading-comp -- submit --txid <txid> [--source <label>]
arc skills run --name trading-comp -- metrics [--show]
```

### `submit`

The foundational competition-submit primitive. Wraps the `competition` skill's `POST /trades` endpoint with:

- Txid normalization (`0x` prefix + 64 hex chars).
- Structured JSON result: `{ ok, txid, source, response, submitted_at }`.
- Idempotency-safe: re-submitting the same txid is a no-op on the backend.
- Exit 1 on validation or network error; exit 0 on success.

`--source` is a free-form label (e.g. `mirror`, `pair-watch`, `manual`) used for audit trails.

### `metrics`

Reads `skills/trading-comp/metrics.md` (the daily snapshot file). With `--show`, prints the current contents. The snapshot fields are documented at the top of `metrics.md` itself.

## Settlement

Sourced from `aibtcdev/landing-page` — `lib/competition/constants.ts`, `app/leaderboard/page.tsx`, issue #815.

**Campaign window**: Fixed UTC start. `COMP_START_TIMESTAMP = 1778700600` = **2026-05-13T19:30:00Z**. Duration: **1 week** (~2026-05-20T19:30:00Z). No rolling window — single campaign, single close.

**Final settlement**: At campaign close, Tenero USD prices freeze into a `final_prices` table/KV snapshot. Post-close P&L is deterministic (same input → same output). **Not yet implemented** (tracked in landing-page #815 §6 "Campaign-end price freeze" open work).

**Live P&L (until close)**: Client-side only. `computeStats` in `LeaderboardClient.tsx` calls Tenero `/v1/stacks/tokens/{contract}` per token on every page load. No server-side P&L endpoint yet (landing-page #811).

**Ranking rule**: Primary = Unrealized P&L (USD), tiebreak = Volume USD. Trade count does NOT determine rank. Server default sort is currently trade-count (placeholder) — viewers must click the P&L chip. Fix lands with #811.

## Leaderboard API Shape

**Trading leaderboard** (`/leaderboard` page, not a standalone API):
- Server-side query: `LEADERBOARD_AGGREGATE_SQL` aggregates `swaps` per (sender, token_in, token_out), INNER JOINed on `agents` (requires ERC-8004 + Genesis).
- SSR payload shape (per sender): `{ stxAddress, btcAddress, displayName, bnsName, erc8004AgentId, tradeCount, latestTradeAt, tokensSpent: [{tokenId, sumAmount}], tokensReceived: [{tokenId, sumAmount}] }`
- P&L computed client-side; no `/api/competition/leaderboard` endpoint exists — the page is the only consumer today.

**Per-agent trade list** (`GET /api/competition/trades?address=<stx>`):
- Returns `{ trades: [...], next_cursor }` (cursor-paginated, default 50, max 200).
- Trade fields: `{ txid, sender, contract_id, function_name, token_in, amount_in, token_out, amount_out, burn_block_time, tx_status, source, scored_value, scored_at }`.
- `source` is `'agent'` (fast-path submit) or `'cron'` (scheduler catch-up).
- Rate limit: 300 reads/min per IP.

**Submit endpoint** (`POST /api/competition/trades`):
- Body: `{ txid: string }` (64-char hex, `0x` prefix accepted).
- 200 = first-time verified (returns SwapRow); 202 = Hiro hasn't propagated terminal status yet (retry ~30s); 409 = already verified (idempotent no-op, returns existing row); 422 = eligibility rejection; 502 = transient Hiro error (retry).
- Rate limit: 20 mutations/min per IP.

**Leaderboard-delta sensor design note**: No `/api/competition/leaderboard` endpoint exists. To track Arc's rank, the sensor must: (1) fetch `GET /api/competition/trades?address=<arc_stx>` for Arc's own trade history, (2) separately fetch competitors' trade histories, (3) call Tenero for prices, and (4) compute P&L locally. Alternatively, scrape the leaderboard page server-render.

## Open Questions

Tracked in the build-order email thread with whoabuddy (2026-05-15). Resolve before build #2:

1. **Slippage hard cap** — per-trade max acceptable slippage before auto-abort. Current Bitflow guard is 5% price impact (`--confirm-high-impact`); competition may need a tighter ceiling.
2. **COMP_END_TIMESTAMP** — constant not yet in `lib/competition/constants.ts`. Confirm exact end timestamp before scheduling post-settlement eval task.

## Build Order

| # | Component | Status |
|---|-----------|--------|
| 1 | trading-comp scaffold + competition-submit wrapper | **this task** |
| 2 | trading-comp-mirror sensor (competitor tx mirror) | queued |
| 3 | trading-comp-pairs sensor (allowlist token watcher) | queued |
| 4 | trading-comp-ecosystem listener (Stacks X/website) | queued |
| 5 | leaderboard-delta sensor | queued |
| 6 | post-settlement eval task (campaign close ~2026-05-20T19:30Z) | queued |

## Refs

- CityCoins2 PR https://github.com/boomcrypto/citycoins2/pull/63 — tx-storage pattern for build #2
- Bitflow API https://docs.bitflow.finance/bitflow-documentation/developers/public-api-documentation
- Starter X handles (build #4 ecosystem listener): stacks, stacksorg, zestprotocol, bitcoin_yield, muneeb, bitflow, bffarmy_, dylan_, diegomey

## Checklist

- [x] `skills/trading-comp/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `cli.ts` runs without error
- [x] `metrics.md` placeholder present with snapshot schema
- [ ] AGENT.md covers prerequisites, safety checks, error handling
