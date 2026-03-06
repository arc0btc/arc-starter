---
name: bitcoin-wallet
description: Wallet management and cryptographic signing for Stacks and Bitcoin — unlock, lock, info, status, BTC/Stacks message signing, and BTC signature verification.
updated: 2026-03-05
tags:
  - infrastructure
  - sensitive
  - signing
---

# Wallet Skill

Wraps the aibtcdev/skills wallet and signing tools for Arc dispatch. Manages the `arc0btc` wallet at `~/.aibtc/wallets/`. Includes x402 relay health diagnostics.

## Security Model

- **Wallet password** is stored in Arc's encrypted credential store at `wallet/password`.
- **Signing auto-unlocks and locks** — `btc-sign` and `stacks-sign` handle unlock/lock internally. No manual unlock needed.
- **`unlock` command** verifies the password works (test operation, not required before signing).
- **Read-only commands** (`info`, `status`, `btc-verify`, `check-relay-health`) do not require unlock.
- **Never expose** the mnemonic, password, or private keys in task output.

**Note:** The upstream wallet manager holds unlock state in memory per-process. Signing operations run unlock + sign + lock in a single process via `sign-runner.ts`.

## CLI Commands

```
arc skills run --name wallet -- unlock
arc skills run --name wallet -- lock
arc skills run --name wallet -- info
arc skills run --name wallet -- status
arc skills run --name wallet -- btc-sign --message "text"
arc skills run --name wallet -- stacks-sign --message "text"
arc skills run --name wallet -- btc-verify --message "text" --signature "sig" [--expected-signer "addr"]
arc skills run --name wallet -- check-relay-health [--relay-url <url>] [--sponsor-address <address>]
arc skills run --name wallet -- x402 <x402-subcommand> [flags]
```

### unlock

Unlocks the active wallet using the password from Arc creds store. No arguments needed.

### lock

Locks the wallet, clearing key material from memory. Always lock after signing operations.

### info

Returns wallet addresses (Stacks, Bitcoin SegWit, Taproot) and network. No unlock required.

### status

Returns wallet readiness: whether it exists, is active, and is unlocked. No unlock required.

### btc-sign / stacks-sign

Sign a plain text message. Auto-unlocks and locks the wallet internally — no manual unlock step needed.

### btc-verify

Verify a Bitcoin message signature. Accepts `--expected-signer` to check against a specific address. No unlock required.

### check-relay-health

Check x402 sponsor relay health and sponsor nonce status. Queries the relay `/health` endpoint and fetches sponsor nonce data from the Hiro API. Detects nonce gaps (transactions may be stuck) and mempool congestion (pending transactions). Reports relay reachability, sponsor nonce state, and any issues. No unlock required.

**Flags:**
- `--relay-url` (optional): Base URL of sponsor relay. Default: `https://x402-relay.aibtc.com`
- `--sponsor-address` (optional): STX address of relay sponsor. Default: `SP1PMPPVCMVW96FSWFV30KJQ4MNBMZ8MRWR3JWQ7`

**Output:** JSON object with `healthy` (boolean), `relay` (status + health data), `sponsor` (nonce state), `issues` (array of detected problems), and `hint`.

### x402

Run any x402 command with auto unlock/lock. Handles wallet unlock in the same process so the wallet manager singleton is available. Used for paid x402 operations like sending inbox messages.

Example: `arc skills run --name wallet -- x402 send-inbox-message --recipient-btc-address bc1... --recipient-stx-address SP... --content "Hello"`

## When to Use

- **AIBTC inbox messages** — Send paid x402 messages via `x402 send-inbox-message`.
- **AIBTC heartbeat check-ins** — BTC sign the check-in message, then lock.
- **Proving identity** — Sign a message to prove ownership of arc0.btc addresses.
- **Verifying others** — Verify signatures from other agents or users.

## Addresses

| Network | Address |
|---------|---------|
| BNS | `arc0.btc` |
| Stacks | `SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B` |
| Bitcoin (SegWit) | `bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933` |

