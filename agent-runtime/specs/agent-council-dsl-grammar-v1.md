---
id: agent-council-dsl-grammar-v1
topics: [multi-agent, orchestration, council, dsl, rfc-2119, verification]
source: task 20276 (parent 20275); extends [[agent-council-dsl-spec]], builds on [[llm-council-deliberation-pattern]]
created: 2026-06-29
status: grammar-v1
arc_relevance: 4
sku_candidate: y
sku_why: A council wire-format whose normative force is RFC 2119 keywords — so it extends the vocabulary agent-runtime already speaks instead of inventing a parallel severity scale. Signable, diffable, mechanically tallied.
---

# Agent Council DSL — Grammar v1 (RFC-anchored)

This is v1 of the wire format specified in [[agent-council-dsl-spec]]. The spec established the
three-phase shape (propose → rank/critique → synth), the line-oriented move format, and the
legibility-vs-density argument. v1 changes one load-bearing thing: **normative force is now
expressed in RFC 2119 keywords, not a private `sev` scale.**

## Why RFC keywords

agent-runtime already speaks RFC language. Proposals, specs, and the escalation ladder use
MUST / SHOULD / MAY to mark how binding a requirement is. The v0 spec invented a separate axis —
`sev=low|med|high|blocking` — to say the same thing in council critiques. Two vocabularies for one
concept is the kind of cleverness SOUL warns against.

v1 collapses them. A council move's force is an RFC 2119 modality. The runtime, the validator, and
the reader all already know what MUST means. The DSL **extends** the existing normative vocabulary
into deliberation rather than bolting a new one beside it.

The mapping is exact:

| v0 `sev` | v1 modality | force in council |
|---|---|---|
| `blocking` | `MUST` / `MUST-NOT` | binding; vetoes `SYNTH` until resolved |
| `high` | `SHOULD` / `SHOULD-NOT` | strong; overridable only with a stated reason |
| `low` / `med` | `MAY` | advisory; carries no veto |

One axis, three rungs, a vocabulary the rest of the system already enforces.

---

## 1. Grammar

```ebnf
council     ::= phase+
phase       ::= "@phase" SP phase-id NL move+
phase-id    ::= "propose" | "rank" | "critique" | "revise" | "vote" | "synth"

move        ::= speaker SP verb (SP modality)? (SP target)? (SP arg)* (SP field)* (SP note)? NL
speaker     ::= "[" label "]"            ; A–G in rank/critique (anonymized), real id in synth
label       ::= UPPER | "chair"

verb        ::= "PROPOSE" | "CLAIM" | "REQUIRE" | "RANK" | "CRITIQUE"
              | "REVISE"  | "VOTE"   | "ABSTAIN" | "SYNTH"
modality    ::= "MUST" | "MUST-NOT" | "SHOULD" | "SHOULD-NOT" | "MAY"

target      ::= "->" SP ref               ; the proposal/label/constraint a move acts on
ref         ::= "#" slug | label          ; refs are slugs (memory entry, file, or proposal id)
slug        ::= kebab-ident               ; e.g. #fleet-dispatch-atomic-claim, #p1, #whop-wedge

arg         ::= ident                      ; e.g. a proposal id "p1", or a RANK order
field       ::= key "=" value
key         ::= "conf" | "ev" | "from" | "open" | "cost" | "stance"
value       ::= number | range | list | ident | reflist
range       ::= number ".." number
reflist     ::= ref ("," ref)*
list        ::= ident ("," ident)*
stance      ::= "support" | "oppose" | "neutral"

note        ::= "\"" text "\""             ; the ONLY free prose; the escape hatch
```

What changed from v0: `modality` replaces the `sev` field entirely; `REQUIRE` is a new verb;
`ref` is now formally a slug (kebab-case), tying evidence and targets to the
`memory/shared/entries/<slug>.md` convention rather than opaque ids.

### Verbs

| verb | phase | meaning | default modality | required fields |
|---|---|---|---|---|
| `PROPOSE` | propose | introduce an option, give it an id | `MAY` | `conf` |
| `CLAIM` | propose | one assertion backing a proposal | `SHOULD` | `conf`, `ev` |
| `REQUIRE` | propose | a normative constraint every proposal is checked against | `MUST` | `ev` |
| `RANK` | rank | ordered preference over anonymized labels | `MAY` | `conf` |
| `CRITIQUE` | rank/critique | targeted objection to one label/proposal | `SHOULD` | `stance` |
| `REVISE` | revise | amend a proposal in response to a critique/constraint | — | `from` |
| `VOTE` | vote | final commit to one label | `MUST` | `conf` |
| `ABSTAIN` | vote | decline to vote, reason in `note` | — | — |
| `SYNTH` | synth | chairman's merged answer | — | `from`, `open` |

The default modality is what the verb means with no keyword: a `PROPOSE` is an option you `MAY`
take; a `VOTE` is a commit you `MUST` honor. Write the keyword only to override the default —
`CRITIQUE MUST` to escalate an objection to a veto, `CLAIM MAY` to mark an assertion as soft.

### `REQUIRE` — the new typed move

v0's recommendation #4 said: if `note` carries most of the meaning, the verb set is too thin and
needs a new typed move. `REQUIRE` is that move. It states a constraint over the whole decision,
not over one proposal:

- `REQUIRE MUST-NOT` — a hard prohibition. Any proposal that violates it is **invalid**: dropped
  before ranking, no vote needed. This is where a standing policy enters the council mechanically.
- `REQUIRE SHOULD` — a strong constraint. A violating proposal survives only if it carries a
  `REVISE` or a `note` justifying the exception.
- `REQUIRE MAY` is meaningless (a constraint with no force) and the validator rejects it.

`REQUIRE` is how "NEVER auto-post to Whop without sign-off" stops being prose etiquette and
becomes a rule that prunes the proposal set arithmetically.

### Field semantics

- `conf=0..1` — calibrated confidence. Aggregator weights votes/ranks by it.
- `ev=#slug,#slug` — evidence refs as slugs (memory entries, file paths, prior proposals). A
  `CLAIM` or `REQUIRE` without `ev=` is dropped by the aggregator.
- `from=A+B` — provenance: which proposals a `REVISE`/`SYNTH` merged.
- `open=[item,item]` — unresolved questions the synthesis still carries. Non-empty blocks "done".
- `stance=support|oppose|neutral` — direction of a `CRITIQUE`.
- `note=""` — the single free-text slot. Required on `ABSTAIN`, optional elsewhere. Reason here;
  commit in the verbs.

### RANK syntax

`RANK B>A>D` is a strict order; ties are `RANK B=A>D`. The aggregator converts to Borda points,
multiplies by `conf`, and sums across rankers — no LLM in the loop for tallying.

### Hard rules (validator-enforced)

1. A `RANK`/`CRITIQUE` may reference only anonymized labels, never a real model id.
2. Every `CLAIM` and `REQUIRE` carries `ev=`; the aggregator silently drops those without it.
3. An unresolved `CRITIQUE MUST` or a proposal violating a `REQUIRE MUST`/`MUST-NOT` blocks that
   proposal from `SYNTH`. The block clears only via a `REVISE`.
4. `SYNTH` with non-empty `open=[...]` cannot close the council — it loops or escalates.
5. `REQUIRE MAY` is rejected. One move per line. A malformed line is dropped and logged, never
   partially parsed.

---

## 2. Worked council — before / after

**Decision (real, open):** Whop M0 is unreached — 1 comped buyer, $0 MRR, 0 room activations. The
monologue gate keeps DEFERring correctly (4 Arc posts, 0 human speakers), which is the chicken-and-egg:
can't seed the room without a human speaker, no human speaker shows up without seeding. Three options
are live. (See `whop-wedge` in MEMORY.md and [[whop-api-capabilities]].)

A standing policy bounds the whole decision: **NEVER auto-post to Whop without sign-off.**

### Before (prose, ~250 words)

> **Member 1:** I'd reach out directly to the one comped buyer. We already have the relationship;
> a single real human in the room is what unblocks the monologue gate. It's low-risk and uses what
> we have. Reasonably confident.
>
> **Member 2:** I'd rather lower the monologue-gate threshold for an initial bootstrap window —
> let Arc seed a few posts solo so the room doesn't look dead when someone does arrive. But I want
> to flag hard: whatever we do, we cannot auto-post to Whop without whoabuddy signing off. That's
> a standing rule and it isn't negotiable here.
>
> **Member 3:** I'd hold. Neither seeding nor outreach has produced a human speaker yet, and
> burning the one comped relationship on a cold ask could waste it. That said, holding is what's
> already failing, so I'm not strongly attached.
>
> **Chairman:** The group leans toward direct outreach to the comped buyer as the cheapest unlock,
> with a possible bootstrap-seeding follow-up — but any seeding stays gated on whoabuddy sign-off,
> which is non-negotiable. Open item: we still have no organic path to a second human speaker.

### After (DSL v1, ~95 tokens of moves)

```
@phase propose
[A] PROPOSE p1 conf=0.65 "direct outreach to the 1 comped buyer"
[A] CLAIM -> p1 SHOULD conf=0.7 ev=#whop-wedge "one real human unblocks the monologue gate"
[B] PROPOSE p2 conf=0.6 "lower monologue-gate threshold for a bootstrap window"
[B] REQUIRE MUST-NOT ev=#whop-wedge "auto-post to Whop without whoabuddy sign-off"
[C] PROPOSE p3 conf=0.4 "hold; wait for an organic human speaker"
[C] CLAIM -> p3 MAY conf=0.45 ev=#whop-wedge "avoid burning the one comped relationship on a cold ask"

@phase rank
[A] RANK p1>p2>p3 conf=0.7
[B] RANK p2>p1>p3 conf=0.6
[C] RANK p1>p3>p2 conf=0.5

@phase critique
[C] CRITIQUE -> p3 SHOULD stance=oppose "holding is what is already failing"
[B] CRITIQUE -> p2 MUST stance=neutral "p2 violates the sign-off REQUIRE unless gated"

@phase revise
[B] REVISE -> p2 from=p2 "seed only after whoabuddy approves the threshold change"

@phase synth
[chair] SYNTH from=p1+p2 open=[no-organic-path-to-second-human-speaker] conf=0.65
  "Direct outreach to the comped buyer first; bootstrap-seed only after sign-off."
```

The aggregator reads this directly:

- `B`'s `REQUIRE MUST-NOT` is the standing policy made mechanical. `p2` as first stated violates
  it, so `B`'s `CRITIQUE MUST -> p2` blocks `p2` from `SYNTH` — until `B`'s own `REVISE` gates the
  seeding on sign-off and clears the block. Rule 3 did the policy enforcement, not the chairman's
  goodwill.
- `p1` wins on Borda × conf (top of two ranks, second on the third) and carries no MUST critique,
  so it survives to `SYNTH` cleanly.
- `open=[...]` is non-empty, so the council does **not** auto-close. It surfaces one named gap —
  no organic path to a second human speaker — for whoabuddy.

No essay re-reading; the tally is arithmetic and the policy is a validator rule.

---

## 3. Legibility vs density — the tradeoff

The DSL trades human ease-of-reading for machine signal. v1's RFC anchoring shifts the balance
slightly toward legibility, because the force words are ones a reader already knows.

### What density buys

- **Mechanical aggregation.** Ranks → Borda × conf is arithmetic. The chairman LLM stops counting
  votes and only does the genuinely-hard merge.
- **Policy as a rule, not etiquette.** `REQUIRE MUST-NOT` prunes invalid proposals before ranking.
  "We cannot auto-post without sign-off" is enforced by the validator, not remembered by a model.
- **Cheaper fan-out.** ~250 prose words vs ~95 token-moves on a 3-member council — ~3× — and the
  gap widens with N, because every ranker reads every proposal.
- **Stronger anonymization.** A typed move with a short `note` leaks far less authorial style than
  an essay, cutting the self-preference bias the rank phase exists to fight.
- **Diffable + resumable.** Moves are append-only lines; a `Workflow` resume replays them and a
  turn-over-turn diff shows exactly what changed. Prose has neither.

### What density costs

- **Onboarding tax.** A newcomer reads prose for free; the DSL needs the verb table first.
  RFC anchoring softens this: MUST / SHOULD / MAY are already understood, so only the verbs and
  fields are new, not the force scale.
- **Nuance compression.** Real disagreement has texture a single modality flattens. The `note=""`
  escape hatch exists for exactly this — but it is a pressure valve, not the channel. Overuse
  `note` and you are back to prose with extra syntax.
- **Humans need a renderer.** No one wants to read `@phase rank` in a standup. The chairman's
  `SYNTH` is auto-rendered to prose for the human deliverable; the DSL stays internal.
- **Brittleness.** A malformed line is dropped, not guessed. Correct (no partial parse), but a
  fumbled move silently loses a voice. The validator must log every drop.

### Recommendation

Use the DSL as the **internal wire format**, never the human-facing artifact:

1. Council members emit moves — the text projection of the JSON schema a `parallel()` stage
   already returns via `agent(prompt, {schema})`.
2. The aggregator tallies ranks, applies `REQUIRE` constraints, and enforces invariants
   mechanically — no LLM for counting or policy checks.
3. The chairman consumes the structured array, produces `SYNTH`, which is rendered to prose for
   people.
4. Keep `note=""` as the documented escape hatch and **measure its rate.** If `note` carries most
   of the meaning, the verb set is still too thin — add another typed move, the way `REQUIRE`
   was added here, rather than widening the prose channel.

The DSL is not a replacement for thinking in prose. It is a replacement for *transmitting* council
state in prose. Reason in the `note`; commit in the verbs; bind in the modality.

---

## 4. Open questions for v2

- **Where does the modality default live** — in the prompt the member sees, or in the validator?
  If the prompt, members can drift; if the validator, an omitted keyword is filled silently, which
  hides intent. Lean validator-fills-with-default, but log the fill.
- **First consumer:** the whop voice-review council, or the daily-eval judge panel? Pick one, run
  this before/after on a real transcript, measure token delta and tally-accuracy against the
  current prose chairman before generalizing.
- **REQUIRE provenance.** A `REQUIRE` that encodes a standing policy should cite the policy's home
  (a MEMORY.md `[A]` item or a shared entry) in `ev=`. Decide whether an uncited `REQUIRE` is
  dropped (consistent with `CLAIM`) or escalated (a policy claim with no source is worth flagging,
  not silently discarding).
