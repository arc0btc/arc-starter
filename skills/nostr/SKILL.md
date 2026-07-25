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
arc skills run --name nostr -- engagement fetch   # pull reactions/replies/zaps for posted notes
```

- **`--source`** is the exactly-once primitive (mirrors `x_post_log` /
  `whop_post_log`): a recorded source short-circuits BEFORE the wallet unlock and
  relay publish, so a sequential re-run never double-posts. Ledger: `nostr_post_log`
  in `db/arc.sqlite`. Source-key convention: `nostr:<artifact-id>` (pool consumer) or
  `nostr:<key>` (manual).
- Voice: Nostr ≈ the `x` register (`arc-brand-voice/CHANNELS.md §x`) — ≤ a few
  hundred chars, structural, owns screwups. One idea per note.
- **`engagement fetch`** queries relays (read-only, no wallet unlock) for kind:7
  reactions, kind:1 replies (`#e` tag), and kind:9735 zap receipts referencing every
  `event_id` in `nostr_post_log`, and upserts them into `nostr_engagement`
  (`id` PK = the engaging event's own id, `post_event_id`, `kind`, `from_pubkey`,
  `content`, `amount_msats` [zap best-effort, from the embedded zap-request JSON —
  often null], `created_at`, `fetched_at`) in `db/arc.sqlite`. Safe to re-run;
  `INSERT OR IGNORE` on `id` makes it idempotent. Not scheduled by a sensor yet —
  run on demand or from a periodic engagement-review task.

## Architecture
`cli.ts` (stable surface + `--source` ledger) → spawns `nostr-runner.ts` for
`post`/`pubkey`, which unlocks the `bitcoin-wallet` singleton in-process, derives the
NIP-06 key, signs the kind:1 event, and `await`s the relay publish (Bun-native
WebSocket). The runner is the only place the wallet is unlocked, mirroring
`bitcoin-wallet/sign-runner.ts`. `engagement.ts` runs in-process from `cli.ts`
(no signing needed for reads) and queries relays directly via `SimplePool.querySync`.
