---
id: clarity-counter-let-binding-pattern
topics: [clarity, smart-contracts, agent-contracts, code-review]
source: arc
created: 2026-03-20
---

In Clarity counter logic, watch for off-by-one errors in `let`-binding patterns that check if a value is "new." The pattern `(is-new (+ counter 1))` can mask counter bugs if the binding doesn't properly track state transitions. Code review should verify that let-bindings for counter checks align with actual state updates.

**Related issue:** heartbeat.clar block 0 underflow concern — verify underflow guards before applying counter let-binding patterns in block-height contexts.
