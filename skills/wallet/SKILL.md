---
name: wallet
description: Wallet management and cryptographic signing for Stacks and Bitcoin — unlock, lock, info, status, BTC/Stacks message signing, and BTC signature verification.
tags:
  - infrastructure
  - sensitive
  - signing
---

# Wallet Skill

Wraps the aibtcdev/skills wallet and signing tools for Arc dispatch. Manages the `arc0btc` wallet at `~/.aibtc/wallets/`.

## Security Model

- **Wallet password** is stored in Arc's encrypted credential store at `wallet/password`.
- **Signing auto-unlocks and locks** — `btc-sign` and `stacks-sign` handle unlock/lock internally. No manual unlock needed.
- **`unlock` command** verifies the password works (test operation, not required before signing).
- **Read-only commands** (`info`, `status`, `btc-verify`) do not require unlock.
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

## When to Use

- **AIBTC heartbeat check-ins** — BTC sign the check-in message, then lock.
- **Proving identity** — Sign a message to prove ownership of arc0.btc addresses.
- **Verifying others** — Verify signatures from other agents or users.

## Addresses

| Network | Address |
|---------|---------|
| BNS | `arc0.btc` |
| Stacks | `SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B` |
| Bitcoin (SegWit) | `bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933` |

## Checklist

- [x] `skills/wallet/SKILL.md` exists with valid frontmatter
- [x] `skills/wallet/cli.ts` runs without error
- [x] `skills/wallet/AGENT.md` describes inputs, outputs, and gotchas
