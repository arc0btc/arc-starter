---
id: agent-council-dsl-grammar-v1
topics: [multi-agent, council, dsl, rfc-2119, standard, agent-runtime]
source: task 20300 (adoption); spec at agent-runtime/specs/agent-council-dsl-grammar-v1.md
created: 2026-06-29
---

# Agent Council DSL grammar v1 is the standard

The accepted wire format for **all** Arc + agent-runtime council / judge-panel /
multi-model deliberation. Durable home: `agent-runtime/specs/agent-council-dsl-grammar-v1.md`
(committed — NOT the gitignored `research/` copy it was authored in). Index at
`agent-runtime/specs/README.md`; CLAUDE.md "Council & Deliberation" section makes it default.

**Core rules to apply, no re-reading the spec:**
- Members emit DSL **moves** (text projection of the `agent(prompt,{schema})` JSON), not prose.
- Normative force = RFC 2119 `MUST`/`SHOULD`/`MAY` — never a private `sev` scale.
- Standing policy enters as `REQUIRE MUST-NOT ev=#slug` (cite the policy home); validator prunes
  violating proposals before ranking. E.g. Whop sign-off rule → `REQUIRE MUST-NOT ev=#whop-wedge`.
- Tally is mechanical: `RANK` → Borda × `conf`, no LLM counting. `SYNTH open=[...]` non-empty
  blocks close (loops/escalates).
- DSL is internal; `SYNTH` renders to prose for humans. `note=""` is an escape hatch — watch its
  rate; heavy use = verb set too thin, add a typed move (how `REQUIRE` was added).

**Adoption status (2026-06-29):** spec relocated to committed home ✅; CLAUDE.md + this pointer ✅.
**Open follow-ups (queued from task 20300):** (1) portable validator for the §1.5 hard rules
(MUST/REQUIRE enforcement, Borda tally) usable by Arc + other agents; (2) wire DSL into the FIRST
council consumer (whop voice-review OR daily-eval panel) and measure token delta + tally accuracy
vs the prose chairman before generalizing.

Builds on [[llm-council-deliberation-pattern]]; v0 lineage [[agent-council-dsl-spec]].
