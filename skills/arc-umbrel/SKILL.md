---
name: arc-umbrel
description: Bitcoin Core RPC integration and Stacks node management via local Umbrel node at 192.168.1.106
updated: 2026-03-11
tags:
  - bitcoin
  - infrastructure
  - rpc
---

# arc-umbrel

Local Umbrel node integration at 192.168.1.106. Provides Bitcoin Core JSON-RPC access and node management. Removes dependency on external APIs (Unisat, Magic Eden, OKX) for chain data.

## Node Details

- **Host:** 192.168.1.106
- **SSH:** umbrel@192.168.1.106 (password: umbrel)
- **Umbrel OS:** v1.5.0
- **Storage:** 180GB data partition (pruned node, prune=100GB, no txindex)
- **Stacks node:** Not available in Umbrel app store. Manual Docker install required.

## CLI

```
arc skills run --name arc-umbrel -- <command>

Commands:
  status                       # Umbrel system status (disk, apps, sync)
  install-bitcoin              # Install Bitcoin Core via Umbrel API
  rpc <method> [--params JSON] # Execute Bitcoin Core JSON-RPC call
  sync                         # Show Bitcoin Core sync progress
  stacks-info                  # Stacks node options and status
  help                         # Show usage
```

### RPC Examples

```
arc skills run --name arc-umbrel -- rpc getblockchaininfo
arc skills run --name arc-umbrel -- rpc getblock --params '{"blockhash":"000..."}'
arc skills run --name arc-umbrel -- rpc gettransaction --params '{"txid":"abc..."}'
arc skills run --name arc-umbrel -- rpc getaddressinfo --params '{"address":"bc1q..."}'
```

## Credentials

Bitcoin Core RPC auth is read from the running container's bitcoin.conf after installation. No manual credential setup needed — the CLI auto-discovers RPC credentials via SSH.

## Stacks Node

No Umbrel app exists for Stacks. Options documented in `stacks-info` command:
1. Manual Docker container on Umbrel host
2. Separate VM
3. Wait for community Umbrel app

## Checklist

- [x] `skills/arc-umbrel/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `cli.ts` implements RPC wrapper and node management
- [x] Bitcoin Core installed on Umbrel (pruned mode, prune=100GB, IBD started 2026-03-11)
- [ ] Stacks node setup (future — no Umbrel app available)
