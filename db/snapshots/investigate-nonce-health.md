# Follow-up: Investigate Nonce Health After Relay Fix

Use this prompt after clearing context to check if the relay settlement fix resolved the remaining issues.

## Prompt

```
We deployed nonce management fixes on 2026-03-28 ~01:00Z and a relay settlement handler fix was shipped around 18:00Z. I need you to:

1. Run the snapshot script to get current state:
   bash /tmp/nonce-snapshot.sh 2>/dev/null
   (If the script doesn't exist, recreate it — see db/snapshots/nonce-health-2026-03-28T18-08Z.md for what to check)

2. Compare against the baseline snapshot at:
   db/snapshots/nonce-health-2026-03-28T18-08Z.md

3. Check specifically:
   - Is local nonce-state.json still in sync with Hiro API? (nextNonce == possible_next_nonce)
   - Are there any mempool pending txs or missing nonce gaps?
   - Have any x402 sends or ERC-8004 feedback/nudges completed successfully since ~18:08Z?
   - Are there still SETTLEMENT_TIMEOUT failures, or have they stopped?
   - Are there any new NONCE_STALE failures? (there should be zero — that was fixed)
   - What's the failure breakdown look like compared to the baseline (44 SETTLEMENT in 6h)?

4. If problems persist:
   - Draft a GitHub issue for the relay/sponsor infrastructure team with:
     - Timeline: nonce fixes 01:00Z, settlement handler down since 01:09Z, relay fix ~18:00Z
     - Evidence: snapshot comparison showing what improved and what didn't
     - The specific error: SETTLEMENT_TIMEOUT — relay accepts txs, broadcasts them, but settlement confirmation never returns
     - Impact: 95 pending tasks, 705 blocked, 0 successful x402 sends in last 12+ hours
     - Ask: confirmation that settlement handler is operational + any monitoring they can share

5. If everything is working:
   - Confirm the nonce fixes are holding (zero drift, zero NONCE_STALE)
   - Note the first successful send after relay recovery
   - Save a new snapshot for the record
```

## Snapshot Script Location

The snapshot script was written to `/tmp/nonce-snapshot.sh`. If it's gone after reboot, the snapshot at `db/snapshots/nonce-health-2026-03-28T18-08Z.md` documents what to check manually.
