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
