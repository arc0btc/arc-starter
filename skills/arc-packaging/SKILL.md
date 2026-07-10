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

Extends `arc-link-research`'s SKU backlog (`research/INDEX.md`'s `## SKU backlog` table,
already pre-filtered to `sku_candidate: y` / `packaged: n`) into an ACTIVE pipeline stage — P3
of `arc-demand-flywheel`. Before this skill existed, the backlog was a passive list someone had
to remember to work; this sensor consumes it on a cadence so it no longer grows unbounded.

## The 3-step contract (mirrors `arc-daily-read`'s P1 / `arc-article-pipeline`'s P2 design)

1. **`materials`** (deterministic) — picks the next eligible candidate via `lib/backlog.ts`'s
   `selectCandidate()` (resume-first: a report stuck `queued`/`claimed` from an interrupted
   prior attempt always wins over starting something new; otherwise highest relevance first,
   then oldest report first), claims it (`INSERT OR IGNORE` into `packaging_queue_log`, keyed by
   `report_file`), and writes a materials brief to `db/packaging-materials/<slug>.json` — the
   report's **full text** (`reportMarkdown`), `sku_why`, a suggested $9 price, and the
   **required dual-audience-frame instructions** (audience is LOCKED to agent operators,
   QUEST.md #11): a human line ("operator: give this to your agent") and an agent line ("read
   this content") — plus explicit guidance not to overclaim x402 delivery and to vary the
   closing sentence per SKU (both from dev-council/arc-strategy-panel review, 2026-07-03).
2. **The dispatch-cycle LLM turn** (SOUL.md-gated) drafts
   `{ title, headline, description }` to `<slug>.draft.json`. The description MUST contain
   both audience frames verbatim-or-near-verbatim — `stage` hard-fails otherwise (with a clear
   DEFERRED-style error list, not a raw exception). **The description also has a hard 1500-char
   limit** (Whop's `products.create` API rejects longer values) — write both audience frames
   concisely and stay under 1500 chars on the first draft; found live 2026-07-08 (task #21744)
   when a 1620-char draft failed at `stage` and had to be trimmed and re-run. **The headline
   also has a hard 80-char limit** — write it short on the first draft; found live 2026-07-10
   (task #21962) when a 153-char headline failed at `stage` and had to be shortened to 74.
3. **`stage --report <file>`** (deterministic) — validates the draft, then, only if valid:
   - strips internal-only content from the report before it becomes the deliverable
     (`cleanDeliverableMarkdown()` — drops Arc's own "Recommendations" backlog table, converts
     `[[wiki-links]]` to plain text, relabels "Provenance" as customer-facing and drops
     cache-hash/task-ID lines; a raw research report is written for Arc's own engineering
     backlog, not a paying stranger)
   - mints the SKU via `whop create-product` (still created hidden at this point)
   - closes the loop via `arc-link-research mark-packaged`
   - wires **membership unlock-all SILENTLY** (`--skip-chat` — a $0 promo code is created, but
     no announcement is posted; see below)
   - **PUBLISHES as the terminal step** via `whop set-visibility --visibility visible` (product
     + plan) — operator directive 2026-07-03: "the SKUs are up to arc to manage/publish and
     don't need my review either. same as the blog." Terminal on purpose (dev-council/Newman):
     the storefront never shows a SKU whose deliverable or member promo isn't wired yet, and a
     failed flip leaves the queue row `claimed` so the resume path re-runs the idempotent
     chain. Pass `--keep-hidden` to `stage` for the old hidden-until-operator-flip behavior;
     rollback for any published SKU is
     `bash bin/arc skills run --name whop -- set-visibility --product <prod_> --plan <plan_> --visibility hidden`
   - emails the operator a summary (product/checkout/promo links + rollback command) reporting
     the READ-BACK visibility — since the 2026-07-03 directive this is operator visibility,
     not a review gate

## Membership unlock-all (`whop unlock-all`)

There is **no server-side "grant membership" call in `@whop/sdk`** (checked every
`resources/*.d.ts` — no `memberships.create`). The only real primitive is a promo code applied
at checkout, so "unlock" means: create-or-find a **100%-off, unlimited-stock, `product_id`-
scoped promo code** (same primitive already live for the membership's own `FREEMONTH_PROMO_ID`).

```
arc skills run --name whop -- unlock-all --product prod_xxx [--plan plan_xxx] [--title <t>] [--skip-chat]
```

`arc-packaging stage` always calls this with `--skip-chat`: the promo is created (the
entitlement exists) but **no chat announcement fires automatically**. dev-council review
(2026-07-03) flagged the original always-announce design as a real premature-exposure risk — a
live $0 checkout link reaching real paying members before the operator has reviewed the SKU,
three subprocesses deep with no visibility. The operator gets everything needed (product page,
checkout URL, promo code, member redemption link) in the review email `stage` sends, and posts
the announcement themselves (into the members-only "AI Prefers Bitcoin" chat,
`exp_I2Wew0PqJQ50a8` — paid-chat posting has blanket pre-approval, CADENCE.md 2026-07-03) once
they've reviewed it, or asks Arc to. **Known limitation (logged, not fixed here):** a single
chat message is a weak activation signal even when the operator does fire it — a persistent,
browsable "member redemption links" post would reach more of the membership than an ephemeral
chat line; flagged as a carry-forward, not built this phase (scope).

## CLI

```
bun skills/arc-packaging/cli.ts materials [--report <filename-in-research/>]
bun skills/arc-packaging/cli.ts stage --report <filename> [--dry-run] [--force-sanitization] [--keep-hidden]
bun skills/arc-packaging/cli.ts status
```

`--report` on `materials` forces a specific candidate (bypasses selection order) — useful for
demos/testing. `--force-sanitization` on `stage` is a human-only escape hatch for a confirmed
sanitizer false positive (e.g. a legitimate research report quoting a `password=` config line);
the automated sensor's dispatch task never mentions this flag.

## Shared selection logic (`lib/backlog.ts`)

`parseSkuBacklog()` and `selectCandidate()` live in one shared module, imported by BOTH `cli.ts`
and `sensor.ts`. **This was not the original design** — the sensor originally computed its own
independent backlog count and compared it against `packaging_queue_log`'s row count, and dev-
council (unanimous, 4 of 5 lenses) found the two had already diverged into a real bug: the count
comparison silently stalled the pipeline around the halfway point of the 27-item backlog. There
is now exactly one answer to "is there anything to package right now," so the sensor and the
actual selector can no longer disagree.

## Sensor

Cadence: every 24h. This is a supply-side stage: since 2026-07-03 it publishes each SKU to the
storefront, but a new catalog item pushes nothing into any feed, timeline, or chat — the
member-facing announcement still never fires automatically, which is what the "looks spammy on
turn-on" risk (and P2's 48h demand-channel floor) actually guards against. Dedup key is the
candidate's own `report_file` (not a count-derived pseudo-sequence — dev-council/Lamport flagged
the earlier scheme as driftable under concurrent or manual runs). Kill-switch
(`outbound_enabled`) checked. **Never mints anything itself** — stops at queuing a dispatch
task; `materials`/`stage` (run by the dispatch-cycle LLM) do the actual work.

## Schema

`packaging_queue_log` (additive, `db/arc.sqlite`): `report_file` (PK, the natural key — a
report gets exactly one row), `slug`, `route`, `relevance`, `sku_why`, `status`
(`queued` -> `claimed` -> `packaged`, claim is compare-and-swap via `UPDATE ... WHERE
status='queued'` + a `changes`-count check, not a bare UPDATE), `product_id`/`plan_id` (written
immediately after mint, before the next subprocess call, so a mid-pipeline crash is still fully
auditable from the DB alone), `promo_code_id`, `queued_at`, `claimed_at`, `packaged_at`.

## Relationship to the dormant course-publishing capability

This is NOT the same thing as the raw `create-course`/`create-chapter`/`create-lesson` CLI used
directly against the shared "Courses" experience (`exp_rm8XtYSqYIBzrl`, attached to the $49/mo
membership) for STRATEGY.md's Phase 2/3 "evergreen multi-part courses" vision. This skill's
`create-product` deliverable IS a per-SKU mini-course (via `attachDeliverable`'s existing,
already-proven-live logic) — a single report as a single-lesson course, not authored multi-part
content. P3's `CHECKPOINTS.md` entry decided to retire (deprioritize, not delete) the evergreen
multi-part vision for this quest — see that entry for the full rationale and reversal path.

## Known carry-forwards (logged, not built this phase — scope discipline, not oversight)

- A persistent "member redemption links" post (vs. an ephemeral chat message) for unlock-all.
- Per-SKU pricing review beyond the $9 default (arc-strategy-panel/Patel flagged that dense
  reference-table content, e.g. a subsystem-by-subsystem audit, may be worth $19 like the
  existing arxiv-skill tier — applied ad hoc where flagged, not systematized into a rule yet).
- `whop create-product`'s route-lookup and `unlock-all`'s promo-lookup both scan only the first
  50/100 rows respectively (pre-existing `whop/cli.ts` behavior, not changed by P3) — this
  pipeline is exactly what pushes the catalog toward that ceiling over time; paginate those
  scans before the catalog crosses ~50 products.
- `packaging_queue_log` has no `visibility` column — published-vs-hidden lives only on Whop
  (read back per flip) and in the verify artifacts, not the local ledger (dev-council/
  Kleppmann, 2026-07-03 publish-by-default review; acceptable while status='packaged' implies
  a confirmed-visible flip, revisit if `--keep-hidden` gets real use).
- `create-product`'s plan create-or-find has no serialization point (dev-council/Lamport,
  same review, pre-existing): a manual `stage` racing the dispatched task on the SAME report
  could stack two one-time plans on one product. The queue layer's claim CAS protects the
  sensor path; don't run manual stages concurrently with a live dispatch claim.

## When to Load

Load when the sensor's dispatch task fires, or when manually running `materials`/`stage`. Pair
with `arc-link-research` (produces the backlog this skill consumes) and `whop` (the underlying
SKU-minting + membership CLI this skill shells out to).
