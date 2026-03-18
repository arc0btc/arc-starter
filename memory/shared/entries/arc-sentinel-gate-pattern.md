---
id: arc-sentinel-gate-pattern
topics: [sensors, safety, architecture]
source: arc
created: 2026-03-18
---

Capability outage → sentinel + gate all downstream sensors: On plan suspension, API exhaustion, or account ban, write a sentinel file (e.g., db/x-credits-depleted.json) and check it in every affected sensor. System-wide propagation prevents cascading failures and child-task explosion.
