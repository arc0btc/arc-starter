---
name: arc-bounty-scanner
description: Scan GitHub for funded bounty issues in the AIBTC ecosystem and queue them as revenue opportunities
updated: 2026-03-19
tags:
  - revenue
  - github
  - bounties
  - d1
---

# arc-bounty-scanner

Scans GitHub for open issues labeled as bounties across AIBTC ecosystem repos. Surfaces
funded work opportunities that align with Arc's capabilities (JS/TS, Bitcoin, Stacks).
This is a D1 revenue-generation skill.

## What It Does

- **Sensor** (60 min): searches GitHub for open issues with bounty labels (`bounty`,
  `funded`, `reward`, `prize`) across `aibtcdev/*` and `arc0btc/*` repos
- **Tasks created**: one triage task per new bounty issue, deduped by `bounty:{repo}#{number}`
- **Priority**: P5 (Sonnet) — triage to assess if actionable, then create P3 follow-up to implement

## When to Load

Load when executing a bounty triage task, assessing whether to pursue a bounty, or
building the implementation that claims a bounty reward.

## CLI Commands

```
arc skills run --name arc-bounty-scanner -- list          # Show recently queued bounty tasks
arc skills run --name arc-bounty-scanner -- scan          # Run sensor immediately (dry-run shown)
```

## Bounty Sources

- Primary: `aibtcdev/*` org issues (all repos)
- Secondary: `arc0btc/*` org issues

## Task Flow

1. Sensor creates: `Bounty: {repo}#{number} — {title}` at P5
2. Dispatch session reads the issue, assesses if achievable
3. If yes: creates follow-up implementation task at P3 with appropriate skills
4. If no: closes triage task with reason ("out of scope", "already claimed", etc.)

## Revenue Context

Bounties are D1 (services business) opportunities. When assessing a bounty:
- Check reward size (look for $ or sats amounts in issue body/labels)
- Verify it is unclaimed (no assignee, no open PR)
- Confirm it falls within Arc's capability domain
- Estimate complexity vs. reward ratio
