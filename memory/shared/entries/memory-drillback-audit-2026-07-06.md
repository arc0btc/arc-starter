---
id: memory-drillback-audit-2026-07-06
topics: [memory, provenance, consolidation, arc-skill-manager]
source: task-21487
created: 2026-07-06
---

Audited every `[A] Active Items` line in `memory/MEMORY.md` (26 entries) for whether it
resolves back to a source task ID (directly, or via a `[[linked]]` shared entry's `source:`
frontmatter). 22/26 already had an inline `task #N`. 4 gaps found, all pre-2026-07-01 —
outside `recent.log`'s 500-line retention window, so the only recovery path was
`git log -S <marker-string>` against the commit that introduced the change:

- **signal-filing-paused** (policy line, no task ref, no shared entry) → `git log -S
  SIGNAL_FILING_DISABLED` found commit `01daaa58` = task #17094.
- **whop-wedge** (referenced `[[whop-wedge-status]]`, which already had `source: task-20403`
  in frontmatter, but the inline MEMORY.md line itself had no task number) → added #20403 inline.
- **open-weight-routing** (`[[openrouter-open-weight-routing]]` had `Source: Task #20198` in
  its body, not frontmatter) → added #20198 inline.
- **x-cadence** (`[[x-cadence-thread-chaining]]` had `source: task-20773` in frontmatter) →
  added #20773 inline.
- Also added task #20643 to the one `[E] Recent Evaluations` table row, found via `git log -S
  "PR #587"`.

**Pattern**: a line linking to a shared entry is NOT the same as the line being
self-resolving — a reader (or future consolidation pass) has to open the linked file and find
its `source:`/`Source:` field, which isn't always in the same place (frontmatter vs. body
prose, inconsistent). Fix applied here was cosmetic (copy the task # inline), not
structural — a future consolidation pass will still need to remember to inline the source
task # when writing lines that only link out.

**Not audited (out of scope for this pass)**: `[N] Agent Network Contacts` and `[L] Core
Validated Patterns` sections — these are roster/pattern-reference entries, not
task-finding summaries, so "source task" doesn't cleanly apply to most of them (e.g.
`amber-otter [COMPROMISED 2026-05-18]` is an incident marker, not a task summary). If a future
audit wants full coverage, those sections need a different provenance question ("when was
this contact/pattern last verified," not "which task produced this line").

**Why:** whoabuddy-approved §5 item 3 (email #21483), doubles as source material for the
"Agent Memory That Doesn't Rot" SKU.
**How to apply:** When consolidating MEMORY.md, always inline the task # even when also
linking to a shared entry — don't rely on the reader following the link to find provenance.
