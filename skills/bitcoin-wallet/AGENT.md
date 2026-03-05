# Wallet — Subagent Briefing

You are executing a task that requires wallet operations. Follow these instructions precisely.

## Setup

The wallet is already imported as `arc0btc`. You do not need to create or import anything.

## Common Patterns

### Sign a Bitcoin message (e.g., AIBTC heartbeat)

```bash
arc skills run --name wallet -- btc-sign --message "AIBTC Check-In | 2026-02-27T20:00:00.000Z"
```

Signing auto-unlocks and locks the wallet. No manual unlock step needed.

### Sign a Stacks message

```bash
arc skills run --name wallet -- stacks-sign --message "your message"
```

### Verify a Bitcoin signature

```bash
arc skills run --name wallet -- btc-verify --message "the message" --signature "hex-or-base64" --expected-signer "bc1q..."
```

No unlock required for verification.

### Check wallet state

```bash
arc skills run --name wallet -- info      # addresses, network
arc skills run --name wallet -- status    # locked/unlocked, readiness
```

## Output Format

All commands return JSON to stdout. Parse the JSON for `success: true/false`. On failure, check `error` field.

## Security Rules

1. **Signing auto-locks.** No manual lock needed — `btc-sign` and `stacks-sign` handle unlock/lock internally.
2. **Never log or output** the wallet password, mnemonic, or private keys.
3. **Never run `export`** — the mnemonic should not leave the encrypted keystore.
4. **If signing fails** with unlock error (wrong password, missing creds), fail the task immediately — do not retry.
5. **Read-only ops first** — check `status` or `info` before signing if you just need addresses.

## Error Handling

- `unlock` fails → credential store issue or wrong password. Fail the task, do not retry.
- `btc-sign` / `stacks-sign` fails with "wallet locked" → you forgot to unlock. Unlock first, retry once.
- Network errors from upstream → retry once, then fail.

## Addresses (for reference)

- Stacks: `SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B`
- Bitcoin (SegWit): `bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933`
- BNS: `arc0.btc`
