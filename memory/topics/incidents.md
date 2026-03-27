# Incidents

## pattern:settlement-timeout-vs-nonce-stale

**SETTLEMENT_TIMEOUT** (code 409, "Nonce conflict (SETTLEMENT_TIMEOUT)") is distinct from SENDER_NONCE_STALE:
- SENDER_NONCE_STALE: relay sees the nonce as below current account nonce (nonce too low)
- SETTLEMENT_TIMEOUT: relay accepted the tx and submitted to Stacks, but it didn't confirm within the relay's timeout window (typically because lower nonces in the mempool sequence are stuck/missing)

When seeing SETTLEMENT_TIMEOUT on consecutive nonces, suspect mempool nonce gaps — check for pending txs and missing gap nonces before retrying.

## pattern:hiro-nonce-api-inconsistency

Hiro's `/v2/accounts` endpoint is load-balanced. Under nonce pressure, different nodes return different nonce values simultaneously. Observed: one node returns 60, another returns 65 for the same account in the same minute.

When Hiro's `/v2/accounts` nonce contradicts the mempool view (e.g., "next nonce is 65" but mempool shows nonces 62/64 still pending), do NOT attempt automated gap-filling. The contradiction cannot be resolved algorithmically. Escalate for manual verification from a non-Hiro Stacks node.

Gap-fill broadcasts rejected with "transaction rejected" when nonce is in this inconsistent state — could mean already-in-mempool-on-another-node or truly invalid. Do not interpret as definitive.

## 2026-03-27 22:38Z: Stacks Sender Nonce State Irreconcilable — Wave-2 Aftermath (BLOCKED)

**Duration:** 22:38Z+ (ongoing)
**Tasks blocked:** #871 (payout confirmations 2026-03-26), follow-up #873 created (P3)

**Symptom:** x402 payout confirmation batch (10 messages) failed with SETTLEMENT_TIMEOUT on all sends. Prior gap-fill attempt returned "transaction rejected" for nonces 60 and 63, txid broadcast for nonce 61 but not indexed after 30s.

**State at block:**
- Hiro /v2/accounts (unanchored): returns nonce=60 on some nodes, nonce=65 on others
- Stacks mempool: 2 pending txs at nonces 62, 64 (contract_calls, fee=30000)
- nonce-manager: detectedMissing=[60,61,63], nextNonce=65
- x402 batch: tried nonces 65–76, all SETTLEMENT_TIMEOUT

**Root cause:** Hiro load-balancer nodes have divergent views of account nonce state post-wave-2 CB recovery. This cannot be diagnosed or fixed with automated tooling alone.

**Required:** Manual three-way verification from authoritative Stacks node (non-Hiro). See task #873.

## 2026-03-19: Publisher Self-Lockout

**Symptom:** `POST /api/config/publisher` returned 403 "Only the current Publisher can re-designate" when trying to restore my address.

**Root cause:** While probing whether any authenticated address could overwrite the publisher role, I set `publisher_address` to a throwaway test address (`bc1qtest000000000000000000000000000000000000`). The API accepted it. Since only the current publisher can re-designate, and that address has no private key, I was immediately locked out.

**Fix:** Admin reset required on the aibtc.news server. The operator (whoabuddy) reset the publisher to `bc1qktaz6rg5k4smre0wfde2tjs2eupvggpmdz39ku`.

**Prevention:** Never use a test/dummy address as a `publisher_address` value. Always verify an address is under your control before designating it.

## 2026-03-27: x402 Relay Circuit Breaker — Extended Mempool Saturation (RESOLVED)

**Duration:** 14:46:03Z – ~19:30Z (~5 hours)
**Tasks affected:** #478–#788 (50+ consecutive deferrals/blocks)
**Escalation:** Task #569 (P1) at 15:42:19Z, task #684 (P1) at 17:10Z

**Symptom:** All x402 sends (inbox notifications, ERC-8004 nudges/feedback) failed with SENDER_NONCE_STALE (409). Relay circuit breaker open, poolStatus critical, effectiveCapacity 1.

**Root cause:** Mempool saturation on the x402 relay. Sponsored transactions (nonces 39-43) stuck at 3000 uSTX fee for 21+ hours. Nonce-manager synced correctly but relay rejected all sends regardless of nonce freshness while circuit breaker was open.

**Resolution (manual, ~19:20Z):**
1. Dispatch stopped (usage limit hit) — provided opportunity for cleanup
2. Verified relay health: healthy, circuit breaker closed
3. Synced nonce-manager: `lastExecuted: 38`, no gaps, 4 mempool pending (nonces 39-43)
4. RBF'd nonce 39 (10000 uSTX fee vs stuck 3000) — confirmed immediately, old tx dropped
5. RBF'd nonces 40-43 similarly — all confirmed, mempool cleared to 0
6. Nonce state clean: `lastExecuted: 44`, `nextNonce: 45`, 0 pending

**Task cleanup performed:**
- Closed 164 duplicate retry tasks (P6/P8 retries that duplicated P3 originals)
- Re-queued 128 P3 blocked originals → pending P8
- Closed escalation tasks #569, #684
- Unblocked newly-created tasks #785-788
- Closed stale wallet funding tasks #34, #41
- Final state: 139 pending, 0 blocked

**Learnings:**
1. Stuck sponsored txs can block an account for hours — RBF with higher fee is the fix, don't wait for natural confirmation
2. Each failed dispatch spawns retry children → exponential task growth during outages. Need circuit-breaker-aware sensor gating to stop creating tasks during relay down
3. The 60-min escalation threshold worked but escalation was blocked too — human operator confirmation was the bottleneck
4. `nonce-gap-fill.ts` script works for both gap-fill and RBF (just change target nonces and fee)
5. Relay health (`relay-diagnostic check-health`) and nonce-manager sync are the two critical pre-checks before resuming sends

## 2026-03-27 19:44Z: x402 Sender Nonce Desync (PENDING DIAGNOSIS)

**Symptom:** Task #785 (signal rejection notification) failed with SENDER_NONCE_STALE at nonce 45. After force-syncing nonce-manager and retrying 3 times, relay continues rejecting nonce 45 as stale.

**State at failure:**
- nonce-manager: `lastExecutedNonce: 44`, `nextNonce: 46`, `mempoolPending: 0`
- relay-diagnostic: healthy, no circuit breaker issues, sponsor nonce 1196
- x402 sender: SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM
- Errors: 3x SENDER_NONCE_STALE (409) with "nonce is stale (below current account nonce)"

**Root cause (hypothesis):** Nonce 45 was either executed and confirmed on-chain without nonce-manager being updated, OR a transaction is stuck at nonce 45 blocking the sequence. Hiro API queries failed (404/null), preventing direct state verification.

**Follow-up:** Task #814 queued for detailed nonce recovery diagnosis (P3, relay-diagnostic + nonce-manager skills).

## 2026-03-27 20:05Z–20:32Z+: x402 Relay Circuit Breaker — Wave 2 (ONGOING, RELAY UNREACHABLE)

**Duration:** 20:05Z–20:32Z+ (27+ minutes and counting)
**Tasks affected:** #802 (inbox-notify), #800+, #830 (signal rejection notify)
**Escalation:** Task #823 (P1) created at 20:15Z

**Symptom:** x402 sends fail with SENDER_NONCE_STALE (409). By 20:32Z, relay became completely unreachable — health check returns "The operation was aborted." Circuit breaker reopened after ~25 min of successful sends post-wave-1.

**Relay state at 20:15Z:**
- circuitBreakerOpen: true
- effectiveCapacity: 1 (critical)
- lastConflictAt: 2026-03-27T20:10:58.308Z
- poolStatus: critical
- poolAvailable: 20, poolReserved: 0

**Relay state at 20:32Z:**
- reachable: false
- error: "The operation was aborted."
- Health check cannot reach relay endpoint

**Sponsor state (last known 20:32Z):**
- lastExecutedNonce: 1195
- possibleNextNonce: 1196
- mempoolCount: 0 (clean on sponsor side)

**Root cause (preliminary):** Circuit breaker reopened, indicating either mempool saturation has returned OR a batch of sponsor nonces failed validation on the relay. The sender nonce 48 rejection despite clean sponsor state suggests either:
1. Our account's on-chain nonce drifted ahead of 48 during wave 1 recovery
2. Nonce 48 was executed without nonce-manager being notified
3. A transaction at nonce 48 is stuck blocking the sequence
4. Relay service became unreachable (possible crash or network partition)

**Action:** Escalated to operator (task #823). Do NOT attempt automated sends. Task #830 blocked at 20:32Z pending relay recovery.
- Relay circuit breaker must clear AND effectiveCapacity > 50
- Relay must become reachable again
- Sender nonce gap resolved (either recover nonce 48-47 or identify which is the actual current nonce on-chain)

**Status at 2026-03-27T21:24Z:** Relay reachable again, but circuit breaker still open (circuitBreakerOpen=true, poolStatus=critical, effectiveCapacity=1, lastConflictAt=21:20:03Z). Task #858 (signal rejection notification) blocked on relay recovery. Do not retry inbox-notify tasks until circuitBreakerOpen→false AND poolStatus→normal.

## 2026-03-27 22:11Z: x402 Sender Nonce Cache Still Stale Post-Wave-2 (ONGOING)

**Symptom:** Task #862 (inbox-notify send-one for signal rejection) acquired nonce 50, but relay rejected it as SENDER_NONCE_STALE (409) on all 3 retry attempts at 22:11:10Z, 22:11:16Z, 22:11:22Z.

**Timeline:**
- 22:11:03Z: nonce-manager acquired nonce 49 from Hiro (source: hiro)
- 22:11:09Z: nonce-manager acquired nonce 50 from local state
- 22:11:10–22:11:22Z: All three attempts rejected with "nonce is stale (below current account nonce)"

**Relay reachability:** Reachable (error is validation, not connection).

**Root cause:** Relay's sender nonce cache is desynchronized from on-chain state. Post-circuit-breaker-wave recovery, relay became reachable but its cached view of SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM's account nonce drifted ahead of both nonce-manager and actual Hiro state.

**Action:** Task #862 blocked. Relay nonce cache requires three-way verification and reset by infrastructure team:
1. Query on-chain nonce directly from Stacks chain (not Hiro, which is load-balanced)
2. Identify which nonce (47, 48, 49, 50) is actually current
3. Recover any stuck transactions or reset relay cache
4. Confirm nonce-manager sync post-recovery before resuming sends

**Do NOT retry signal rejection tasks until relay nonce cache is verified clean.**

## 2026-03-27 22:56Z: x402 Relay Circuit Breaker Still Open — Wave-2 Ongoing (BLOCKING SENDS)

**Symptom:** Task #875 (ERC-8004 nudge, inbox-notify) blocked due to relay circuit breaker still open. Health check at 22:56:22Z shows:
- circuitBreakerOpen: **true**
- effectiveCapacity: **1** (critical)
- poolStatus: **critical**
- lastConflictAt: **2026-03-27T22:53:18.330Z** (3 minutes old)

**Duration since wave-2 start:** 52+ minutes (20:05Z → 22:56Z)

**Current blocked tasks:** #875 (queued, blocked before send), #862 (blocked at 22:11Z), likely others

**Assessment:** Circuit breaker has been stuck open for 52+ minutes despite relay being reachable. Recent conflict 3 minutes ago suggests either:
1. Underlying nonce desync not yet resolved
2. Circuit breaker in prolonged cooldown cycle
3. New conflicts still regenerating

**Action:** Task #875 blocked and marked for retry pending relay recovery. Follow-up task #876 created to retry nudge once relay clears.

**Do not send x402 messages while circuitBreakerOpen=true and lastConflictAt < 15 minutes ago.**

## 2026-03-27 23:09Z: x402 Relay Circuit Breaker Still Generating Fresh Conflicts (ONGOING, BULK-BLOCK)

**Current status (23:09:27Z):**
- circuitBreakerOpen: **true**
- effectiveCapacity: **0.95** (marginal improvement from 0.01)
- poolStatus: **critical**
- lastConflictAt: **2026-03-27T23:09:10.443Z** (17 seconds old at check time)

**Duration:** 180+ minutes since wave-2 start (20:05Z → 23:09Z)

**Action taken:** Task #889 (inbox-notify signal rejection) bulk-blocked upfront rather than attempted. Follow-up task #895 created for retry once CB clears. Reasoning:
1. lastConflictAt is only 17 seconds old — well within "do not send" threshold (<15 min rule)
2. CB is unstable and still regenerating conflicts
3. Attempting send now = guaranteed failure + retry cascade (pattern from tasks #862, #875)
4. Better to block proactively and retry once effectiveCapacity >50 AND circuitBreakerOpen→false

**Assessment:** Relay circuit breaker has been stuck open for **3 hours** despite being reachable. This exceeds the 60-minute escalation threshold (`circuit-breaker-60min-escalation` pattern). If relay remains unstable at next dispatch, escalate to human operator for infrastructure intervention.
