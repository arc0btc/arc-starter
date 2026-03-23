---
name: styx-agent
skill: styx
description: BTC→sBTC conversion via Styx protocol — full headless deposit flow including pool status checks, PSBT signing, broadcast, and deposit tracking.
---

# Styx Agent

This agent handles trustless BTC→sBTC conversion via the Styx protocol by FaktoryFun. It checks pool liquidity, estimates fees, creates deposit reservations, builds and signs PSBTs locally using the wallet's BTC keys, broadcasts to mempool.space, and tracks deposit status through confirmation. Use Styx for fast pool-based conversion of smaller amounts (10k–1M sats); use the native `sbtc` skill for direct protocol deposits of larger amounts.

## Prerequisites

- Wallet must be unlocked: `bun run wallet/wallet.ts unlock --password <password>`
- Wallet must have sufficient BTC balance at `btcAddress` (deposit amount + network fee)
- Pool must have available liquidity: verify with `pool-status` before depositing
- `@faktoryfun/styx-sdk` and `@scure/btc-signer` packages must be installed (included in package.json)

## Decision Logic

| Goal | Subcommand |
|------|-----------|
| Check available pool liquidity before depositing | `pool-status` — use `--pool main` or `--pool aibtc` |
| List all available pools and their configs | `pools` — no arguments needed |
| Get current Bitcoin network fee rates | `fees` — returns low/medium/high in sat/vB |
| Get current BTC price in USD | `price` — no arguments needed |
| Execute full BTC→sBTC deposit (reserve + sign + broadcast) | `deposit` — requires `--amount` in sats; optionally `--stx-receiver`, `--btc-sender`, `--pool`, `--fee` |
| Check status of an existing deposit | `status` — use `--id <depositId>` or `--txid <btcTxId>` |
| View deposit history for a Stacks address | `history` — use `--address` or omit for active wallet |

## Safety Checks

- **Check pool liquidity first** — run `pool-status` before `deposit`; depositing more than `estimatedAvailable` will fail
- **Verify BTC balance** — wallet `btcAddress` must have enough sats to cover `--amount` plus estimated fee
- **Minimum deposit: 10,000 sats** — the CLI enforces this with `MIN_DEPOSIT_SATS` from the SDK
- **Pool maximums**: `main` pool caps at 300,000 sats; `aibtc` pool caps at 1,000,000 sats
- **Ordinal safety (mainnet only)** — the CLI automatically filters out ordinal UTXOs using the Hiro Ordinals API; if all UTXOs contain inscriptions the deposit is blocked
- **`--btc-sender` must match active wallet** — the CLI signs with the active wallet's keys; providing a different address will throw an error
- **Update status after broadcast** — the CLI does this automatically (with one retry); if it fails, save `depositId` and `txid` for manual recovery to prevent pool liquidity from being locked indefinitely

## Error Handling

| Error message | Cause | Fix |
|--------------|-------|-----|
| `"Wallet is not unlocked. Use wallet/wallet.ts unlock first."` | Wallet not unlocked | Run `wallet unlock` |
| `"Bitcoin keys not available. Unlock your wallet again."` | BTC keys missing from session | Re-run `wallet unlock` |
| `"Amount X below minimum deposit (10000 sats)"` | Deposit amount too small | Use at least 10,000 sats |
| `"Insufficient pool liquidity: need X sats, pool has ~Y sats"` | Pool does not have enough sBTC | Try the other pool or wait for liquidity |
| `"All N UTXO(s) selected by Styx contain inscriptions."` | All UTXOs are ordinals on mainnet | Use a wallet with cardinal UTXOs for BTC deposits |
| `"HTTP error! status: 400"` | Invalid deposit params | Check amount limits and address formats |
| `"HTTP error! status: 503"` | Styx backend unavailable | Retry after 5 minutes |
| `"Provide either --id <depositId> or --txid <btcTxId>"` | No identifier given to `status` | Pass `--id` or `--txid` |

## Output Handling

- **deposit**: extract `depositId` (save for tracking), `txid` (Bitcoin tx), `explorerUrl` (mempool.space link), `status` should be `"broadcast"`, `warning` field indicates status update failure (save `depositId` and `txid` for manual recovery)
- **status**: extract `status` field — poll until it reaches `"confirmed"`; `stxTxId` appears once sBTC is minted on Stacks
- **pool-status**: extract `estimatedAvailable` (BTC float) — multiply by 1e8 to convert to sats for comparison with deposit amount
- **fees**: extract `low`, `medium`, `high` (sat/vB) to inform fee priority selection
- **history**: extract `deposits` array with `id`, `status`, `btcAmount`, `sbtcAmount`, `btcTxId`

## Example Invocations

```bash
# Check pool liquidity and fees before depositing
bun run styx/styx.ts pool-status --pool main
bun run styx/styx.ts fees

# Execute a full BTC→sBTC deposit
bun run styx/styx.ts deposit --amount 50000 --stx-receiver SP2GH... --fee medium

# Track deposit status until confirmed
bun run styx/styx.ts status --id <deposit-id>
```
