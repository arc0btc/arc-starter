---
name: stacks-stackspot
description: Autonomous Stacking participation — detect joinable pots, auto-join with Arc wallet, claim sBTC rewards. Mainnet-only lottery stacking.
tags:
  - l2
  - stacking
  - mainnet-only
  - autonomous
---

# Stackspot Skill

Manages autonomous participation in stackspot.app stacking lottery pots. Arc detects joinable pots, auto-joins with controlled amounts (20 STX trial threshold), and claims sBTC rewards when pots complete.

**How it works:** Participants pool STX into pots that are stacked via PoX for one cycle (~2 weeks). A VRF mechanism selects one winner who receives stacking yield in sBTC. All participants get their original STX back. Arc's participation is **mainnet-only** and **fully autonomous** via sensor.

## Sensor Behavior

- **Cadence:** Every 5-10 minutes
- **Pot Discovery:** List all known stackspot pot contracts, detect unlocked pots with available space
- **Auto-Join Logic:** Join pots with 20 STX (trial amount) if:
  - Pot is not locked (stacking hasn't started)
  - Pot has available participant slots
  - Arc hasn't already joined the same pot
  - Arc has sufficient STX balance (>20 STX + small buffer for tx fees)
- **Reward Monitoring:** Track completed pots and queue claim-rewards tasks
- **Rate Limiting:** Max 1 join per cycle per pot to avoid rapid spam

## Manual Operations

While the sensor handles auto-joining, you can also manually control participation via the upstream stackspot CLI:

```bash
# List all known pots (read-only, no wallet required)
bun run github/aibtcdev/skills/stacks-stackspot/stackspot.ts list-pots

# Get full on-chain state for a specific pot
bun run github/aibtcdev/skills/stacks-stackspot/stackspot.ts get-pot-state --contract-name STXLFG

# Join a pot (requires unlocked wallet)
bun run github/aibtcdev/skills/stacks-stackspot/stackspot.ts join-pot --contract-name STXLFG --amount 20000000

# Start a full pot (platform contract triggers PoX stacking)
bun run github/aibtcdev/skills/stacks-stackspot/stackspot.ts start-pot --contract-name STXLFG

# Claim sBTC rewards after pot cycle completes
bun run github/aibtcdev/skills/stacks-stackspot/stackspot.ts claim-rewards --contract-name STXLFG

# Cancel a pot before stacking (recover STX)
bun run github/aibtcdev/skills/stacks-stackspot/stackspot.ts cancel-pot --contract-name Genesis
```

## Key Constraints

- **Mainnet-only:** All operations error on testnet
- **STX Lock-up:** Joined STX is locked for one PoX cycle (~2 weeks)
- **Timing:** `start-pot` only works during PoX prepare phase — check with `bun run github/aibtcdev/skills/stacking/stacking.ts get-pox-info`
- **VRF Winners:** Only selected winner receives sBTC; all participants recover their STX
- **Known Pots:** Genesis (max 2, min 20 STX), BuildOnBitcoin (max 10, min 100 STX), STXLFG (max 100, min 21 STX)

## Known Pots

| Pot | Max Participants | Min STX | Notes |
|-----|------------------|---------|-------|
| Genesis | 2 | 20 | Entry-level lottery pot |
| BuildOnBitcoin | 10 | 100 | Medium-sized pool |
| STXLFG | 100 | 21 | Large lottery |

## Addresses

- **Stacks:** `SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B`
- **Bitcoin:** `bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933`

## Components

| File | Purpose |
|------|---------|
| `sensor.ts` | Auto-detect joinable pots, join, monitor rewards |
| Upstream | `github/aibtcdev/skills/stacks-stackspot/stackspot.ts` — full pot management |

## Checklist

- [x] `skills/stacks-stackspot/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name (stackspot)
- [x] SKILL.md under 2000 tokens
- [x] `sensor.ts` implemented with 7-minute cadence
- [x] Sensor detects all pots and skips locked ones
- [x] Sensor queues auto-join tasks (20 STX trial)
- [x] Environment: NETWORK=mainnet required
- [x] Upstream stackspot.ts available for manual operations
- [x] Sensor registered: `bash bin/arc sensors list | grep stackspot` ✅
