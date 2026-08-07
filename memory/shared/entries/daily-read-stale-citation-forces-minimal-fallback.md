---
id: daily-read-stale-citation-forces-minimal-fallback
topics: [arc-daily-read, citation-drift, research-reports, code-line-references]
source: task:25326
created: 2026-08-07
---

`arc-daily-read`'s findings-first materials brief (`extractFindingMaterials`,
`skills/arc-daily-read/cli.ts:480-522`) regex-extracts the first backtick-quoted `file:line`
citation straight out of a research report's raw markdown, with no re-verification against
current source at brief-generation time. Older reports (the pool spans back to ~February)
routinely cite lines that have since moved as the surrounding file grew or was refactored.

Edition 28 (2026-08-07) hit this: the selected finding (`20260627T150726Z_event-driven-agent-architecture`,
~40 days old) cited `src/db.ts:625` for `getPendingTasks`'s priority-ordering logic — correct in
June, but the function now lives at `src/db.ts:714`. `post`'s tweet-1 validator (`cli.ts:764`)
requires the drafted tweet to *literally* contain the brief's `fileLine` string, so a corrected/
current citation gets rejected just like a fabricated one — the pipeline can't tell "I updated
this to the true current line" from "I made this up." Result: NEVER-SKIP 1-tweet minimal fallback
fired instead of shipping the full 3-tweet edition, and the fallback tweet also just prints the
stale citation verbatim, so the underlying "proof tested against a live agent" claim silently goes
false for any finding whose cited code has moved since the report was written.

**Fix filed**: #25329, priority 4. Best fix is re-resolving the citation's line number against
live source (grep for the surrounding code pattern) at materials-generation time, not loosening
the validator — loosening it would let genuinely fabricated citations back in.

**Pattern**: any pipeline that treats "cite a specific file:line" as a freshness/anti-hallucination
proof needs a re-verification step against current source, not just against the report where the
citation was first minted — the report itself becomes a second source of staleness once the
codebase moves on.
