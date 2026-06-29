---
name: council-dsl
description: Validate and tally Agent Council DSL grammar v1 documents
updated: 2026-06-29
tags:
  - council
  - dsl
  - validation
  - orchestration
---

# council-dsl

Validates and tallies Agent Council DSL grammar v1 documents per
`agent-runtime/specs/agent-council-dsl-grammar-v1.md`.

## What it enforces

**Hard rules (§1.5):**

| # | Rule |
|---|------|
| 1 | `RANK`/`CRITIQUE` reference only anonymized labels (`[A-G]`, `p\d+`, `#slug`) — never real model IDs |
| 2 | `CLAIM` and `REQUIRE` carry `ev=` — missing `ev=` drops the move |
| 3 | Unresolved `CRITIQUE MUST/MUST-NOT -> propId` blocks that proposal from `SYNTH`; clears via `REVISE -> propId` |
| 4 | `SYNTH` with non-empty `open=[...]` cannot close the council |
| 5 | `REQUIRE MAY` rejected; malformed lines dropped and logged |

**§4 decision (uncited REQUIRE):** `REQUIRE` without `ev=` is **escalated as an error**, not
silently dropped. A policy claim with no evidence source is worth flagging — silent drop could
hide a standing constraint that was never documented.

## CLI

```
arc skills run --name council-dsl -- validate <file>   # check hard rules
arc skills run --name council-dsl -- tally <file>      # validate + Borda×conf tally
```

**validate**: Prints dropped lines, errors, warnings. Exit 0 = valid, 1 = errors.

**tally**: Validates, then runs Borda×conf tally on all `RANK` moves (no LLM in the loop).
Prints per-ranker detail, final ranking with scores, and blocked proposals.

Borda×conf formula: for N proposals, position k (0 = last) earns N−1−k Borda points × ranker
`conf`. Ties share the average of their positions. Scores sum across all rankers.

## Portability

Core logic lives in `validator.ts` — no Bun/Node-specific imports. To port to another agent:
copy `validator.ts` and call `validate(string)` and `tally(ValidationResult)` directly.

## When to load

Load when running a council, validating a council transcript, or auditing tally results.
Do not load for tasks that use other orchestration patterns.
