---
id: defi-zest-agent
topics: [defi, zest, sbtc, stacks, mainnet]
source: task:17740
created: 2026-05-27
---

# Zest Protocol — Subagent Briefing

You are executing on-chain Zest Protocol V2 operations. These are **irreversible mainnet transactions**. Verify everything before broadcasting. When in doubt, read position first, then act.

---

## V2 Contracts

**Deployer:** `SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7`

| Contract | Role |
|----------|------|
| `.v0-4-market` | Supply, withdraw, borrow, repay write operations |
| `.v0-1-data` | Read-only position queries (`get-user-position`) |

**Arc's address:** `SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B`

**Mainnet check:** addresses MUST start with `SP` (mainnet) or `SM`. If you see `ST`/`SN` — stop, that's testnet. Verify via Hiro API before any write op.

---

## Asset Registry

| Symbol | Asset ID | Decimals | Token Contract |
|--------|----------|----------|----------------|
| wSTX | 0 | 6 | `SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.wstx` |
| sBTC | 2 | 8 | `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token` |
| stSTX | 4 | 6 | `SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token` |
| USDC | 6 | 6 | `SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx` |
| USDH | 8 | 8 | `SPN5AKG35QZSK2M8GAMR4AFX45659RJHDW353HSG.usdh-token-v1` |
| stSTXbtc | 10 | 6 | `SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststxbtc-token-v2` |

Amounts are always in **smallest units** (sBTC = sats, wSTX = µSTX). Never pass human-readable values.

---

## CLI Commands

```bash
# Read position (always run this first before any write op)
arc skills run --name defi-zest -- position [--asset sBTC] [--address SP...]

# Supply assets to lending pool
arc skills run --name defi-zest -- supply --asset sBTC --amount <sats>

# Withdraw assets from lending pool
arc skills run --name defi-zest -- withdraw --asset sBTC --amount <sats>

# List all supported assets
arc skills run --name defi-zest -- list-assets
```

---

## Write Operation Safety Layers

The `tx-runner.ts` runs these checks automatically — understand them so you can interpret errors:

1. **sBTC balance preflight** (supply only): Simulates balance via stxer.xyz before acquiring a nonce. If insufficient balance → exits immediately, no nonce consumed. Error: `"Pre-flight blocked: insufficient sBTC balance"`.

2. **Mempool depth guard**: Refuses to submit if ≥20 pending txs exist for Arc's address. Prevents `TooMuchChaining` (Stacks limit ~25). Error: `"Mempool depth N >= limit 20"`. If this fires, wait for mempool to clear — do not retry immediately.

3. **Nonce serialization**: All write ops coordinate through `acquireNonce`/`releaseNonce` (file lock at `~/.aibtc/nonce-state.json`). On tx failure, nonce is synced from Hiro API — do not manually adjust nonces.

4. **Wallet credentials**: Required — `bitcoin-wallet/id` and `bitcoin-wallet/password` from credential store.

---

## Pyth VAA Requirement (Borrow/Collateral Ops)

Operations involving price feeds (borrow, collateral-add, collateral-remove-redeem) require fresh **Pyth price attestation VAAs**. These are short-lived signed price updates.

**vaaInFlight dedup pattern** (from aibtc-mcp-server PRs #512/#513, resolved 2026-05-26):
- Fetch a fresh VAA immediately before submitting the transaction
- Track the VAA identifier in `vaaInFlight` to prevent submitting the same attestation twice
- If the upstream MCP tool returns a VAA error or stale price, fetch a fresh VAA and retry once
- Never cache VAAs between dispatch cycles — they expire

If using MCP tools (`zest_borrow`, `zest_supply`, `zest_withdraw`), the MCP server ≥v1.56.1 handles VAA fetching and dedup automatically. Check version before using.

---

## Position Monitoring

- Sensor runs every **360 minutes** (6h), checks sBTC supply position via `v0-1-data.get-user-position`
- Position state persisted in `skills/defi-zest/position-state.json`
- **Alert threshold**: >10% drop in `suppliedShares` between checks → creates P3 opus task to investigate
- Investigate drops: could be expected withdrawal, liquidation, or protocol event. Check Hiro mempool for recent txs from Arc's address.

---

## Error Handling

| Error | Action |
|-------|--------|
| 403/401 | **Stop immediately.** Do not retry. Fail the task. |
| Mempool depth ≥20 | Close task as failed. Create follow-up scheduled +30min. |
| Preflight blocked (insufficient sBTC) | Fail the task. Do not retry — balance won't change on retry. |
| Nonce acquisition failed | Fail the task. Nonce-tracker auto-recovers after 90s. |
| Network timeout (Hiro API) | Retry up to 3 times with 10s backoff, then fail. |
| tx-runner: no output | Check stderr for context. Likely upstream defi.ts issue — fail and create follow-up. |

---

## Before Any Write Operation

1. Run `position` to confirm current state
2. Verify wallet creds exist: `arc creds list | grep bitcoin-wallet`
3. Verify Arc address prefix is `SP` (mainnet)
4. Confirm amount is in smallest units (not human-readable)
5. For borrow: ensure MCP server ≥v1.56.1 is available for VAA handling

---

## Do Not

- **Do not fabricate txids.** If the tx-runner returns no output, that is an error — not a success.
- **Do not retry 403/401** — these are permission/auth failures, not transient errors.
- **Do not exceed 100 STX equivalent** in a single operation without escalating to whoabuddy.
- **Do not run on testnet addresses** — this skill is mainnet-only.
