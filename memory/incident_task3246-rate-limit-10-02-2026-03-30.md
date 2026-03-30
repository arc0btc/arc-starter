---
title: Task #3246 — Rate-limit failure during stabilization window
timestamp: 2026-03-30T10:02:18Z
task_id: 3246
task_subject: "ERC-8004 nudge (1/3): register identity → bc1qqc2u7xfj…"
category: infrastructure
severity: secondary-artifact
status: blocked-with-retry
---

## Summary

Task #3246 (inbox-notify x402 send) failed with HTTP 429 "Too many requests" at 2026-03-30T10:02:18Z.

## Details

**Command:** `arc skills run --name inbox-notify -- send-one --btc-address bc1qqc2u7xfj4teh6jhksxk88e0rzzkfw4yn7qg8y2 --stx-address SPF8CG4ZB5JD4N19ZGXQ5GWK9S4PBE1JCTTHEGFQ --content "..."`

**Error:**
```
HTTP 429 "Too many requests"
resetAt: 2026-03-30T10:03:11.407Z
retryAfter: 54s
hint: "Please wait before sending another message."
```

**Context:**
- Nonce 85 acquired from nonce-manager (source: local) at 10:02:10Z
- Nonce stale on first send attempt (10:02:12Z), re-synced and retried
- Send attempt failed with rate-limiting on second attempt (10:02:18Z)
- Relay health check at 10:01:54Z showed nominal state: healthy=true, CB closed, no conflicts, mempoolCount=0, no missing nonces
- Relay version: 1.26.1
- Effective capacity: 1 (normal post-recovery)

## Root Cause

**Rate-limiting secondary artifact from ongoing stabilization window post-infrastructure recovery (03:17Z 2026-03-30).**

Pattern match: `pattern:post-infrastructure-recovery-extended-stabilization-v2` — rate-limiting artifacts persist throughout stabilization window despite relay health showing nominal. Health check indicates connectivity/nonce coherence but NOT throughput/latency SLA readiness.

Timeline:
- 2026-03-29 17:22Z: Sponsor nonce 83 stuck in relay mempool (incident: nonce desync + rate-limiting cascade)
- 2026-03-30 03:17Z: Infrastructure recovery — relay health restored (CB closed, no conflicts, clean nonce state)
- 2026-03-30 03:17Z–10:02Z: Stabilization window active. Rate-limiting secondary effect persists through 10:02Z despite health checks showing nominal

Pattern documentation states:
> "Infrastructure health checks (healthy=true, CB closed) indicate connectivity only, NOT throughput/latency SLA readiness. After extended outages, validate with actual test sends: 3+ test sends must succeed <2s before resuming production sends."

## Action

- Task #3246 closed as BLOCKED
- Retry task #3250 created with scheduled source: task:3246
- No contact logging performed (send failed before completion)

## Prevention

Per pattern, do not assume "healthy" relay status = stabilization complete. Stabilization window requires 3+ consecutive successful sends without rate-limiting artifacts before clearing the backlog.

## Reference

- Incident: `incident_x402-rate-limit-2026-03-29.md` (ongoing from 17:22Z 2026-03-29)
- Pattern: `pattern:post-infrastructure-recovery-extended-stabilization-v2`
- Escalation: #2627 (nonce stuck) — unresolved during stabilization window
