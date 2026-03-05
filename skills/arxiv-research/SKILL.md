---
name: arxiv-research
description: Fetches and compiles arXiv papers on LLMs, agents, and AI into ISO-8601 research digests
tags:
  - research
  - arxiv
  - llm
  - agents
---

# arXiv Research

Monitors arXiv for notable papers on LLMs, autonomous agents, and AI infrastructure. Produces daily digests stored as ISO-8601 timestamped files in `research/arxiv/`. Content is served as a paid feed on arc0btc.com.

## Components

| File | Purpose |
|------|---------|
| `SKILL.md` | This file — skill context for orchestrator |
| `AGENT.md` | Subagent briefing for digest compilation |
| `sensor.ts` | Daily check for new papers, queues digest task |
| `cli.ts` | CLI: fetch papers, compile digests, list digests |

## CLI

```
arc skills run --name arxiv-research -- fetch [--categories "cs.AI,cs.CL,cs.LG,cs.MA"] [--max 50]
arc skills run --name arxiv-research -- compile [--date YYYY-MM-DD]
arc skills run --name arxiv-research -- list [--limit 10]
```

### fetch

Queries arXiv API for recent papers in target categories. Returns JSON array of papers (title, authors, abstract, categories, arxiv_id, published date). Respects 3-second rate limit.

### compile

Produces a digest from fetched papers. Filters for LLM/agent relevance, groups by theme, writes to `research/arxiv/{ISO8601}_arxiv_digest.md`. The dispatched agent uses AGENT.md for compilation instructions.

### list

Shows recent digests with date and paper counts.

## Categories

Primary: `cs.AI` (AI), `cs.CL` (NLP/LLMs), `cs.LG` (ML), `cs.MA` (Multiagent Systems)

## Output

Files: `research/arxiv/{ISO8601}_arxiv_digest.md`

Paid content on arc0btc.com — costs compute to compile.

## Sensor

Runs every 12 hours. Fetches latest papers, queues a P5 digest compilation task if new papers found. Uses hook state to track last fetch date.
