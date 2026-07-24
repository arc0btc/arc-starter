---
name: arc-typecheck-guard
description: Detect type errors introduced by unattended auto-commits via a baseline-diffed tsc --noEmit check
updated: 2026-07-15
tags:
  - dispatch
  - safety
  - typescript
disallowed-tools: [Edit, Write, NotebookEdit]
---

# arc-typecheck-guard

Closes the gap that caused #22717: the dispatch fallback auto-commit
(`chore(loop): auto-commit after dispatch cycle`) ships files with no reviewed
session behind them, and the only pre-commit gate is Bun's transpile check —
which validates syntax, not types. A type-broken sensor (wrong arg type, dropped
required field) transpiles clean, commits, then throws at runtime and silently
halts. This guard runs a real `tsc --noEmit` and flags the regression.

## How it works

A sensor (30-min cadence) compares per-file `tsc` error counts against a
persisted baseline (`db/tsc-baseline.json`):

1. If HEAD is unchanged since the last check → skip (cheap, no tsc run).
2. Find `.ts` files under `src/`/`skills/` changed by **auto-commits** in the new
   range. Reviewed/human commits are ignored — they go through code-review + CI.
3. If none → advance the pointer without running tsc.
4. Otherwise run `tsc --noEmit -p tsconfig.json` once, parse errors by file, and
   flag any auto-commit-touched file whose error count **increased** over baseline.
5. Refresh the baseline to current, so reviewed fixes lower it and confirmed
   regressions are not re-flagged.

The baseline diff — not a zero-error requirement — is deliberate: `main` carries
~50 pre-existing errors (mostly gitignored sibling-checkout imports). Only
increases attributable to an unattended commit are surfaced, as a `sonnet`
follow-up task listing the offending lines.

## CLI

```
arc skills run --name arc-typecheck-guard -- check      # run one guard pass now (prints outcome JSON)
arc skills run --name arc-typecheck-guard -- status     # print the persisted baseline
arc skills run --name arc-typecheck-guard -- baseline   # force-refresh baseline to current HEAD + tsc counts
```

Run `-- baseline` after intentionally landing new pre-existing-style errors, or
after a large reviewed refactor, to reset the reference point.

## When to Load

Load when: the sensor files a type-error follow-up task, or when auditing the
dispatch auto-commit safety layers (`src/safe-commit.ts`). Do NOT load for
routine feature work.

## Design notes

- **Sensor, not inline in `safe-commit.ts`.** A full `tsc` is ~10-30s; running it
  on every dispatch cycle's hot path is too costly. A cadenced sensor runs it at
  most once per interval, off the critical path.
- **Flags, does not revert.** Type errors do not crash a running Bun service
  (Bun ignores types at runtime), so revert-on-error would be too aggressive.
  The runtime throw is the real symptom; a follow-up within ~30 min is the right
  severity. Contrast: `revertOnServiceDeath` reverts because a dead service is an
  active outage.
- Complements the transpile guard and `lintModelField` heuristic in
  `src/safe-commit.ts`; `tsc` catches what regex/transpile cannot (e.g. the
  `insertTaskIfNew(db, {…})` wrong-first-arg form that the model-field lint missed).

## Checklist

- [ ] `SKILL.md` frontmatter `name` matches directory (`arc-typecheck-guard`)
- [ ] `sensor.ts` exports async default returning `Promise<string>`, gated by `claimSensorRun`
- [ ] `cli.ts` supports `check`, `status`, `baseline`
- [ ] `check.ts` core logic is shared by sensor + cli (no duplication)
- [ ] `db/tsc-baseline.json` is written on first run, absent from git if desired
