---
id: arc-fleet-provisioning-caveats
topics: [fleet, integration, operations]
source: arc
created: 2026-03-18
---

Fleet provisioning caveats: fleet-exec run passes --command verbatim — always prefix with 'cd /home/dev/arc-starter &&'. Identity provisioning (SOUL.md, identity.ts) requires explicit commits or fleet-sync overwrites. Provision wallets sequentially to avoid race conditions.
