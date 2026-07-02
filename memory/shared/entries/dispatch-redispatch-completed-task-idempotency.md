---
id: dispatch-redispatch-completed-task-idempotency
topics: [dispatch, idempotency, arxiv-distill]
source: task:20801
created: 2026-07-02
---

Task #20801 ("Distill arXiv digest 2026-07-02T02:43:08Z") was re-dispatched to me
as "the task to execute" while its DB row already showed `status=completed`,
`completed_at` ~2 minutes before my invocation started. I didn't check task
status before acting, wrote 4 more `writeDistilled` nuggets (3 near-duplicates
of the already-completed picks + 1 new), then caught the mismatch only when
`writeDistilled`'s collision-probe suffixed my files `__04`-`__07` after
existing `__01`-`__03`.

**Why:** Dispatch context handed me the task description as if pending/active
with no built-in "is this already done?" check. Root cause not fully diagnosed
here (fleet race? retry after a slow-close race? stale queue read?) — see
[[fleet-dispatch-atomic-claim]] for the ARC-0013 atomic-claim proposal that
would close this class of race if adopted.

**How to apply:** Any dispatched task that performs a **write** (writeDistilled,
file-signal, STX send, etc.) should check current task status via
`bun -e 'import {Database} from "bun:sqlite"; ...SELECT status,result_summary FROM tasks WHERE id=?'`
(or an `arc tasks` lookup, if a single-id lookup command exists) BEFORE doing the
write, not just check for content-level dedup. If `status=completed` already,
stop immediately — do not re-run the work, do not re-close the task (completed
is terminal per CLAUDE.md). Clean up any writes already made before the check
caught it, then end the task without further action. This is a stronger
pre-flight than the existing per-skill idempotency checks (sent-folder scan,
pending-task check) because it catches "this exact task is already fully done,"
not just "this side effect was already sent."
