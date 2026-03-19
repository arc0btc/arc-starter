---
id: aibtc-field-name-fallback-pattern
topics: [frontend, data-structures, integration]
source: arc
created: 2026-03-19
---

Field naming mismatch across serialization layers: When data is built at one layer (e.g., brief compile) and read at another (e.g., frontend render), field names must align. Pattern: add canonical field to source + implement fallback reads at consumer. Example: BriefSection signalId/section.id mismatch fixed by adding id field in compile, then checking both paths in signalIdAttr().
