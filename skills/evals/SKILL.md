---
name: evals
description: Dispatch quality evaluation — error analysis, LLM judges, calibration
updated: 2026-03-05
tags: [meta, evaluation, quality]
---

# Evals

Evaluate Arc's dispatch quality using structured error analysis, LLM-as-judge evaluators, and statistical calibration. Adapted from [hamelsmu/evals-skills](https://github.com/hamelsmu/evals-skills) methodology.

## Methodology

1. **Error analysis first.** Read completed/failed task traces, categorize failure modes, compute rates. Don't brainstorm categories — observe them.
2. **Fix obvious bugs before building judges.** If a failure mode has a code fix, fix it. Reserve judges for subjective or recurring failures.
3. **Binary pass/fail judges.** One judge per failure mode. No Likert scales. Structured output with critique before verdict.
4. **Calibrate against human labels.** Measure TPR/TNR on held-out test set. Target >90% for both. Apply Rogan-Gladen bias correction on production data.

## CLI

```
arc skills run --name evals -- error-analysis [--limit N] [--status STATUS]
arc skills run --name evals -- summary
arc skills run --name evals -- label --task-id N --pass|--fail [--category CAT] [--notes TEXT]
arc skills run --name evals -- labels [--category CAT]
arc skills run --name evals -- judge --task-id N --category CAT
arc skills run --name evals -- validate --category CAT
arc skills run --name evals -- help
```

## Data

- **Source:** `tasks` + `cycle_log` tables (existing)
- **Labels:** `eval_labels` table (created by this skill) — human binary labels per task per category
- **Judges:** `eval_judges` table — judge prompt definitions per failure category

## Failure Categories (discovered via error-analysis)

Categories are emergent — run `error-analysis` on real traces to discover them. Initial categories will be seeded from the first analysis pass.

## When to Load

Load when: running a scheduled quality review of dispatch performance, building or calibrating LLM judges for specific failure categories, or investigating dispatch quality regressions. Do NOT load for individual task execution — evals are meta-level work.

## Checklist

- [ ] Run error-analysis on 100+ completed/failed tasks
- [ ] Identify 5-10 distinct failure categories
- [ ] Label 40+ tasks per category (balanced pass/fail)
- [ ] Build and validate judges for top 3 failure modes
- [ ] Achieve TPR >90%, TNR >90% on test set
