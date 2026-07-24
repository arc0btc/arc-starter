---
id: dispatch-self-close-watchdog-fix
topics: [dispatch, timeout, cost, subprocess-lifecycle]
source: task:23055 (fix for lever identified in task:23053/23050)
created: 2026-07-17
---

# Sessions that self-close then idle now get force-exited after a 45s grace window, not the full per-model timeout

Follow-up implementation of the lever flagged in [[early-close-idle-to-timeout-completed-at-skew-false-tamper]]:
#23050 called `arc tasks close` at 08:42:52 but the `claude` subprocess never emitted a
terminal stream-JSON `"result"` event and idled until the 500s outer timeout killed it at
08:46:39 — 227s of pure wall-clock waste per occurrence, 3 near-timeout tasks that day.

## Fix (`src/dispatch.ts`, commit b9fdd085)
Inside `dispatch()`, alongside the existing `timeoutTimer` watchdog, added a poll (every 10s)
of `getTaskById(taskId)` while the subprocess runs. `markTaskActive` sets status='active'
before spawn, so any transition away from `'active'` while the process is still alive means
the model already closed/blocked the task itself. On first detection, start a 45s grace timer
(covers the Stop hooks' declared budget: `memory-save.sh` 15s + `inbox-write.sh` 10s in
`.claude/settings.json`, plus margin) then SIGTERM → SIGKILL(+10s) the subprocess, same
escalation shape as the existing full-timeout kill.

**Why this doesn't need to know *why* the subprocess hangs**: it reacts to the authoritative
DB row transition, not to stream-JSON parsing quirks or hook internals — works regardless of
root cause (Stop hook stall, MCP teardown hang, model continuing to "think" post-close, etc).

**Safety**: if the force-exit causes `dispatch()` to throw (non-zero exit or the
`stream-JSON incomplete` guard because no `"result"` line ever arrived), the exit-code
handling in `dispatch()` and the outer `executeTask` catch (`"errored after LLM self-close"`)
already both check `getTaskById(id).status !== "active"` before treating it as a real failure —
both preserve the terminal status instead of `markTaskFailed`/`requeueTask`ing over it. This
existing guard (originally for #17845/#17797 duplicate-send prevention) is what makes an
early, code-driven force-exit safe to add.

**Root cause NOT fixed**: this bounds the cost of the idle tail (500s → ~55s) but doesn't
explain why the `claude` subprocess doesn't exit on its own after the model's last tool call.
If the pattern recurs post-fix, check whether `.claude/settings.json`'s `Stop` hooks
(`memory-save.sh`, `inbox-write.sh`) are actually completing within their declared timeouts —
no raw dispatch stdout/journal log was available to confirm during this investigation
(sandboxed session, no `journalctl` access, no per-cycle log file for the `claude` subprocess
itself — only `console.log` via `src/utils.ts`'s `log()`, which isn't captured anywhere
inspectable in-session).

Related: [[early-close-idle-to-timeout-completed-at-skew-false-tamper]], [[tasks-close-reclosing-resets-completed-at-retro-loop]].
