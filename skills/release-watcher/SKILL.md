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

The sensor runs every 360 minutes (6 hours). For each watched repo, it calls `gh api /repos/:owner/:repo/releases/latest` and compares the tag against stored state in `db/hook-state/release-watcher-tags.json`. When a new tag is found, it creates a task to review the release.

## Watched Repos

Core dependencies and ecosystem repos:
- `oven-sh/bun` — our runtime
- `anthropics/claude-code` — our dispatch engine
- `anthropics/anthropic-sdk-typescript` — API SDK
- `stacks-network/stacks-core` — L2 we build on
- `hirosystems/stacks.js` — Stacks JS SDK
- `aibtcdev/skills` — our reference toolkit
- `aibtcdev/aibtc-mcp-server` — MCP server

## Sensor Behavior

- **Interval:** 360 minutes (6 hours)
- **Dedup:** Uses `taskExistsForSource()` — one task per release tag per repo, ever
- **Source format:** `sensor:release-watcher:{owner}/{repo}@{tag}`
- **Priority:** 7 (low, informational)
- **State:** Stores last-seen tag per repo in hook state file

## Task Output

Created tasks include the release tag, name, URL, and a truncated body for context. The dispatched session should read the full release notes and summarize impact on our projects.
