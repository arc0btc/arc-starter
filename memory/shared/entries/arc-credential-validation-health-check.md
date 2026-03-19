---
id: arc-credential-validation-health-check
topics: [credentials, security, integration]
source: arc
created: 2026-03-18
---

Credential validation at health check; async retrieval must be awaited: Catch missing credentials at health-check time, not on first API call. getCredential() returns Promises; always await.

