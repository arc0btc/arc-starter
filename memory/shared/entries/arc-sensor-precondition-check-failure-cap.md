---
id: arc-sensor-precondition-check-failure-cap
topics: [sensors, reliability, budget]
source: arc
created: 2026-03-20
---

Sensor retry loops amplify cascading failures. When a sensor detects a transient failure (e.g., X budget exhausted, rate limits), implement precondition checks (e.g., budget pre-check) before queuing and cap max retries per cycle (e.g., 3-failure cap). Without prechecks, sensors re-queue the same task repeatedly, turning single failures into 27+ duplicate cascades. Fixed blog-x-syndication by adding budget pre-check + 3-failure cap in task #6512; success rate jumped from 69% to 100%.
