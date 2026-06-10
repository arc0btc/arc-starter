# ARC-0011: REFINE/PIVOT/web-search/handoff Escalation Ladder

| Field | Value |
|-------|-------|
| ARC | 0011 |
| Title | REFINE/PIVOT/web-search/handoff Escalation Ladder |
| Author | Arc |
| Status | Implemented (2026-06-10, task #18540) |
| Created | 2026-05-29 |
| Requires | ARC-0007 (verification_failed retry class), ARC-0009 (dead-ends consultation) |

---

## Context

Arc's current retry model is flat: `max_retries=3`, then `status = 'failed'`. Every failure is treated identically — the same approach is retried until the counter exhausts, then the task dies. There is no mechanism to change strategy mid-failure, consult prior dead-ends, fetch external context, or escalate to the operator at the right moment.

This produces two failure modes observed in production:

1. **Chronic failure loops** — Resend API 402, arXiv 429, and x402 registration checks have all hit the same wall 3× before dying with no new information. The flat model wastes 3 dispatch cycles producing identical failures (task #17797, task #17788 are recent examples).

2. **Premature hard failure** — Tasks that could have succeeded with a strategy change (different API endpoint, different query, different framing) are abandoned at the same point every time. The arc failure count inflates; the fix stays in the blind spot.

The `codex-autoresearch` failure escalation pattern (research/2026-05-07T053100Z_codex-autoresearch.md, section 4) documents this ladder as a canonical solution across multiple agent frameworks. The failure-detector taxonomy from `recursive-improve` (memory/shared/entries/recursive-improve-failure-detectors.md) defines the four detector classes that drive rung selection. Together they are the reference design for this proposal.

Related: ARC-0007 introduced a `verification_failed` retry class that creates a new failure entry type needing explicit dispatch handling — the escalation ladder is where `verification_failed` failures route. ARC-0009 introduced a dead-ends consultation step at PIVOT time, which this proposal formalizes as the third rung's prerequisite.

---

## Motivation

The flat `max_retries=3` model has three concrete costs:

**Wasted cycles.** When a failure is structural (depleted credits, retired endpoint, schema mismatch), each retry burns a full dispatch cycle to reproduce the same outcome. Three identical failures produce zero additional information.

**Silent strategy exhaustion.** The current model has no concept of "tried this approach, needs a different one." Strategy alternatives exist but go untried. There is no layer between "retry the same thing" and "fail the task entirely."

**Operator escalation at wrong granularity.** When tasks fail and escalate to whoabuddy, the escalation carries no strategic history — no record of what was attempted, what specifically blocked each attempt, or what alternatives were ruled out. A useful escalation should arrive with a decision tree already pruned.

If we do nothing: chronic failures continue to inflate the failure count, waste compute budget, and escalate without actionable context. The $0.449/task average (2026-05-29 eval) reflects partially this overhead.

---

## Proposal

Replace the flat `max_retries=3` model with a four-rung escalation ladder. Each rung is a distinct strategy; the dispatch runtime selects the rung based on the failure-detector class and current attempt state.

### The Four Rungs

```
attempt_count  rung          strategy
─────────────  ────────────  ──────────────────────────────────────────────────
1–2            REFINE        Same approach; adjust prompt, parameters, or timing.
                             No strategy change. Examples: retry with backoff,
                             rephrase request, reduce scope, increase timeout.

3–4            PIVOT         Fundamentally different approach. Consult dead-ends
                             log (ARC-0009) before choosing. Document abandoned
                             strategy + reason in task.result_detail. Reset
                             REFINE counter; PIVOT counter increments.

5–6            WEB-SEARCH    Fetch external context. Treat results as hypotheses;
                             verify mechanically before acting. Permitted tools:
                             arc skills run --name web-search, arc skills run
                             --name arxiv-research. One WEB-SEARCH rung per task
                             (non-repeating). On completion, re-enter REFINE.

7+             HANDOFF       Set status = 'blocked'. Write result_summary as a
                             pruned decision tree: approach tried, rung reached,
                             what was learned, what a human should try next.
                             Create follow-up task tagged [ESCALATED] for operator
                             triage.
```

One success at any rung resets all counters to zero.

### Rung Selection by Failure-Detector Class

The four detector classes from `recursive-improve-failure-detectors.md` map to rung entry points:

| Detector class | Entry rung | Rationale |
|---------------|------------|-----------|
| `errors` (recurring error signature, ≥3 in 7d) | PIVOT | Same error 3× = structural. Skip REFINE entirely. |
| `loops` (identical subject+failed, attempt_count ≥ max_retries) | PIVOT | Loop detected = approach exhausted. |
| `give-ups` (attempt_count < max_retries, status failed/blocked) | REFINE | Might recover with prompt adjustment. |
| `recovery` (parent lineage failed→completed) | REFINE | Positive pattern; retry is likely to work. |

A `verification_failed` class (ARC-0007) enters at REFINE: verification failures are often prompt-level, not approach-level.

### Schema Extension

```sql
-- New columns on tasks table
ALTER TABLE tasks ADD COLUMN escalation_rung TEXT DEFAULT 'REFINE';
  -- Values: REFINE | PIVOT | WEB-SEARCH | HANDOFF
ALTER TABLE tasks ADD COLUMN pivot_count INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN dead_ends TEXT;
  -- JSON array: [{"approach": "...", "reason": "...", "attempt": N}]
  -- Populated by dispatch at each PIVOT transition
```

`max_retries` is retained as the HANDOFF threshold (default 7 for new tasks; existing tasks retain their current value and escalate earlier per the current model until migrated).

### Dispatch Behavior

At task selection, dispatch reads `escalation_rung` and adjusts the context it loads:

- **REFINE**: Standard SKILL.md context. No dead-ends loaded.
- **PIVOT**: Load `dead_ends` JSON from prior attempts. Load ARC-0009 dead-ends consultation context. Prompt includes: "Previous approaches: [dead_ends]. Choose a fundamentally different strategy."
- **WEB-SEARCH**: Same as PIVOT, plus web-search skill context. Dispatch auto-includes `arc-web-search` in `skills` array for this attempt only.
- **HANDOFF**: Dispatch does not execute the task. It closes it as `blocked` and creates a `[ESCALATED]` follow-up task targeting whoabuddy, populated with the full `dead_ends` log.

After each failed attempt, dispatch updates `escalation_rung` and `dead_ends` before releasing the lock.

### Rung Transition Logic (pseudocode)

```typescript
function nextRung(task: Task, failureClass: DetectorClass): EscalationRung {
  if (failureClass === 'errors' || failureClass === 'loops') return 'PIVOT';
  if (task.escalation_rung === 'REFINE' && task.attempt_count >= 2) return 'PIVOT';
  if (task.escalation_rung === 'PIVOT' && task.pivot_count >= 2) return 'WEB-SEARCH';
  if (task.escalation_rung === 'WEB-SEARCH') return 'PIVOT'; // one pass, then back
  if (task.attempt_count >= (task.max_retries ?? 7)) return 'HANDOFF';
  return task.escalation_rung; // stay on current rung
}
```

---

## Backward Compatibility

**No breaking change to existing tasks.** The new columns have defaults:
- `escalation_rung = 'REFINE'` — existing tasks enter the ladder at rung 1, which behaves identically to the current retry model until attempt_count ≥ 3.
- `pivot_count = 0` — existing tasks have no pivot history; PIVOT promotion happens at attempt 3 as before.
- `dead_ends = NULL` — treated as empty array; no context loaded until first PIVOT.

**`max_retries` semantics shift.** The column now acts as the HANDOFF threshold, not a raw retry cap. For new tasks, the recommended default is 7 (covering 2 REFINE + 2 PIVOT + 1 WEB-SEARCH + 2 post-web REFINE). Existing tasks with `max_retries=3` will HANDOFF sooner — effectively unchanged behavior but with a `blocked` status and decision tree in the summary instead of `failed` with a bare error message.

**Migration:** No data migration needed. Schema additions are additive. Sensors that create tasks continue to work unchanged; they inherit defaults. To use PIVOT-aware sensor behavior, update the task creation call to pass `--max-retries 7`.

---

## Alternatives Considered

**1. Keep flat retries, just increase max_retries.** Rejected. More retries of the same approach on structural failures produces more wasted cycles and no new information. The problem is strategy selection, not retry count.

**2. Separate skills-based routing** (different skill per failure type). Rejected. Skill assignment happens at task creation time; failure type isn't known until after the first attempt. Post-creation skill mutation creates dispatch ambiguity and breaks the skills-are-declared-upfront invariant.

**3. REFINE/PIVOT only, no WEB-SEARCH or HANDOFF rungs.** Considered. WEB-SEARCH is valuable specifically for tasks that fail due to stale cached knowledge (API changes, new endpoints, schema updates). Without it, the only options are retry-same and handoff — too coarse for a class of failures that genuinely benefit from a lookup. HANDOFF without a decision tree is the current behavior; the proposal preserves HANDOFF but makes it useful.

**4. Single `strategy` field (enum) on tasks.** Considered as an alternative schema. Rejected because `dead_ends` (the pruned decision tree) is the more valuable artifact — the rung is derivable from attempt_count, but the strategic history is not.

---

## Open Questions

1. **Should `dead_ends` be populated on REFINE failures too, or only on PIVOT?** Writing dead-ends on every REFINE attempt could produce noise; writing only on PIVOT means the transition decision has no log of which REFINE variants were tried. Suggested: write on PIVOT entry only, with a brief description of the REFINE attempts that preceded it.

2. **WEB-SEARCH rung: which skills are permitted?** This proposal limits to `arc-web-search` and `arxiv-research`. Should `contacts` (agent network) count as a WEB-SEARCH equivalent for tasks involving agent collaboration? Or does that constitute HANDOFF?

3. **What is the right default for `max_retries` on new tasks?** Proposal suggests 7, but sensor-created tasks (especially streak-maintenance and signal-filing) are high-frequency and low-stakes — they may want a lower HANDOFF threshold (5) to avoid burning WEB-SEARCH cycles on transient cooldowns.

4. **Should HANDOFF generate an email notification?** The escalation follow-up task relies on dispatch selecting it. If the queue is backed up or the service is stopped, whoabuddy may not see the escalation for hours. A direct email on HANDOFF would add latency guarantee. Potential duplicate-send risk if the HANDOFF task itself is re-dispatched — see task #17797 idempotency pattern.

5. **Interaction with `verification_failed` (ARC-0007):** If a task passes all rungs but fails verification, does it re-enter REFINE from the top, or count the verification failure as a new REFINE attempt? Proposed: count as a REFINE attempt on the current rung (verification failure = same approach, wrong output — adjust and retry).

---

## Implementation Notes (2026-06-10, task #18540)

Shipped in `src/escalation.ts` (ladder logic), `src/dispatch.ts` (rung-aware context +
failure routing), `src/db.ts` (schema + helpers), `src/cli.ts` (`--max-retries`, default 7).
Decisions made where the spec was ambiguous or self-contradictory:

- **HANDOFF threshold hoisted.** The `nextRung` pseudocode checks `attempt_count >= max_retries`
  *last*, which is unreachable for `errors`/`loops` (they early-return to PIVOT) — those tasks
  would loop in PIVOT forever. The implementation checks the HANDOFF threshold first so the
  ladder always terminates, preserving the stated intent ("max_retries is the HANDOFF threshold").
- **WEB-SEARCH non-repeating** is enforced via a `webSearchUsed` flag derived from the dead-ends
  log, resolving the contradiction between "one pass" and "PIVOT with pivot_count≥2 → WEB-SEARCH".
- **`arc-web-search` does not exist**; the WEB-SEARCH rung auto-loads `arxiv-research` (the installed
  research skill) plus the built-in WebSearch/WebFetch tools. (Open Question 2.)
- **Dead-ends written on rung transitions + every PIVOT failure**, not only PIVOT entry — gives the
  HANDOFF decision tree a complete pruned history. (Open Question 1.)
- **HANDOFF follow-up is created `blocked`, not pending** — a durable triage record that dispatch
  never re-executes, preventing an escalation loop. No email yet. (Open Questions 4.)
- **Short-circuits unchanged.** auth / subprocess_timeout / rate_limited bypass the ladder (fail or
  rollback-requeue as before); only transient/unknown and script failures route through it.

## References

- `research/2026-05-07T053100Z_codex-autoresearch.md` — Section 4: failure escalation ladder (REFINE/PIVOT/web/handoff pattern source)
- `memory/shared/entries/recursive-improve-failure-detectors.md` — four failure-detector classes; insight→metric→fix discipline
- `memory/shared/entries/harness-engineering-five-subsystems.md` — feedback subsystem gap; verification commands
- `memory/shared/entries/harness-engineering-completion-verification.md` — verification_failed; independent evaluator pattern
- `docs/proposals/ARC-0000.md` — proposal process
- ARC-0007 — `verification_failed` retry class (prerequisite; introduces the failure class this ladder must route)
- ARC-0009 — dead-ends consultation (prerequisite; defines the dead-ends log this ladder reads at PIVOT time)
- Task #17788 — X API 402 = CreditsDepleted; example of a structural failure that loops under the current flat model
- Task #17797 — side-effecting task re-dispatch; escalation must not create duplicate side effects
