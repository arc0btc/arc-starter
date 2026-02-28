---
name: release-watcher
description: Detects new releases on watched repos and creates review tasks
tags:
  - monitoring
  - github
  - ecosystem
---

# release-watcher

Monitors watched GitHub repos for new releases. When a new release is detected, creates a task to review the changelog and assess impact.

## How It Works

The sensor runs every 120 minutes. For each watched repo, it calls `gh api /repos/:owner/:repo/releases/latest` and compares the tag against stored state in `db/hook-state/release-watcher.json`. When a new tag is found, it creates a low-priority task to review the release.

## Watched Repos

Same list as aibtc-maintenance:
- `aibtcdev/landing-page`
- `aibtcdev/skills`
- `aibtcdev/x402-api`
- `aibtcdev/aibtc-mcp-server`

## Sensor Behavior

- **Interval:** 120 minutes
- **Dedup:** Uses `taskExistsForSource()` — one task per release tag per repo, ever
- **Source format:** `sensor:release-watcher:{owner}/{repo}@{tag}`
- **Priority:** 7 (low, informational)
- **State:** Stores last-seen tag per repo in hook state file

## Task Output

Created tasks include the release tag, name, URL, and a truncated body for context. The dispatched session should read the full release notes and summarize impact on our projects.
