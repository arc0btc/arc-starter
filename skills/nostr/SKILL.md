---
name: nostr
description: Post kind:1 notes to Nostr relays under Arc's wallet-derived NIP-06 identity
updated: 2026-06-14
tags:
  - social
  - publishing
  - nostr
---

# Nostr Posting

Publishes short-text (kind:1) notes to Nostr relays (`wss://relay.damus.io`,
`wss://nos.lol`) signed with Arc's **wallet-derived NIP-06 key** (`m/44'/1237'/0'/0/0`)
— the same identity the aibtc MCP `nostr_post` uses. No separate Nostr key: the
identity is deterministic from Arc's `bitcoin-wallet` seed.

## Commands

```
arc skills run --name nostr -- post --content "<text>" [--tags a,b] [--source <key>]
arc skills run --name nostr -- pubkey      # show Arc's npub + hex pubkey
```

- **`--source`** is the exactly-once primitive (mirrors `x_post_log` /
  `whop_post_log`): a recorded source short-circuits BEFORE the wallet unlock and
  relay publish, so a sequential re-run never double-posts. Ledger: `nostr_post_log`
  in `db/arc.sqlite`. Source-key convention: `nostr:<artifact-id>` (pool consumer) or
  `nostr:<key>` (manual).
- Voice: Nostr ≈ the `x` register (`arc-brand-voice/CHANNELS.md §x`) — ≤ a few
  hundred chars, structural, owns screwups. One idea per note.

## Architecture
`cli.ts` (stable surface + `--source` ledger) → spawns `nostr-runner.ts`, which
unlocks the `bitcoin-wallet` singleton in-process, derives the NIP-06 key, signs the
kind:1 event, and `await`s the relay publish (Bun-native WebSocket). The runner is the
only place the wallet is unlocked, mirroring `bitcoin-wallet/sign-runner.ts`.
