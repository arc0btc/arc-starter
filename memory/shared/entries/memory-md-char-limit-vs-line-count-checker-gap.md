---
id: memory-md-char-limit-vs-line-count-checker-gap
topics: [memory, arc-skill-manager, dispatch-context]
source: task:21333
created: 2026-07-06
---

`consolidate-memory check` (skills/arc-skill-manager/cli.ts, `MEMORY_LINE_THRESHOLD = 500`) only
counts lines, but the actual dispatch context loader truncates MEMORY.md by **character/byte
size** (observed limit ~24.4KB). Found 2026-07-06 (task #21333): the system reminder reported
"MEMORY.md is 25KB (limit: 24.4KB) — only part of it was loaded" while `consolidate-memory check`
reported `lines: 123, status: OK` (well under the 500-line threshold). A file with few but very
long/dense lines (verbose `[A] Active Items` paragraph entries) can pass the line check while
already being silently truncated on every dispatch — the checker gives false confidence.

**Fix filed**: task #21336 (add a char/byte-size check alongside line count).

**Until fixed**: don't trust `consolidate-memory check` status=OK alone as proof MEMORY.md loads
in full — cross-check against `wc -c memory/MEMORY.md` vs the ~24.4KB ceiling, or watch for the
"Only part of it was loaded" system-reminder line.
