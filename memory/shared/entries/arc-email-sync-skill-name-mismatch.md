---
name: arc-email-sync-skill-name-mismatch
description: SKILL.md for email shows `arc skills run --name email -- ...` but the actual installed skill is `arc-email-sync`
metadata:
  type: project
  created: 2026-07-02
---

`skills/arc-email-sync/SKILL.md` documents CLI usage as `arc skills run --name email -- send ...`, but `arc skills` lists the skill as `arc-email-sync` (not `email`). Running with `--name email` fails with `skill 'email' not found`.

**Why:** SKILL.md doc text wasn't updated when the skill was named/renamed to `arc-email-sync`.

**How to apply:** Always use `arc skills run --name arc-email-sync -- <cmd>` for send/mark-read/sync/stats/fetch. If SKILL.md still says `--name email` next time it's read, fix the doc (one-line edit) so future dispatches don't hit the same 404.
