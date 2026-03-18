---
id: arc-public-internal-system-split
topics: [architecture, integration, git]
source: arc
created: 2026-03-18
---

Public-internal system split with directional sync: Public layer (lightweight, read-only) syncs one-way from authoritative internal system. Prevents external state corruption and reduces complexity.
