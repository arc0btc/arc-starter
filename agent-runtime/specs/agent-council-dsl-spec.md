---
id: agent-council-dsl-spec
topics: [multi-agent, orchestration, workflows, council, dsl, verification]
source: task 20268 (parent 20267); builds on [[llm-council-deliberation-pattern]]
created: 2026-06-29
status: draft-spec
arc_relevance: 4
sku_candidate: y
sku_why: A wire-format grammar that lets a model-diverse council exchange moves an aggregator can read mechanically — packages the council/judge-panel pattern the harness line already sells, with a worked before/after on a real Arc decision.
---

# Agent Council DSL — a structured grammar for council deliberation

## Why this exists

The council pattern ([[llm-council-deliberation-pattern]]) runs three phases: members
**propose** in parallel, **cross-rank** the anonymized set, and a **chairman synthesizes**.
Today each phase is free prose. Prose costs us four things:

1. **Aggregation is manual.** A chairman re-reads N essays to extract who ranked what. Rankings
   that should sum mechanically get re-derived by an LLM, which is where bias and drift enter.
2. **Anonymization leaks.** Authorship hides in writing style even when the label is stripped.
   A typed move with no prose tail leaks less.
3. **Tokens scale badly.** A 7-model council in prose is 7 essays read by 7 rankers — quadratic
   prose. Most of those tokens are connective tissue, not signal.
4. **No diff, no resume.** Prose transcripts can't be diffed turn-over-turn or replayed by a
   `Workflow` resume; structured moves can.

The DSL is the **wire format** between council members and the aggregator. It is not meant to be
the human deliverable — the chairman's `SYNTH` is rendered back to prose for people. Think of it
as the text projection of the JSON schema an Arc `parallel()` stage already emits.

Design stance (SOUL: simple over clever): line-oriented, one move per line, key=value tail.
Skimmable by a human, parseable by a 20-line tokenizer, no nesting to mis-balance.

---

## 1. Grammar

```ebnf
council     ::= phase+
phase       ::= "@phase" SP phase-id NL move+
phase-id    ::= "propose" | "rank" | "critique" | "revise" | "vote" | "synth"

move        ::= speaker SP verb (SP target)? (SP arg)* (SP field)* (SP note)? NL
speaker     ::= "[" label "]"                  ; A–G in rank/critique (anonymized), real id in synth
label       ::= UPPER | "chair"
verb        ::= "PROPOSE" | "CLAIM" | "RANK" | "CRITIQUE"
              | "REVISE"  | "VOTE"  | "ABSTAIN" | "SYNTH"
target      ::= "->" SP ref                    ; the proposal/label a move acts on
ref         ::= "#" ident | label

arg         ::= ident                           ; e.g. a proposal id "p1", or a RANK order
field       ::= key "=" value
key         ::= "conf" | "sev" | "ev" | "from" | "open" | "cost" | "stance"
value       ::= number | range | list | ident
range       ::= number ".." number
list        ::= ident ("," ident)*
sev         ::= "low" | "med" | "high" | "blocking"
stance      ::= "support" | "oppose" | "neutral"

note        ::= "\"" text "\""                  ; the ONLY free prose; the escape hatch
```

### Verbs

| verb | phase | meaning | required fields |
|---|---|---|---|
| `PROPOSE` | propose | introduce an option, give it an id | `conf` |
| `CLAIM` | propose | one assertion backing a proposal | `conf`, `ev` |
| `RANK` | rank | ordered preference over anonymized labels | `conf` |
| `CRITIQUE` | rank/critique | targeted objection to one label | `sev`, `stance` |
| `REVISE` | revise | amend a proposal in response to critique | `from` |
| `VOTE` | vote | final commit to one label | `conf` |
| `ABSTAIN` | vote | decline to vote, with reason in `note` | — |
| `SYNTH` | synth | chairman's merged answer | `from`, `open` |

### Field semantics

- `conf=0..1` — calibrated confidence. Aggregator weights votes/ranks by it.
- `sev=low|med|high|blocking` — a `blocking` critique vetoes a proposal from `SYNTH` unless resolved by a `REVISE`.
- `ev=#id,#id` — evidence refs (memory entries, file paths, prior proposals). Unbacked `CLAIM` is dropped by the aggregator.
- `from=A+B` — provenance: which proposals a `REVISE`/`SYNTH` merged.
- `open=[item,item]` — unresolved questions the synthesis still carries. Non-empty `open` blocks "done".
- `note=""` — the single free-text slot. Required on `ABSTAIN`, optional elsewhere. Keep it short; it is not where the move's meaning lives.

### RANK syntax

`RANK B>A>D` is a strict order. Ties: `RANK B=A>D`. The aggregator converts to Borda points,
multiplies by `conf`, and sums across rankers — no LLM in the loop for tallying.

### Hard rules (validator-enforced)

1. A `RANK`/`CRITIQUE` may only reference anonymized labels, never a real model id. (anonymize-before-rank)
2. Every `CLAIM` carries `ev=`; the aggregator silently drops claims without it.
3. `SYNTH` with non-empty `open=[...]` cannot close the council — it loops or escalates.
4. One move per line. A malformed line is dropped and logged, never partially parsed.

---

## 2. Worked council — before / after

**Decision:** ARC-0013 fleet dispatch DB substrate. Extend arc-starter SQLite (single-node
fleet) vs. move to a networked DB (true multi-host)? Three members; chairman synthesizes.
(Real open decision — see [[fleet-dispatch-atomic-claim]].)

### Before (prose, ~310 words across the transcript)

> **Member 1:** I think we should keep SQLite. Arc already runs on `bun:sqlite`, the atomic
> `UPDATE ... RETURNING` claim works fine on a single node, and introducing a networked DB adds
> operational surface we don't need yet. We don't actually have multiple hosts today, so paying
> for Postgres or similar now is premature. My confidence here is moderate.
>
> **Member 2:** I'd push back. The whole point of ARC-0013 is *fleet-safe* dispatch. SQLite's
> file lock and even the RETURNING claim assume one writer. The moment you have two hosts, the
> claim can double-grab because there's no shared write barrier across machines. So if we're
> serious about multi-host we need a networked substrate. That said, I take Member 1's point that
> we don't have multiple hosts today, which is a real consideration.
>
> **Member 3:** Both of you are partly right. The atomic claim is the correct mechanism either
> way — the question is only what it runs against. I'd suggest we ship the SQLite version now
> because it's single-node-correct and unblocks everything, but we should write the claim behind
> an interface so swapping to Postgres later is a config change, not a rewrite. The open risk is
> lease recovery on crash, which neither substrate handles for free.
>
> **Chairman:** Synthesizing — the group leans toward shipping SQLite now with the atomic claim,
> behind an abstraction that lets us swap substrates. The unresolved item is lease recovery on
> crash, and the substrate decision for true multi-host stays open pending whoabuddy.

### After (DSL, ~90 tokens of moves)

```
@phase propose
[A] PROPOSE p1 conf=0.6 "extend SQLite, atomic UPDATE...RETURNING claim"
[A] CLAIM -> p1 conf=0.7 ev=#fleet-dispatch-atomic-claim "single-node-correct today; no new ops surface"
[B] PROPOSE p2 conf=0.65 "networked DB for true multi-host"
[B] CLAIM -> p2 conf=0.8 ev=#0013 "SQLite claim double-grabs across hosts; no shared write barrier"
[C] PROPOSE p3 conf=0.7 "ship SQLite now behind a substrate interface"
[C] CLAIM -> p3 conf=0.75 ev=#fleet-dispatch-atomic-claim "atomic claim is correct regardless of substrate"

@phase rank
[A] RANK C>A>B conf=0.7
[B] RANK C>B>A conf=0.65
[C] RANK C>A=B conf=0.8

@phase critique
[B] CRITIQUE -> A sev=high stance=oppose "no multi-host write barrier"
[C] CRITIQUE -> p3 sev=med stance=neutral "lease recovery on crash unhandled either way"

@phase synth
[chair] SYNTH from=C+A open=[lease-recovery-on-crash, substrate-for-multihost] conf=0.7
  "Ship SQLite atomic claim behind a substrate interface; swap is config, not rewrite."
```

The aggregator reads this directly: `C` wins by Borda × conf (top of all three ranks), the
`blocking`-tier check passes (B's critique is `high`, not `blocking`), and `open=[...]` is
non-empty — so the council does **not** auto-close; it surfaces two named items for whoabuddy.
No essay re-reading, and the tally is arithmetic.

---

## 3. Legibility vs density — the tradeoff

The DSL trades human ease-of-reading for machine signal. The honest accounting:

### What density buys

- **Mechanical aggregation.** Ranks → Borda × conf is arithmetic. The chairman LLM stops being a vote-counter and only does the genuinely-hard merge.
- **Cheaper fan-out.** The before/after above is ~310 prose words vs ~90 token-moves — roughly 3–4× on a 3-member council, and the gap widens with N because every ranker reads every proposal.
- **Stronger anonymization.** A typed move with a short `note` leaks far less authorial style than an essay. Cuts the self-preference bias phase 2 exists to fight.
- **Diffable + resumable.** Moves are append-only lines. A `Workflow` resume replays them; a turn-over-turn diff shows exactly what changed. Prose has neither.
- **Enforceable invariants.** "Every claim cites evidence", "blocking critique vetoes synth", "no real ids in rank phase" become validator rules, not etiquette.

### What density costs

- **Onboarding tax.** A newcomer reads prose for free; the DSL needs the verb table first. Mitigated because the *authors* are LLMs given the grammar in their prompt, not humans.
- **Nuance compression.** Real disagreement has texture a `sev=high` flattens. The `note=""` escape hatch exists for exactly this — but it is a pressure valve, not the channel. Overuse `note` and you are back to prose with extra syntax.
- **Humans need a renderer.** No one wants to read `@phase rank` in a standup. The fix: the chairman's `SYNTH` is auto-rendered to prose for the human deliverable; the DSL stays internal.
- **Brittleness.** A malformed line is dropped, not guessed. That is correct (no partial parse) but means a fumbled move silently loses a voice. The validator must log every drop.

### Recommendation

Use the DSL as the **internal wire format**, never the human-facing artifact:

1. Council members emit moves (this is just the text projection of the JSON schema a `parallel()` stage already returns — `agent(prompt, {schema})`).
2. The aggregator tallies ranks and enforces invariants mechanically — no LLM for counting.
3. The chairman consumes the structured array, produces `SYNTH`, which is rendered to prose for people.
4. Keep `note=""` as the documented escape hatch, and **measure its rate** — if `note` carries most of the meaning, the verb set is too thin and needs a new typed move, not more prose.

The DSL is not a replacement for thinking in prose. It is a replacement for *transmitting* council
state in prose. Reason in the `note`; commit in the verbs.

---

## 4. Fit with Arc's existing machinery

- **No new infra.** Moves are the line-form of a `parallel()` schema return. The validator and Borda tally are ~40 lines of TypeScript over the parsed array.
- **Model diversity stays the diversity axis.** Per-member `model` overrides (`opus` + `sonnet` + `openrouter:*`) give variance in *weights*; the DSL just makes their outputs comparable.
- **Anonymize-before-rank becomes a validator rule**, not a convention that erodes.
- **Open question for adoption:** is the first consumer the whop voice-review council, or the daily-eval judge panel? Pick one, run the before/after on a real transcript, measure token delta and tally-accuracy vs the current prose chairman before generalizing.
