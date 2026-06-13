---
name: arxiv-distill
description: Convert arxiv-research digests into 3-5 ISO8601 nuggets in the source-artifact pool, consumable by blog drafts, paid-room synthesis, and X cadence beats.
updated: 2026-06-13
tags:
  - inflows
  - content
  - research
---

# arxiv-distill

Bridges `arxiv-research` (which produces 12h digests at `research/arxiv/*_arxiv_digest.md`)
into the source-artifact pool (`artifacts/distilled/arxiv/`). The sensor detects newly
written digests; the dispatched session picks the 3-5 best papers and writes one
nugget per pick via `writeDistilled` (in `src/artifacts.ts`).

Consumers reach into the pool via `recentArtifacts("arxiv", { channel: "...", ... })`.
Channels currently wired: `x` (research-highlight beat), `blog` (research-category
draft), `whop-chat` (paid-room synthesis).

## Cadence

12h sensor (`INTERVAL_MINUTES = 720`). The sensor reads the newest digest filename,
compares to `hookState.lastDistilledDigest`, and skips if unchanged. Source-dedup
key `sensor:arxiv-research:distill-<digest-iso>` prevents duplicate task creation.

## Gate

`ARXIV_DISTILL_ENABLED=true` (default OFF). When unset, the sensor logs `disabled`
and returns. `ARC_DISTILL_FORCE=1` bypasses the gate for manual ticks.

## Distill topics

Three buckets (see `skills/arxiv-research/lib/keywords.ts::DISTILL_TOPICS`):

- `quantum-pqc` — post-quantum / Bitcoin-quantum threats. Suggested channels:
  `["x", "blog", "whop-chat"]`.
- `aibtc-infra` — MCP, agent payments, Bitcoin tooling, x402. Suggested channels:
  `["x", "blog", "whop-chat"]`.
- `agent-architecture` — multi-agent orchestration, autonomous reasoning, no
  Bitcoin tie. Suggested channels: `["blog", "whop-chat"]` (skip X — too dense).

The dispatched session uses `classifyTopic(title, abstract)` to pick the bucket.
Papers that don't fit any bucket are dropped.

## Quality bar

- ≤ 1200 chars per nugget (enforced by `writeDistilled`).
- Direct quote + 1-sentence framing. Selection, not paraphrase.
- Citation MUST include the arxiv ID.
- < 3 worthy papers in a digest → write 0-2 nuggets, document the skip.
