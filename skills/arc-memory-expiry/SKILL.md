---
name: arc-memory-expiry
description: Daily cleanup of TTL-expired arc_memory entries
tags:
  - memory
  - maintenance
---

# arc-memory-expiry

Sensor that runs daily to clean up expired `arc_memory` FTS5 entries. Memories with a `ttl_days` value are automatically deleted once they exceed their TTL.

## Sensor

Runs every 1440 minutes (24 hours). Calls `expireArcMemories()` directly — no task creation needed unless entries were actually expired.

## When to Load

Load when investigating memory expiry behavior or debugging the arc_memory table.
