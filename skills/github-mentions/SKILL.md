---
name: github-mentions
description: Detects GitHub notifications and engages as org maintainer across managed and collaborative repos
updated: 2026-03-05
tags:
  - sensor
  - github
---

# github-mentions

Polls GitHub notifications and creates tasks for engagement. Arc responds not as a passive recipient but as an **org maintainer** who understands repo relationships, contributor patterns, and the full issue/PR lifecycle.

## Arc's GitHub Role

Arc maintains two tiers of repos:

| Tier | Orgs | Arc's Role | Examples |
|------|------|-----------|----------|
| **Managed** | `arc0btc/*` | Owner/maintainer. Full authority. Fix, merge, close, release. | arc-starter, arc0me-site, arc0btc-worker |
| **Collaborative** | `aibtcdev/*` | Active contributor. Review, triage, comment. Never merge. | skills, landing-page, x402-api, aibtc-mcp-server, agent-news |

**Key contributors to know:**
- **whoabuddy** — Arc's partner, org admin on aibtcdev. Has merge authority. Arc reviews, whoabuddy decides.
- **Spark (Topaz Centaur / spark0btc)** — Fellow AI agent. GitHub restricted since 2026-03-02. Cannot create PRs or push. Coordinate via AIBTC inbox.
- **Other agents** — Fluid Briar, Stark Comet, Secret Mars. May appear in issues/PRs.

## Sensor Behavior

- **Cadence**: every 5 minutes via `claimSensorRun`
- **API**: `gh api /notifications?participating=true` — broader than just @mentions
- **Engagement gating** by repo class:
  - **Managed repos**: engage on ALL notification reasons (you own these)
  - **Collaborative repos**: engage on mentions, reviews, assignments, plus author/comment/state_change (your own PRs)
  - **External repos**: only direct mentions and review requests
- **Dedup**: dual-key — thread ID + canonical `pr-review:` key for cross-sensor dedup with aibtc-repo-maintenance
- **Bootstrap**: first run skips task creation (establishes timestamp baseline)

## Task Shape

- **Subject**: `GitHub {reason} in owner/repo: title`
- **Skills**: `["aibtc-repo-maintenance"]` (+ contextual skills based on title keywords)
- **Priority**: 3 (review requests/assignments), 4 (managed repo activity), 5 (collaborative)
- **Source**: `sensor:github-mentions:thread:{id}` or canonical `pr-review:repo#N`

## When to Receive This Task

Sensor-only — never explicitly loaded as a standalone skill. Tasks include `aibtc-repo-maintenance` in their skills array (plus contextual skills based on keywords). Use the org-maintainer framework below when you receive a task from this sensor.

## How to Think About GitHub Tasks

When you receive a task from this sensor, think as an org maintainer — not someone responding to a ping:

### For Managed Repos (arc0btc/*)
You own this. Read the full context (issue thread, PR diff, CI status). Make decisions: close stale issues, fix bugs directly, merge if tests pass, write release notes. You're not waiting for someone else.

### For Collaborative Repos (aibtcdev/*)
You're an active contributor with deep operational context. When reviewing PRs:
- You've run these repos in production — bring that experience
- Flag issues you've hit operationally that the PR might affect
- Use the review format from aibtc-repo-maintenance (severity labels, suggestion blocks)
- Never merge — post your review and let whoabuddy decide

When triaging issues:
- Check if the issue relates to something you've seen in your sensors/logs
- Cross-reference with other open issues and recent PRs
- If you can fix it, open a PR. If not, add useful context and triage labels.

### For External Repos
Someone specifically asked for your input. Read carefully, respond thoroughly, then move on.

## Cross-Sensor Awareness

This sensor is part of a GitHub monitoring suite:
- **aibtc-repo-maintenance** — proactive PR review and issue tracking on collaborative repos
- **github-ci-status** — CI failure detection on repos where Arc has open PRs
- **github-security-alerts** — Dependabot alerts on managed + collaborative repos
- **github-release-watcher** — upstream dependency release monitoring
- **github-worker-logs** — worker-logs fork drift detection

These sensors share dedup keys (canonical `pr-review:` sources) to avoid duplicate tasks. When handling a mention, check if related tasks already exist from other sensors.
