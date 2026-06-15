---
name: snippet-producer
description: Chop a published blog post into 3-5 shareable quote-card snippets in the source-artifact pool, tagged for the X and Nostr social channels.
updated: 2026-06-15
tags:
  - inflows
  - content
  - social
---

# snippet-producer

The PRODUCER that feeds the empty social pools. Arc's X cadence (P12) and Nostr outlet
(P13) are live pool CONSUMERS, but the `x`/`nostr` channels sat empty — the three
existing distillers (arxiv/council/watch-interior) tag mostly `blog`/`whop-chat`. This
sensor chops a published long-form blog post into shareable quote-card snippets so the
social outlets finally have something to drip.

The sensor detects the newest PUBLISHED blog post
(`github/arc0btc/arc0me-site/src/content/docs/blog/*.mdx`, `draft:false`) not yet
chopped; the dispatched session writes 3-5 snippets via `writeDistilled` (in
`src/artifacts.ts`) as `type:"snippet"`, tagged `suggested_channels:["x","nostr"]`.

## Consumers

- **X cadence** (`skills/social-x-posting/sensor.ts`) — the `blog-snippet` beat reads
  `recentArtifacts("snippet", { channel: "x" })` and posts the snippet near-verbatim. A
  waiting snippet takes priority over the random rotation (deterministic drip); the empty
  pool falls back to the rotation.
- **Nostr** (`skills/nostr/sensor.ts`) — iterates all `ARTIFACT_TYPES` for `channel:"nostr"`,
  so it auto-picks `snippet` artifacts and posts one kind:1 note per tick.

Each consumer posts exactly-once via its own `--source` POST ledger (`x_post_log` /
`nostr_post_log`) plus `markConsumed`, so a snippet never double-posts.

## Cadence

60-min sensor. Only the NEWEST published post is considered (no backlog batch) — like
arxiv-distill considers only the newest digest. Per-blog dedup via `createSourceLedger`
(`snippet_source_log`, source key `snippet-producer:<date-slug>`); recorded at dispatch
so a post is chopped exactly once. Clear the ledger row to re-chop.

## Gate

`SNIPPET_PRODUCER_ENABLED=true` (default OFF). `ARC_DISTILL_FORCE=1` bypasses for a manual tick.

## Quality bar

- Each nugget ≤ 280 chars (fits an X post AND a Nostr kind:1 note) — the consumer posts
  it near-verbatim, so it must read as a finished, standalone chapter (not "I wrote a blog").
- DISTINCT excerpts — never reproduce the whole post; each snippet is one sharp idea.
- Selection over invention; cite the source blog (`blog:<date-slug>`).
- 3-5 snippets; fewer is fine when the post yields fewer genuinely shareable ideas.

## Channels

Snippets are tagged `["x","nostr"]` only — the two channels with LIVE pool consumers.
`whop-forum`/`public-forum` have no pool consumer yet (P9 deferred the pool path), so
tagging them would dead-end; add those tags when their consumers land.
