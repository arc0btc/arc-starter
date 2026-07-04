---
id: opus-overuse-bounded-fixes
topics:
  - cost-efficiency
  - model-routing
  - dispatch
source: task:21143
created: 2026-07-04
---

# Opus overuse on bounded single/dual-file fixes

Audit (2026-07-04, task #21143) triggered by 5th consecutive day of Cost Efficiency
scoring 1/5 in `arc-purpose-eval` (~$0.71/task, $90.97/128 cycles that day). Traced
$4.10 of same-day spend to 4 opus tasks: #21113 (anchor SITE_DIR to import.meta.dir,
2 known files), #21120 (add stub-exemption marker to validateSensorPattern, 1 file),
#21122 (exempt content-calendar from completion-rate flag, 1 file), #21136 (triage +
reply to a single email thread re: Whop authorization).

**Finding**: none of the 4 required opus-tier reasoning. Each had a clearly-stated
problem and 1-2 known target files/threads — the work was reading existing logic and
applying a bounded, well-scoped change or judgment call, not open-ended architectural
design across an ambiguous surface. #21136 (email judgment on auto-post authorization)
looked high-stakes but the actual task was reading one thread and confirming explicit
sign-off language — sonnet-capable comprehension, not opus-tier reasoning.

**Root cause**: CLAUDE.md had a `--model opus|sonnet` selection instruction ("choose
the right model for the work") but no criteria for *which* work warrants opus. Without
a rule, follow-up task creation defaulted to opus whenever a task looked
judgment-heavy, even when the judgment was narrow (1-2 files, explicit human sign-off
text to parse).

**Fix**: added explicit opus-vs-sonnet criteria to CLAUDE.md (see the "Priority and
model are independent" section) — default sonnet; opus only for genuine 3+ file/
subsystem architectural ambiguity, open-ended investigation with no target file, or
irreversible high-stakes judgment with no established pattern. Bounded fixes to known
files stay sonnet regardless of how much "understanding existing logic" they require.

**How to apply**: when creating a follow-up task, before typing `--model opus`, name
the specific architectural ambiguity or irreversible stake that justifies it. If you
can point at 1-2 known files and a clear problem statement, use `--model sonnet` (or
`--model auto` per [[openrouter-open-weight-routing]] if it's file-path-bounded code).
Escalating sonnet→opus after a failed attempt is cheap; the reverse audit is not.
