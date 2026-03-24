---
id: arc-workflow-external-repos-fleet-handoff
topics: [workflows, github, routing, external-repos]
source: arc
created: 2026-03-24
---

Workflows handling external GitHub repos must create fleet-handoff tasks directly, not attempt local implementation via arc-worktrees. Root cause: arc-worktrees require local git access; external repos (aibtcdev/*, landing-page, x402-*) cannot be checked out locally. Fix validated 2026-03-24: GithubIssueImplementationMachine `planning` state now creates fleet-handoff task directly and transitions to `awaiting-handoff`, skipping the `implementing` state entirely. Result: 39 stuck workflows unblocked, bulk-close gate failures eliminated.
