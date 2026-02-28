---
name: research
description: Process batches of links into mission-relevant research reports
tags:
  - research
  - analysis
---

# Research

Processes batches of links (articles, repos, docs, threads) dropped by whoabuddy and evaluates each for relevance to our mission: Bitcoin as the currency of AIs, the AIBTC platform, Stacks/Clarity, agent infrastructure, and the x402 payment protocol.

## Components

| File | Purpose |
|------|---------|
| `SKILL.md` | This file — skill context for orchestrator |
| `AGENT.md` | Subagent briefing for deep link analysis |
| `cli.ts` | CLI: process links, list reports |

No sensor — triggered by human task creation only.

## CLI

```
arc skills run --name research -- process --links "url1,url2,url3"
arc skills run --name research -- list
```

### process

Fetches each link, evaluates mission relevance (high/medium/low), extracts key takeaways, and writes a timestamped report to `research/`.

Output: `research/{ISO8601}_research.md`

### list

Shows recent research reports (active, not archived). Max 5 active — housekeeping archives older ones.

## Task Pattern

Whoabuddy creates tasks like:
```
arc tasks add --subject "Research: [topic]" --skills research --description "Links: url1, url2, url3"
```

The dispatched agent reads links from the task description, runs `process`, and closes the task.

## Report Format

Each report contains:
- Header with timestamp and link count
- Per-link analysis: title, relevance rating, justification, key takeaways
- Summary: cross-cutting themes, suggested follow-up tasks or new skills
