---
name: github-issues
description: GitHub issue intake for Forge — sensor detects assigned/labeled issues, CLI provides triage and code analysis workflow
updated: 2026-03-18
tags:
  - github
  - issues
  - triage
  - sensor
---

# github-issues

Forge's GitHub issue pipeline. Sensor polls watched repos for newly opened or updated issues and creates triage tasks. CLI provides issue inspection and code analysis commands.

## Sensor Behavior

- **Cadence**: 15 minutes
- **Auth**: Uses `GITHUB_TOKEN` env var if available; falls back to unauthenticated (60 req/hr, public repos only)
- **Repos**: configured in `db/github-issues-config.json` (defaults: aibtcdev/aibtc-mcp-server, aibtcdev/skills, aibtcdev/landing-page)
- **Filter**: open issues updated in last 24h; optionally filtered by assignee or label
- **Dedup**: workflow-based — checks `getWorkflowByInstanceKey('github-issue-{repo}-{number}')` before creating. If a `github-issue-implementation` workflow already exists (any state), skips entirely. The `arc-workflows` meta-sensor creates tasks from workflow state.

## Task Shape

Tasks are created by the `arc-workflows` meta-sensor (not directly by this sensor) once the `github-issue-implementation` workflow instance is in `detected` state.

- **Subject**: `[owner/repo] Analyze and plan #N — title`
- **Skills**: `["github-issues"]`
- **Priority**: 5 (default from state machine)
- **Source**: `workflow:{workflow_id}`

## Priority Routing

| Label / Condition         | Priority | Model  |
|---------------------------|----------|--------|
| bug / security / critical | P3       | opus   |
| feature / enhancement     | P5       | sonnet |
| question / doc / help     | P7       | haiku  |
| (no matching label)       | P5       | sonnet |

## Config File

Create `db/github-issues-config.json` to customize:

```json
{
  "repos": ["aibtcdev/skills", "myorg/myrepo"],
  "assigned_to": ["forge-agent"],
  "labels": ["forge", "needs-dev"]
}
```

Omit `assigned_to` and `labels` to capture all open issues in configured repos.

## CLI Commands

```
arc skills run --name github-issues -- list --repo OWNER/REPO
arc skills run --name github-issues -- triage --repo OWNER/REPO --issue N
arc skills run --name github-issues -- analyze --repo OWNER/REPO --issue N [--path PATH]
```

## When You Receive an Issue Task

1. Run `triage` to see full issue details
2. Classify: bug / feature / question / security
3. If a bug: run `analyze --path .` to cross-reference issue body against local source
4. If fixable: create a follow-up task (P3 Opus) to implement the fix on a branch
5. If a feature: assess effort and fit; create a planning task if approved
6. Close the triage task with a one-line summary

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] sensor.ts exports async default returning Promise<string>
- [x] cli.ts parses named flags, exits 1 on errors
