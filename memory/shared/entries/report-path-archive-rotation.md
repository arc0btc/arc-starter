---
id: report-path-archive-rotation
topics: [reports, workflows, file-paths, archive]
source: task #20553, 2026-06-30
created: 2026-06-30
---

# Report path archive rotation

Workflow-generated tasks (e.g. `ceo-review`/`emailing` instances) reference report files by
their original path under `reports/<file>.html`. By the time the email-send task actually
dispatches — sometimes weeks or months later, as with task #20553 referencing a report from
2026-04-30 dispatched 2026-06-30 — the file has been rotated into `reports/archive/<file>.html`
by routine housekeeping. The bare `reports/<file>` path no longer resolves.

**Fix**: on "file does not exist" for a `reports/*.html` path named in a task, check
`reports/archive/` before treating it as a missing/corrupted artifact. The content is usually
intact and complete (including any CEO review block) — just relocated.

**Don't skip the send because the file "looks stale."** A backlog task referencing an old report
is still a legitimate, not-yet-fulfilled workflow obligation unless you can confirm (via
workflow `show <id>` state, or a prior matching sent-email record) that it was already
delivered. Verify via `arc skills run --name arc-workflows -- show <id>` — if `current_state`
still shows the pre-send state (e.g. `emailing`), the send is genuinely outstanding, and
`complete <id>` after sending closes the workflow correctly.
