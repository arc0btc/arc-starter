---
name: dao-zero-authority
description: DAO proposal detection, governance participation, and voting on Stacks
updated: 2026-03-05
tags:
  - governance
  - dao
  - stacks
  - voting
---

# zero-authority

Autonomous DAO governance participation on Stacks. Detects proposals, evaluates them, and votes. Ties together identity, reputation, and on-chain governance.

## Architecture

**Tracked DAOs** live in `skills/dao-zero-authority/daos.json`. Each entry specifies a Stacks contract address and the Clarity function names for reading proposals and casting votes. The sensor polls tracked DAOs for active proposals and queues voting tasks.

**Proposal detection** uses the Hiro API read-only contract call endpoint (`/v2/contracts/call-read/`) to query proposal state without spending STX. Voting requires wallet unlock and a sponsored or direct contract call.

## Sensor

**Removed** (2026-03-12). No on-chain references exist yet. Revisit once Zero Authority has deployed contracts with on-chain activity.

## CLI Commands

```bash
# DAO tracking
arc skills run --name zero-authority -- list-daos
arc skills run --name zero-authority -- add-dao --contract <address.name> --label <name>
arc skills run --name zero-authority -- remove-dao --contract <address.name>

# Proposal queries
arc skills run --name zero-authority -- proposals --contract <address.name>
arc skills run --name zero-authority -- proposal --contract <address.name> --id <proposal-id>

# Voting
arc skills run --name zero-authority -- vote --contract <address.name> --id <proposal-id> --direction for|against

# Governance overview
arc skills run --name zero-authority -- status
```

## Integration

- **wallet** — Required for signing vote transactions
- **reputation** — Voting history feeds reputation score
- **quorumclaw** — Bitcoin-layer multisig governance (complementary)
- **aibtc-news** — Governance votes are reportable signals for DAO Watch beat

## Stacks DAO Contract Pattern

Standard AIBTC DAO contracts expose:
- `get-proposal (uint)` → proposal details (title, status, votes-for, votes-against, end-block)
- `get-proposal-count` → total proposals
- `vote (uint bool)` → cast vote (proposal-id, for/against)
- `get-voting-power (principal)` → agent's voting weight

Contract function names are configurable per DAO in `daos.json` to support non-standard implementations.

## When to Load

Load when: a DAO proposal needs review or voting, or when adding/removing tracked DAOs. Sensor creates P3 tasks (subject: "DAO proposal in {dao}: {title}") that include this skill. Also load when running `zero-authority status` to check governance position.

## Checklist

- [x] `skills/dao-zero-authority/SKILL.md` exists with valid frontmatter
- [ ] `skills/dao-zero-authority/sensor.ts` — removed, revisit when on-chain contracts exist
- [x] `skills/dao-zero-authority/cli.ts` runs without error
- [x] `skills/dao-zero-authority/daos.json` provides configurable DAO tracking
