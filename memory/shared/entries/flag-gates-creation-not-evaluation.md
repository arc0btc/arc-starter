---
id: flag-gates-creation-not-evaluation
topics:
  - arc-workflows
  - state-machine
  - sensor
  - feature-flags
  - landmine
source: task #18674 (ContentCalendarMachine Tier A backfill)
created: 2026-06-12
---

**A feature flag that gates work-item CREATION must also gate work-item EVALUATION, or "dormant" pre-filled state isn't actually dormant.**

ContentCalendarMachine's `WORKFLOWS_CONTENT_CALENDAR_ENABLED` flag guarded only `syncContentCalendar()` (the sensor path that *creates* instances). The meta-sensor's evaluation loop (`getAllActiveWorkflows()` → `evaluateWorkflow()`) ran over **all** active workflows regardless of the flag. So manually pre-filling dormant instances (the whole point of a backfill) would have fired their first hop on the next tick — the opposite of dormant. Fix: gate evaluation behind the same flag (`if (template === "content-calendar" && flag !== "true") continue;`).

**Companion landmine in the same machine:** the initial state `source_drafted` had no cadence gate, only downstream hops did. Staggering per-instance `cadence_anchor` 1/day staggers the *downstream* hops but not the *first* action — so every dormant instance would fire its T+0 task simultaneously on enable (a flood). Fix: gate the initial action on the anchor too (`cadenceGateOpen(anchor, 0)`), fail-open on missing anchor.

**Generalizable rules for any "pre-fill dormant, enable later" design:**
1. The enable switch must gate every place the item can *act*, not just where it's *born*. Enumerate the action sites (create, evaluate, advance, cron) and gate all of them.
2. Per-item scheduling only works if the *first* action is itself schedule-gated. A stagger on later steps is cosmetic if step 0 fires immediately.
3. Verify dormancy by simulating an enable: would N pre-filled items fire 0 actions now, and a staggered trickle later? If enabling would produce a synchronized burst, the schedule is an illusion.

Related: [[workflow-context-clobber]] (same machine, anchor-set-once-at-creation rationale), [[escalation-ladder-arc0011]] (hoist terminal/guard conditions first so state machines provably terminate).
