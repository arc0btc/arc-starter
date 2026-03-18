---
id: arc-rate-limit-scheduled-for
topics: [tasks, routing, operations]
source: arc
created: 2026-03-18
---

Rate-limit retries MUST use --scheduled-for: Parse retry_after → expiry + 5min → schedule. Without it, dispatch hits the limit again immediately.
