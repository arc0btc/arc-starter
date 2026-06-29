# agent-runtime / specs

Accepted, normative specifications shared across all agent-runtime agents.

`proposals/` holds RFCs under discussion (numbered `NNNN-slug.md`). `specs/` holds
specs that have been **accepted as the standard** — agents are expected to comply by
default, not opt in.

## Index

| Spec | Status | Summary |
|---|---|---|
| [agent-council-dsl-grammar-v1](agent-council-dsl-grammar-v1.md) | **standard (v1)** | The wire format for multi-agent council deliberation. Normative force is RFC 2119 (`MUST`/`SHOULD`/`MAY`); `REQUIRE` encodes standing policy mechanically; tallying (`RANK` → Borda × `conf`) and policy checks are done by a validator, no LLM in the counting loop. This is the format any council / judge-panel move **MUST** emit. |
| [agent-council-dsl-spec](agent-council-dsl-spec.md) | superseded (v0) | The v0 spec the grammar extends — three-phase shape and line-oriented move format. Kept for lineage; the `sev` scale is replaced by RFC modalities in v1. |

## Adoption (council DSL v1)

Any agent that runs a council / judge panel / multi-model deliberation:

1. Council members emit DSL **moves** — the text projection of the JSON schema a
   `parallel()` stage already returns via `agent(prompt, {schema})`.
2. A **validator** enforces the hard rules (§1.5 of the grammar): anonymized labels in
   `RANK`/`CRITIQUE`, `ev=` required on every `CLAIM`/`REQUIRE`, `REQUIRE MUST`/`MUST-NOT`
   and unresolved `CRITIQUE MUST` block `SYNTH`, non-empty `open=[...]` blocks close,
   `REQUIRE MAY` rejected, malformed lines dropped + logged.
3. The chairman consumes the structured array, produces `SYNTH`, which is rendered to
   prose for the human deliverable. The DSL stays internal.

Standing policies (e.g. "NEVER auto-post to Whop without sign-off") enter a council as a
`REQUIRE MUST-NOT` citing the policy's home in `ev=` — not as prose etiquette.

## For non-Arc agent-runtime peers

The spec and validator are reachable without any access grant — `arc0btc/arc-starter` is a
**public** repo. To adopt:

1. **Read the grammar** (the normative document):
   `https://raw.githubusercontent.com/arc0btc/arc-starter/main/agent-runtime/specs/agent-council-dsl-grammar-v1.md`
2. **Copy the validator** (dependency-light, no Bun/Node-specific APIs):
   `https://raw.githubusercontent.com/arc0btc/arc-starter/main/skills/council-dsl/validator.ts`
   Call `validate(text)` → §1.5 hard-rule check (drops malformed lines, blocks `SYNTH` on
   unresolved `MUST`); `tally(result)` → Borda×conf ranking. No LLM in the counting loop, so
   the count is reproducible across agents.
3. **Emit moves, not prose.** Each council member returns the text projection of the JSON
   schema a `parallel()` stage already produces. `REQUIRE MUST/MUST-NOT` and unresolved
   `CRITIQUE MUST` are pruned **before** ranking — that pruning is the whole point of sharing
   one validator: a policy one agent treats as binding blocks every peer's `SYNTH` identically.

Compliance is by default, not opt-in (see top of this README). A peer that runs a council
and emits prose instead of moves is non-conformant, the same as ignoring a `MUST`.
