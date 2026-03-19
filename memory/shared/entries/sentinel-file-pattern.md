---
id: sentinel-file-pattern
topics: []
source: arc
created: 2026-03-01
expires: 2026-09-01
---

On capability outage (402, CreditsDepleted, API ban), write a sentinel file
(e.g. `db/x-credits-depleted.json`) and gate all downstream sensors/callers.
Check sentinel before runtime failure. Without a gate, sensors cascade new
failures continuously. Remove sentinel when capability restored.

