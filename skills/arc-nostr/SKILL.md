---
name: arc-nostr
description: Publish notes and manage Arc's identity on Nostr — Bitcoin-native, censorship-resistant social layer
updated: 2026-03-17
tags:
  - social
  - publishing
  - nostr
  - identity
---

# arc-nostr

Publish short-text notes (kind:1) and manage Arc's Nostr profile (kind:0) on the default relays (damus.io, nos.lol). Keys are stored as a hex private key in Arc's credential store — no external wallet unlock required.

## Why Nostr

- **Bitcoin-native audience** — Nostr's core community overlaps directly with D2 (AIBTC) targets
- **No API costs** — No rate limits, no per-post charges (unlike X)
- **Censorship-resistant** — Aligns with D5 (honest public) — content survives deplatforming
- **Verifiable identity** — Cryptographic keypair; future NIP-05 linkage to arc0.btc possible
- **Complements X** — X for mainstream/AIBTC community; Nostr for Bitcoin-native reach

## Credentials Required

```
arc creds set --service nostr --key private_key --value <64-char hex>
```

Generate a fresh keypair with:
```
arc skills run --name arc-nostr -- generate-key
```

Or import an existing key (e.g., derived from wallet mnemonic via NIP-06 path m/44'/1237'/0'/0/0):
```
arc skills run --name arc-nostr -- import-key --hex <64-char hex>
```

## Default Relays

- `wss://relay.damus.io`
- `wss://nos.lol`

## CLI Commands

| Command | Purpose |
|---------|---------|
| `generate-key` | Generate a new Nostr keypair, print npub, store privkey in creds |
| `import-key --hex HEX` | Import an existing hex private key into creds |
| `get-pubkey` | Print Arc's Nostr public key (hex + npub) |
| `post --content TEXT [--tags TAG1,TAG2]` | Publish a kind:1 note |
| `feed [--limit N] [--pubkey NPUB_OR_HEX]` | Read recent notes (default: own feed, last 20) |
| `search --tags TAG1,TAG2 [--limit N]` | Search notes by hashtags |
| `set-profile [--name TEXT] [--about TEXT] [--website URL] [--nip05 ID]` | Update Nostr profile (kind:0) |
| `get-profile [--pubkey NPUB_OR_HEX]` | Fetch a Nostr profile (defaults to Arc's) |

## Composability

- Cross-post X content to Nostr: read X timeline → post matching note
- Tag posts with `aibtc`, `bitcoin`, `stacks` to reach relevant communities
- NIP-05 verification (`arc0btc@arc0.btc`) is a future identity milestone (D2/D5)
- Sensor could detect new X posts and auto-syndicate to Nostr

## When to Load

Load when: posting to Nostr, reading Nostr feed, managing Arc's Nostr profile, or building cross-posting workflows. Do NOT load for X-only publishing tasks.
