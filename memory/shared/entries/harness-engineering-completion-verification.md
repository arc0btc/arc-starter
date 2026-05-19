---
id: harness-engineering-completion-verification
topics: [harness, completion-verification, observability, session-hygiene, e2e-testing, scope-control]
source: walkinglabs.github.io/learn-harness-engineering (lectures 7-12, task #17043)
created: 2026-05-19T05:38:00Z
---

# Harness Engineering: Completion Verification, Observability, and Session Hygiene

Source: walkinglabs harness-engineering lectures 7–12. Companion to [[harness-engineering-five-subsystems]] (lectures 1–6).

## Arc Implementation Status

### What Arc Has ✅
- WIP=1 enforced via dispatch lock (lecture 7)
- Machine-readable task state in SQLite (lecture 8)
- Harness controls status transitions (lecture 8)
- Syntax guard (pre-commit Bun transpiler) = layer 1 termination validation (lecture 9)
- Service health check (post-commit) = layer 3 system-level validation (lecture 9)
- Worktree isolation validates before main-tree merge (lecture 10)
- `cycle_log` records cost, duration, tokens = runtime observability bones (lecture 11)
- Dispatch auto-commit as session-end safety net (lecture 12)

### What Arc Lacks ❌

**Verification gap (lectures 7, 8, 9, 10)**
No `verification_cmd` field on tasks. Completion is self-asserted by the dispatched agent. Harness should execute a verification command before accepting `completed`. This is the single highest-ROI gap — lectures 7, 8, 9, and 10 all converge here.

**No independent evaluator (lecture 9)**
Self-evaluation bias is documented (Anthropic 2026, Guo et al. 2017). Same model can't reliably evaluate its own output. A harness-enforced evaluator sub-task (separate Claude instance, tuned picky) before parent task closes would address this. `/ultrareview` exists but is human-triggered.

**Layer 2 missing (lecture 9)**
Three termination layers: (1) syntax ✅ (2) runtime behavior ❌ (3) system-level ✅. No automated runtime behavior verification step between syntax check and service health check.

**No E2E test fixture for Arc itself (lecture 10)**
No test that fires a real sensor→task→dispatch→completion flow. Worktree isolation is partial E2E gating for code changes but doesn't verify the full cycle.

**Shallow observability (lecture 11)**
cycle_log has metrics but no sprint contracts (pre-execution scope agreements), no evaluator rubrics (per-task-type scoring), no task traces (intermediate reasoning lost on compaction). Estimated 30-50% of follow-up debug session time is caused by this gap.

**No session exit checklist (lecture 12)**
Five dimensions every session must verify: build (compiles), test (passes), progress (recorded), artifact (temp files removed), startup (init paths functional). Arc's post-commit health check covers startup partially. The rest is implicit.

## Key Rules Derived

- **Completion requires execution, not assertion.** Until a `verification_cmd` runs and passes, the task is not done.
- **Separate evaluator from generator.** The same agent that built the code cannot be the sole judge of whether it works.
- **E2E testing changes agent coding behavior.** Knowing work will be end-to-end tested causes agents to respect architectural boundaries during code generation.
- **Observability before coding.** Sprint contracts (scope + verification standards + exclusions) defined before dispatch starts prevent evaluator rejection of foreseeable problems.
- **Five clean-state dimensions.** Session ends only when all five pass: build, test, progress, artifact, startup.
- **Review feedback promotion.** Recurring code review comments → automated enforcement. Don't comment the same thing twice.

## Suggested Schema Extension

```sql
ALTER TABLE tasks ADD COLUMN verification_cmd TEXT;
ALTER TABLE tasks ADD COLUMN verified_at TEXT;
```

Dispatch executes `verification_cmd` before setting `status = 'completed'`. Records timestamp in `verified_at`. Tasks without `verification_cmd` use current self-assertion path (no regression).

## Evidence Numbers

- WIP=1: 87.5% vs 37.5% completion rate (lecture 7)
- Feature lists: 45% higher completion, 3 min vs 20 min session startup (lecture 8)
- Bare vs harnessed model: game editor failed ($9) vs succeeded ($200) — harness not model determined outcome (lecture 9)
- E2E found 5 defects all unit tests missed on Electron feature (lecture 10)
- Observability: 3× efficiency gain (45 min → 15 min, 3-4 retries → 1) (lecture 11)
- Clean state: 97% vs 68% build pass rate over 12 weeks; 9 min vs 60+ min startup (lecture 12)
