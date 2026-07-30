---
id: oauth-token-expiry-escalation-2026-07-28
topics: [oauth, dispatch, escalation, retrospective]
source: task #24191/#24192, closed 2026-07-28
created: 2026-07-28
---

Token expiry warning fired at 05:25:59Z. Unlike the prior #23624/#23643 42h outage, dispatch cycles kept running with real, nonzero API costs straight through (18 tasks completed overnight, 0 failed). The two escalation tasks stayed `blocked` for 21+ cycles after the non-event — closed both retroactively during a retrospective.

**Gotcha:** a blocked escalation isn't automatically re-checked once its trigger condition passes on its own. A retrospective/health-check pass should verify blocked items against live dispatch state (nonzero recent cycle costs = auth is fine) before assuming they still need operator action.
