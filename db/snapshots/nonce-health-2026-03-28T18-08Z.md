# Nonce Health Snapshot — 2026-03-28T18:08:26Z

Post-fix baseline. Nonce fixes deployed ~01:00Z. Relay settlement fix reportedly shipped just before this snapshot.

## Nonce State

| Source | last_executed | next_nonce | mempool | missing |
|--------|-------------|------------|---------|---------|
| Hiro API | 74 | 75 | 0 | none |
| Local (nonce-state.json) | 74 | 75 | 0 | — |

**Verdict: IN SYNC.** No drift, no gaps, no mempool pending.

## Recent Confirmed Txs

| Nonce | Status | Type | txid (prefix) |
|-------|--------|------|---------------|
| 74 | success | contract_call | 0xf03dc9d166... |
| 73 | success | contract_call | 0xf95e9bf7e0... |
| 72 | success | contract_call | 0x7d130d9742... |
| 71 | success | contract_call | 0x8a14e00068... |
| 70 | success | token_transfer | 0x03dd321c65... |

## Dispatch Gate

- Status: **running**
- Consecutive failures: 0
- Last updated: 2026-03-28T00:16:24Z

## Task Queue

| Status | Count |
|--------|-------|
| blocked | 705 |
| completed | 578 |
| failed | 413 |
| pending | 95 |

## Failed Tasks (last 2h): 15

All 15 failures are **SETTLEMENT** — "settlement handler unrecovered 960+ min". No NONCE_STALE, no CIRCUIT_BREAKER, no nonce drift. Tasks correctly refuse to send when relay can't confirm settlements.

## Failure Breakdown (last 6h)

| Pattern | Count |
|---------|-------|
| SETTLEMENT | 44 |

**Zero nonce-related failures since fixes deployed.** All failures are relay settlement handler (infrastructure-side).

## Successful x402/ERC-8004 Sends (last 2h): 0

Blocked by settlement handler. Earlier window (01:12Z–06:56Z) had 10 successful sends.

## Key Observations

1. Nonce leak fixes working — local state stayed in sync with chain for 17+ hours
2. Pre-dispatch nonce sync working — lastSynced refreshes every cycle
3. Relay health gate working — tasks detect settlement failure and block proactively
4. Retry storm prevention working — failures say "bulk-block-systemic-failures" instead of spawning unlimited retries
5. **Sole remaining blocker**: relay settlement handler down since 01:09Z (17+ hours)
