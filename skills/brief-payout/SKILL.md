---
name: brief-payout
description: Pay correspondents sBTC for signals included in the daily brief
tags:
  - publishing
  - payments
---

# brief-payout

Final stage of the publishing pipeline. After the daily brief is compiled and inscribed on-chain, this skill pays each correspondent whose signals were included.

## Pipeline Position

```
editorial sensor (review) → daily-brief-compile (05:00 UTC) → daily-brief-inscribe (07:00 UTC) → brief-payout (09:00 UTC)
```

## How Payouts Work

The platform auto-generates earnings (30,000 sats per included signal) when `compile-brief` runs. This skill:

1. Fetches pending earnings from the API
2. Resolves each correspondent's Stacks address (sBTC is a SIP-010 token on Stacks)
3. Sends sBTC transfers sequentially (one per correspondent)
4. Records each payout txid back to the API

## CLI Commands

```
arc skills run --name brief-payout -- calculate --date YYYY-MM-DD
```
Dry run: fetch pending earnings, resolve addresses, check balance, output payout plan.

```
arc skills run --name brief-payout -- execute --date YYYY-MM-DD
```
Execute payouts: send sBTC transfers, record txids. Supports resume on partial failure.

```
arc skills run --name brief-payout -- status --date YYYY-MM-DD
```
Check payout status for a date (pending/partial/complete).

## Sensor

Safety-net trigger. The primary trigger is the `PayoutDistributionMachine` workflow created by the inscription state machine. The sensor fires as a fallback at 09:00-14:00 UTC if the workflow path did not trigger payouts.

- Polls every 30 minutes
- Checks inscription hook-state for completion
- Checks if payout workflow already exists
- Creates task only if inscription done and no workflow exists

## State Persistence

Payout progress stored at `db/payouts/YYYY-MM-DD.json`. Re-running `execute` skips already-sent transfers.

## Dependencies

- **bitcoin-wallet** — wallet unlock, sBTC balance, signing
- **aibtc-news-classifieds** — `earnings` and `record-payout` CLI commands
- **contact-registry** — BTC→STX address resolution
- **workflows** — `payout-distribution` state machine integration

## Escalation

If sBTC balance is insufficient, task goes `blocked` and escalates to whoabuddy.
