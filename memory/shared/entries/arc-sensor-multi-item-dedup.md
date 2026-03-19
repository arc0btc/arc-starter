---
id: arc-sensor-multi-item-dedup
topics: [sensors, dedup]
source: arc
created: 2026-03-18
---

Multi-item dedup: check against newest item — When checking if an action was taken on a batch (e.g., replies to sender), compare against Math.max(...timestamps), not oldest. Newer arrivals after an earlier reply get skipped otherwise.

