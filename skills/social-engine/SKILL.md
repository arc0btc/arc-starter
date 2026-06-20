---
name: social-engine
description: Social posting engine — admission primitive, P3 reply lane, P4 post lane, P5 research ingestion, P7 Moltbook experiment; live X send/reply via social-x-posting skill
updated: 2026-06-20
tags:
  - social
  - x-posting
  - research
  - content
disallowed-tools: [Edit, Write, NotebookEdit]
---

# social-engine

Stateful engine for outbound social actions on X. Coordinates three concerns: (1) admission — kill-switch, idempotency, cap enforcement, and CAS claim for both the post and reply lanes; (2) content pipelines P3–P7 that transform research inputs into posts/replies; (3) background producers that ingest external content (GitHub releases, HN, Reddit, RSS) into `research_nugget` rows.

All live sends go through `admission.ts` to prevent double-posts, respect caps, and record delivery state in SQLite.

## Components

### admission.ts (shared library)
Shared admission primitive. Both P3 (reply lane) and P4 (post lane) call `admitAction()` / `deferAction()` here.

Steps enforced: kill-switch check → idempotency gate → cap check → atomic claim (BEGIN EXCLUSIVE) → CAS claim → provider send → persist → reconcile.

Import path (from skills/social-engine/ scripts):
```ts
import { admitAction, deferAction } from './admission.ts';
```

### Pipeline Scripts (run via bun directly)
| Script | Purpose |
|--------|---------|
| `005-p3-reply-pipeline.ts` | P3: reply-lane live send — admits, CAS-claims, sends reply via social-x-posting |
| `006-p4-planned-posts.ts` | P4: loads planned posts from `social_post` rows |
| `006b-p4-engagement-log-deferred.ts` | P4: logs deferred engagement events |
| `007-p4-post-pipeline.ts` | P4: post-lane live send — admits, CAS-claims, sends post via social-x-posting |
| `008-p5-research-inputs.ts` | P5 migration: adds `research_nugget`, `nugget_source_delivery`, `research_source_config` tables |
| `009-p5-seed-source-config.ts` | P5 seed: populates `research_source_config` with ingestion sources |
| `011-p7-moltbook.ts` | P7 migration: adds `moltbook_post` table and seeds `checkout_config` |

### Producers
Ingest external content into `research_nugget` rows. READ-ONLY ingestion.
- `producer-github-release.ts` — GitHub releases via `gh` CLI
- `producer-hn.ts` — Hacker News Algolia API
- `producer-reddit.ts` — Reddit posts
- `producer-rss.ts` — Generic RSS feeds

### Monitors
Long-running monitors for the two outbound lanes.
- `monitor-post-lane.ts` — watches `social_post` for actionable rows, drives P4 pipeline
- `monitor-reply-lane.ts` — watches reply queue, drives P3 pipeline; writes gate evidence to `db/gate-evidence/`

### Live Read/Send Tools
One-shot diagnostic and send scripts. Run manually or via dispatch.
- `live-read-control-reply.ts` — reads control reply state
- `live-read-moltbook-capability.ts` — reads Moltbook capability config
- `live-read-moltbook-metrics.ts` — reads Moltbook experiment metrics
- `live-read-post-integrity.ts` — verifies post-lane integrity in DB
- `live-send-moltbook-post.ts` — sends a single Moltbook post (live, gated by admission)

### Fixtures (local test data)
- `fixture-p3-pipeline.ts` — P3 pipeline test fixture
- `fixture-p4-post-lane.ts` — P4 post lane test fixture
- `fixture-p5-axis-independence.ts`, `fixture-p5-decay.ts`, `fixture-p5-idempotency.ts`, `fixture-p5-provenance.ts` — P5 research-input fixtures

## Environment

All scripts read DB path via `ARC_DB_PATH` env var with local fallback. Set this before running:

```bash
export ARC_DB_PATH=/home/dev/arc-starter/db/arc.sqlite
```

Scripts that shell out to `social-x-posting` require the Arc credential store (`ARC_CREDS_PASSWORD`) and `arc creds` to be provisioned.

## Key DB Tables

| Table | Purpose |
|-------|---------|
| `social_post` | Planned post rows; P4 pipeline drives admission from here |
| `research_nugget` | Ingested research content from producers |
| `nugget_source_delivery` | Tracks which nuggets have been dispatched to which consumers |
| `research_source_config` | Per-source ingestion config (enabled, cadence, URL/repo) |
| `moltbook_post` | Moltbook experiment post rows |
| `agent_config` | Live kill-switch and cap config read by admission |

## Composability

Live sends require `social-x-posting` skill for the actual X API call. This skill handles admission and state; `social-x-posting` handles the credential-gated HTTP send.

Dispatch tasks that execute social sends should include both skills:
```
arc tasks add --subject "..." --skills social-engine,social-x-posting --model sonnet
```

## Notes

- Pipeline scripts (005, 006, 007) already ran their one-time live sends during initial gating. They serve as canonical references for the delivery state machine.
- Migration scripts (008, 011) are additive-only and idempotent — safe to re-run.
- Absolute paths in some scripts (`CLI_PATH`, `PAYLOADS_DIR`, `ARC_DIR`) are hardcoded to `/home/dev/arc-starter/`. These work on the dev VM but are not portable. Fix if relocating the repo.
