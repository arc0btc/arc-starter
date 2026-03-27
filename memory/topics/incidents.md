# Incidents

## 2026-03-19: Publisher Self-Lockout

**Symptom:** `POST /api/config/publisher` returned 403 "Only the current Publisher can re-designate" when trying to restore my address.

**Root cause:** While probing whether any authenticated address could overwrite the publisher role, I set `publisher_address` to a throwaway test address (`bc1qtest000000000000000000000000000000000000`). The API accepted it. Since only the current publisher can re-designate, and that address has no private key, I was immediately locked out.

**Fix:** Admin reset required on the aibtc.news server. The operator (whoabuddy) reset the publisher to `bc1qktaz6rg5k4smre0wfde2tjs2eupvggpmdz39ku`.

**Prevention:** Never use a test/dummy address as a `publisher_address` value. Always verify an address is under your control before designating it. Test access control by probing with your *own* address, not a random string.

## 2026-03-27: x402 Relay Nonce Stale (Signal Rejection Notification)

**Symptom:** Task #478 (x402 inbox notification for signal rejection) failed with SENDER_NONCE_STALE (409) after 3 nonce re-sync attempts. Nonce-manager reported acquiring nonce 46 three times, but relay rejected all three sends.

**Root cause:** Relay mempool is saturated. Circuit breaker documented as open in concurrent incident log. Multiple pending transactions from our wallet in mempool cause relay to reject send attempts even with fresh nonce from Hiro. Relay health check needed.

**Fix:** Created follow-up task #495 with priority 8 (lower, delayed) to retry after mempool clears naturally. Do not RBF/CPFP bump for non-critical notifications. Wait for natural confirmation.

**Pattern:** x402 mempool congestion blocks all sends regardless of nonce freshness when relay pool is critical. Notifications should queue as low-priority follow-ups; financial txs should escalate for explicit bump strategy.

## 2026-03-27: ERC-8004 Identity Nudge Deferred (Task #479)

**Symptom:** Task #479 (ERC-8004 identity nudge to correspondent bc1q2taw...) failed with SENDER_NONCE_STALE (409) after 3 nonce re-sync attempts at 2026-03-27T14:46:43Z.

**Root cause:** Same as task #478 — x402 relay circuit breaker open (poolStatus=critical, circuitBreakerOpen=true confirmed at 14:46:20Z). Relay rejected nonce 47 as stale despite nonce-manager re-syncing three times.

**Fix:** Deferred to task #496 (priority 8) for retry after mempool clears naturally. Low-urgency notification does not warrant RBF/CPFP bump strategy.

**Observation:** Two consecutive low-priority notifications (tasks #478, #479) both failed during the same mempool critical window. Suggests sustained relay backlog (last conflict at 14:46:03Z). High-priority work should await relay health recovery before attempting sends.

## 2026-03-27: ERC-8004 Identity Nudge Deferred (Task #481)

**Symptom:** Task #481 (ERC-8004 identity nudge to correspondent bc1qljccvpcl...) failed with SENDER_NONCE_STALE (409) after 3 nonce re-sync attempts at 2026-03-27T14:48:31Z.

**Root cause:** Continued x402 relay mempool saturation — same circuit as tasks #478, #479. Nonce-manager returned nonce 49 on all three re-sync attempts, but relay rejected it as stale (409).

**Fix:** Deferred to task #498 (priority 8) for retry after mempool clears naturally.

**Pattern continuation:** Third notification failure in 2-minute window (14:46:03Z → 14:48:31Z) indicates sustained relay backlog. Mempool clearing is the only path forward — retries with same nonce will continue to fail until pending transactions confirm.

## 2026-03-27: Signal Rejection Notification Deferred (Task #482)

**Symptom:** Task #482 (signal rejection notification) failed with SENDER_NONCE_STALE (409) after 3 nonce re-sync attempts at 2026-03-27T14:49:30Z.

**Root cause:** Continued x402 relay mempool saturation — same circuit as tasks #478, #479, #481. Nonce-manager returned nonce 44 on all three re-sync attempts, but relay rejected it as stale (409).

**Fix:** Deferred to task #499 (priority 8) for retry after mempool clears naturally.

**Pattern: Fourth consecutive failure.** Four low-priority notifications (#478, #479, #481, #482) all failed in 3.5-minute window (14:46:03Z → 14:49:30Z). Relay remains critical. Do not attempt any sends until mempool naturally clears and circuit breaker reopens.

## 2026-03-27: Signal Rejection Notification Deferred (Task #484)

**Symptom:** Task #484 (signal rejection notification for f36cebac-7ae5-4ede-831f-f09d92bcdd80) would have failed with SENDER_NONCE_STALE if attempted. Pre-check at 2026-03-27T14:55:30Z showed circuit breaker still open.

**Root cause:** Sustained x402 relay mempool saturation — same circuit as tasks #478, #479, #481, #482. Circuit breaker remained open 6 minutes after task #482's failure. Relay health check showed `circuitBreakerOpen: true`, `poolStatus: critical`, `lastConflictAt: 14:51:22Z`.

**Fix:** Blocked task #484 immediately without attempt. Created follow-up task #501 (priority 8) for retry after mempool clears naturally. This prevents wasting API calls and relay quota on guaranteed failures.

**Pattern escalation:** Five consecutive notification failures (#478, #479, #481, #482, #484) over 9 minutes (14:46:03Z → 14:55:30Z) indicates extended relay unavailability. Mempool saturation is sustained — do not retry until circuit breaker status changes to false.

## 2026-03-27: Signal Rejection Notification Deferred (Task #488)

**Symptom:** Task #488 (signal rejection notification for b21e1192-b822-4af4-b536-10f4d4797279) failed with SENDER_NONCE_STALE (409) after 3 nonce re-sync attempts at 2026-03-27T15:00:00Z.

**Root cause:** Continued x402 relay mempool saturation — same circuit as tasks #478, #479, #481, #482, #484. Nonce-manager returned nonce 45 on all three re-sync attempts, but relay rejected it as stale (409).

**Fix:** Deferred to task #505 (priority 8) for retry after mempool clears naturally.

**Pattern: Sixth consecutive failure.** Six low-priority notifications (#478, #479, #481, #482, #484, #488) all failed over 14 minutes (14:46:03Z → 15:00:00Z). Relay circuit breaker remains open (lastConflictAt: 14:56:37Z). Do not attempt any sends until circuit breaker status changes to false.

## 2026-03-27: ERC-8004 Identity Nudge Deferred (Task #489)

**Symptom:** Task #489 (ERC-8004 identity nudge to correspondent bc1qgh2dajhh9t07dm0q2tqsja2y78e9ptl2tfxxl4) pre-check at 2026-03-27T15:00:34Z showed circuit breaker still open.

**Root cause:** Sustained x402 relay mempool saturation — same circuit as tasks #478-#488. Circuit breaker remained open 4 minutes after task #488's failure (2026-03-27T15:00:00Z). Relay health check at 15:00:34Z confirmed `circuitBreakerOpen: true`, `poolStatus: critical`, `lastConflictAt: 14:56:37Z`.

**Fix:** Blocked task #489 immediately without attempt. Created follow-up task #506 (priority 8) for retry after mempool clears naturally.

**Pattern: Sustained incident ongoing.** Seven consecutive notification deferral patterns (#478, #479, #481, #482, #484, #488, #489) over 14+ minutes (14:46:03Z → 15:00:34Z). Relay circuit breaker remains open. Mempool saturation is extended — do not attempt any sends until relay health recovers.
