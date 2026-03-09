---
name: arc-dispatch-eval
description: Post-dispatch evaluation sensor — scores task outcomes and creates improvement tasks
updated: 2026-03-09
tags:
  - meta
  - quality
  - feedback-loop
---

# arc-dispatch-eval

Post-dispatch evaluation sensor that reviews recently completed tasks and scores them on three dimensions:

1. **Result quality** — Did `result_summary` indicate real success or hand-wave? Missing/generic summaries score low.
2. **Cost efficiency** — Was cost reasonable for the priority/model tier? Overspend flags waste.
3. **Convention adherence** — Correct model for priority tier? Cost recorded? Skills specified?

Low-scoring tasks generate improvement tasks that close the feedback loop.

## Scoring

Each dimension scores 0–2 (bad/ok/good). Total 0–6. Tasks scoring ≤2 get flagged.

### Result Quality (0–2)
- 0: No `result_summary`, or generic ("completed", "done", "ok")
- 1: Summary exists but short (<50 chars) or vague
- 2: Substantive summary (≥50 chars, not generic)

### Cost Efficiency (0–2)
- 0: Cost >2× the tier ceiling (P1-4: $1.00, P5-7: $0.50, P8+: $0.25)
- 1: Cost between 1–2× ceiling
- 2: Cost within ceiling

### Convention Adherence (0–2)
- 0: Model mismatch for priority AND missing skills
- 1: One minor issue (model mismatch or missing skills)
- 2: Model matches priority tier, skills present

## Sensor Behavior

- **Interval:** 120 minutes
- **Lookback:** 4 hours (overlaps slightly for coverage)
- **Dedup:** One improvement task per evaluation window (date+hour source key)
- **Threshold:** Only flags if ≥2 tasks score ≤2 in the window
- **Output:** Creates a P7 sonnet task listing flagged tasks with scores and recommendations

## When to Load

Load when: investigating task quality patterns, tuning dispatch evaluation thresholds, or reviewing improvement tasks created by this sensor.
