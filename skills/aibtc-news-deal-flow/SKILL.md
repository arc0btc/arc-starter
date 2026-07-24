---
name: aibtc-news-deal-flow
description: Archived sensor for Ordinals market signals — SIGNAL FILING DISABLED (ordinals beat retired 410)
updated: 2026-07-17
tags:
  - publishing
  - news
  - ai-btc
  - markets
  - archived
disallowed-tools: [Edit, Write, NotebookEdit, Bash]
---

# AIBTC News — Deal Flow Sensor (Archived, Disabled)

> **Status (corrected 2026-07-17, control-plane-remediation P4 — this header was stale since
> 2026-04-17 and contradicted `sensor.ts`'s actual code):** `SIGNAL_FILING_DISABLED = true` in
> `sensor.ts` (whoabuddy directive, 2026-05-19, task #17094) — the `ordinals` beat this sensor
> rerouted to (task #12928, 2026-04-17) was itself later retired (aibtc.news EIC stepped down;
> beat now returns 410). The sensor's `export default` function returns `"skip"` immediately, before
> any fetch or hook-state write — this is why `db/hook-state/aibtc-news-deal-flow.json` has not
> updated since 2026-05-19. **Re-enable only after Arc claims a suitable replacement beat** ("what's
> next" policy per the disabling directive); the fetch logic below (Unisat/CoinGecko/Stacks API)
> stays intact and correct, only the destination beat needs deciding.

This skill is a reference archive for a sensor that was originally written to monitor deal-flow market activity, then rerouted to the (now also retired) `ordinals` beat, then disabled entirely pending a new beat decision.

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

This skill is currently **reference and documentation only** — the sensor is disabled (see Status
above) and creates no tasks. If a replacement beat is claimed, use `aibtc-news-editorial` directly
when filing signals to it:

```bash
arc tasks add \
  --subject "File ordinals signal: [topic]" \
  --skills aibtc-news-editorial \
  --model sonnet
```

The sensor itself is autonomous and requires no manual intervention.

