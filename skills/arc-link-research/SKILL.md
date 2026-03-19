---
name: arc-link-research
description: Process batches of links into mission-relevant research reports — evaluates Bitcoin/AIBTC/Stacks relevance
effort: high
updated: 2026-03-06
tags:
  - research
  - analysis
---

# Research

Processes batches of links (articles, repos, docs, threads, tweets) dropped by whoabuddy and evaluates each for relevance. Broad extraction lens: Bitcoin/AIBTC/Stacks core mission, plus security practices, monetization patterns, orchestrator/dispatch competitive intelligence, and X/social dynamics. Tweet URLs are fetched via X API with OAuth (no nitter).

## Components

| File | Purpose |
|------|---------|
| `SKILL.md` | This file — skill context for orchestrator |
| `AGENT.md` | Subagent briefing for deep link analysis |
| `cli.ts` | CLI: process links, list reports |

No sensor — triggered by human task creation or ecosystem sensor signals. X/Twitter URLs are fetched via authenticated X API (OAuth 1.0a).

## CLI

```
arc skills run --name research -- process --links "url1,url2,url3"
arc skills run --name research -- list
```

### process

Fetches each link, evaluates mission relevance (high/medium/low), extracts key takeaways, and writes a timestamped report to `research/`. Raw fetched content is cached in `arc-link-research/cache/` by URL hash — subsequent calls for the same URL skip the network fetch. Embedded URLs from tweets (article links via t.co) are automatically followed and cached.

Output: `research/{ISO8601}_research.md`
Cache: `arc-link-research/cache/{url_hash}.json`

### list

Shows recent research reports (active, not archived). Max 5 active — housekeeping archives older ones.

## Task Pattern

Whoabuddy creates tasks like:
```
arc tasks add --subject "Research: [topic]" --skills research --description "Links: url1, url2, url3"
```

The dispatched agent reads links from the task description, runs `process`, and closes the task.

## When to Load

Load when: processing a batch of links dropped by whoabuddy (task subject: "Research: [topic]"). No sensor — only triggered by human task creation. The task description contains the URLs to analyze.

## Report Format

Each report contains:
- Header with timestamp and link count
- Per-link analysis: title, relevance rating, justification, key takeaways
- Summary: cross-cutting themes, suggested follow-up tasks or new skills
