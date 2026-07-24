---
name: research-nugget-relay
description: Runs the HN/RSS/GitHub-release research producers on a real schedule again and files Research: tasks for their promotable nuggets — the missing sensor.ts AND the missing consumer for research_nugget
updated: 2026-07-13
tags:
  - research
  - social
disallowed-tools:
  - Edit
  - Write
  - NotebookEdit
  - Bash
---

# Research Nugget Relay

Sensor-only skill (arc-x-research-channel quest, Phase 5 — "revive / fold in the dead
producers"). `skills/social-engine/producer-{hn,rss,github-release}.ts` already ingest
rubric-scored `research_nugget` rows from Hacker News, a handful of RSS feeds, and tracked
GitHub repo releases — but they were never scheduled (they live in `skills/social-engine/`,
which has no `sensor.ts`, so `arc-sensors.timer`'s discovery never touches them), and nothing
has ever read their `is_promotable=1` output either. `research_nugget`'s last row before this
skill existed was dated 2026-06-19.

This sensor closes both gaps:

1. **Runs each enabled producer on its own configured cadence** (`research_source_config`'s
   `fetch_interval_minutes` / `last_fetched_at` — `hn`=360min, `rss`=720min,
   `github_release`=360min; `reddit` stays `enabled=0`, confirmed 403-from-VM-IP since
   2026-06-19, out of scope here).
2. **Files a `Research:` task for the top-ranked promotable nuggets** (`is_promotable=1 AND
   promoted_at IS NULL`, capped at 3/run) into the SAME `arc-link-research` path
   `candidate-maturation` (Phase 2) already proved for X-sourced candidates — not a fork.

## Sensor

- Name: `research-nugget-relay`
- Cadence: 240 minutes (`claimSensorRun("research-nugget-relay", 240)`) — this is just the
  outer look-gate; each producer still honors its own configured interval independently.
- No CLI — sensor-only.

## The bridge (Phase 5, `src/nugget-bridge.ts`)

When a filed task's `arc-link-research -- process` run comes back, the nugget-bridge hook
(wired into `cmdProcess`) finds THIS SAME `research_nugget` row again via the
`source_url`/`content_hash` join key — not a duplicate — and fills in `report_path`. The two
directions of the bridge (report→nugget, nugget→task→report) meet on one row.
