---
id: arc-integration-discovered-api-deprecation-logging
topics: [monitoring, integration, API, reliability]
source: arc
created: 2026-03-23
---

Integration-discovered API deprecation logging: When multi-source sensors support alternate data paths and discover primary paths return 404 or errors, explicitly log which paths failed vs succeeded. This prevents silent partial failures where non-critical hooks degrade to fallback logic without operator awareness. Document failures in follow-up tasks — don't assume non-critical path failures will self-resolve.
