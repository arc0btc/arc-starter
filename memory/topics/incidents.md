# Incidents

## Reusable Patterns

### pattern:settlement-timeout-vs-nonce-stale

**SETTLEMENT_TIMEOUT** (code 409, "Nonce conflict (SETTLEMENT_TIMEOUT)") is distinct from SENDER_NONCE_STALE:
- SENDER_NONCE_STALE: relay sees the nonce as below current account nonce (nonce too low)
- SETTLEMENT_TIMEOUT: relay accepted the tx and submitted to Stacks, but it didn't confirm within the relay's timeout window (typically because lower nonces in the mempool sequence are stuck/missing)

When seeing SETTLEMENT_TIMEOUT on consecutive nonces, suspect mempool nonce gaps — check for pending txs and missing gap nonces before retrying.

**Update (2026-03-29):** Post frontend update, SETTLEMENT_TIMEOUT after relay `accepted:true` now returns `201 + paymentStatus:"pending"` instead of an error. SETTLEMENT_TIMEOUT is now only returned when the relay itself rejects the transaction.

### pattern:hiro-nonce-api-inconsistency

Hiro's `/v2/accounts` endpoint is load-balanced. Under nonce pressure, different nodes return different nonce values simultaneously. Do NOT attempt automated gap-filling when Hiro nonce contradicts mempool view. Escalate for manual verification from a non-Hiro Stacks node.

### pattern:post-infrastructure-recovery-extended-stabilization-v2

**Trigger:** Infrastructure recovery from extended outage (>2hr), settlement handler experiencing SETTLEMENT_TIMEOUT errors post-recovery.

**Window:** 80+ minutes minimum after CB closure (observed from 2026-03-28 incident; initial 30-40min estimate was insufficient).

**Criteria for resuming x402 sends:**
1. Relay health nominal (CB closed, no fresh conflicts >15min stale)
2. Sponsor nonce clean (no gaps, no pending mempool)
3. **3+ consecutive x402 sends succeed without error** — health check alone is insufficient
4. Settlement response times normal (<2s) on successful sends
5. Operator confirms settlement service recovery

**Key insight:** "Relay reports healthy" (connectivity, nonce coherence) ≠ "settlement throughput stable." After extended outages, relay health status is misleading. Must verify with actual test sends.

### pattern:health-status-vs-throughput-sla

Infrastructure health checks (healthy=true, CB closed) indicate connectivity only, NOT throughput/latency SLA readiness. After extended outages, validate with actual test sends: 3+ test sends must succeed <2s before resuming production sends.

### pattern:secondary-escalation-protocol

If a P1 infrastructure escalation remains unresolved after 60-90 minutes (exceeding typical operator response SLA of 15-30 min), create a secondary escalation. Include: original escalation ID, elapsed time, evidence of continued failure, operator response status.

### pattern:bulk-block-systemic-failures

When a systemic infrastructure issue (relay CB open, fresh conflicts within 15 min, or ongoing SETTLEMENT_TIMEOUT) affects multiple pending tasks, proactively block all related tasks upfront instead of letting each fail individually. This prevents retry cascades and wasted dispatch cycles.

### pattern:relay-failure-cascade-to-unreachability

Repeated sender failures (SENDER_NONCE_STALE) accumulate conflicts in relay CB counter. Cascade: errors → CB open → conflicts regenerate → relay unreachable. Each stage requires different remediation: nonce sync → wait for CB cooldown → operator intervention.

### pattern:nonce-manager-resync-post-chain-query-during-cb

During CB wave events, on-chain nonce can advance beyond nonce-manager state while relay blocks sends. During recovery: (1) Query on-chain nonce from Hiro/chain authority, (2) If on-chain nonce is ahead, resync nonce-manager, (3) Verify acquire/release works post-sync.

---

## Resolved Incidents

### 2026-03-19: Publisher Self-Lockout (RESOLVED)

Set `publisher_address` to a throwaway test address, immediately locked out. Fix: admin reset by whoabuddy. **Prevention:** Never use a test/dummy address as publisher_address.

### 2026-03-27 14:46Z-19:30Z: x402 Relay Circuit Breaker Wave 1 (RESOLVED)

5-hour CB outage from mempool saturation. Sponsored txs (nonces 39-43) stuck at 3000 uSTX fee for 21+ hours. Fixed by RBF with higher fee (10000 uSTX). 164 duplicate retry tasks cleaned up, 128 originals re-queued.

**Key learnings:**
- Stuck sponsored txs → RBF with higher fee, don't wait for natural confirmation
- Failed dispatches spawn retry children → exponential task growth during outages
- `nonce-gap-fill.ts` works for both gap-fill and RBF

### 2026-03-27 19:44Z: Sender Nonce Desync at Nonce 45 (RESOLVED via wave-2 recovery)

Nonce 45 rejected as SENDER_NONCE_STALE despite nonce-manager showing it as next. Likely executed on-chain without nonce-manager update during wave-1 recovery.

### 2026-03-28 01:09Z-17:32Z: Settlement Handler Failure Cascade (RESOLVED)

**Duration:** ~16 hours (01:09Z-17:32Z 2026-03-28)
**Impact:** 1,107 tasks blocked/failed, 4 P1 escalations created
**Root cause:** TooMuchChaining — sponsor wallets with zero Hiro mempool entries were still getting `TooMuchChaining` from the Stacks node, causing infinite nonce assignment loops. Additionally, first-blocker gaps (nonces between last_executed and first mempool tx) were being missed, blocking the entire chain.

**Resolution:**
- Relay PR #258 (merged 03:32Z): First-blocker gap detection + flush-wallet recovery
- Relay PR #261 (merged 17:32Z): TooMuchChaining quarantine (CB threshold=1) + backward ghost probe for phantom mempool entries
- Frontend: Settlement poll reduced 12→2 attempts (26s→6s). SETTLEMENT_TIMEOUT after relay `accepted:true` now returns 201 pending instead of error.
- Relay v1.26.1 released with all fixes

**Task cleanup:** 1,107 stale tasks (1,040 blocked + 66 pending + 1 active) bulk-closed on 2026-03-29. Clean slate restart.

**Key learnings:**
- Relay "healthy" != settlement throughput OK (pattern already documented)
- TooMuchChaining can occur even with empty mempool on Hiro — Stacks node has its own view
- Exponential task growth during sustained outages: sensors create tasks → dispatch fails → creates retries → 2,444 total tasks from ~300 real operations
