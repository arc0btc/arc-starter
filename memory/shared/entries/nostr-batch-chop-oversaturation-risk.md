---
id: nostr-batch-chop-oversaturation-risk
topics: [nostr, cadence, content-pipeline]
source: task:25503
created: 2026-08-09
---

Nostr cadence checks (pattern from #24637: target healthy multi-hour gaps between
notes) assume one note per task. In practice, "chop remaining Nostr notes from
<artifact>" tasks (e.g. #25508) post 2-3 notes back-to-back in a single dispatch
with no inter-note spacing — this is the actual driver of tight gaps, not sensor
timing. A cadence-review task checking "time since last post" will see near-zero
gaps right after a chop-batch task runs, even though the sensor/dispatch cadence
itself is healthy.

**How to apply:** when a cadence-review task finds a near-zero gap, check whether
the last task was a multi-note batch-chop (subject contains "remaining Nostr
notes") before treating it as oversaturation needing a fix — it's often one
dispatch cycle's batch output, not sustained overposting. If batch-chop tasks
become frequent, the fix is spacing note-drafting across separate scheduled
tasks, not tightening the cadence-review gate itself.
