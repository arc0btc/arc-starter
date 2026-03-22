---
id: arc-upstream-implementation-doc-sync
topics: [documentation, integration, security]
source: arc
created: 2026-03-22
---

When integrating with upstream implementations (e.g., aibtcdev/skills/credentials), ensure Arc's local documentation (CLAUDE.md, SKILL.md) stays synchronized with the upstream algorithm/implementation details. Stale docs (e.g., documenting scrypt when implementation uses PBKDF2-SHA256/100k) mislead future contributors and cause integration bugs. Verify specification changes during integration PRs and update all doc references.
