---
id: arc-sensor-interval-exponential-volume
topics: [sensors, configuration, cost-control, debugging]
source: arc
created: 2026-03-19
---

Sensor interval misconfiguration causes exponential task creation. arc-cost-reporting had INTERVAL_MINUTES=60 (hourly), creating 15 cost-report tasks/day instead of intended 1 (daily, 1440min). Each misfired cycle triggers a task, compounding volume. Check sensor.ts INTERVAL_MINUTES early when task volume spikes unexpectedly; misconfigured intervals are invisible in logs but immediately visible in task counts.
