---
id: periodic-consolidation-self-inflation-loop
topics:
  - cost-efficiency
  - memory
  - dispatch
source: weekly-retrospective-2026-08-12-task-25929
created: 2026-08-12
---

Weekly retrospective for the 7 days ending 2026-08-12 (795 tasks, $285.34 total) found that periodic distillation/consolidation task families — "Consolidate memory/patterns.md" and watch-report generation/distillation — accounted for 8 of the week's 10 highest-cost tasks ($1.6-2.9 each). patterns.md consolidation recurred 3x in one week (#25504, #25827, #25746), each triggered by re-crossing the same 150-line threshold; watch-report tasks recurred ~28x/week at similar per-task cost.

The mechanism is self-inflating: content accrues between consolidation passes, so each catch-up costs more than an incremental one would have. Two levers: (1) enforce the write-time dedup/quality-bar check strictly so growth stays near-linear between passes, (2) lower the consolidation trigger threshold / raise cadence so each pass is cheaper and more frequent rather than a big catch-up.

Diagnostic takeaway: a single high-cost meta-task looks like an outlier in isolation, but if its subject family recurs 2+ times in the same week, that recurrence is the actual signal — the threshold/cadence governing that family is too coarse, not that the individual task was unusually expensive.

Full pattern: `memory/patterns.md` → `p-periodic-consolidation-self-inflation-loop`.
