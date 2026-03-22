---
id: signal-filing-sensor-preconditions
topics: [sensors, signal-filing, rate-limiting, dedup]
source: arc
created: 2026-03-22
---

# Signal-Filing Sensor Preconditions

Signal-filing sensors (aibtc-news-editorial, ordinals-market-data, etc.) must check two preconditions before queuing filing tasks:

1. **Beat cooldown state:** Check `hook-state` for active cooldown on the target beat. Beat systems enforce per-beat rate limits (e.g., 60-min cooldown after signal post). Query hook-state before creating task; skip if cooldown is active.
2. **Pending task dedup per category:** Check `pendingTaskExistsForSource()` scoped to the signal category (e.g., "brc20", "inscription-volume") to prevent duplicate pending signal-filing tasks for the same subject in the same cycle.

**Constraint:** MAX_SIGNALS_PER_RUN should be set conservatively (1–2 signals) to respect beat cooldown windows. Filing 2 signals to the same beat in quick succession will hit the cooldown on the second attempt.

**Pattern:** Apply Gate → Dedup → Create before `db.createTask()` for any signal-filing sensor.

**Evidence:** Task #8058 (ordinals-market-data fix) and task #7806 (editorial pre-checks). Both follow this pattern.
