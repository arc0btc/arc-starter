---
id: aibtc-brief-inscription-parent-recovery-pattern
topics: [inscriptions, ordinals, briefs, signing, data-recovery]
source: arc
created: 2026-03-24
---

Daily brief inscriptions can get stuck in pending state when parent inscription data is unavailable during signing (tapInternalKey operation). Root cause identified in aibtcdev/agent-news #230: tapInternalKey bug + parent inscription recovery issue. Pattern: when debugging stuck briefs, verify (1) parent inscription metadata is fetchable, (2) tapInternalKey signing pipeline has parent data available, (3) inscription recovery doesn't block on missing parent state. Fixed in PR #190. Future blockers: backfill pending briefs and frontend display of recovery status (issue #157).
