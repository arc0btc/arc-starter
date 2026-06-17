---
name: arc-link-research
description: Process batches of links into mission-relevant research reports — evaluates Bitcoin/AIBTC/Stacks relevance
updated: 2026-03-06
tags:
  - research
  - analysis
disallowed-tools:
  - Edit
  - Write
  - NotebookEdit
  - Bash
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
arc skills run --name arc-link-research -- prescreen --links "url1,url2,..."
arc skills run --name arc-link-research -- process --links "url1,url2,url3"
arc skills run --name arc-link-research -- list
```

### prescreen

**Use this before creating research tasks for x.com/Twitter URLs.** Checks each tweet for accessibility (deleted or private tweets return inaccessible). Returns JSON with `accessible` and `skipped` arrays. Only create tasks for URLs in `accessible`.

```bash
arc skills run --name arc-link-research -- prescreen --links "https://x.com/user/status/123,https://x.com/user/status/456"
```

### process

Fetches each link, evaluates mission relevance (high/medium/low), extracts key takeaways, and writes a timestamped report to `research/`. X/Twitter links are pre-screened automatically inside `process` — inaccessible tweets are skipped. Raw fetched content is cached in `arc-link-research/cache/` by URL hash.

```bash
arc skills run --name arc-link-research -- process --links "url1,url2,url3" [--section "Section Name"]
```

**`--section` flag (awesome-list decomposition):** When the link is a GitHub repo (awesome-list), pass `--section "Section Name"` to scope URL extraction to that `## heading` only. Without `--section`, the tool extracts URLs from the first ~3000 chars of the README, which returns the wrong section. The heading match is fuzzy (strips emoji/punctuation). Always use `--section` for awesome-list tasks.

If the task description contains `Section: <name>`, extract that name and pass it as `--section`.

Output: `research/{ISO8601}_research.md`
Cache: `skills/arc-link-research/cache/{url_hash}.json`

### list

Shows recent research reports (active, not archived). Max 5 active — housekeeping archives older ones.

## Task Pattern

Whoabuddy creates tasks like:
```
arc tasks add --subject "Research: [topic]" --skills research --description "Links: url1, url2, url3"
```

The dispatched agent reads links from the task description, runs `process`, and closes the task.

**Awesome-list tasks:** If the description includes `Section: <name>`, extract the section name and pass it as `--section`:
```bash
arc skills run --name arc-link-research -- process --links "https://github.com/owner/awesome-list" --section "Multi-Agent Swarms"
```

## When to Load

Load when: processing a batch of links dropped by whoabuddy (task subject: "Research: [topic]"). No sensor — only triggered by human task creation. The task description contains the URLs to analyze.

## Report Format

Each report contains:
- Header with timestamp and link count
- Per-link analysis: title, relevance rating, justification, key takeaways
- Summary: cross-cutting themes, suggested follow-up tasks or new skills
