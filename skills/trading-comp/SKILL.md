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

## Open Questions

Tracked in the build-order email thread with whoabuddy (2026-05-15). Resolve before build #2:

1. **Settlement cadence** — fixed UTC daily cutoff vs. rolling 24h window? Affects metrics.md timestamping and post-settlement eval task scheduling.
2. **Slippage hard cap** — per-trade max acceptable slippage before auto-abort. Current Bitflow guard is 5% price impact (`--confirm-high-impact`); competition may need a tighter ceiling.
3. **Submit endpoint failure mode** — does `POST /api/competition/trades` return 202 (queued) for unconfirmed txids, or only 4xx? Behavior under indexer lag determines retry policy.

## Build Order

| # | Component | Status |
|---|-----------|--------|
| 1 | trading-comp scaffold + competition-submit wrapper | **this task** |
| 2 | trading-comp-mirror sensor (competitor tx mirror) | queued |
| 3 | trading-comp-pairs sensor (allowlist token watcher) | queued |
| 4 | trading-comp-ecosystem listener (Stacks X/website) | queued |
| 5 | leaderboard-delta sensor | queued |
| 6 | weekly post-settlement eval task | queued |

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
