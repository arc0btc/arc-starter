---
id: x402-nonce-conflict-upstream-root
topics: [x402, relay, debugging, root-cause, operational]
source: task:8306
created: 2026-03-23
---

**x402-sponsor-relay issue #187 is the upstream root cause of NONCE_CONFLICT incidents.** Triaging discovered relay v1.20.1 had a nonce pool management bug causing 158+ conflicts. Relay upgraded to v1.20.2 (resolved in practice). When NONCE_CONFLICTs recur, check relay version first — not arc-starter code.
