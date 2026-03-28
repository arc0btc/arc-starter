---
name: x402 settlement handler stabilization post-wave-2 (task #993, #955, #965, #988)
description: Relay reports healthy post-CB-wave-2 recovery but settlement handler still under load, causing SETTLEMENT_TIMEOUT 24s after send
type: incident
date: 2026-03-28
---

# 2026-03-28 01:27Z: x402 SETTLEMENT_TIMEOUT #993 — Relay Settlement Handler Marginal Post-Wave-2 Recovery

**Task:** #993 (signal rejection notification)
**Duration of wave-2 CB outage:** 20:05Z 2026-03-27 → ~01:00Z 2026-03-28 (240+ minutes)
**Status:** Blocked, follow-up #999 created for retry (P5)

## Symptom

x402 inbox-notify send-one acquired nonce 75, relay accepted broadcast but settlement confirmation timed out at 01:27:51Z (24s after send attempt).

Health check 3 seconds before send (01:27:09Z) showed:
- relay-diagnostic: healthy=true
- circuitBreakerOpen: false (cleared)
- conflictsDetected: 0
- effectiveCapacity: 1 (marginal, not ideal)
- poolStatus: healthy
- Sponsor nonce: clean (lastExecuted=1197, nextNonce=1198, mempoolCount=0)
- lastConflictAt: null (no recent conflicts)
- Relay reports: "Relay and sponsor are operating normally."

Yet the send failed immediately with:
```
x402 error: SETTLEMENT_TIMEOUT (409)
detail: "Payment broadcast but settlement confirmation timed out."
retryAfter: 60s
```

## Root Cause

Relay CB finally cleared after 4+ hour wave-2 outage, but **settlement handler remains under load**. This is continuation of the marginal capacity state pattern observed in tasks #955, #965, #988:

1. Relay reports all green (CB closed, healthy, no conflicts)
2. Sponsor nonce is clean (no gaps, no pending)
3. BUT settlement confirmation handler has not recovered throughput capacity
4. Relay accepts broadcast and enters settlement phase, but handler times out before confirming

This is not a nonce conflict or CB issue — it's a **settlement handler throughput issue** during post-outage stabilization.

## Pattern: Post-Infrastructure-Recovery-Marginal-State

When infrastructure reports nominal health post-outage but experiences settlement timeouts:
- Infrastructure "recovered" (CB closed, reachable, reports healthy)
- But throughput recovery is incomplete (settlement times out despite healthy status)
- Hammering with retries creates duplicate settlements and wastes nonce credits
- Better approach: block dependent tasks and retry after stabilization window (5-10 min)

This pattern applies when:
1. Health check reports healthy=true, CB closed, no conflicts
2. Sponsor nonce clean (no gaps, no pending)
3. BUT send fails with SETTLEMENT_TIMEOUT (not SENDER_NONCE_STALE, not CB open)
4. The timeout is 20-30s after send (relay accepted broadcast, handler timed out)

## Timeline of Settlement Timeouts Post-Wave-2

- **01:09Z task #988:** SETTLEMENT_TIMEOUT at nonce 75 (CB just closed)
- **01:27Z task #993:** SETTLEMENT_TIMEOUT at nonce 75 again (18 min later, CB still closed)
- Prior: **task #955 (00:30Z)**, **task #965 (00:40Z)** also SETTLEMENT_TIMEOUT during similar post-recovery state

All four tasks show the same pattern: healthy relay, no nonce issues, but settlement handler under load.

## Action Taken

- Blocked task #993 per `post-infrastructure-recovery-marginal-state` pattern
- Created follow-up task #999 for retry after 5-10min stabilization window
- Do NOT retry immediately — settlement handler needs more time to clear its queue

## Lesson

**Relay health reports must be interpreted with settlement response times in context.**

When relay reports "operating normally" and CB is closed, but settlement is timing out:
- The system IS technically recovered (CB not the issue)
- But settlement throughput is still marginal (handler queue backlog)
- Do not resume production x402 sends until settlement succeeds on first attempt with < 2s response time

Health indicators checklist for x402 readiness:
1. circuitBreakerOpen: false ✓
2. conflictsDetected: 0 ✓
3. lastConflictAt: stale or null ✓
4. Sponsor nonce: clean ✓
5. **Settlement response time: < 2s ✓ ← KEY for post-recovery**
6. **3+ consecutive sends succeed ✓ ← verification**

Task #993 failed at step 5. Retry after settlement has 5-10min to recover throughput.

## Follow-up

Task #999 created for retry. If retry also gets SETTLEMENT_TIMEOUT, escalate to operator for settlement service diagnostics (queue depth, memory usage, throughput throttle).
