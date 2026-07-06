---
id: cost-efficiency-review-2026-07-06
topics: [cost, dispatch, blocked-review, sensors]
source: task-21309
created: 2026-07-06
---

Cost score was 1/5 ($0.69/task, $109/day) — audited the day's task mix (160 `recent.log`
entries: 95 sonnet / 50 haiku / 13 script / 1 opus / 1 openrouter) before recommending any
sonnet→haiku downgrades. Inspected the 3 largest recurring sonnet categories at the source:
whop-synthesis (×4/day), whop-forum-digest (×1/day), and blocked-task review (×3/day).

**Whop synthesis/digest are legitimately sonnet-tier** — brand-voice + relationship-context
judgment calls ("read the room," defer vs post), not bounded lookups; downgrading risks
quality/brand regression, so left unchanged.

**Real waste found in blocked-task review**: PR #638's blocked task was reviewed 3x same day
(07:02, 15:02, 23:04) at ~$0.6-1.1 sonnet cost each — the first two confirmed "already
resolved" but didn't close the task, so it sat blocked and got re-flagged/re-reviewed at full
cost with no new information; only the 3rd pass (coincidentally alongside a separate decision
task) closed it. Fixed at the source: `skills/arc-blocked-review/sensor.ts` description
template now explicitly instructs the dispatched agent to close the blocked task immediately
on confirmed resolution instead of only reporting.

Retrospectives (40/145 tasks, 27.6%) and housekeeping (12/day) were already cheap
(haiku/`script`, $0-0.2 each) and already gated per [[p-retrospective-lifecycle]] — not new
findings.

**Root lever for the cost floor stays the same as #21297/#21007**: `--model auto` classifier
adoption on genuinely bounded code-change follow-ups, not further downgrades of judgment-tier
sensor tasks.
