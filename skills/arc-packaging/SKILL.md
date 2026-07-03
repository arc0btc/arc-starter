---
name: arc-packaging
description: The standing SKU-packaging pipeline stage — turns a fresh relevance-4/5 research report into a hidden Whop SKU with dual-audience-frame copy and membership unlock-all, automatically
updated: 2026-07-03
tags:
  - monetization
  - content
  - whop
  - research
---

# arc-packaging

Extends `arc-link-research`'s SKU backlog (`research/INDEX.md`'s `## SKU backlog` table,
already pre-filtered to `sku_candidate: y` / `packaged: n`) into an ACTIVE pipeline stage — P3
of `arc-demand-flywheel`. Before this skill existed, the backlog was a passive list someone had
to remember to work; this sensor consumes it on a cadence so it no longer grows unbounded.

## The 3-step contract (mirrors `arc-daily-read`'s P1 / `arc-article-pipeline`'s P2 design)

1. **`materials`** (deterministic) — picks the next unqueued relevance>=4 candidate from the
   SKU backlog table (highest relevance first, then oldest report first — FIFO within a tier),
   claims it (`INSERT OR IGNORE` into `packaging_queue_log`, keyed by `report_file`), and writes
   a materials brief to `db/packaging-materials/<slug>.json` — the full report text, `sku_why`,
   a suggested $9 price, and the **required dual-audience-frame instructions** (audience is
   LOCKED to agent operators, QUEST.md #11): a human line ("operator: give this to your agent")
   and an agent line ("read this content").
2. **The dispatch-cycle LLM turn** (SOUL.md-gated) drafts
   `{ title, headline, description }` to `<slug>.draft.json`. The description MUST contain
   both audience frames verbatim-or-near-verbatim — `stage` hard-fails otherwise.
3. **`stage --report <file>`** (deterministic) — validates the draft (dual-frame check + a
   regex secrets scan over the report text AND the drafted copy), then, only if valid:
   - mints the SKU via `whop create-product` (HIDDEN by that command's own existing default —
     no operator gate needed to mint; nothing is public until a separate visibility flip)
   - closes the loop via `arc-link-research mark-packaged` (flips the report's
     `packaged: y`, rebuilds `research/INDEX.md`, the backlog count drops)
   - wires **membership unlock-all** via the new `whop unlock-all` command (see below)

## CLI

```
bun skills/arc-packaging/cli.ts materials [--report <filename-in-research/>]
bun skills/arc-packaging/cli.ts stage --report <filename> [--dry-run]
bun skills/arc-packaging/cli.ts status
```

`--report` on `materials` forces a specific candidate (bypasses selection order) — useful for
demos/testing; default behavior always picks the next unqueued relevance>=4 candidate.

## Membership unlock-all (`whop unlock-all`)

There is **no server-side "grant membership" call in `@whop/sdk`** (checked every
`resources/*.d.ts` — no `memberships.create`). The only real primitive is a promo code applied
at checkout, so "unlock" means: create-or-find a **100%-off, unlimited-stock, `product_id`-
scoped promo code** (same primitive already live for the membership's own `FREEMONTH_PROMO_ID`),
then announce the $0 redemption link ONCE into the members-only "AI Prefers Bitcoin" chat
(`exp_I2Wew0PqJQ50a8` — paid-chat posting has blanket pre-approval, CADENCE.md 2026-07-03) so
every current AND future $49/mo member can self-redeem. Idempotent on both the promo (find by
`product_id` scope) and the chat post (`whop_post_log` dedup via `--source`).

```
arc skills run --name whop -- unlock-all --product prod_xxx [--plan plan_xxx] [--title <t>] [--skip-chat]
```

## Sensor

Cadence: every 24h. This is a supply-side stage (mints HIDDEN products only, no public
exposure until the operator's own visibility flip) so it can run faster than P2's 48h
demand-channel floor without the "looks spammy on turn-on" risk that applies to public content.
Checks the live backlog count against `packaging_queue_log` before queuing — skips silently if
there's nothing new to package. Kill-switch (`outbound_enabled`) and dedup
(`pendingTaskExistsForSource`) checked. **Never mints anything itself** — stops at queuing a
dispatch task; `materials`/`stage` (run by the dispatch-cycle LLM) do the actual work.

## Schema

`packaging_queue_log` (additive, `db/arc.sqlite`): `report_file` (PK, the natural key — a
report gets exactly one row), `slug`, `route`, `relevance`, `sku_why`, `status`
(`queued` -> `claimed` -> `packaged`), `product_id`, `plan_id`, `promo_code_id`, `queued_at`,
`claimed_at`, `packaged_at`.

## Relationship to the dormant course-publishing capability

This is NOT the same thing as the raw `create-course`/`create-chapter`/`create-lesson` CLI used
directly against the shared "Courses" experience (`exp_rm8XtYSqYIBzrl`, attached to the $49/mo
membership) for STRATEGY.md's Phase 2/3 "evergreen multi-part courses" vision. This skill's
`create-product` deliverable IS a per-SKU mini-course (via `attachDeliverable`'s existing,
already-proven-live logic) — a single report as a single-lesson course, not authored multi-part
content. P3's `CHECKPOINTS.md` entry decided to retire (deprioritize, not delete) the evergreen
multi-part vision for this quest — see that entry for the full rationale and reversal path.

## When to Load

Load when the sensor's dispatch task fires, or when manually running `materials`/`stage`. Pair
with `arc-link-research` (produces the backlog this skill consumes) and `whop` (the underlying
SKU-minting + membership CLI this skill shells out to).
