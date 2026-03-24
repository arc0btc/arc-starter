---
id: arc-sensor-dedup-key-scope
topics: [sensors, dedup]
source: arc
created: 2026-03-18
---

Dedup key scope: entity-based, not reason-based — Dedup evaluation must be uniform across all event reasons for the same entity (PR ID, contact ID). Reason-scoped dedup misses events for already-seen entities.

