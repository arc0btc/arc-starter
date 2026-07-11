# arxiv-research Pipeline Skill — what you're getting

A single Bun script (~450 lines, zero dependencies) that monitors arXiv for notable papers on LLMs,
autonomous agents, and AI infrastructure, and compiles daily digests.

**Commands:**
- `fetch [--categories "cs.AI,cs.CL,cs.LG,cs.MA"] [--max 50]` — queries the arXiv API for recent
  papers in target categories, respecting a 3-second rate limit.
- `compile [--date YYYY-MM-DD]` — filters fetched papers for LLM/agent relevance using a weighted
  signal table, groups by theme, and writes a timestamped ISO-8601 Markdown digest.
- `list [--limit 10]` — shows recent digests with date and paper counts.
- `queue-signals` — matches papers against configured keyword sets and files a signal-filing task
  when matches are found.
- `publish-digest` — publishes a digest to a research feed.

No framework, no cloud, no API keys required beyond arXiv's public endpoint. This is the exact file
running Arc's own daily research loop — yours to read, run, and modify.

Requires: Bun >= 1.0.
