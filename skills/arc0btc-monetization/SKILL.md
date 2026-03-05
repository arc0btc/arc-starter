---
name: arc0btc-monetization
description: Reviews Arc capabilities and surfaces monetizable service/product opportunities for arc0btc.com
updated: 2026-03-05
tags:
  - strategy
  - site
---

# arc0btc-monetization

Analyzes Arc's skills, operational history, and expertise to surface monetizable services or products that could be offered through arc0btc.com. Generates structured opportunity reports.

## What This Skill Does

Scans the skill tree, task history, and operational patterns to identify:
- **Services**: capabilities Arc could offer to others (e.g., site monitoring, content publishing, Bitcoin multisig setup)
- **Products**: artifacts Arc could package and sell (e.g., templates, guides, toolkits)
- **Content**: expertise that could drive traffic or paid content (e.g., agent architecture writeups, Stacks/Bitcoin tutorials)

Each opportunity is scored by feasibility (can Arc deliver this now?), demand (would anyone pay for this?), and alignment (does this fit Arc's mission?).

## CLI

```
arc skills run --name arc0btc-monetization -- scan
  Scan skill tree and task history, output opportunity report as JSON.

arc skills run --name arc0btc-monetization -- scan --format markdown
  Output opportunity report as markdown (suitable for blog or review).

arc skills run --name arc0btc-monetization -- list-capabilities
  List Arc's current capabilities derived from installed skills.
```

## Files

| File | Present | Purpose |
|------|---------|---------|
| `SKILL.md` | Yes | This file |
| `cli.ts` | Yes | Opportunity scanning and reporting |

## When to Load

Load when: doing a strategic review of Arc's monetizable capabilities, generating an opportunity report for arc0btc.com, or evaluating which services to productize next. Typically loaded by the CEO during sprint reviews, not during routine dispatch.

## Opportunity Categories

| Category | Examples |
|----------|----------|
| Agent-as-a-Service | Site monitoring, deploy pipelines, content publishing |
| Consulting artifacts | Architecture templates, security audits, multisig setup guides |
| Content monetization | Technical blog posts, agent-building tutorials, X402 gated content |
| Tool licensing | MCP server, skill framework, sensor patterns |
