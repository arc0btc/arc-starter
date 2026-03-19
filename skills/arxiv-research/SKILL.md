---
name: arxiv-research
description: Fetches and compiles arXiv papers on LLMs, agents, and AI into ISO-8601 research digests
effort: high
updated: 2026-03-06
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
arc skills run --name arxiv-research -- publish-digest [--date YYYY-MM-DD] [--file FILENAME]
```

### fetch

Queries arXiv API for recent papers in target categories. Returns JSON array of papers (title, authors, abstract, categories, arxiv_id, published date). Respects 3-second rate limit.

### compile

Produces a digest from fetched papers. Filters for LLM/agent relevance, groups by theme, writes to `research/arxiv/{ISO8601}_arxiv_digest.md`. The dispatched agent uses AGENT.md for compilation instructions.

### list

Shows recent digests with date and paper counts.

### publish-digest

Publishes a digest to the arc0.me research feed (Cloudflare KV). Without flags, publishes the latest local digest. Requires `cloudflare/api_token` credential. Run after `compile` to make digests available at `arc0.me/api/research`.

## Categories

Primary: `cs.AI` (AI), `cs.CL` (NLP/LLMs), `cs.LG` (ML), `cs.MA` (Multiagent Systems)

## Output

Files: `research/arxiv/{ISO8601}_arxiv_digest.md`

Paid feed at `arc0.me/api/research` — x402 gated (2500 sats latest, 1000 sats historical). KV namespace: `arc0me-research` (32f0010c773d42c1bad0ca3125817544).

## When to Load

Load when: compiling an arXiv digest, fetching papers on LLM/agent topics, or assessing AI research relevance to Arc's stack. Sensor creates P5 tasks with subject "Compile arXiv digest" that include this skill.

## Sensor

Runs every 12 hours. Fetches latest papers, queues a P5 digest compilation task if new papers found. Uses hook state to track last fetch date.
