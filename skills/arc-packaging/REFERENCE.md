# arc-packaging — Design History & Rationale

Detail moved out of `SKILL.md` (2026-07-24) to keep that file under the 2000-token guideline.
Load this only when you need the "why" behind a design decision, not for routine operation.

## Why materials/stage is a 3-step contract

Extends `arc-link-research`'s SKU backlog (`research/INDEX.md`'s `## SKU backlog` table,
pre-filtered to `sku_candidate: y` / `packaged: n`) into an active pipeline stage — P3 of
`arc-demand-flywheel`. Before this skill existed, the backlog was a passive list someone had to
remember to work; the sensor now consumes it on a cadence so it no longer grows unbounded.

Field limits discovered live: description has a hard 1500-char limit (Whop's `products.create`
rejects longer — found 2026-07-08, task #21744, a 1620-char draft failed and had to be trimmed).
Headline has an 80-char limit (found 2026-07-10, task #21962, a 153-char headline failed and was
shortened to 74). `quiz` is required (control-plane-remediation Phase 2 row 62, 2026-07-16/17):
at least 3 `QuizQuestion`s drawn from the report's own claims — `stage` hard-fails without it,
same enforcement tier as the description frames.

`stage`'s auto-publish (product + plan visible) only fires if BOTH the cover attach and the quiz
attach succeeded (control-plane-remediation Phase 2 rows 61/62/63 — these became required steps,
not just recommended, so a caller not passing `--keep-hidden` no longer guarantees a visible
SKU). If either fails, the SKU stays `packaged` but hidden, with a loud log naming which step
failed and the manual retry/rollback commands. This is deliberately terminal (dev-council/Newman):
the storefront should never show a SKU whose deliverable, cover, quiz, or member promo isn't
wired. A failed flip leaves the queue row `claimed` so the resume path re-runs the idempotent
chain.

Publish-as-terminal-step reflects an explicit operator directive (2026-07-03): "the SKUs are up
to arc to manage/publish and don't need my review either. same as the blog."

## Membership unlock-all rationale

There is no server-side "grant membership" call in `@whop/sdk` (checked every `resources/*.d.ts`
— no `memberships.create`). The only real primitive is a promo code applied at checkout, so
"unlock" means: create-or-find a 100%-off, unlimited-stock, `product_id`-scoped promo code (same
primitive already live for the membership's own `FREEMONTH_PROMO_ID`).

`arc-packaging stage` always calls `unlock-all` with `--skip-chat`: the promo is created (the
entitlement exists) but no chat announcement fires automatically. A dev-council review
(2026-07-03) flagged the original always-announce design as a real premature-exposure risk — a
live $0 checkout link reaching real paying members before the operator has reviewed the SKU,
three subprocesses deep with no visibility. The operator gets everything needed (product page,
checkout URL, promo code, member redemption link) in the review email `stage` sends, and posts
the announcement themselves (into "AI Prefers Bitcoin", `exp_I2Wew0PqJQ50a8` — blanket
pre-approval per CADENCE.md 2026-07-03) once reviewed, or asks Arc to.

**Known limitation (logged, not fixed):** a single chat message is a weak activation signal — a
persistent, browsable "member redemption links" post would reach more members than an ephemeral
chat line.

## Why the backlog selector is a shared module

`parseSkuBacklog()` / `selectCandidate()` live in `lib/backlog.ts`, imported by both `cli.ts` and
`sensor.ts`. This was not the original design — the sensor originally computed its own
independent backlog count and compared it against `packaging_queue_log`'s row count. Dev-council
(unanimous, 4 of 5 lenses) found the two had already diverged into a real bug: the count
comparison silently stalled the pipeline around the halfway point of a 27-item backlog. There is
now exactly one answer to "is there anything to package right now."

## Dedup-before-mint gate detail

`stage` checks the candidate report's `source_url`/`topics` (front-matter) against every
already-packaged report's front-matter, via `arc-link-research`'s own `findCoverage()`
(`skills/arc-link-research/lib/catalog.ts` — same function backing that skill's `check` command,
imported directly so the two skills can't disagree on what "already covered" means). A hit means
a live Whop product already covers the same url/topic — `stage` aborts before calling
`create-product`, logs the overlapping report(s), and marks the queue row `duplicate` (terminal).
Runs in `--dry-run` too, so `materials`/draft work isn't wasted on a doomed candidate.

## Relationship to the dormant course-publishing capability

Not the same as the raw `create-course`/`create-chapter`/`create-lesson` CLI used directly
against the shared "Courses" experience (`exp_rm8XtYSqYIBzrl`, attached to the $49/mo membership)
for STRATEGY.md's Phase 2/3 "evergreen multi-part courses" vision. This skill's `create-product`
deliverable IS a per-SKU mini-course (via the existing, already-proven `attachDeliverable` logic)
— a single report as a single-lesson course, not authored multi-part content. P3's
`CHECKPOINTS.md` entry decided to retire (deprioritize, not delete) the evergreen multi-part
vision for this quest.

## Known carry-forwards (logged, not built this phase — scope discipline)

- A persistent "member redemption links" post (vs. an ephemeral chat message) for unlock-all.
- Per-SKU pricing review beyond the $9 default (arc-strategy-panel/Patel flagged dense
  reference-table content, e.g. a subsystem-by-subsystem audit, may be worth $19 like the
  existing arxiv-skill tier — applied ad hoc where flagged, not systematized yet).
- `whop create-product`'s route-lookup and `unlock-all`'s promo-lookup both scan only the first
  50/100 rows respectively (pre-existing `whop/cli.ts` behavior) — paginate before the catalog
  crosses ~50 products.
- `packaging_queue_log` has no `visibility` column — published-vs-hidden lives only on Whop (read
  back per flip) and in verify artifacts, not the local ledger (dev-council/Kleppmann, 2026-07-03
  review; acceptable while `status='packaged'` implies a confirmed-visible flip).
- `create-product`'s plan create-or-find has no serialization point (dev-council/Lamport,
  pre-existing): a manual `stage` racing the dispatched task on the SAME report could stack two
  one-time plans on one product. The queue's claim CAS protects the sensor path; don't run manual
  stages concurrently with a live dispatch claim.
