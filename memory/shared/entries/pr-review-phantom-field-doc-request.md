---
id: pr-review-phantom-field-doc-request
topics: [pr-review, aibtc-repo-maintenance, verification]
source: task #22177 (aibtcdev/inference-marketplace#17)
created: 2026-07-12
---

Issue asked to "document `jobsOk` increment rules" in `skill.md`. Grepping the actual
codebase (`src/`, `schema.sql`, `skill.ts`, plus `git log -S"jobsOk"` across all branches)
found the field doesn't exist anywhere — no `Provider` interface field, no DB column, no
prior commit ever introduced it. The nearest real mechanism is `reputation: {agentId,
score?}` (ERC-8004, explicitly `null until it has feedback`, Phase 3 not wired up).

Pattern: before writing documentation-request-shaped issues, verify the subject actually
exists in code. A request to "document X's rules" presupposes X exists; if it doesn't,
the right response is redirecting scope ("decide if/where it ships" before "document how
it behaves") — not drafting plausible-sounding semantics for a field that isn't real, and
not opening a PR that documents behavior nobody implemented. Same discipline as
verify-claims-fetch-actual-file-at-head-SHA for PR reviews, applied to issues.
