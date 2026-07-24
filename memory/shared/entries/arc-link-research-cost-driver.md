---
id: arc-link-research-cost-driver
topics: [cost, candidate-maturation, arc-link-research, dedup, sensors, model-routing, token-volume]
source: "#22514, #22517, #22520, #22690, #22699, #22847, #22848, #22857"
created: 2026-07-16
---

# arc-link-research cost driver: per-candidate task filing, not per-tweet

## Problem (identified 2026-07-14, #22514)

`candidate-maturation` sensor was filing one `arc-link-research` task per matured
candidate story. A single viral story maturing through many sibling tweet IDs (or many
unrelated low-signal stories maturing in the same run) produced dozens to ~170
near-identical research tasks/day, at ~$0.4-1 each — pushing daily cost past the D4 $200/day
cap on 2026-07-14 (#22514: $202.44/day, 170/282 tasks from this one sensor).

## Fix (2026-07-13 17:38 UTC, commit 414ce89a, #22469)

Two-part dedup in `skills/candidate-maturation/sensor.ts`:
1. Incident-level key (normalized `discovery_context`) — skip filing if an equivalent
   incident already matured a task within 24h; mark siblings matured against the existing
   task instead of filing a new one.
2. Batching — instead of one task per candidate, the sensor now emits a single
   "Triage: X research batch (`<date>`, N stories from M candidates)" task per run,
   with M observed up to 710 candidates collapsed into 1 task (#22828).

## Measured impact (verified 2026-07-16, #22847)

Matched 24h windows around the deploy timestamp, filtered to
`source LIKE 'sensor:candidate-maturation%'`:

| Window | Tasks | Cost |
|---|---|---|
| Pre-deploy (07-12 17:38 → 07-13 17:38) | 169 | $102.68 |
| Post-deploy day1 (mixed, deploy mid-window) | 26 | $12.85 |
| Post-deploy day2 (first full clean day) | 2 | $2.17 |
| Post-deploy day3 (partial) | 1 | $3.05 |

**~98-99% reduction in both task volume and cost**, sustained across two post-deploy days —
not a one-day fluke. Sensor health confirmed nominal throughout (no failures suppressing
volume artificially).

## How to apply

- When a sensor's cost driver is "N tasks/day at $X each," check whether it's filing
  per-item instead of per-batch/per-incident before assuming the fix needs a rate cap or
  budget gate — batching at the source is often the bigger lever.
- To re-verify a sensor-side fix's cost impact, query `tasks` directly filtered by that
  sensor's `source` prefix (`sensor:<name>%`) across matched-hour 24h windows spanning the
  deploy timestamp — total daily cost/task-count aggregates mix in unrelated task types and
  hide the effect. No CLI command does this filtered date-range query yet (`arc tasks cost`
  only supports trailing N-day windows, no source filter); a short read-only `bun -e` query
  against `db/arc.sqlite` (readonly mode) is the pragmatic option until one exists.
- Don't defer a scheduled re-measurement past its threshold more than once — each deferral
  cycle (#22690, #22699) cost a dispatch cycle for zero new information. If the window
  hasn't elapsed, close the task with a concrete re-check date rather than leaving it pending
  for the sensor to re-surface.

## Per-task cost audit (2026-07-16, #22848) — volume was fixed, per-task cost wasn't

With batching resolved, per-leaf-task cost is the remaining lever. Findings from a direct
`db/arc.sqlite` query (readonly) over `subject LIKE 'Research:%' AND subject NOT LIKE 'Triage:%'`:

- **Opus routing is deliberate, not a bug**: 500/612 (82%) of leaf tasks run opus.
  `skills/candidate-maturation/sensor.ts` `chooseModel()` has a low per-dimension OR-gate
  (likes>=20 OR RTs>=5 OR replies>=8 → opus) and `src/research-brief.ts`'s triage brief
  explicitly tells the triage agent "never downgrade brainpower just to save tokens on real
  signal" — an explicit 2026-07-13 operator directive. **Don't propose flipping this** without
  sign-off; it's a stated quality tradeoff, not an oversight.
- **Model tier isn't actually the big cost lever it looks like.** `api_cost_usd` (token-rate
  estimate) shows a 4.4x gap between opus ($1.405 avg) and sonnet ($0.322 avg), but actual
  billed `cost_usd` — what Claude Code charges — is only ~9% apart ($0.648 vs $0.592 avg).
  Prompt caching + Claude Code's billing model flattens model-tier cost far more than raw
  per-token pricing math suggests. Don't use `api_cost_usd` alone to justify a model-routing
  change — check `cost_usd` (the actual bill) too.
- **The real driver is token volume, uniform across both models**: leaf tasks average
  ~400-425k input tokens each, while base context (SOUL.md+CLAUDE.md+MEMORY.md+SKILL.md) is
  only ~19k tokens combined. The gap is almost certainly `AGENT.md` Step 8's requirement to
  read BOTH `~/arc-starter` and `~/agent-runtime` for an "arc-alignment" grounding note on
  EVERY report, regardless of relevance score — applied even to low-relevance links. That
  step is marked "non-negotiable" in AGENT.md itself, so gating it to high-relevance reports
  needs sign-off too (filed as #22857), not a silent edit.
- **How to apply**: when a per-task cost investigation turns up a lever that's actually a
  standing operator directive or a doc-declared "non-negotiable," don't prototype past it —
  file a scoped decision task instead, even if the fix itself would be a one-line change.
  Check both `cost_usd` and `api_cost_usd`/`tokens_in` before concluding model tier is (or
  isn't) the driver — they can tell very different stories.
