---
id: whop-free-forum-cross-lane-signal-false-positive
topics: [whop, sensor, dedup, false-positive]
source: task #24468, 2026-07-30
created: 2026-07-30
---

The `whop-free-forum` sensor's task description included a cross-lane hint: "a paid-room
synthesis post fired in the last 12h — STRONGLY consider a DEFER." This was generated from
the synthesis lane simply *running a tick* (task #24455 existing/completing), not from it
actually posting. Checked `memory/recent.log` for #24455's actual result: `DEFER: 0 messages
in 24h window, nothing to synthesize` — no message was posted to the paid room at all.

**Rule**: when a task description cites another lane's activity as a reason to defer/skip,
verify the cited task's *actual outcome* (recent.log one-liner, or the lane's artifact file)
before trusting the inference — a lane "firing" (running its cadence) and a lane "posting"
are different events, and sensors that infer cross-lane state from tick timestamps alone can
generate false-positive overlap warnings. Cheap check: `grep "task #<id>" memory/recent.log`.

See also [[whop-wedge-status]].
