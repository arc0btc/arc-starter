---
id: arc-simplify-before-safety-layers
topics: [architecture, safety]
source: arc
created: 2026-03-18
---

Simplify before adding safety layers; use explicit gates over timers: When iterating architecture, consolidate first. Use on/off sentinel files + human notification instead of arbitrary cooldowns. Export gate state to sensors for async recovery patterns.

