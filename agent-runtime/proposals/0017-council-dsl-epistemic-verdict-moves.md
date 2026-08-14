# ARC-0017: Council DSL — Epistemic Labels, Kill Criteria, Dissent-Enforcement

| Field | Value |
|-------|-------|
| ARC | 0017 |
| Title | Add `epi=` to CLAIM, `kill=` to SYNTH, and a dissent-enforcement validator warning |
| Author | Arc |
| Status | Proposed — awaiting whoabuddy sign-off (spec change) |
| Created | 2026-08-14 |
| Requires | `agent-runtime/specs/agent-council-dsl-grammar-v1.md`, `skills/council-dsl/validator.ts` |
| Amends | agent-council-dsl-grammar-v1 §1 (grammar), §1.5 (hard rules), §4 (open questions) |

---

## Context

`research/2026-08-14T00:35:58Z_research.md` (task #26087) evaluated
`0xNyk/council-of-high-intelligence` (CoHI, 3.9k★) against Arc's own council DSL v1. CoHI's
headline feature — persona-routing across 18 named analytical seats with provider-diversity —
is a *deliberation-quality* mechanism (seat assignment, cross-model routing) that lives outside
the DSL's scope by design: the grammar spec is a wire format for `parallel()` fan-out results,
not a seat-assignment policy, and this proposal does not touch that layer.

Three other mechanisms in CoHI *are* wire-format concerns and map cleanly onto gaps the DSL spec
already names as open:

1. **Epistemic labels.** CoHI tags every claim `FACT` / `INFERENCE` / `ASSUMPTION` / `UNKNOWN`.
   Arc's `CLAIM` verb carries `conf=` (calibrated confidence) and `ev=` (evidence ref) but no
   epistemic *status* — whether the claim is observed, inferred, assumed, or an acknowledged gap.
   Today that distinction has nowhere to live except `note=""`, which §3 recommendation #4 of the
   spec already flags as the wrong channel: "if `note` carries most of the meaning, the verb set
   is too thin — add another typed move."

2. **Kill criteria.** CoHI's verdict shape pairs a recommendation with "acceptable compromises,
   kill criteria, and one concrete next step." Arc's `SYNTH` has `open=[...]` for unresolved
   questions, which is a *different* concept — an open question is something the council didn't
   settle; a kill criterion is something the council *did* settle, paired with a pre-registered
   condition under which the decision should be reversed. `open=[...]` has no field for this today,
   so a chairman either omits kill criteria entirely or folds them into `SYNTH`'s free-text
   deliverable prose, where they aren't mechanically checkable at the next review.

3. **Dissent enforcement.** CoHI's enforcement checks "look for premature agreement, repeated
   claims, missing dissent, and unsupported confidence." `skills/council-dsl/validator.ts`
   currently enforces the five §1.5 hard rules (label anonymization, `ev=` presence on
   CLAIM/REQUIRE, MUST-block-before-SYNTH, non-empty `open` blocks close, `REQUIRE MAY` rejection)
   but has no check for convergence pathology — nothing flags a council where every `RANK` move is
   identical or where zero `CRITIQUE stance=oppose` moves exist across the whole transcript. This
   is mechanical (string/field comparison over already-parsed moves, no LLM), so it fits the
   validator's existing no-LLM-in-the-loop contract exactly.

## Proposal

### 1. `epi=` field on `CLAIM`

```ebnf
key   ::= "conf" | "ev" | "from" | "open" | "cost" | "stance" | "epi" | "kill"
epi   ::= "fact" | "inference" | "assumption" | "unknown"
```

`epi=` is optional on `CLAIM` (default: `inference`, the CoHI default for an unlabeled claim —
observed-but-not-directly-verified is the common case; forcing an explicit `fact` or `assumption`
tag is more useful than silently defaulting to the strongest claim type). When present, it must
be one of the four values above; the validator drops the field (not the move) and logs a warning
for any other value, consistent with how malformed fields are handled elsewhere.

`epi=unknown` is the one CoHI doesn't map onto a claim about the world — it's a claim about a
*gap*: "this is missing information that could change the decision." A `CLAIM ... epi=unknown`
is exempt from the existing "CLAIM without `ev=` is dropped" rule, since an acknowledged unknown
has nothing to cite by definition. This is the one grammar-level carve-out this proposal
introduces; the validator must special-case it rather than silently dropping `epi=unknown` claims
that lack `ev=`.

### 2. `kill=` field on `SYNTH`

```ebnf
key   ::= ... | "kill"
value ::= ... | reflist | text-list
```

`kill=[condition,condition]` on `SYNTH`, syntactically parallel to `open=[...]` (bracketed,
comma-separated). Semantically distinct:

- `open=[...]` — questions the council did **not** resolve. Non-empty blocks the council from
  closing (existing hard rule 4, unchanged).
- `kill=[...]` — conditions under which an **already-made** decision should be reversed,
  pre-registered at decision time rather than invented after the fact. Empty `kill=[]` is valid
  (not every decision needs a kill criterion) and does **not** block closing — it does not carry
  rule 4's force. `kill=` is advisory to future review, not a validator gate.

This gives Arc's `[A] Active Items` a mechanical trigger to check against instead of re-deriving
"should this be revisited?" from prose each time a stale item is reviewed.

### 3. Validator dissent-enforcement warning (non-blocking)

Add one new check to `validate()` in `skills/council-dsl/validator.ts`, run at the same
post-parse stage as the existing hard-rule-3/4 checks (`validator.ts:239`):

- **Premature agreement**: if 2+ `RANK` moves exist and all are identical (same order, ignoring
  `conf`), emit a warning (not an error — this does not block `SYNTH`).
- **Missing dissent**: if 2+ `CRITIQUE` moves exist and none carries `stance=oppose`, emit a
  warning.

Both are **warnings**, not hard-rule errors: unlike rules 1-5, unanimous agreement or the absence
of a critique is not necessarily wrong — sometimes a council converges because the answer is
genuinely clear-cut. The warning is a legibility signal for whoever reads the transcript (or a
future automated council-quality retrospective), not a mechanical veto. This matches the
validator's `warnings` list, which already exists in `ValidationResult` for lower-severity findings
distinct from the `errors` array.

### What's out of scope

CoHI's persona-routing and multi-provider seat-diversity are explicitly **not** part of this
proposal. Arc's councils are `parallel()` fan-outs over `agent(prompt, {schema})` — seat identity
and provider assignment are a routing/prompt concern the DSL spec deliberately keeps outside the
wire format (per the spec's own §3 recommendation: "the DSL is not a replacement for thinking in
prose... it is a replacement for transmitting council state"). Borrowing routing diversity would
be a workflow/orchestration change, not a grammar amendment, and is a separate discussion if
pursued at all.

## Migration

Purely additive — `epi=` and `kill=` are optional fields on existing verbs (`CLAIM`, `SYNTH`);
no existing valid transcript becomes invalid. The dissent-enforcement check adds to `warnings`,
never `errors`, so no existing transcript that validates today stops validating. No version bump
needed for the grammar (`grammar-v1` stays v1, this is a backward-compatible field addition,
unlike ARC-0016's nonce-state key change which needed a hard version bump because it altered how
existing data is addressed). `skills/council-dsl/validator.ts` changes are the only code touched;
no consumer (daily-eval judge panel, whop voice-review council) is required to emit the new
fields to keep working.

## Risk if not fixed

Low urgency — no incident, no cost driver. The gap is a documented one (spec §3 rec #4, §4 open
questions) that the DSL's own design anticipated but hasn't been filled yet. Left alone, the
epistemic fact/assumption distinction and any kill-criteria the chairman wants to state keep
leaking into `note=""`, which is exactly the "verb set too thin" drift the spec warns against —
not urgent, but it compounds quietly as more councils run (daily-eval judge panel is the current
production consumer; whop voice-review was flagged in §4 as the next natural one).

## Open questions for whoabuddy

1. Sign-off on the grammar amendment itself (adding two optional fields + one non-blocking
   validator check is small, but the spec is a cross-agent-runtime standard per CLAUDE.md's
   "Council & Deliberation" section, not solely Arc's to change unilaterally).
2. Should `epi=unknown`'s `ev=`-exemption carry any minimum bar (e.g. still require a `note=`
   explaining what's unknown), or is a bare `CLAIM ... epi=unknown` with no `ev=` and no `note=`
   acceptable?
3. First consumer to pilot on: daily-eval judge panel (already the DSL's production consumer,
   lowest-friction place to measure `epi=`/`kill=` uptake) or wait for whop voice-review council
   (§4's original "next natural consumer" pick, more genuinely adversarial deliberation where
   dissent-enforcement would see real signal)?

---

*Filed by Arc, task #26092, follow-up to #26087 (research) / #26084 (triage batch).*
