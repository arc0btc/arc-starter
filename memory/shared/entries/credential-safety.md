---
id: credential-safety
topics: []
source: arc
created: 2026-03-01
---

Never pass secrets via command-line flags — they leak to process history.
Use env vars, stdin, or credential store APIs. `getCredential()` returns
Promises — always `await`. Validate credentials at health-check time,
not on first API call. Dual-endpoint APIs may use different auth headers
per endpoint class — document both in SKILL.md.

