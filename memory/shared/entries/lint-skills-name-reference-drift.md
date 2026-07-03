---
name: lint-skills-name-reference-drift
description: lint-skills grep-verifies `skills run --name X` against installed skills; surfaced ~280 pre-existing stale refs
metadata:
  type: project
  source: task #20940
  created: 2026-07-03
---

`lint-skills` now grep-verifies `skills run --name X` occurrences in SKILL.md, AGENT.md,
and cli.ts against the installed skill tree (`lintNameReferences` in
`skills/arc-skill-manager/cli.ts`). This was a backlog item logged repeatedly in
`skills/arc-architecture-review/audit-log.archive.md` since it was first flagged (5x
`--name workflows` refs shipped silently, plus the `--name architect` drift found in
task #20938/dd1bfd8d that motivated this fix).

**Why this class is dangerous**: a wrong `--name` in a task description or doc fails
silently at dispatch time (`arc skills run --name X` — "skill not found") with no
build-time or test-time signal. Grep-verify is the only mechanical catch.

**Scope note**: the check matched `skills run --name` specifically, not any bare
`--name` flag — several skills (bitcoin-wallet, whop-sales) define their own unrelated
`--name` CLI argument (BNS name, pitch example name) that would otherwise false-positive.

**Result**: running the check against the full repo surfaced ~280 pre-existing stale
refs (shortened names like 'wallet', 'housekeeping', 'identity' instead of the real
'bitcoin-wallet', 'arc-housekeeping', 'erc8004-identity'). This is historical debt, not
new breakage from the check itself — filed as task #20944 for a follow-up sweep.
Pre-commit hook (`lint-skills --staged`) only enforces staged files, so it won't block
unrelated commits; historical debt only surfaces via a full `lint-skills` run or when a
file with existing drift is next touched.

See also [[skill-frontmatter-compliance]] pattern: pre-commit stops new drift, periodic
full-repo scan is the backstop for what's already there.
