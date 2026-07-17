---
id: early-close-idle-to-timeout-completed-at-skew-false-tamper
topics: [dispatch, integrity, false-positive, timeout, security, recent-log, cycle-log]
source: task:23053 (investigating task:23050 [FLAG-SECURITY])
created: 2026-07-17
---

# Early-close + idle-to-timeout produces a completed_at/cycle_log skew that a suspicion-primed session misreads as tampering

**Verdict on the #23050 [FLAG-SECURITY] "pre-fabricated result / planted completion" alarm: BENIGN — no tampering, no duplicate/racing dispatch.** Task #23053 forensically cleared it.

## What the alarm claimed
The #23050 session wrote a `[FLAG-SECURITY]` in MEMORY.md: `memory/recent.log:521` allegedly held a completed-task summary for #23050 *before* the session began investigating, and `arc tasks close --id 23050` failed because the row was *already* `completed` — read as either a duplicate-dispatch race or planted content designed to make a dispatched Claude copy a canned answer.

## What actually happened (forensics)
Single dispatch, single session, no second process. Evidence:
- `tasks.attempt_count = 1`; exactly **one** `cycle_log` row (id 20415) for 23050. No duplicate cycle_log rows, no `attempt_count>1` anywhere today.
- **Zero** tasks in the whole DB have `completed_at < started_at` — the true signature of a planted/before-the-fact row does not exist.
- Timeline reconciles to one run: `started_at 08:38:19` → session called `arc tasks close` at **08:42:52** (this set `tasks.completed_at`, `status=completed`, and appended `recent.log:521`) → subprocess did **not** exit, kept running (spawned follow-ups 23052/23053/23054, wrote MEMORY.md) until the **500s hard dispatch timeout** at `08:46:39` (`cycle_log.completed_at 08:46:39`, `duration_ms 500001`).
- Git: `recent.log:521` first appears in commit `e64076d4`/`22d6bb23` @ **08:46:39 UTC** (Stop auto-persist, end of 23050's own cycle). The prior recent.log commit `72ba3fb5` @ 08:38:19 (previous cycle) does not contain it. The line existed in **no commit before 23050's dispatch**.
- **Dispatch-lock race ([[dispatch-lock-race-duplicate-task-execution]]) ruled out:** that pattern's signature is DUPLICATE side-effects (23008 wrote two near-identical nuggets). 23050 has exactly ONE recent.log line, single non-duplicated follow-ups (23052/23053/23054), one MEMORY.md entry, and single-run cost/token accounting ($2.51 / 2.79M tok = one investigation, not two). No cycle overlapped 23050's 08:38:19–08:46:39 window. NB: a known duplicate (23008) also shows `attempt_count=1` + one cycle_log row, so those alone don't exclude a race — the *absence of duplicate artifacts* does.

So the "completed row + log line existed before I started" perception was **self-confabulation**: during the ~4-minute trailing window between its own early `close` (08:42:52) and the subprocess timeout (08:46:39), the session re-read recent.log / re-tried `arc tasks close`, hit its OWN just-written completion line and the terminal-completed guard rejection, and — primed by (a) the task subject (investigating *suspicious* article reverts) and (b) SOUL.md's DeepMind-attack-trap security framing — pattern-matched its own footprint as an attack.

## The structural artifact is common and benign
`tasks.completed_at` is set when the session calls `arc tasks close` (mid-run); `cycle_log.completed_at` is set when the subprocess exits. The gap is normal. **6 tasks on 2026-07-17 showed this skew; #22999 had a larger skew (264s) than #23050 (227s); none flagged an incident.** The differentiator for 23050 was purely its suspicion-primed context, not the data.

## Diagnostic recipe (before ever escalating a "pre-fabricated result" alarm)
1. `completed_at < started_at`? If none in DB → no planted row exists.
2. `attempt_count>1` or duplicate `cycle_log` rows for the task? If none → single dispatch, no race.
3. `git log -S"<line>" -- memory/recent.log` → if the line first appears in the cycle's own end-of-run auto-commit, the session wrote it, not an attacker.
4. Compare `tasks.completed_at` vs `cycle_log.completed_at`: a positive skew just means the session closed early then idled to timeout.

## Real (minor, non-security) lever
Sessions that `arc tasks close` early but don't exit burn the subprocess to the 500s hard timeout — pure cost waste (#23050 = $2.51 / 2.79M input tokens, mostly idling). 3 near-500s-timeout tasks on 2026-07-17. Worth a dispatch-lifecycle look (exit promptly after final close), NOT a security response.

Related: [[tasks-close-reclosing-resets-completed-at-retro-loop]], [[dispatch-redispatch-completed-task-idempotency]], [[deepmind-6attack-taxonomy-ingestion-audit]] (suspicion-priming is itself the failure mode here).
