---
id: research-batch-triage-process-once
topics: [arc-link-research, research-triage, fan-out, cost-efficiency, dispatch]
source: task #20093 (2026-06-27 21-link batch triage)
created: 2026-06-27
---

# Research-batch triage: run `process` ONCE as the mechanical pass, then fan out

When a triage task hands you a large link batch (e.g. 21 links) with a "cache → dedup →
relevance-gate → fan out one task per topic" protocol, do NOT fetch the links one at a time
inline (burns orchestrator context + budget). Instead:

1. **One mechanical pass:** `arc skills run --name arc-link-research -- process --links "<all>" --task <id> --parent <p>`.
   This is the no-LLM triage tool — it caches every URL's readable text to
   `skills/arc-link-research/cache/<hash>.json`, **auto-follows embedded t.co/article links**,
   and emits **ONE batch report** (per-link relevance high/med/low + keyword topics). Not 21 reports.
2. **Read the batch report** for the first-cut gate, then **read caches for bare-link tweets**
   (`bun -e` over `cache/*.json` → url + title + rawContent slice). The keyword heuristic is
   noisy on bare t.co tweets — the real signal is in the embedded article (`Article content:
   {title, plain_text}`), so a tweet the heuristic scored "low" can be relevance 4 once resolved.
3. **Apply judgment:** consolidate near-duplicate tweets into one topic (this batch: 6 loop-themed
   tweets → 2 topics, 3 memory tweets → 1), skip relevance ≤1 with a one-line note (no slop-by-catalog),
   dedup against `research/INDEX.md` (note "extends [[existing]]", don't re-research).
4. **Fan out** one task per surviving topic — opus for code-grounded reports, sonnet for thin
   summarize-fetch — each instructed to **REUSE the cache and NOT re-run `process`** (a second
   `process` writes a duplicate batch report + pollutes INDEX). Then one lower-priority synthesis task.

**Why `process` and not per-link WebFetch:** X tweets need OAuth (WebFetch fails on x.com); `process`
already has the X API path + embedded-link following + caching. It is the cheapest correct triage.

**Cost:** the 21-link `process` triage + cache reads + 15 task creations ran ~$2.3. The expensive
grounded reports happen in the fanned-out dispatch cycles (separate budgets), not in the triage task.

Related: [[self-fork-inherits-full-context]] (why not to fan-out via Agent here),
[[content-publish-verify-deploy]], dedup convention [[dead-ends-convention]].
