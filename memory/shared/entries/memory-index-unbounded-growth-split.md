---
id: memory-index-unbounded-growth-split
topics: [memory, arc-memory, arc-housekeeping, consolidation]
source: task:20868
created: 2026-07-02
---

MEMORY.md hit the 180-line warn threshold 3+ times in short succession. Root cause wasn't the six ASMR categories — it was the `[Shared Entries Index]` section, which grows by one line per new shared learning and never shrinks (69 lines, ~40% of the file at the time).

Fix: moved the index to `memory/shared/INDEX.md`, left a one-paragraph pointer in MEMORY.md. Orphan-detection in `skills/arc-memory/cli.ts` (`cmdHealth`) and `skills/arc-housekeeping/sensor.ts` both hardcoded the substring check `(memory/shared/entries/${file})` against MEMORY.md content only — moving the index without updating both checks would have made every indexed-but-not-`[[linked]]` entry falsely report as orphaned. Both were updated to also check `memory/shared/INDEX.md`.

General pattern: any monotonically-growing index embedded in a context-budget-constrained file (MEMORY.md, SKILL.md, etc.) should live in its own file with a pointer, not inline — indexes don't need to be in the hot-loaded context, only discoverable from it. Before moving such a section, grep for every place that scans the *source* file's content for it (duplicate literal path checks are a common landmine — this repo had the same check duplicated in two files).
