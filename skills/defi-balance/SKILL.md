---
name: defi-balance
description: Monitor STX and sBTC wallet balances via Hiro API and alert on significant changes
tags:
  - defi
  - monitoring
  - sensor
  - stacks
---

# defi-balance

Sensor-only skill. Monitors STX and sBTC balances for a configured Stacks address every 5 minutes. No LLM needed — pure TypeScript using Bun's built-in fetch.

## How It Works

1. Reads the target STX address from `DEFI_BALANCE_ADDRESS` environment variable (falls back to `STX_ADDRESS`)
2. Fetches STX balance from Hiro API: `GET /extended/v1/address/{address}/stx`
3. Fetches token balances from Hiro API: `GET /extended/v1/address/{address}/balances` — extracts sBTC
4. Compares current balances with previous run stored in `db/hook-state/defi-balance-prev.json`
5. Creates a task if:
   - **First run**: captures baseline (no previous state)
   - **Balance drop below threshold**: STX < 1 STX or sBTC < 0.00001 BTC
   - **Significant change detected**: >5% shift in either balance since last run

## Task Sources

| Trigger | Source key |
|---------|------------|
| First-run baseline | `sensor:defi-balance:baseline` |
| STX change alert | `sensor:defi-balance:stx-change:{YYYY-MM-DD}` |
| sBTC change alert | `sensor:defi-balance:sbtc-change:{YYYY-MM-DD}` |
| STX low balance | `sensor:defi-balance:stx-low:{YYYY-MM-DD}` |
| sBTC low balance | `sensor:defi-balance:sbtc-low:{YYYY-MM-DD}` |

Date-stamped source keys mean at most one alert per token per day, preventing alert storms.

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `DEFI_BALANCE_ADDRESS` | STX address to monitor | `STX_ADDRESS` env var |
| `STX_ADDRESS` | Fallback STX address | none |

## API Endpoints

- STX balance: `https://api.hiro.so/extended/v1/address/{address}/stx`
- All token balances: `https://api.hiro.so/extended/v1/address/{address}/balances`
- sBTC token contract: `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token` (mainnet)

## Thresholds

- **STX low**: balance < 1 STX (1,000,000 microSTX)
- **sBTC low**: balance < 0.00001 BTC (1,000 satoshis)
- **Significant change**: >5% shift (up or down) from previous run

## Checklist

- [x] `skills/defi-balance/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name (`defi-balance`)
- [x] `sensor.ts` exports async default function returning `Promise<string>`
- [x] Zero external dependencies (Bun built-in fetch only)
- [x] Graceful error handling — API failures do not crash the sensor
- [x] Dedup gate prevents duplicate alert tasks per day
