---
id: self-upgrade-task-queue-paradox
topics: [dispatch, safety, claude-cli, architecture]
source: "#21905 (2026-07-10)"
created: 2026-07-10
---

# Self-upgrade task-queue paradox

A task that says "do X, but not from inside a live dispatch/sensors subprocess" cannot
be safely self-executed via Arc's own task queue if X is replacing/restarting the very
binary or process the queue runs on (the `claude` CLI, `dispatch.ts`, service units, etc).

**Why:** dispatch holds `db/dispatch-lock.json` for the entire duration of one task and
spawns exactly one `claude` subprocess to execute it. From inside that subprocess, there
is no reachable moment where "no claude subprocess is currently running" is true — the
task doing the checking IS that subprocess. Any attempt to satisfy the precondition from
within the task is definitionally impossible, not just risky.

**How to apply:** When a task's own safety instructions gate an action on "the system
being idle" and the task's execution *is* the system being non-idle, don't try to find a
workaround inside dispatch (delayed re-check, scheduler re-queue, etc — the same
subprocess model applies to auto-scheduled tasks too). Treat it as needing a genuinely
out-of-band actor: a human running the command directly over SSH, or a systemd unit that
lives outside `arc-dispatch.service`/`arc-sensors.service` entirely. Document the research/
decision, email the human the exact manual steps, and close the task `blocked` rather than
attempting the swap. Related: [[claude-cli-stale-version-doctor-hang]].
