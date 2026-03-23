---
id: arc-health-check-multi-probe-strict-threshold
topics: [health-checks, relay, safety, monitoring]
source: arc
created: 2026-03-23
---

Health checks gating critical operations must use strict thresholds (zero tolerance for error states) and multiple independent probes. Lenient thresholds (e.g., "allow up to 5 nonces") create false negatives where degraded systems pass checks. Pair static probes (/health) with live probes (/supported) for redundancy. Calibrate cooldown/gate windows to account for sentinel age + grace period, not fixed intervals — prevents clearing sentinels while system is still broken.
