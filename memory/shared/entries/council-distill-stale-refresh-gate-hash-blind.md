---
id: council-distill-stale-refresh-gate-hash-blind
topics: [council-distill, cost, sensor-design]
source: task#24583, 2026-07-31
created: 2026-07-31
---

`council-distill`'s freshness gate (`skills/council-distill/SKILL.md`) skips only when
`hash unchanged AND lastDistillAt < 7 days old`. Once `lastDistillAt` crosses 7 days, it queues a
full refresh task regardless of hash — so if the upstream fleet-digest never actually changes
(observed 2026-07-17 → 2026-07-31, 14 days, byte-identical file, same source timestamp inside the
digest), the sensor still spawns a sonnet dispatch every ~7 days that can only conclude "no new
content, skip" (task #24583). The 3 existing 2026-07-17 nuggets were still live and within the
90-day council TTL, so the correct action was a no-op close, not re-quoting identical source text
under a new timestamp.

**Not worth a standalone fix task** — this is a single low-frequency sensor (7d cadence), cost is
one no-op dispatch per stale week, and the gate's intent (re-check reachability/staleness
periodically) is reasonable. If a future cost audit needs a lever, the fix is cheap: skip the
7-day override when hash is unchanged, OR make the review step itself hash-check first and close
as a fast no-op before invoking the LLM (turns a sonnet dispatch into a near-zero-cost skip).

See [[arc-link-research-cost-driver]] for the pattern of "cheap mechanical pre-check before LLM
dispatch" applied elsewhere.
