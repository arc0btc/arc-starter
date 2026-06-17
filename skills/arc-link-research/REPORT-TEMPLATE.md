# Research report — standard template

Every research report Arc writes to `research/` follows this template. It exists so
the research shelf and the **product catalog are one pipeline**: machine front-matter
makes reports rankable + dedup-able (`research/INDEX.md`), and the `sku_candidate`
flag is the backlog that `create-product` (the `whop` skill) restocks the $9 SKU line
from. The packaged report sells on its **"tested against a live autonomous agent"
overlay** — so repo-grounded Arc-alignment is REQUIRED, not optional: it is both the
tailoring-to-our-code value and the buy-reason.

> When this template + `research/INDEX.md` exist, an X-link research prompt collapses
> to "research these links — follow the report template."

---

## 1. Front-matter (REQUIRED, machine-parseable)

The report MUST begin with this `---`-fenced block (line 1 = `---`). Parsed by
`lib/frontmatter.ts`; line-based, so keep one `key: value` per line and topics as an
inline `[a, b]` array.

```
---
source_url: <canonical link, or "batch" for a multi-link report>
cached_path: <research/cache/… path to the raw fetch, or "">
fetched_at: <ISO-8601, e.g. 2026-06-16T18:00:00Z>
task_id: <dispatch task id>
parent: <parent task id, or "">
topics: [topic-a, topic-b]
arc_relevance: <0–5 integer>
repos_touched: <arc-starter | agent-runtime | both | neither | unknown>
sku_candidate: <y | n>
sku_why: <one line — why it would (or wouldn't) sell as a $9 packaged report>
packaged: <y | n — has a Whop SKU been minted from this report yet?>
---
```

- **`arc_relevance` 0–5** is the anti-slop gate. **≤1 = skip** — don't force a report
  for a thin link; a one-line "skipped, why" note is the correct output.
- **`topics`** is the dedup + catalog key — normalize them (lowercase, kebab) and reuse
  existing topic names where one fits (check `research/INDEX.md`).
- **`sku_candidate: y`** REQUIRES a `sku_why`. Most reports are `n` — the SKU bar is
  "packaged, this would sell," not "this was interesting."

## 2. Required sections

- **TL;DR** — 3 lines.
- **Key takeaways** — the actual substance, each **cited** to the source.
- **Arc-alignment — REQUIRED, grounded in the REAL code.** Read BOTH repos on the VM:
  - `~/arc-starter` — Arc's legacy single-agent VM (this repo).
  - `~/agent-runtime` — the **new shared fleet base** (`aibtcdev/agent-runtime`).
  Then answer concretely, **citing actual files/skills**: where Arc already does this,
  where it's a gap, and **which repo it belongs in**. Always ask **"port to
  agent-runtime?"** — a finding that fits agent-runtime levels up *every* agent, a
  bigger call than an arc-starter tweak. No hand-waving: if you can't ground a claim in
  the repos, say so.
- **Recommendations** — each tagged **effort (S/M/L) · impact · risk · target repo**.
- **Provenance** — source URL + cache path + date, so a later *packaged* report can
  cite "verify this before you buy" (the receipt standard, P10A).

## 3. Workflow (the pipeline discipline)

1. **Dedup first** — before researching a link, check coverage:
   `arc skills run --name arc-link-research -- check --url "<url>" | --topic "a,b"`.
   If covered, UPDATE the existing report (if there's new signal); do NOT fork a duplicate.
2. **Cache** the raw fetch (the `process` command does this by URL hash under
   `skills/arc-link-research/cache/`); record `cached_path`.
3. **Relevance-gate** each link; skip ≤1 with a one-line reason.
4. **Awesome-list / multi-topic** link → extract sub-links, dedup each, one report per
   genuinely distinct topic (cap ~8; log any dropped + why).
5. **Write** the report to `research/{ISO8601}_*.md` with the front-matter + sections above.
6. **Reindex** so the catalog stays current:
   `arc skills run --name arc-link-research -- reindex`.
   (`process` auto-reindexes; an agent-written report must run it explicitly.)

## 4. Compile / email step (when a batch completes)

Email an HTML report in the **same format/quality as the packaged $9 guide** (this
doubles as a packaging rehearsal). Sections: themes across the links · Arc-code
applicability (split arc-starter vs agent-runtime, specific files) · monetization/Whop
(which topics → a $9 SKU, which strengthen the existing line) · AIBTC ecosystem · top 5
to implement today (what/why/effort/risk/target repo/first step) · **SKU candidates**
(the 1–3 most worth packaging next + why they'd sell) · editorial read + next steps.

**Keep the raw research free and complete; the packaging/synthesis is the paid value.**
