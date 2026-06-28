# ARC-0013: Dispatch Loop Port — fleet dispatch + ARC-0011 escalation + minimal eval

| Field | Value |
|-------|-------|
| ARC | 0013 |
| Title | Dispatch Loop Port — fleet dispatch + ARC-0011 escalation + minimal eval (done_check + maker≠checker) |
| Author | Arc |
| Status | Draft (spec for sign-off — NOT a port authorization) |
| Created | 2026-06-28 |
| Requires | ARC-0011 (escalation ladder, implemented in arc-starter) |
| Touches | `agent-runtime/src/db.ts` (new), `dispatch.ts` (new), `escalation.ts` (new), `eval.ts` (new); arc-starter `src/dispatch.ts`, `src/db.ts` (prove-first) |
| Origin | whoabuddy email 31b42434 — "if we think the loop will be helpful, let's spec it out and try it"; 2026-06-27 research synthesis Top-5 #3/#4 |

---

## Context

`agent-runtime` (`/home/dev/agent-runtime`, bin `art`) is **harness nouns without verbs**.
It ships `skills.ts`, `models.ts`, `identity.ts`, `memory.ts`, `credentials.ts`, the
codex/openrouter adapters, and a handful of skills that already carry `evals/eval.yaml`
case files. It has **no `db.ts`, no `dispatch.ts`, no `sensors.ts`, no `escalation.ts`, and
no eval runner.** Every fleet agent built on it today is a pile of skills with no loop and
no recovery ladder.

arc-starter is the opposite: a battle-tested 1,777-line `src/dispatch.ts`, a full task-queue
schema, and ARC-0011's escalation ladder live in production. The 2026-06-27 synthesis named
this port "the single highest-leverage AIBTC infra move — it turns 'a pile of skills' into
'every agent has a loop and a recovery ladder.'"

This is **not a blind copy.** arc-starter's dispatch is single-node by design; agent-runtime
is a fleet substrate. The two differ in exactly one load-bearing place — task claiming — and
that difference is the reason this needs a spec before code.

---

## Scope

**In:**
1. **Dispatch loop** — task selection → prompt build → subprocess run → cost/result record → close, ported to `agent-runtime/src/dispatch.ts`, with a **fleet-safe atomic SQL claim** replacing arc-starter's single-node file lock.
2. **ARC-0011 escalation** — lift the REFINE→PIVOT→WEB-SEARCH→HANDOFF ladder into a standalone `src/escalation.ts` module (currently inline in arc-starter `dispatch.ts`).
3. **Minimal eval** — a runner over the `evals/eval.yaml` files skills already ship; `art eval --skill <name>` grades outcome+patterns, exit-0 = pass.
4. **Top-5 #3 — `done_check` / `definition_of_done`** — a per-task contract the dispatcher grades *before* marking `completed`.
5. **Top-5 #4 — maker ≠ checker** — an independent completion gate on high-cost tasks; advisory-log first, structurally enforced via the claim column.

**Out (explicitly deferred):**
- `sensors.ts` port (separate proposal; the loop is the priority).
- Worktree isolation, web dashboard, services installer (arc-starter has them; not load-bearing for "every agent has a loop").
- Multi-agent workflow runtime.
- Cross-host DB substrate *selection* — this spec flags it as the #1 decision but does not pick it.

---

## Design

### 1. The one load-bearing difference: atomic claim, not file lock

arc-starter claims a task in three non-atomic steps under a process-wide file lock
(`db/dispatch-lock.json`, PID + task_id):

```
acquireLock(file)              # serializes the ENTIRE dispatcher process, single node
  → getPendingTasks()          # SELECT ... ORDER BY priority(boosted) ASC, id ASC
  → task = pendingTasks[0]      # read
  → markTaskActive(task.id)     # write — separate statement, race window here
```

On one node this is correct: the file lock guarantees only one dispatcher runs at a time,
so the read→pick→write window is never contended. **In a fleet it double-grabs.** Two
dispatchers each `getPendingTasks()`, both see the same `pendingTasks[0]`, both
`markTaskActive` it, both run it. The file lock cannot help — a shared file lock would
serialize the whole fleet back down to one worker, defeating the point.

**Fleet claim = single atomic statement, per task, no process lock:**

```sql
UPDATE tasks
   SET status      = 'active',
       started_at  = datetime('now'),
       claimed_by  = :worker_id,
       claimed_at  = datetime('now'),
       attempt_count = attempt_count + 1
 WHERE id = (
   SELECT id FROM tasks
    WHERE status = 'pending'
      AND (scheduled_for IS NULL OR datetime(scheduled_for) <= datetime('now'))
    ORDER BY
      CASE WHEN scheduled_for IS NOT NULL
                AND datetime(scheduled_for) < datetime('now','-1 minute')
           THEN MAX(1, priority - 2)   -- past-due boost, preserved from arc-starter
           ELSE priority END ASC,
      id ASC
    LIMIT 1
 )
RETURNING *;
```

The `SELECT … LIMIT 1` inside the `UPDATE` collapses pick+claim into one write. The DB's
write serialization decides the winner; the loser's `RETURNING` is empty and it picks again.
The boosted-priority `ORDER BY` is copied verbatim from arc-starter `getPendingTasks()`
(`src/db.ts:625`) so scheduling semantics are unchanged.

**Substrate caveat (the #1 decision — see Open Questions):** this statement is only as atomic
as the store underneath it.
- *Same-host, multi-process SQLite:* WAL mode + `PRAGMA busy_timeout` + `BEGIN IMMEDIATE`
  makes `UPDATE…RETURNING` safe across processes on one box.
- *Cross-host fleet:* one SQLite file over a network share does **not** give this guarantee.
  A real fleet needs a networked store (Postgres / Turso / D1). The claim *statement* is
  portable; the *substrate* is whoabuddy's call.

**Fleet crash recovery changes too.** arc-starter marks *any* `active` task failed on boot
("crash recovery", `dispatch.ts:1231`) — safe single-node because no other dispatcher exists.
A fleet must not reap another live worker's task. Replace with a **lease**: reclaim an
`active` task only if `claimed_at` is older than a lease TTL (e.g. 35 min, > max cycle).
`claimed_by` gives the observability arc-starter never needed.

### 2. Schema additions (`agent-runtime/src/db.ts`, new)

Start from arc-starter's `tasks` + `cycle_log` schema, plus:

```sql
-- fleet claim / lease (Design §1)
claimed_by  TEXT,           -- worker id holding the task; NULL when pending
claimed_at  TEXT,           -- lease timestamp for stale-claim reclamation

-- ARC-0011 (already proven in arc-starter; carry over)
escalation_rung TEXT DEFAULT 'REFINE',
pivot_count     INTEGER DEFAULT 0,
dead_ends       TEXT,
max_retries     INTEGER DEFAULT 7,   -- HANDOFF threshold

-- Top-5 #3 — done_check (shared schema; prove in arc-starter first)
definition_of_done TEXT,   -- the contract: pattern/outcome grammar (see §5)
done_check_result  TEXT,   -- dispatcher's grade: pass | fail | skipped | <reason>

-- Top-5 #4 — maker ≠ checker (shared schema)
checker_verdict TEXT       -- JSON {verdict, by, advisory:bool, ts}; advisory-log first
```

### 3. Dispatch loop phases (`agent-runtime/src/dispatch.ts`, new)

Mirror arc-starter's phase structure, swapping the claim and recovery for fleet-safe versions:

```
Phase 0  pre-flight   shutdown gate; lease-reclaim stale active tasks (NOT blanket-fail)
Phase 1  claim        atomic UPDATE…RETURNING (Design §1) → task or idle
Phase 2  rung         read escalation_rung; build escalation context (escalation.ts §4)
Phase 3  prompt       buildPrompt(task, skills, recentCycles, rung)
                      ▸ CACHE ORDER: static (Identity, skills) BEFORE dynamic
                        (Current Time, Recent Cycles, Task). This is Top-5 #2 — bake it
                        into the port from line one rather than inheriting arc-starter's
                        current dynamic-first ordering (dispatch.ts:437).
Phase 4  run          model adapter subprocess; capture cost_usd / api_cost_usd / tokens
Phase 5  done_check   grade output vs definition_of_done (§5). fail → verification_failed
Phase 6  checker      maker≠checker gate on high-cost tasks (§6); advisory-log or block
Phase 7  close        on pass → completed (reset rung); on fail → escalation.nextRung()
```

### 4. `escalation.ts` (lift ARC-0011 into a module)

ARC-0011 logic lives inline in arc-starter `dispatch.ts` (`nextRung`, `buildEscalationContext`,
`handleHandoff`, ~lines 396–1190). Extract to `agent-runtime/src/escalation.ts` with a clean
surface — and refactor arc-starter to import the same module so the two never drift:

```ts
export function nextRung(task: Task, failureClass: DetectorClass): EscalationRung
export function buildEscalationContext(task: Task, rung: EscalationRung): string
export function handleHandoff(task: Task): void   // blocks task + [ESCALATED] follow-up
```

Ladder semantics are unchanged (proposal 0011): REFINE 1–2 → PIVOT 3–4 → WEB-SEARCH (one
pass) → HANDOFF at `attempt_count >= max_retries`; one success resets to REFINE; recurring
error signature (≥3 same-subject in 7d) skips straight to PIVOT. `done_check` failures (§5)
route in as the `verification_failed` class → REFINE entry.

### 5. `done_check` / definition_of_done (Top-5 #3)

The most-cited gap of the synthesis batch (loop-first, loops-explained, compound-eng, and
hitchhiker all name it): "done" is a sentence in the task subject, not a contract the loop
can check. Turn it into a contract.

- `tasks.definition_of_done` holds the contract. **Reuse the grammar skills already ship in
  `evals/eval.yaml`**: `outcome: completed` + `patterns: [...]` strings expected in the
  result. No new DSL — the eval format *is* the done-check format.
- Phase 5: after the subprocess returns, the dispatcher grades the result against
  `definition_of_done`. Pass → eligible for `completed`. Fail → `done_check_result='fail'`,
  routed as `verification_failed` into the ladder (REFINE), not silently closed.
- Cheap path: pattern/outcome match (no LLM). Expensive path (opt-in): a grader prompt.
- **Spec convention: exit-0 = pass** (matches the eval runner, §7), so done_check and the
  eval harness share one verdict contract.

### 6. Independent completion gate — maker ≠ checker (Top-5 #4)

Closes the Verification Gap every loop source names: today the agent grades its own homework
(maker = checker). Add an independent checker on high-cost tasks.

- **Trigger:** `cost_usd > 1` OR `priority <= 1` (synthesis threshold; tunable).
- **Mechanism:** before close, the maker enqueues a `verify` follow-up task carrying the
  result + `definition_of_done`. **The claim column enforces independence for free:** the
  verify task sets `exclude_claimant = <maker worker_id>`, so a *different* worker claims and
  grades it. No special-casing — maker≠checker falls out of the fleet claim model. (Single
  node / arc-starter prototype: spawn `Agent({subagent_type})` with a fresh context and,
  ideally, a different model.)
- **Advisory-log first.** At launch, record `checker_verdict` but do **not** block close.
  Run ~1–2 weeks, measure the maker/checker disagreement rate, *then* decide whether to flip
  the gate to blocking. Starting blocking would gate throughput on an unmeasured signal.

### 7. Minimal eval runner (`art eval`)

Skills already ship `evals/eval.yaml` (e.g. `skills/contacts/evals/eval.yaml`: `cases[]` with
`input.task_subject/description`, `expected.outcome`, `expected.patterns[]`, `model`, `tags`).
The runner just executes them:

```
art eval --skill <name>        # run all cases in skills/<name>/evals/eval.yaml
art eval --all                 # every skill; CI gate
```

Each case: build a synthetic task from `input`, run it through dispatch (or a dry single-shot),
grade `outcome` + `patterns` → pass/fail. Exit-0 = all pass (shared verdict with §5). This is
the regression net that makes the port — and every future skill — verifiable.

---

## Sequencing recommendation (for whoabuddy's call)

The synthesis line holds: **#3 and #4 are shared-schema; prototype in arc-starter first.**
Recommended order, each phase independently shippable and reversible:

| Phase | Where | What | Risk | Gate to next |
|-------|-------|------|------|--------------|
| **0a** | arc-starter | `definition_of_done` + `done_check_result` columns; Phase-5 grading (reuse eval grammar) | M/med | done_check fires on ≥1 task class without false-fails |
| **0b** | arc-starter | maker≠checker **advisory** gate (cost>1 \|\| pri<=1); log `checker_verdict`, don't block | M/med | 1–2 wk of disagreement-rate data |
| **1** | agent-runtime | `db.ts` schema **with `claimed_by`/`claimed_at` from day one**; `dispatch.ts` w/ atomic claim (§1); lease recovery | M/high | atomic claim survives a 2-worker double-grab test |
| **2** | agent-runtime | `escalation.ts` extracted from arc-starter; arc-starter refactored to import it (no drift) | L/med | parity test vs arc-starter ladder |
| **3** | agent-runtime | `art eval` runner over existing `eval.yaml` | S/low | `art eval --all` green in CI |
| **4** | agent-runtime | fold proven #3/#4 from Phase 0 into agent-runtime schema + loop; flip #4 to blocking iff data supports | M/med | — |

Rationale: Phase 0 buys the two riskiest *behaviors* (done-grading, independent verify) on a
substrate we already trust, with real disagreement-rate data, before they touch fleet boot.
Phase 1 is the only genuinely new engineering (atomic claim + lease) and is gated on a
concrete concurrency test. Phases 2–3 are mechanical lifts. Phase 4 only lands #3/#4 in the
fleet once arc-starter has proven they don't false-fail or over-block.

---

## Open Questions (whoabuddy decides)

1. **DB substrate for the fleet (#1, blocking Phase 1).** Same-host multi-process SQLite
   (WAL + busy_timeout — atomic claim is sufficient) vs a networked store (Postgres/Turso/D1
   for cross-host workers)? This decides whether §1's statement stands alone or needs a real
   server. Everything else in this spec is portable across that choice.
2. **maker≠checker: advisory→blocking trigger.** What disagreement rate (and on which task
   classes) justifies flipping Phase 0b from advisory to blocking? And is `cost>1 || pri<=1`
   the right trigger, or too broad/narrow?
3. **Lease TTL.** 35 min (> max cycle) a safe default for stale-claim reclamation, or tune to
   the slowest expected task?
4. **Extract-in-place vs copy for `escalation.ts`.** Refactor arc-starter to *import* the new
   module (one source of truth, small risk to a production path) vs copy it (fast, drifts)?
   Recommendation: extract-in-place — drift between two escalation ladders is a worse bug than
   the refactor.

---

## Non-goals / risks

- This spec authorizes **no code.** It is the scoped plan whoabuddy asked for; Phase 0 starts
  only on sign-off.
- Touching arc-starter's claim path (Phase 2 refactor) is the one change that can regress a
  production loop — gated behind a parity test.
- If the fleet substrate answer is "networked DB," Phase 1 grows a data-layer abstraction that
  is out of this spec's scope and warrants its own proposal.
