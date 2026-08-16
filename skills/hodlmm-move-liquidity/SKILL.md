---
name: hodlmm-move-liquidity
description: "HODLMM Move-Liquidity & Auto-Rebalancer — withdraw from drifted bins, re-deposit around the current active bin. Includes autonomous monitoring loop."
tags:
  - defi
  - hodlmm
  - liquidity
metadata:
  author: "cliqueengagements"
  author-agent: "Micro Basilisk (Agent 77) — SP219TWC8G12CSX5AB093127NC82KYQWEH8ADD1AY | bc1qzh2z92dlvccxq5w756qppzz8fymhgrt2dv8cf5"
  user-invocable: "false"
  arguments: "doctor | scan | run | auto | install-packs"
  entry: "hodlmm-move-liquidity/hodlmm-move-liquidity.ts"
  requires: "wallet, signing"
---

# HODLMM Move-Liquidity & Auto-Rebalancer

## What it does

When the active bin drifts away from your LP position, move your liquidity to the active bin. One atomic transaction via the Bitflow DLMM liquidity router's `move-relative-liquidity-multi` function: withdraw from old bins and deposit into the active bin in a single on-chain call — no intermediate state, no partial execution risk. The active bin is where all trades flow and fees accrue; capital anywhere else earns zero.

The `auto` command runs as an autonomous rebalancer — monitors all pools on a configurable interval and moves liquidity automatically when drift exceeds a threshold. Most HODLMM read skills detect drift and stop there; this skill closes the loop and keeps capital productive without human intervention.

## Safety notes

- **Writes to chain**, one atomic transaction per rebalance (`move-relative-liquidity-multi`) — withdraw + deposit either both succeed or neither does. No tokens leave the LP's wallet outside the router contract.
- **Mainnet only.** All contract addresses are mainnet Stacks.
- **`--confirm` required for `run`.** Without it, outputs a dry-run preview only. `auto` executes directly (operator opts in by starting it).
- **postConditionMode: Allow** — HODLMM mints/burns DLP tokens in the same tx, which can't be expressed as sender-side post-conditions. Contract-level slippage protection compensates instead: each move requires ≥95% DLP shares back (`min-dlp`) and caps liquidity fees at 5% (`max-x/y-liquidity-fee`); violating either bound reverts on-chain. Plus `--confirm` gate, cooldown, in-range check, gas check.
- **4-hour cooldown** between moves on the same pool, enforced in code and persisted to disk.

## Commands

### doctor

Check API access, wallet readiness, and dependency availability.

```bash
bun run hodlmm-move-liquidity/hodlmm-move-liquidity.ts doctor --wallet SP219TWC8G12CSX5AB093127NC82KYQWEH8ADD1AY
```

### scan

Read-only scan of all HODLMM pools. Shows each position's in-range status, bin range, active bin, and drift distance.

```bash
bun run hodlmm-move-liquidity/hodlmm-move-liquidity.ts scan --wallet SP219TWC8G12CSX5AB093127NC82KYQWEH8ADD1AY
```

### run

Assess a specific pool and generate a move plan. Dry-run by default.

```bash
# Preview (no on-chain action)
bun run hodlmm-move-liquidity/hodlmm-move-liquidity.ts run --wallet <addr> --pool dlmm_1

# Execute
bun run hodlmm-move-liquidity/hodlmm-move-liquidity.ts run --wallet <addr> --pool dlmm_1 --confirm --password <pass>

# Custom spread (default: ±5 bins around active)
bun run hodlmm-move-liquidity/hodlmm-move-liquidity.ts run --wallet <addr> --pool dlmm_1 --spread 3 --confirm --password <pass>

# Force recenter an in-range position
bun run hodlmm-move-liquidity/hodlmm-move-liquidity.ts run --wallet <addr> --pool dlmm_1 --force --confirm --password <pass>
```

Options:
- `--spread <n>` — bin spread ±N around active bin (default: 5, max: 10)
- `--force` — force rebalance even if position is in range (recenter around active bin)

### auto

Autonomous rebalancer. Monitors all pools on a loop, auto-moves liquidity when drift exceeds threshold.

```bash
# Start auto-rebalancer (checks every 15 minutes, moves when drift ≥ 3 bins)
bun run hodlmm-move-liquidity/hodlmm-move-liquidity.ts auto --wallet <addr> --password <pass>

# Custom interval and threshold
bun run hodlmm-move-liquidity/hodlmm-move-liquidity.ts auto --wallet <addr> --password <pass> --interval 30 --drift-threshold 5

# Single cycle (no loop)
bun run hodlmm-move-liquidity/hodlmm-move-liquidity.ts auto --wallet <addr> --password <pass> --once
```

Options:
- `--interval <minutes>` — check interval (default: 15, minimum: 5)
- `--drift-threshold <bins>` — minimum drift to trigger move (default: 3)
- `--spread <n>` — bin spread ±N around active bin (default: 5, max: 10)
- `--max-moves <n>` — max moves per cycle, 0 = unlimited (default: 0)
- `--once` — run one cycle then exit

### install-packs

No external packs required.

```bash
bun run hodlmm-move-liquidity/hodlmm-move-liquidity.ts install-packs
```

## Output contract

All commands emit JSON to stdout.

All responses follow `{ status: success|error|blocked, action, data, error }`.

- **scan** `data`: `{ wallet, pools_scanned, positions_found, out_of_range, positions: [{ pool_id, pair, active_bin, user_bins[], user_bin_min/max, in_range, drift, total_x, total_y, total_dlp }] }`
- **run (in range)** `data`: `{ decision: "IN_RANGE", reason, health }` — no move needed, use `--force` to recenter
- **run (dry-run)** `data`: `{ decision: "MOVE_NEEDED", mode: "dry-run", reason, health, plan: { pool_id, pair, active_bin, atomic, spread, old_range, new_range, moves: [{ from, to_offset, to_bin, dlp }], stx_balance, estimated_gas_stx } }`
- **run (executed)** `data`: `{ decision: "EXECUTED", health, plan, transaction: { txid, explorer } }`
- **auto (cycle report)** `data`: `{ mode: "loop", interval_minutes, drift_threshold, spread, cycle, moves, skipped, errors, next_check }`
- **error**: `{ status: "error", data: null, error: "descriptive message" }`
- **blocked**: `{ status: "blocked", data: { cooldown_minutes }, error: "Cooldown active — N minutes remaining" }`

## Known constraints

- Requires `@stacks/transactions` and `@stacks/wallet-sdk` to be installed in the runtime environment.
- Single atomic transaction via `move-relative-liquidity-multi` — either all bins move or none do. No partial execution risk.
- Liquidity is distributed across ±spread bins around the active bin (default ±5). The DLMM bin invariant requires bins below active to hold only Y token and bins above active to hold only X token — source bins below active map to destination offsets [-spread, 0] and source bins above active map to [0, +spread].

## Origin

Winner of AIBTC x Bitflow Skills Pay the Bills competition.
Original author: @cliqueengagements
Competition PR: https://github.com/BitflowFinance/bff-skills/pull/231
