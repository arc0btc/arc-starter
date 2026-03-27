# Overnight Batch Pattern

A structured overnight execution pattern that queues work at 8pm, checkpoints at midnight, and produces a review at 6am. All times MST (UTC-7).

---

## Overview

The overnight batch leverages Arc's existing scheduling primitives — `--defer`, sensors, and priority routing — to create a three-phase overnight cycle. No new infrastructure required.

```
8pm MST (03:00 UTC)     Midnight MST (07:00 UTC)     6am MST (13:00 UTC)
│                        │                             │
▼                        ▼                             ▼
┌──────────┐            ┌──────────┐                  ┌──────────┐
│  QUEUE   │            │CHECKPOINT│                  │  REVIEW  │
│ Phase 1  │───work────▶│ Phase 2  │───work──────────▶│ Phase 3  │
└──────────┘            └──────────┘                  └──────────┘
 Queue batch             Assess progress               Generate brief
 Set priorities          Rebalance if needed            Flag blockers
 Start execution         Handle failures                Set morning queue
```

---

## Phase 1: Queue (8pm MST / 03:00 UTC)

**Trigger:** `overnight-batch` sensor detects 03:00 UTC window (±15 min), runs once per night.

**Actions:**
1. Create a batch of overnight tasks from a curated source:
   - Deferred tasks whose `scheduled_for` falls in the overnight window
   - Tasks tagged with `batch:overnight` in description
   - Sensor-generated tasks queued during the day with `--defer` to 8pm
2. Create the **checkpoint task** (Phase 2), deferred to midnight:
   ```
   arc tasks add --subject "Overnight checkpoint: assess progress" \
     --priority 3 --defer 4h --skills arc-scheduler \
     --description "Phase 2 of overnight batch. Review completed/failed tasks since 03:00 UTC. Rebalance priorities. Handle failures."
   ```
3. Create the **morning review task** (Phase 3), deferred to 6am:
   ```
   arc tasks add --subject "Morning review: generate overnight brief" \
     --priority 2 --defer 10h --skills arc-scheduler \
     --description "Phase 3 of overnight batch. Generate overnight-brief from template. Summarize all overnight activity. Set morning priorities."
   ```

**Task selection for overnight batch:**
- **Deep work (P3-4, Opus):** Architecture tasks, complex code, skill creation — things that benefit from uninterrupted execution and extended overnight timeouts (90 min vs 30 min daytime).
- **Bulk operations (P6-7, Sonnet):** Content generation, PR reviews, report compilation — volume work that accumulates during the day.
- **Maintenance (P8-9, Haiku):** Config updates, status checks, cleanup — low-cost tasks that clear the backlog.

**Priority strategy:** Stagger priorities so deep work runs first, bulk second, maintenance last. The dispatch loop naturally handles this ordering.

---

## Phase 2: Checkpoint (Midnight MST / 07:00 UTC)

**Trigger:** Deferred task created in Phase 1 becomes eligible at midnight.

**Actions:**
1. Query overnight progress since 03:00 UTC:
   ```sql
   -- Tasks completed since batch start
   SELECT count(*) FROM tasks WHERE completed_at >= '03:00 UTC' AND status = 'completed';
   -- Tasks failed
   SELECT count(*) FROM tasks WHERE completed_at >= '03:00 UTC' AND status = 'failed';
   -- Cost so far
   SELECT sum(cost_usd) FROM cycle_log WHERE started_at >= '03:00 UTC';
   ```
2. **Rebalance decisions:**
   - If cost is tracking above $100 overnight: pause P8+ tasks, only continue P1-4
   - If >3 tasks failed: create a diagnostic task (P4) to investigate pattern
   - If queue is empty: pull forward tomorrow's deferred tasks or idle gracefully
   - If a blocked task is preventing downstream work: escalate priority or create workaround
3. Update `memory/MEMORY.md` with checkpoint observations

**Output:** One-line result summary: `"Checkpoint: X completed, Y failed, $Z spent. [Rebalanced/No changes needed]"`

---

## Phase 3: Review (6am MST / 13:00 UTC)

**Trigger:** Deferred task created in Phase 1 becomes eligible at 6am.

**Actions:**
1. Generate the overnight brief using `templates/overnight-brief.md`
2. Data sources:
   - `tasks` table: completed/failed/blocked since 03:00 UTC
   - `cycle_log` table: cycles, costs, tokens
   - `git log --since="10 hours ago"`: overnight commits
   - Sensor logs: anomalies or alerts
3. Write brief to `memory/overnight-brief-YYYY-MM-DD.md`
4. Set morning priorities:
   - Failed tasks → create retry tasks at appropriate priority
   - Blocked tasks → flag in brief's "Needs Attention" section
   - Identify highest-value work for the human's morning review
5. Commit brief and memory updates

**Output:** The overnight brief, ready for whoabuddy's morning review.

---

## Sensor Design: `overnight-batch`

```
Interval: 30 minutes
Logic:
  1. Check current UTC hour
  2. If hour == 3 (8pm MST) and no batch created today:
     - claimSensorRun('overnight-batch', 1440)  // once per 24h
     - Create Phase 1/2/3 tasks
  3. Otherwise: skip
```

The sensor is lightweight — it only fires once per day at the 8pm window. The 30-minute check interval ensures it catches the window without excessive polling.

**Dedup key:** `sensor:overnight-batch:YYYY-MM-DD` as the task source. Query existing tasks with this source to prevent duplicate batches.

---

## How to Queue Work for Overnight

### From sensors (during the day):
```bash
# Sensor detects something that can wait until tonight
arc tasks add --subject "Deep analysis: token economics" \
  --priority 4 --defer 8pm-relative \
  --description "batch:overnight. Full token analysis needed."
```

### From humans:
```bash
# Queue specific work for tonight's batch
arc tasks add --subject "Refactor dispatch error handling" \
  --priority 3 --scheduled-for "2026-03-10T03:00:00Z" \
  --skills arc-scheduler \
  --description "batch:overnight. Complex refactor — run overnight with extended timeout."
```

### From dispatch (follow-up tasks):
```bash
# Current task creates overnight follow-up
arc tasks add --subject "Verify deployment after soak period" \
  --priority 6 --defer 8h \
  --source "task:2645" \
  --description "batch:overnight. Check deployment health after 8h soak."
```

---

## Cost Governance

Overnight budget allocation (within $200/day total):
- **Target overnight spend:** $40-60 (20-30% of daily budget)
- **Hard gate:** Existing dispatch budget gate ($500 ceiling) prevents runaway spend
- **Checkpoint enforcement:** Phase 2 reviews spend and can throttle remaining work
- **Model mix matters:** 2-3 Opus tasks ($2-4 each) + 10-15 Sonnet tasks ($0.50-1 each) + 20-30 Haiku tasks ($0.10-0.25 each) = ~$25-45

---

## Implementation Steps

1. **Create `overnight-batch` sensor** — Detects 8pm window, creates Phase 1/2/3 tasks. Simple time-gate sensor, no LLM needed.
2. **Create `overnight-batch` skill** — CLI commands for manual batch creation, checkpoint queries, and brief generation. Houses the SKILL.md (this doc) and sensor.
3. **Wire Phase 2 checkpoint logic** — Query-based progress assessment. Dispatch runs this as a normal task.
4. **Wire Phase 3 brief generation** — Template rendering from `overnight-brief.md`. Dispatch runs this as a normal task.
5. **Test with a manual batch** — Queue 5-10 tasks with `--scheduled-for` at tonight's 8pm window. Observe the three-phase cycle.

---

## Design Principles

- **No new primitives.** Uses `--defer`, sensors, priority routing, and templates — all existing.
- **Self-healing.** If Phase 2 or 3 tasks fail, they retry normally (max 3). If the batch sensor misses a window, the next day's sensor run creates tomorrow's batch.
- **Observable.** Each phase produces a task result. The morning brief is a committed file. Nothing happens silently.
- **Composable.** Any task can be tagged `batch:overnight` to ride the next batch. Sensors can defer to the batch window. Humans can manually queue.
- **Budget-safe.** Checkpoint at midnight enforces cost governance mid-batch. Morning review catches anything the checkpoint missed.
