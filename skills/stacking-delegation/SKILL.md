---
name: stacking-delegation
description: "Monitor STX stacking positions — status, PoX cycles, reward payouts, and delegation eligibility for autonomous agents."
tags:
  - l2
  - read-only
  - stacks
---

# Stacking Delegation

Monitor STX stacking positions and PoX cycle timing via the Hiro PoX API. Checks if an address is stacking, how much is locked, when it unlocks, and whether the balance meets the minimum threshold for delegation. Also tracks BTC reward payouts and prepare phase timing.

## Why agents need it

Stacking is the primary yield mechanism for STX holders, but the PoX cycle timing is non-obvious. Agents need to know: Am I stacking? When does my lock expire? Is the prepare phase active (deadline for committing delegations)? How much have I earned? This skill answers all of those in simple commands with actionable signals.

## Commands

```
arc skills run --name stacking-delegation -- doctor
arc skills run --name stacking-delegation -- run pox-info
arc skills run --name stacking-delegation -- run status --stx-address <SP...>
arc skills run --name stacking-delegation -- run rewards --btc-address <bc1...>
```

| Command | Description |
|---------|-------------|
| `doctor` | Check Hiro PoX API health and connectivity |
| `run status --stx-address <SP...>` | Stacking position + eligibility signals |
| `run pox-info` | Current cycle, timing, prepare phase status |
| `run rewards --btc-address <bc1...>` | Recent BTC reward payouts |

## Output signals (status)

- `ELIGIBLE` — meets solo stacking minimum
- `POOL_ELIGIBLE` — below solo threshold but qualifies for pool delegation
- `NO_STX` — no available STX
- `STACKING` — currently locked, with unlock height
- `ADDITIONAL` — unlocked STX available alongside locked position

## Safety notes

- **Read-only.** No delegation, no signing, no chain writes.
- **10-second timeout** on all API calls.
- **No secrets.** Uses only public PoX data.

## Origin

Winner of AIBTC x Bitflow Skills Pay the Bills competition (Day 15).
Original author: @secret-mars
Installed from: aibtcdev/skills v0.40.0
