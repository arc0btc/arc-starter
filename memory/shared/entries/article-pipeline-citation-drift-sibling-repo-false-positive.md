---
id: article-pipeline-citation-drift-sibling-repo-false-positive
topics: [arc-article-pipeline, validation, agent-runtime, monorepo]
source: task #22771
created: 2026-07-15
---

`arc-article-pipeline`'s `stage` command emits `WARNING — possible citation drift: citation
"<path>:<line>" points at <path>, which no longer exists in the live repo` whenever a
`fileLine` citation points into a sibling checkout (e.g. `agent-runtime/src/memory.ts:206`)
that is real but lives outside `arc-starter`'s own tree — the check only resolves paths
relative to arc-starter, so any true citation into `agent-runtime`, `github/aibtcdev/skills`,
or other sibling repos always fires this warning even when the citation is accurate.

Non-blocking (stage still succeeds), but don't treat it as evidence the citation is stale.
Verify manually against the actual sibling repo path (e.g. `/home/dev/agent-runtime/src/memory.ts`)
before drafting, and don't chase a "fix" for the citation itself when this fires — the gap is
in the checker's path resolution, not the source finding. See [[article-pipeline-citation-verbatim-line-range]].
