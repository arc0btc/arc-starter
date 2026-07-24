---
name: arc-packaging
description: The standing SKU-packaging pipeline stage — turns a fresh relevance-4/5 research report into a published Whop SKU with dual-audience-frame copy and membership unlock-all, automatically
updated: 2026-07-03
tags:
  - monetization
  - content
  - whop
  - research
---

# arc-packaging

Consumes `arc-link-research`'s SKU backlog (`research/INDEX.md`'s `## SKU backlog` table,
pre-filtered to `sku_candidate: y` / `packaged: n`) as an active pipeline stage (P3 of
`arc-demand-flywheel`). Full design rationale and history: `skills/arc-packaging/REFERENCE.md`.

## The 3-step contract

1. **`materials`** (deterministic) — picks the next eligible candidate via
   `lib/backlog.ts`'s `selectCandidate()` (resume-first: a report stuck `queued`/`claimed` from
   an interrupted attempt wins over starting new; otherwise highest relevance, then oldest
   report), claims it (`INSERT OR IGNORE` into `packaging_queue_log`, keyed by `report_file`),
   and writes a materials brief to `db/packaging-materials/<slug>.json` — the report's full text,
   `sku_why`, a suggested $9 price, and required dual-audience-frame instructions (audience is
   LOCKED to agent operators, QUEST.md #11: a human line + an agent line, don't overclaim x402
   delivery, vary the closing sentence per SKU).
2. **The dispatch-cycle LLM turn** (SOUL.md-gated) drafts `{ title, headline, description, quiz }`
   to `<slug>.draft.json`. The description must contain both audience frames verbatim-or-near, and
   stay under **1500 chars** (hard API limit). The headline has an **80-char** hard limit. `quiz`
   is **required**: ≥3 `QuizQuestion`s drawn from the report's own claims (see
   `MaterialsBrief.voiceInstructions.quiz`). `stage` hard-fails on any violation with a clear error
   list, not a raw exception.
3. **`stage --report <file>`** (deterministic) — validates the draft, then if valid:
   - strips internal-only content (`cleanDeliverableMarkdown()`: drops the Recommendations
     backlog table, converts wiki-links to plain text, relabels Provenance as customer-facing,
     drops cache-hash/task-ID lines)
   - mints the SKU via `whop create-product` (created hidden), passing `--quiz` alongside
     `--report` so the deliverable attaches atomically with creation
   - closes the loop via `arc-link-research mark-packaged`
   - wires membership unlock-all silently (`--skip-chat` — see below)
   - generates + attaches a cover (`lib/cover.ts`'s `renderSkuCover()`, deterministic, motif =
     the SKU's own live title/headline numbers; panel rules in
     `manage-agents/ops/store-covers/BRAND-KIT.md`)
   - **publishes as the terminal step** (`whop set-visibility --visibility visible`) — but only
     if BOTH the cover attach and quiz attach succeeded. If either failed, the SKU stays
     `packaged` but hidden with a log naming which step failed and the manual retry command.
     Pass `--keep-hidden` to skip auto-publish regardless of outcome. Rollback:
     `bin/arc skills run --name whop -- set-visibility --product <prod_> --plan <plan_> --visibility hidden`
   - emails the operator a summary (product/checkout/promo links + rollback command), reporting
     read-back visibility for awareness, not as a review gate

## Membership unlock-all (`whop unlock-all`)

No server-side "grant membership" call exists in `@whop/sdk` — "unlock" means create-or-find a
100%-off, unlimited-stock, `product_id`-scoped promo code (same primitive as the membership's
`FREEMONTH_PROMO_ID`).

```
arc skills run --name whop -- unlock-all --product prod_xxx [--plan plan_xxx] [--title <t>] [--skip-chat]
```

`stage` always passes `--skip-chat`: the promo/entitlement is created but no chat announcement
fires automatically — premature-exposure risk (dev-council 2026-07-03). Operator reviews via the
email `stage` sends and posts the announcement themselves (or asks Arc to), into "AI Prefers
Bitcoin" (`exp_I2Wew0PqJQ50a8`, blanket pre-approved per CADENCE.md).

## CLI

```
bun skills/arc-packaging/cli.ts materials [--report <filename-in-research/>]
bun skills/arc-packaging/cli.ts stage --report <filename> [--dry-run] [--force-sanitization] [--keep-hidden]
bun skills/arc-packaging/cli.ts status
```

`--report` on `materials` forces a specific candidate (bypasses selection order) — for
demos/testing. `--force-sanitization` on `stage` is a human-only escape hatch for a confirmed
sanitizer false positive; the automated sensor task never passes this flag.

## Sensor

Cadence: every 24h. Supply-side only — publishes each SKU to the storefront, but never pushes
into any feed/timeline/chat (member-facing announcement still requires a human). Dedup key is
the candidate's own `report_file`. Kill-switch (`outbound_enabled`) checked. Never mints anything
itself — stops at queuing a dispatch task; `materials`/`stage` (run by the dispatch-cycle LLM) do
the actual work.

A second lane, `arc-packaging-hidden-escalation` (6h cadence), watches `packaging_queue_log` rows
`status='packaged'` whose `packaged_at` is >72h old, reads the live Whop visibility, and — if
still hidden (meaning the cover/quiz attach failed and was never retried) — queues a review task
(7-day cooldown per product).

## Schema

`packaging_queue_log` (`db/arc.sqlite`): `report_file` (PK), `slug`, `route`, `relevance`,
`sku_why`, `status` (`queued` → `claimed` → `packaged`, or `duplicate` if the dedup-before-mint
gate rejects it — both terminal), `product_id`/`plan_id` (written immediately after mint, before
the next subprocess call, so a mid-pipeline crash is still auditable from the DB alone),
`promo_code_id`, `queued_at`, `claimed_at`, `packaged_at`.

Claim is compare-and-swap (`UPDATE ... WHERE status='queued'` + a `changes`-count check), not a
bare UPDATE.

## Dedup-before-mint gate

`stage` checks the candidate's `source_url`/`topics` against every already-packaged report's
front-matter via `arc-link-research`'s `findCoverage()` — a hit means a live Whop product already
covers the same url/topic, so `stage` aborts before minting and marks the row `duplicate`. Runs
in `--dry-run` too.

## When to Load

Load when the sensor's dispatch task fires, or when manually running `materials`/`stage`. Pair
with `arc-link-research` (produces the backlog this skill consumes) and `whop` (the underlying
SKU-minting + membership CLI this skill shells out to). See `REFERENCE.md` for design rationale,
known carry-forwards, and the relationship to the dormant course-publishing capability.
