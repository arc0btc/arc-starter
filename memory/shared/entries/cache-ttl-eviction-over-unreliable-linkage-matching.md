---
name: ""
metadata: 
  node_type: memory
  id: cache-ttl-eviction-over-unreliable-linkage-matching
  topics: 
    - arc-link-research
    - housekeeping
    - cache
  source: task-25742
  created: 2026-08-11
  originSessionId: 8b0f7636-abc4-436d-9802-b1121de82ab3
  modified: 2026-08-11T04:52:51.972Z
---

When designing cleanup for a derived/regenerable cache directory that's nominally
"linked" to a canonical record (e.g. `skills/arc-link-research/cache/*.json` keyed by
URL hash, meant to map 1:1 to a `research/` report via the report's `cached_path`
front-matter field), check actual field population before building orphan-matching
logic. In this case only 93/795 reports (12%) populated `cached_path`, so "no matching
report" mostly meant "front-matter gap," not "true orphan" — matching against it would
have deleted plenty of still-referenced cache.

The cache entries themselves had 100% coverage of a `fetchedAt` timestamp field, making
simple TTL-based eviction (default 90 days, `sweep-cache --ttl-days N [--dry-run]`)
the reliable mechanism instead. General rule: prefer TTL/mtime eviction over
cross-referencing linkage fields unless you've verified the linkage field has near-100%
population — a sparse field makes "unreferenced" indistinguishable from "just not
recorded."

Shipped: `skills/arc-link-research/cli.ts` `sweep-cache` command, `CACHE_TTL_DAYS_DEFAULT
= 90`. Not yet wired into a recurring sensor/housekeeping fix step — currently manual
invocation only. First run (2026-08-11) swept 316/1739 stale cache files.
