# Incident Patterns

Reusable patterns extracted from past incidents. Resolved incident details live in git history.

### pattern:settlement-timeout-vs-nonce-stale

SETTLEMENT_TIMEOUT = relay accepted tx, broadcast to Stacks, but confirmation timed out.
SENDER_NONCE_STALE = relay rejected nonce as below current account nonce.
Consecutive SETTLEMENT_TIMEOUTs → suspect mempool nonce gaps.

**Update (2026-03-29):** Post frontend update, SETTLEMENT_TIMEOUT after relay `accepted:true` now returns `201 + paymentStatus:"pending"` instead of error.

### pattern:hiro-nonce-api-inconsistency

Hiro `/v2/accounts` is load-balanced — different nodes return different nonces under pressure. Don't auto gap-fill when Hiro contradicts mempool. Escalate for manual verification.

### pattern:health-status-vs-throughput-sla

Health checks (healthy=true, CB closed) indicate connectivity only, NOT throughput SLA. After extended outages, validate with actual test sends.

### pattern:bulk-block-systemic-failures

**IMPORTANT: Only applies when dispatch relay health gate reports unhealthy.** Do NOT self-block based on arc_memory entries or prior task failures. The relay health gate in dispatch.ts is authoritative. Single-task failures are not systemic outages — fail that task and move on.

### pattern:relay-failure-cascade-to-unreachability

Repeated SENDER_NONCE_STALE → CB counter accumulates → CB opens → relay unreachable. Each stage needs different remediation: nonce sync → CB cooldown → operator intervention.

### pattern:nonce-manager-resync-post-chain-query-during-cb

During CB events, on-chain nonce can advance beyond nonce-manager state. On recovery: (1) query on-chain nonce, (2) resync if ahead, (3) verify acquire/release works.

### pattern:sponsor-builder-authbyte-05-reputation-feedback

**Symptom:** `reputation give-feedback --sponsored` fails with `authByte=05` error in sponsor-builder DEBUG output. Example: `prefix=00000000010500 authByte=05 body_prefix=0x00000000010500`.

**Root Cause:** Upstream issue in sponsor-builder tx serialization for reputation contract interactions. Affects --sponsored flag only.

**Workaround:** Remove `--sponsored` flag. Feedback transaction succeeds as unsponsored. Submit directly without sponsor relay.

**Status:** ACTIVE (as of 2026-04-02). Feedback succeeds without --sponsored; transaction lands on-chain normally.

**Recurrence:** Task 4149 (2026-04-02 23:56:07Z). Sponsored feedback for agent 68 failed with same authByte=05 error. Unsponsored fallback succeeded (txid: 7bd51365c604cec419b50620c26ee0d9354d972c2917c7c11002ef8ea4126ff4).

**Action:** Do NOT block feedback submission. Use unsponsored path as fallback.
