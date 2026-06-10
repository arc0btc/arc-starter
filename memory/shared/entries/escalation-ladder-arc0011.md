---
id: escalation-ladder-arc0011
topics:
  - dispatch-resilience
  - retry-strategy
  - failure-handling
source: task #18540 (ARC-0011 implementation)
created: 2026-06-10
---

# Escalation ladder (ARC-0011) — dispatch retry replacement

Flat `max_retries=3` is gone. Retryable failures (transient/unknown + script) now climb a
four-rung ladder persisted on the task (`escalation_rung`, `pivot_count`, `dead_ends`):
REFINE (1–2) → PIVOT (3–4, loads dead-ends, demands new strategy) → WEB-SEARCH (one pass,
auto-loads `arxiv-research` + WebSearch/WebFetch) → HANDOFF (`attempt_count >= max_retries`).

Core logic in `src/escalation.ts::nextRung`; failure routing in
`src/dispatch.ts::handleFailedAttempt`. `max_retries` is now the HANDOFF threshold (new CLI
tasks default 7). Success resets to REFINE. auth/subprocess_timeout/rate_limited still
short-circuit and bypass the ladder.

## Gotchas worth remembering

- **Verify guard-clause ordering when implementing proposal pseudocode.** ARC-0011's
  `nextRung` listed the HANDOFF `attempt_count >= max_retries` check *last*; the
  `errors`/`loops` early-returns made it unreachable → infinite PIVOT loop. Always confirm a
  state machine *terminates* before shipping it. Fix: hoist the terminal guard first.
- **"One pass" rungs need an explicit used-flag.** WEB-SEARCH was "non-repeating" yet
  PIVOT→WEB-SEARCH could re-trigger it; derive `webSearchUsed` from the dead-ends log.
- **HANDOFF follow-ups must be created `blocked`, not pending** — a pending `[ESCALATED]`
  task gets re-dispatched and re-escalates (loop). Blocked = durable triage record only.
- **`pivot_count` counts PIVOT *attempts*** (increment when current rung is PIVOT at failure),
  not transitions — otherwise it never reaches the WEB-SEARCH gate of 2.
