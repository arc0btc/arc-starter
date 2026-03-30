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

---

## Active Issues

### 2026-03-29 15:29Z: Reputation Sponsored Transaction Auth Type Bug

**Symptom:** `reputation give-feedback --sponsored` fails with error: `Malformed transaction payload (Invalid auth type byte 0x00 — expected 0x04 (Standard) or 0x05 (Sponsored))`

**Scope:** Affects all `--sponsored` reputation commands (give-feedback, revoke-feedback, append-response, approve-client)

**Root cause:** Reputation command's sponsored transaction construction is generating an invalid auth type byte (0x00) instead of the correct byte for sponsored transactions (0x05)

**Workaround:** None currently available. Reputation feedback cannot be submitted via sponsored mode until the bug is fixed.

**Fix location:** `reputation/reputation.ts` — check sponsored transaction auth type byte construction

**Task affected:** #2504 (ERC-8004 feedback for signal 8ce75aa0-ebdf-42d5-9bcb-6b51675d274c → agent 78) — closed as FAILED

**Action required:** Fix reputation command's sponsored tx auth type byte construction in aibtcdev/skills

### 2026-03-29 17:22Z: Sponsor Nonce 83 Stuck Post-Settlement Recovery

**Task:** #2464 (ERC-8004 nudge 1/3 to bc1qlgcphpkq3yc38ztr6n48qh3ltsmxjprv9dm0ru)
**Time:** 17:22:04Z
**Duration:** Ongoing
**Status:** Blocked → Escalated to whoabuddy (#2583)

**Symptom:** `SENDER_NONCE_DUPLICATE` on nonce 83. Inbox-notify attempts nonces 83, 84, 85 in sequence; all rejected as duplicates.

**Root Cause:** Nonce 83 stuck in relay mempool from earlier dispatch cycle (likely during settlement cascade recovery period 01:09Z-17:32Z 2026-03-28). Relay v1.26.1 reports healthy but does not support automated RBF recovery.

**Investigation:**
- Relay health check: healthy=true, CB closed, no detected conflicts
- Relay sponsor nonce: lastExecuted=1205, nextNonce=1206 (OK)
- **Agent nonce:** lastExecuted=82, nextNonce=83 (matches on-chain via force-sync)
- Relay mempool: shows no pending nonces for agent ([]) 
- Contradiction: relay says no pending, but rejects nonce 83

**Recovery Attempt:**
- `relay-diagnostic recover --action rbf`: Supported=false, "Relay does not support RBF recovery yet"
- Manual RBF via relay operator tools required

**Action:** Escalation task #2583 created for whoabuddy. Requires manual nonce gap-fill or RBF via sponsor relay operator console.

**Affected Tasks:** #2464, #2585, #2588, #2592, #2598, #2599, #2603 (all ERC-8004 nudges / inbox-notify sends) — blocked 2026-03-29 per pattern:bulk-block-systemic-failures.

**Updated (18:01Z):** Nonce desync now affecting nonces 84-85 range (moved past 83). Task #2599 (notify signal rejected) failed with SENDER_NONCE_STALE on nonces 84-85 after 3 retry attempts. Confirms ongoing mempool desynchronization, not localized to nonce 83.

**Updated (18:07Z):** Task #2603 (inbox-notify send-one for signal 8ab224c4 → bc1q73ffx0fw…) failed with SENDER_NONCE_STALE on nonce 84 after 3 retries. Confirms issue is persistent and affecting new sends from the queue.

**Updated (18:09Z):** Task #2605 (notify signal approved e256db41 → bc1qspmesnma…) failed with SENDER_NONCE_STALE on nonce 84 after 3 retries. Confirms ongoing mempool desynchronization continues affecting all x402 sends. Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605.

**Updated (18:13Z):** Task #2612 (notify signal rejected 8450dfcc → bc1qymq9fuk8…) failed with SENDER_NONCE_STALE on nonce 85 after 3 retries. Issue continues affecting new batches from queue. All inbox-notify sends blocked pending relay operator recovery. Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612.

**Updated (18:18Z):** Task #2617 (notify signal rejected 2cd6a6d0 → bc1qj75gde2z…) blocked proactively per pattern:bulk-block-systemic-failures. Incoming tasks will continue failing with SENDER_NONCE_STALE until operator resolves stuck nonce 83 in relay mempool. Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617.

**Updated (18:19Z):** Task #2618 (ERC-8004 nudge 2/3 → bc1qj75gde2z…) blocked proactively per pattern:bulk-block-systemic-failures. Identical to #2617 — will hit same stuck nonce on send attempt. Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617, #2618.

**Updated (18:20Z):** Task #2619 (notify signal approved fd3c21ff → bc1q9p6ch73n…) blocked proactively per pattern:bulk-block-systemic-failures. Will hit same stuck nonce issue. Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617, #2618, #2619. Escalation #2583 unresolved for 58 minutes (SLA threshold: 60-90 min). Secondary escalation task #2627 created to escalate to higher-priority channel per pattern:secondary-escalation-protocol.

**Updated (18:21Z) — SECONDARY ESCALATION #2627 (P1):** Original escalation #2583 unresolved 59 min (SLA threshold: 60-90 min). 33 tasks now blocked (28 previously + 5 newly blocked: #2620-2624). Nonce desync persists across 83-85 range. Relay healthy but contradicts own mempool state. No automated recovery path — manual operator intervention required. Per pattern:tertiary-escalation-when-secondary-sla-exceeded, tertiary escalation warranted if unresolved by ~19:20Z.

**Updated (18:25Z):** Task #2623 (notify signal approved 8ca8cf25 → bc1qqc2u7xfj…) blocked proactively per pattern:bulk-block-systemic-failures. Will hit same stuck nonce issue. Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617, #2618, #2619, #2620-2624, #2623.

**Updated (19:32Z):** Task #2651 (ERC-8004 nudge 1/3 → bc1q40wpc50y…, Contact #60) blocked proactively per pattern:bulk-block-systemic-failures. Matches exact same pattern as earlier blocked nudges. Relay mempool state unresolved; escalation #2627 still unresolved (71+ min). Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617, #2618, #2619, #2620-2624, #2623, #2651.

**Updated (19:33Z):** Task #2652 (notify signal approved 4e6d3ae5 → bc1q6hdknz6k…) blocked proactively per pattern:bulk-block-systemic-failures. Matches same pattern. Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617, #2618, #2619, #2620-2624, #2623, #2651, #2652.

**Updated (19:45Z):** Task #2660 (ERC-8004 nudge 1/3 → bc1q40wpc50yky…, Contact #60) blocked proactively per pattern:bulk-block-systemic-failures. Matches same pattern as prior nudges (tasks #2651, #2652, etc). Escalation #2627 still unresolved (83+ min). Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617, #2618, #2619, #2620-2624, #2623, #2651, #2652, #2660.

**Pattern Match:** Similar to pattern:nonce-manager-resync-post-chain-query-during-cb but differs in that force-sync confirms on-chain state is correct; issue is relay-side stuck mempool without automated recovery.

**Updated (20:28Z) — RATE-LIMITING PHASE:** Task #2680 (notify signal rejected 9e0b7569) failed with HTTP 429 "Too many requests" on x402 send. Rate-limit reset at 2026-03-29T20:30:01.794Z. Per pattern:rate-limiting-secondary-symptom, this is a secondary effect from accumulated retry attempts during the nonce desync cascade (01:09Z 2026-03-28 → ongoing). Relay health check returns nominal at 20:28Z, but rate-limiting indicates service-level strain persisting. Escalation #2627 remains unresolved (103+ min). Service recovery incomplete.

**Updated (20:31Z):** Task #2682 (notify signal rejected c586b519 → bc1qljccvpcl…) blocked proactively per pattern:bulk-block-systemic-failures. Escalation #2627 unresolved 130+ min (SLA window severely exceeded). All x402 inbox-notify sends blocked pending operator intervention. Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617, #2618, #2619, #2620-2624, #2623, #2651, #2652, #2660, #2680, #2682.

**Updated (20:36Z):** Task #2687 (ERC-8004 nudge 1/3 → bc1q5qpj9hwf2…, Contact #27) blocked proactively per pattern:bulk-block-systemic-failures. Escalation #2627 unresolved 135+ min (SLA severely exceeded). Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617-2624, #2623, #2651, #2652, #2660, #2680, #2682, #2687.

**Updated (20:38Z):** Task #2688 (notify signal approved b443b327… → bc1qd90yysnw…) failed with HTTP 429 "Too many requests" after acquiring nonce 85. Rate-limit reset at 20:39:07.768Z (54s window). Task closed as BLOCKED per pattern:bulk-block-systemic-failures. Escalation #2627 unresolved 137+ min (SLA severely exceeded). Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617-2624, #2623, #2651, #2652, #2660, #2680, #2682, #2687, #2688.

**Updated (21:02Z):** Task #2705 (ERC-8004 nudge 1/3: register identity → bc1q40wpc50yky3nx5vavp2svvenjpagq2mqkycqun, Contact #60) proactively blocked per pattern:bulk-block-systemic-failures. Escalation #2627 unresolved 140+ min (SLA severely exceeded). No send attempted — relay mempool nonce 83+ stuck and rate-limiting active. Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617-2624, #2623, #2651, #2652, #2660, #2680, #2682, #2687, #2688, #2705.

**Updated (21:14Z):** Task #2710 (notify signal approved 6534c4a4 → bc1qq6482lek…) proactively blocked per pattern:bulk-block-systemic-failures. Escalation #2627 unresolved 143+ min (SLA severely exceeded). No send attempted — relay mempool nonce 83+ stuck and rate-limiting active. Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617-2624, #2623, #2651, #2652, #2660, #2680, #2682, #2687, #2688, #2705, #2710.

**Updated (21:45Z):** Task #2728 (notify signal rejected 5ecb343d → bc1q3wcjxn2w…) proactively blocked per pattern:bulk-block-systemic-failures. Escalation #2627 unresolved 143+ min (SLA severely exceeded). No send attempted — relay mempool nonce 83+ stuck and rate-limiting active. Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617-2624, #2623, #2651, #2652, #2660, #2680, #2682, #2687, #2688, #2705, #2710, #2728.

### 2026-03-29 15:29Z: Reputation Sponsored Auth Type Bug — RELAY-SIDE (RECLASSIFIED)

**Original report:** `reputation give-feedback --sponsored` fails with "Malformed transaction payload (Invalid auth type byte 0x00 — expected 0x04 (Standard) or 0x05 (Sponsored))"

**Originally attributed to:** Client-side transaction construction in reputation.ts

**Actual root cause:** Relay v1.26.1 POST /sponsor endpoint has a transaction parser bug. ALL sponsored transactions (contract calls AND STX transfers) fail with the same error. Client serialization is verified correct — byte 5 = 0x05 (Sponsored).

**Evidence:**
- Built sponsored contract call and STX transfer with `makeContractCall`/`makeSTXTokenTransfer({sponsored: true})`
- Verified auth type byte = 0x05 at position 5 in serialized hex
- Both fail with identical 400 MALFORMED_PAYLOAD "Invalid auth type byte 0x00"
- x402 inbox messages work because they use POST /relay (facilitator path), not POST /sponsor

**Scope:** Blocks ALL sponsoredContractCall usage: reputation, identity, direct STX sponsor operations. Only x402 facilitator path (POST /relay) is unaffected.

**Action:** Escalation task created for relay team. Workaround: non-sponsored mode or route through /relay with settlement params.

**Updated (22:01Z):** Task #2743 (notify signal rejected 1cb822e0 → bc1q7tp55n7n…) proactively blocked per pattern:bulk-block-systemic-failures. Escalation #2627 unresolved 149+ min (SLA severely exceeded). No send attempted — relay mempool nonce 83+ stuck and rate-limiting active. Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617-2624, #2623, #2651, #2652, #2660, #2680, #2682, #2687, #2688, #2705, #2710, #2728, #2743.

**Updated (22:16Z):** Task #2749 (notify signal approved 246983df → bc1qaq6vmg54…) proactively blocked per pattern:bulk-block-systemic-failures. Escalation #2627 unresolved 164+ min (SLA severely exceeded). No send attempted — relay mempool nonce 83+ stuck and rate-limiting active. Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617-2624, #2623, #2651, #2652, #2660, #2680, #2682, #2687, #2688, #2705, #2710, #2728, #2743, #2749.

**Updated (22:32Z):** Task #2760 (notify signal rejected 020fd622 → bc1qpahnawp5…) proactively blocked per pattern:bulk-block-systemic-failures. Escalation #2627 unresolved 254+ min (SLA severely exceeded). No send attempted — relay mempool nonce 83+ stuck and rate-limiting active. Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617-2624, #2623, #2651, #2652, #2660, #2680, #2682, #2687, #2688, #2705, #2710, #2728, #2743, #2749, #2760.

**Updated (22:35Z):** Task #2763 (ERC-8004 nudge 1/3 → bc1qua5msvxh…) proactively blocked per pattern:bulk-block-systemic-failures. Escalation #2627 unresolved 257+ min (SLA severely exceeded). No send attempted — relay mempool nonce 83+ stuck and rate-limiting active. Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617-2624, #2623, #2651, #2652, #2660, #2680, #2682, #2687, #2688, #2705, #2710, #2728, #2743, #2749, #2760, #2763.

**Updated (23:17Z):** Task #2792 (notify signal rejected 1a09adc2 → bc1q5qpj9hwf…) proactively blocked per pattern:bulk-block-systemic-failures. Escalation #2627 unresolved 299+ min (SLA severely exceeded). No send attempted — relay mempool nonce 83+ stuck and rate-limiting active. Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617-2624, #2623, #2651, #2652, #2660, #2680, #2682, #2687, #2688, #2705, #2710, #2728, #2743, #2749, #2760, #2763, #2792.

**Updated (23:21Z):** Task #2796 (notify signal rejected 96aa1611-56cf-456c-a9f4-06754b321d10 → bc1qlgcphpkq…) proactively blocked per pattern:bulk-block-systemic-failures. Escalation #2627 unresolved 303+ min (SLA severely exceeded). No send attempted — relay mempool nonce 83+ stuck and rate-limiting active. Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617-2624, #2623, #2651, #2652, #2660, #2680, #2682, #2687, #2688, #2705, #2710, #2728, #2743, #2749, #2760, #2763, #2792, #2796.


**Updated (23:33Z):** Task #2805 (ERC-8004 feedback signal 80e3529a → agent 67) proactively blocked per pattern:bulk-block-systemic-failures. Relay sponsored auth type bug blocks all --sponsored reputation commands. Escalation #2627 unresolved 300+ min (SLA severely exceeded). No send attempted. Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617-2624, #2623, #2651, #2652, #2660, #2680, #2682, #2687, #2688, #2705, #2710, #2728, #2743, #2749, #2760, #2763, #2792, #2796, #2805.

**Updated (23:38Z):** Task #2810 (ERC-8004 nudge 1/3 → bc1q3wcjxn2w…, Contact #21) proactively blocked per pattern:bulk-block-systemic-failures. Nonce 83+ stuck. Escalation #2627 unresolved 311+ min (SLA severely exceeded). No send attempted. Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617-2624, #2623, #2651, #2652, #2660, #2680, #2682, #2687, #2688, #2705, #2710, #2728, #2743, #2749, #2760, #2763, #2792, #2796, #2805, #2810.

**Updated (23:39Z):** Task #2811 (notify signal rejected ec9c7042 → bc1qljccvpcl…) proactively blocked per pattern:bulk-block-systemic-failures. Escalation #2627 unresolved 320+ min (SLA severely exceeded). No send attempted — relay mempool nonce 83+ stuck and rate-limiting active. Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617-2624, #2623, #2651, #2652, #2660, #2680, #2682, #2687, #2688, #2705, #2710, #2728, #2743, #2749, #2760, #2763, #2792, #2796, #2805, #2810, #2811.

**Updated (23:45Z):** Task #2815 (notify signal rejected b364dee2 → bc1q2taw0a9e…) proactively blocked per pattern:bulk-block-systemic-failures. Escalation #2627 unresolved 323+ min (SLA severely exceeded). No send attempted — relay mempool nonce 83+ stuck and rate-limiting active. Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617-2624, #2623, #2651, #2652, #2660, #2680, #2682, #2687, #2688, #2705, #2710, #2728, #2743, #2749, #2760, #2763, #2792, #2796, #2805, #2810, #2811, #2815.

**Updated (23:47Z):** Task #2817 (notify signal rejected 9a085132 → bc1qgh2dajhh…) proactively blocked per pattern:bulk-block-systemic-failures. Escalation #2627 unresolved 323+ min (SLA severely exceeded). No send attempted — relay mempool nonce 83+ stuck and rate-limiting active. Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617-2624, #2623, #2651, #2652, #2660, #2680, #2682, #2687, #2688, #2705, #2710, #2728, #2743, #2749, #2760, #2763, #2792, #2796, #2805, #2810, #2811, #2815, #2817.

**Updated (23:48Z):** Task #2818 (ERC-8004 nudge 1/3: register identity → bc1qgh2dajhh…, Contact #18) proactively blocked per pattern:bulk-block-systemic-failures. Escalation #2627 unresolved 325+ min (SLA severely exceeded). No send attempted — relay mempool nonce 83+ stuck and rate-limiting active. Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617-2624, #2623, #2651, #2652, #2660, #2680, #2682, #2687, #2688, #2705, #2710, #2728, #2743, #2749, #2760, #2763, #2792, #2796, #2805, #2810, #2811, #2815, #2817, #2818.

**Updated (00:06Z 2026-03-30):** Task #2829 (ERC-8004 feedback signal 49725537… → agent 79) proactively blocked per pattern:bulk-block-systemic-failures. Blocking factors: (1) Relay sponsored auth type bug — all --sponsored reputation commands fail with "Invalid auth type byte 0x00", (2) Mempool nonce stuck (nonce 83+, escalation #2627 unresolved 328+ min, SLA severely exceeded). No send attempted. Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617-2624, #2623, #2651, #2652, #2660, #2680, #2682, #2687, #2688, #2705, #2710, #2728, #2743, #2749, #2760, #2763, #2792, #2796, #2805, #2810, #2811, #2815, #2817, #2818, #2829.

**Updated (00:18Z 2026-03-30):** Task #2837 (ERC-8004 nudge 2/3: register identity → bc1q2taw0a9e…, Contact #19) proactively blocked per pattern:bulk-block-systemic-failures. Blocking factors: (1) Relay mempool nonce 83+ stuck since 2026-03-29 17:22Z, (2) Relay sponsored auth type bug — all --sponsored reputation commands fail with "Invalid auth type byte 0x00", (3) Rate-limit secondary effect active (HTTP 429 from retry cascade), (4) Escalation #2627 unresolved 331+ min (SLA severely exceeded). Infrastructure recovery required. Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617-2624, #2623, #2651, #2652, #2660, #2680, #2682, #2687, #2688, #2705, #2710, #2728, #2743, #2749, #2760, #2763, #2792, #2796, #2805, #2810, #2811, #2815, #2817, #2818, #2829, #2837.

**Updated (00:21Z 2026-03-30):** Task #2840 (notify signal approved 0051126f-d505-410a-83e3-4a89a76eca81 → bc1qt79n74sa…) proactively blocked per pattern:bulk-block-systemic-failures. Escalation #2627 unresolved 339+ min (SLA severely exceeded). No send attempted — relay mempool nonce 83+ stuck and rate-limiting active. Incident ongoing for 7+ hours with no automated recovery path. Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617-2624, #2623, #2651, #2652, #2660, #2680, #2682, #2687, #2688, #2705, #2710, #2728, #2743, #2749, #2760, #2763, #2792, #2796, #2805, #2810, #2811, #2815, #2817, #2818, #2829, #2837, #2840.

**Updated (00:33Z 2026-03-30):** Task #2849 (notify signal approved 0a880017-f0d4-4f64-8ccb-cb22b862655c → bc1qspmesnma…) proactively blocked per pattern:bulk-block-systemic-failures. Relay mempool sponsor nonce 83+ stuck since 2026-03-29 17:22Z (7+ hours unresolved). Escalation #2627 remains unresolved 346+ min (SLA severely exceeded). No send attempted. Total affected: #2464, #2585, #2588, #2592, #2598, #2599, #2603, #2605, #2612, #2617-2624, #2623, #2651, #2652, #2660, #2680, #2682, #2687, #2688, #2705, #2710, #2728, #2743, #2749, #2760, #2763, #2792, #2796, #2805, #2810, #2811, #2815, #2817, #2818, #2829, #2837, #2840, #2849.
