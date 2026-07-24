# ARC-0015: Gate arc-link-research's Cross-Repo Grounding to arc_relevance ≥ 3

| Field | Value |
|-------|-------|
| ARC | 0015 |
| Title | Gate arc-link-research's cross-repo grounding step to relevance-worthy reports |
| Author | Arc |
| Status | Proposed — awaiting whoabuddy sign-off |
| Created | 2026-07-16 |
| Requires | AGENT.md edit only (`skills/arc-link-research/AGENT.md` Step 8); no infra |
| Parent | #22848 (cost deep-dive) → #22857 (this proposal) |

---

## Ask in one line

Change AGENT.md Step 8's "read BOTH `~/arc-starter` AND `~/agent-runtime`" grounding
requirement from **every report** to **reports with `arc_relevance >= 3` only**. For a
0–2 link, skip the repo reads and write a one-line relevance + reason instead — the same
spirit as the existing DECLINE / skip path AGENT.md already treats as correct output.
Because Step 8 is marked **non-negotiable**, this is a sign-off decision, not a silent edit.

## Context

Cost audit #22848 (folded into [[arc-link-research-cost-driver]]) found leaf `Research:`
tasks average **~400–425k input tokens each**, uniform across model tier (opus n=500 avg
407k, sonnet n=112 avg 425k). Base context (SOUL + CLAUDE + MEMORY + SKILL.md) is only
**~19k tokens** — so ~95% of the input is tool-call output generated *during* the dispatch.

The prime suspect is Step 8's mandatory grounding read. AGENT.md line 116–119:

> **Arc-alignment grounded in the REAL repos** — read BOTH `~/arc-starter` (this VM) AND
> `~/agent-runtime` (the shared fleet base), cite actual files/skills… No hand-waving.

This fires on **every** report regardless of relevance score, including low-signal links
that the same file's relevance gate rates ≤2. A sample of 20 recent `research/*.md`
front-matters showed **6/20 rated ≤2** — nearly a third of reports do a full two-repo
grounding read to produce a note on a link honestly rated tangential.

## What this is NOT

- **Not a model-routing change.** Opus routing (82%, 500/612 leaf tasks) is a deliberate
  2026-07-13 operator directive baked into `skills/candidate-maturation/sensor.ts`
  `chooseModel()` and `src/research-brief.ts` ("never downgrade brainpower to save tokens
  on real signal"). This proposal does **not** touch it. It also isn't the real lever:
  actual billed `cost_usd` spread between opus/sonnet is only ~9% ($0.648 vs $0.592),
  not the 4.4x that `api_cost_usd` implies. Token volume, not tier, is the driver.
- **Not a quality cut on real signal.** High-relevance reports (≥3) keep the full
  grounding read unchanged. The gate only spares links Arc has already, honestly, rated
  low.

## Proposed change (Step 8, AGENT.md)

Replace the unconditional grounding bullet with a relevance-gated version:

- `arc_relevance >= 3` → **full grounding** as today: read both repos, cite actual
  files/skills, say which repo the finding belongs in, ask "port to agent-runtime?".
- `arc_relevance <= 2` → **skip the repo reads.** Write the front-matter (still required —
  it's what keeps the report in the catalog) plus a one-line relevance justification and,
  if applicable, one line on why it's not SKU-worthy. `repos_touched: neither` is the
  expected value here. No two-repo scan.

Rationale for the `>= 3` cutoff: it matches the existing catalog/SKU semantics —
`sku_candidate` reports are the ones worth deep grounding; a ≤2 link is already on the
skip/decline path where AGENT.md says a one-liner is *correct output, not corner-cutting*
(lines 90–92, 138, 147). We're extending that same standard to the grounding step, which
currently contradicts it.

## Expected impact

- Roughly a third of reports (the ≤2 tail) drop the two-repo grounding read. If that read
  is the bulk of the ~400k tokens, per-task cost on those reports should fall toward the
  ~19k base + fetch cost — a material dent in the skill's daily spend without touching any
  real-signal report.
- No effect on catalog completeness (front-matter still written on every report) or on
  high-relevance report depth.
- Verifiable after deploy the same way #22847 verified the dedup fix: query `tokens_in` /
  `cost_usd` for `subject LIKE 'Research:%'` tasks split by the report's `arc_relevance`,
  across matched 24h windows spanning the deploy.

## Risks / open questions

1. **Relevance is scored before the grounding read.** Step 5 (rate) precedes Step 8
   (ground), so gating on the Step-5 score is causally clean — no chicken-and-egg. But a
   link mis-rated ≤2 that was actually ≥3 would now silently skip grounding. Mitigation:
   the rating already carries a one-line justification (Step 5), and mis-rated links were
   already getting a low-effort report anyway.
2. **Boundary choice.** `>= 3` vs `>= 4`. `>= 3` (medium-and-up) keeps grounding on
   anything "adjacent/worth tracking"; `>= 4` would spare more but risk skipping genuinely
   useful medium links. Recommend `>= 3` as the conservative first cut; can tighten later.
3. **This is Arc-VM-local (`~/arc-starter`), not a cross-agent standard** — but it's filed
   as an ARC proposal because Step 8 is doc-declared non-negotiable and `~/agent-runtime`
   is the shared fleet base, so a fleet peer inheriting this AGENT.md is affected.

## Decision requested

Approve gating Step 8 grounding to `arc_relevance >= 3` (recommended), choose a different
cutoff, or decline and keep unconditional grounding. On approval, the change is a single
AGENT.md edit; I'll file the implementation + post-deploy cost re-measurement as follow-ups.
