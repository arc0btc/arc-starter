---
name: jingswap
description: Execution briefing for Jingswap blind batch auction — phase detection, market selection, deposit logic, settlement, cancel thresholds, and safety rules
---

# Jingswap — Subagent Briefing

Jingswap is a **blind batch auction DEX** on Stacks. Both sides (quote token and sBTC) deposit independently into a cycle. At settlement, Pyth oracle prices fill as much as possible; unswapped remainder rolls into the next cycle. There are no limit prices — deposits are unconditional bids.

---

## Markets

| `--market` | Quote token | Contract | Unit |
|---|---|---|---|
| `sbtc-stx` *(default)* | STX | `SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.sbtc-stx-jing` | uSTX (6 decimals) |
| `sbtc-usdcx` | USDCx | `SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.sbtc-usdcx-jing` | USDCx units (6 decimals) |

**Market selection rule:** match the quote token the user/task specifies. If the task says "buy sBTC with STX" → `sbtc-stx`. "Buy sBTC with USDCx" → `sbtc-usdcx`. If the task says "deposit sBTC" with no market preference → `sbtc-stx` (default). Never guess; if ambiguous, default to `sbtc-stx` and state the assumption.

---

## Auction Cycle Phases

Always call `cycle-state` first. The `phase` field drives all deposit decisions.

| Phase | Value | Duration | Meaning |
|---|---|---|---|
| Deposit | `0` | ≥150 blocks (~5 min) | Deposits open for both sides |
| Buffer | `1` | ~30 blocks (~1 min) | No new deposits; settlement pending |
| Settle | `2` | Until triggered | Anyone can call settle; then cycle advances |

**Stacks block time:** ~2 seconds (Nakamoto). 150 blocks ≈ 5 minutes. 530 blocks ≈ 17.5 minutes.

### Phase detection pattern

```
cycle-state response fields to check:
  phase: 0 | 1 | 2
  blocksElapsed: <N>  (blocks since cycle opened)
  cycleNumber: <N>
```

If `phase !== 0`, do not attempt a deposit — the CLI will reject it and exit 1. Reschedule or wait.

---

## Deposit Decision Tree

```
1. Call cycle-state
2. If phase !== 0 → abort. Log current phase. Create follow-up task scheduled for +5min.
3. Check amount against budget caps:
     - Quote (STX): max 50,000,000 uSTX (50 STX) per cycle
     - sBTC: max 10,000 sats per cycle
4. If within budget + phase === 0 → call deposit-quote or deposit-sbtc
5. Parse response: { success: true, txid: "..." } = ok. success: false = fail immediately.
```

**Do not retry a deposit on the same cycle if it fails.** A failed deposit may still have broadcast — retrying risks double-spend. Create a follow-up task and escalate.

---

## Settlement & Cancel Threshold

Settlement is permissionless — anyone can trigger it. The CLI does not currently expose a `settle` subcommand; settlement is handled externally (Jingswap backend or other agents). Your role is deposit, not settlement.

**Cancel threshold:** 530 blocks after a cycle closes without settlement, deposits can be cancelled and rolled forward. This is automatic at the contract level — no action needed by Arc.

**Rollover behavior:** Unswapped deposits (either side) automatically carry forward into the next cycle. Arc does NOT need to re-deposit rolled balances — they remain in the auction. Depositing again on top of a rolled balance would double the position.

To check if a previous deposit rolled over: call `depositors --cycle <N>` and look for Arc's Stacks address in the depositor list for the cycle in question.

---

## Reading Settlement Results

After a cycle settles, use `settlement --cycle <N>` to see:
- Oracle price used (Pyth)
- Total quote deposited vs filled
- Total sBTC deposited vs filled
- Fill ratio (filled/total)

Use `cycles-history` to find the most recent settled cycle number if unknown.

---

## Safety Rules

1. **Phase gate is mandatory.** The CLI enforces it, but verify phase before calling write commands. Never skip.
2. **Budget caps are hard limits.** 50 STX or 10,000 sats per cycle — never exceed. These are configured in `config.json`.
3. **Mainnet only.** No testnet contracts exist. All transactions are real.
4. **Wallet credentials required.** Write commands use `bitcoin-wallet/id` and `bitcoin-wallet/password` credentials. If missing, the tx runner returns `{ success: false, error: "Wallet credentials not found" }` — escalate, do not retry.
5. **No limit prices.** Deposits are unconditional — you receive whatever oracle price is at settlement. Check `prices` before depositing if price risk matters.
6. **120s tx timeout.** The tx runner will kill the process after 120 seconds. If timeout occurs, check the chain for the transaction before retrying — it may have broadcast.
7. **One deposit per cycle.** Depositing twice in the same cycle stacks the amount. Only do this deliberately.

---

## Common Task Patterns

### "Deposit N STX into Jingswap"
```
arc skills run --name jingswap -- cycle-state
# verify phase === 0, then:
arc skills run --name jingswap -- deposit-quote --amount <N_in_uSTX>
# N STX = N * 1,000,000 uSTX (6 decimals). 50 STX max = 50000000 uSTX.
```

### "Deposit N sats sBTC into Jingswap"
```
arc skills run --name jingswap -- cycle-state
# verify phase === 0, then:
arc skills run --name jingswap -- deposit-sbtc --amount <N_sats>
# max 10000 sats
```

### "Check current auction state"
```
arc skills run --name jingswap -- cycle-state
arc skills run --name jingswap -- prices
```

### "Check if our deposit was filled"
```
arc skills run --name jingswap -- settlement --cycle <N>
# Look for Arc's address in fill data, or compare deposited vs filled totals.
```

### "Deposit USDCx for sBTC"
```
arc skills run --name jingswap -- cycle-state --market sbtc-usdcx
# verify phase === 0, then:
arc skills run --name jingswap -- deposit-quote --amount <N_units> --market sbtc-usdcx
# USDCx uses 6 decimals. Budget cap: same 50,000,000 unit limit applies.
```

---

## Error Handling

| Error | Action |
|---|---|
| `phase !== 0` | Do not deposit. Wait or schedule follow-up. |
| `Amount exceeds budget` | Reduce amount to cap. Never override budget in code. |
| `Wallet credentials not found` | Escalate to whoabuddy. |
| `Timeout (120s)` | Check chain for txid before retrying. |
| `Jingswap API 5xx` | Retry once after 30s. If persists, fail task. |
| `success: false` in tx response | Fail task immediately. Log full response. |
