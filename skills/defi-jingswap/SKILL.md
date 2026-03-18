---
name: defi-jingswap
description: Jingswap STX/sBTC blind auction — cycle monitoring, deposit/cancel, settlement
updated: 2026-03-17
tags:
  - defi
  - trading
  - mainnet-only
---

# defi-jingswap

STX/sBTC blind auction on Stacks via the Jingswap contract. Depositors place STX or sBTC into a shared pool; after a minimum deposit window, the auction settles at a clearing price derived from Pyth oracle feeds.

**Contract:** `SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.sbtc-stx-jingswap`
**API:** `https://faktory-dao-backend.vercel.app`

## Phase Flow

| Phase | ID | Duration | Actions Allowed |
|-------|----|----------|-----------------|
| Deposit | 0 | ≥150 blocks (~5 min) | deposit-stx, deposit-sbtc, cancel-stx, cancel-sbtc |
| Buffer | 1 | 30 blocks (~1 min) | none (cooldown) |
| Settle | 2 | until settled or cancelled | settle-with-refresh, cancel-cycle (after 530 blocks) |

Units: STX amounts in micro-STX (÷1e6), sBTC in satoshis (÷1e8). Stacks blocks ~2 seconds (Nakamoto).

## Sensor: defi-jingswap

**Cadence:** 30 minutes. Polls `/api/auction/cycle-state`. Files a task when deposit phase is open with meaningful TVL on both sides and Arc has no active deposit. Rate-limited to one signal per 4 hours.

## CLI Commands

```
arc skills run --name defi-jingswap -- <subcommand> [flags]
```

| Command | Description |
|---------|-------------|
| `cycle-state` | Current cycle phase, blocks elapsed, totals |
| `prices` | Oracle (Pyth BTC+STX/USD) and DEX prices |
| `depositors [--cycle N]` | STX and sBTC depositors for a cycle |
| `my-deposit [--cycle N]` | Arc's deposit amounts for a cycle |
| `history` | All past auction cycles with settlement data |
| `deposit-stx --amount N` | Deposit N STX (deposit phase only) |
| `deposit-sbtc --amount N` | Deposit N sats (deposit phase only) |
| `cancel-stx` | Cancel STX deposit (deposit phase only) |
| `cancel-sbtc` | Cancel sBTC deposit (deposit phase only) |

## Budget & Safety

- **Max per cycle:** 50 STX or 10,000 sats (env: `JINGSWAP_MAX_STX`, `JINGSWAP_MAX_SATS`)
- All write ops validate phase=0 (deposit) before executing
- Write ops require wallet credentials (`bitcoin-wallet` service)
- Mainnet only

## When to Load

Load when: monitoring Jingswap auctions, depositing/cancelling, analyzing cycle history.
Do NOT load for: other DeFi protocols (Bitflow, Zest, ALEX).
