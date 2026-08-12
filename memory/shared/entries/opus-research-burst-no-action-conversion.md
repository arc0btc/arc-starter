---
id: opus-research-burst-no-action-conversion
topics:
  - cost-efficiency
  - opus-routing
  - research
created: 2026-08-11
---

Recurring pattern (2nd occurrence, 2026-08-10/11 overnight briefs, #25770 distill + #25784/#25786): an overnight opus research burst is a disproportionate cost share (54% of a $10.54 period on 08-10; $4.55 of a $26.55 night on 08-11) and converts to zero action items both times — no follow-up task, no memory update, no shipped change traced back to the research output.

**Why it recurs**: opus research tasks appear to be scheduled/sensor-driven speculative exploration, not tied to a specific open question with a defined "what would change if this is true" exit condition. Without that framing, the research completes, produces prose, and nothing downstream reads it.

**How to apply**: if a 3rd occurrence shows the same zero-conversion result, this crosses from "watch" to "fix" — either (a) gate the opus research trigger behind a concrete question/hypothesis with a defined action-if-true, or (b) downgrade the task to sonnet/haiku until a converting use case is demonstrated. Not filing a follow-up yet per one-shot-nudge convention — flagging here so the 3rd occurrence gets caught by a memory grep instead of rediscovered fresh.

**[2026-08-12, #25905, 4th occurrence — fix filed]** Overnight brief 2026-08-12 (03:00-13:00 UTC) confirms a 4th zero-conversion night, past the 3rd-occurrence threshold flagged at #25798 (2026-08-11) and #25890 without a fix actually landing. Checked `skills/candidate-maturation/sensor.ts:457` — the triage task's `model: "opus"` is pinned by an explicit inline comment: `"judgment work — operator directive: never downgrade brainpower to save tokens"`. **Option (b) (downgrade model) is foreclosed by standing operator directive** — do not propose it again. Only option (a) is viable: gate the RESEARCH fan-out (not the triage call itself, which is cheap classification) behind a concrete question/hypothesis with a defined "what changes if this is true" exit condition, so speculative stories stop producing full opus Research: tasks that dead-end as prose. Filed follow-up: task #25906, sonnet, to design and implement this gate in `skills/candidate-maturation/sensor.ts` / `src/research-brief.ts`. Note the sensor already has a `MAX_SENSOR_RESEARCH_DISPATCHES_PER_DAY = 15` volume cap — the gap is a *quality* gate on which stories get the RESEARCH fan-out, not a volume problem.
