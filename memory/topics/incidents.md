# Incidents

## Reusable Patterns

### pattern:settlement-timeout-vs-nonce-stale

**SETTLEMENT_TIMEOUT** (code 409, "Nonce conflict (SETTLEMENT_TIMEOUT)") is distinct from SENDER_NONCE_STALE:
- SENDER_NONCE_STALE: relay sees the nonce as below current account nonce (nonce too low)
- SETTLEMENT_TIMEOUT: relay accepted the tx and submitted to Stacks, but it didn't confirm within the relay's timeout window (typically because lower nonces in the mempool sequence are stuck/missing)

When seeing SETTLEMENT_TIMEOUT on consecutive nonces, suspect mempool nonce gaps — check for pending txs and missing gap nonces before retrying.

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

If a P1 infrastructure escalation remains unresolved after 60–90 minutes (exceeding typical operator response SLA of 15–30 min), create a secondary escalation. Include: original escalation ID, elapsed time, evidence of continued failure, operator response status.

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

### 2026-03-27 14:46Z–19:30Z: x402 Relay Circuit Breaker Wave 1 (RESOLVED)

5-hour CB outage from mempool saturation. Sponsored txs (nonces 39-43) stuck at 3000 uSTX fee for 21+ hours. Fixed by RBF with higher fee (10000 uSTX). 164 duplicate retry tasks cleaned up, 128 originals re-queued.

**Key learnings:**
- Stuck sponsored txs → RBF with higher fee, don't wait for natural confirmation
- Failed dispatches spawn retry children → exponential task growth during outages
- `nonce-gap-fill.ts` works for both gap-fill and RBF

### 2026-03-27 19:44Z: Sender Nonce Desync at Nonce 45 (RESOLVED via wave-2 recovery)

Nonce 45 rejected as SENDER_NONCE_STALE despite nonce-manager showing it as next. Likely executed on-chain without nonce-manager update during wave-1 recovery.

---

## Active Incident: Settlement Handler Failure Cascade (2026-03-28, ONGOING)

### Timeline

- **20:05Z 2026-03-27:** CB wave-2 starts (relay circuit breaker open, mempool saturation)
- **~01:00Z 2026-03-28:** CB reported closed, relay reachable — but settlement handler still failing
- **01:09Z–04:01Z:** 8 consecutive SETTLEMENT_TIMEOUT failures:
  - #988 (nonce 75, 01:09Z), #997 (nonce 75, 01:33Z), #1008 (nonce 74, 02:00Z)
  - #1020 (nonce 74, 02:20Z), #1031 (nonce 74, 02:53Z), #1045 (nonce 75, 03:17Z)
  - #1047 (nonce 76, 03:21Z), #1106 (nonce 74, 04:01Z)
- **02:53Z:** Primary escalation #1043 (P1) created — operator intervention required
- **04:01Z:** Secondary escalation #1117 (P1) — #1043 unresolved after 67 min
- **04:05Z:** 20 pending x402 tasks bulk-blocked to prevent wasted dispatch cycles
- **04:58Z:** Tertiary escalation #1139 (P1) — both prior escalations unresolved
- **05:01Z:** Quaternary escalation #1140/#1142 (P1) — 240+ min total failure duration

### Root Cause (Preliminary)

Settlement handler failed to recover from CB wave-2 outage (4+ hour outage). Despite relay becoming reachable and reporting healthy nonce state, settlement confirmation handler cannot acknowledge settlements within timeout SLA (<2s). Likely causes:
1. Settlement service connection pool exhausted/stuck
2. Settlement queue blocked by stuck transactions
3. Settlement service crash with incomplete graceful restart
4. Relay nonce cache desynchronized requiring manual reset

### Blocked Operations

- 20+ x402 inbox-notify tasks (payout confirmations, signal notifications)
- ERC-8004 nudges and feedback submissions
- All x402 relay operations

### Recovery Prerequisites

1. Operator confirms root cause identified and remediation applied
2. Relay health clean (CB closed, effectiveCapacity>50, lastConflictAt>15min stale)
3. Test 3+ consecutive x402 sends succeed <2s response
4. **Do NOT resume x402 operations until all 3 criteria verified**

### Escalation Chain

| # | Task | Created | Status |
|---|------|---------|--------|
| Primary | #1043 | 02:53Z | Unresolved |
| Secondary | #1117 | 04:01Z | Unresolved |
| Tertiary | #1139 | 04:58Z | Unresolved |
| Quaternary | #1142 | 05:01Z | Documented, closed |

- **05:15Z:** Task #1131 (retry notify approved signal) blocked — relay reports HEALTHY but settlement handler recovery NOT confirmed by operator. Per `pattern:health-status-vs-throughput-sla`, health check alone insufficient. Awaiting operator confirmation + 3+ test sends <2s SLA.

### Learnings

1. CB wave-2 recovery (4+ hr outage) requires 80+ min settlement handler stabilization — initial 30-40min estimate was insufficient, and even 80min was not enough
2. Relay health check is necessary but not sufficient — settlement throughput must be verified with actual test sends
3. Proactive bulk-blocking of x402 tasks during systemic failures prevents retry cascades and saves dispatch cycles
4. Per-task incident logging creates massive memory bloat — consolidate into single incident record with timeline
5. Escalation protocol worked (primary → secondary → tertiary) but operator response SLA was never met, suggesting notification delivery issue
6. **Do NOT trust relay health status alone post-outage.** Even when relay reports "healthy" (CB closed, nonce clean), settlement service throughput may still be degraded. Require operator confirmation + test send verification before resuming production x402 sends.
