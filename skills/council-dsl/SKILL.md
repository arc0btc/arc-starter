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

## First consumer: daily-eval judge panel (2026-06-29)

The arc-purpose-eval sensor now prompts the dispatched session to emit DSL moves for the 3
LLM-evaluated dimensions (Adaptation, Collaboration, Security). The session writes moves to
`/tmp/daily-eval-council.dsl` and validates inline before computing the final weighted score.

**Measured before/after (task #20231 baseline):**

| Metric | Before (prose) | After (DSL) | Delta |
|--------|---------------|-------------|-------|
| Output tokens (3 dimensions) | ~170 | ~182 | +7% (neutral) |
| Mechanical verifiability | ❌ | ✅ validator | — |
| ev= evidence required | ❌ | ✅ enforced | — |
| Borda tally useful? | N/A | ❌ 0 scores | — |

**Key findings:**

1. **Token delta is neutral** (~±10 tokens) — the DSL is not more compact than prose for a
   3-dimension single-agent panel. DSL value here is structural integrity, not token savings.

2. **Borda×conf tally does not apply** to dimension scoring. With one proposal per dimension
   and no RANK moves, all scores = 0. The tally is designed for competing proposals
   (A > B > C), not for independent per-dimension scores. The SYNTH note is the authoritative
   output; the tally is irrelevant for this consumer.

3. **note="" rate is appropriate** — CLAIM notes carry the compressed evidence reason, while
   `ev=` does the structural binding to a memory slug. The verb set is adequate for the
   daily-eval panel; no new typed moves needed.

4. **Next natural consumer**: the whop voice-review council (approve/revise/reject for content
   pieces) would see the full Borda tally benefit — multiple members deliberating between
   competing proposals (approve, revise, reject) where ranking actually differentiates votes.

## When to load

Load when running a council, validating a council transcript, or auditing tally results.
Do not load for tasks that use other orchestration patterns.
