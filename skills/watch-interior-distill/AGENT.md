---
name: watch-interior-distill-agent
skill: watch-interior-distill
description: Distill 1-2 interior observations from one watch report into source-artifact nuggets for paid-room premium context.
---

# watch-interior-distill — extraction protocol

You are reading one `reports/*_watch_report.html` and extracting 1-2 INTERIOR
OBSERVATIONS — concrete operating deltas that paying $50/mo members would want
to hear about.

## Topic taxonomy (fixed)

Pick 1-2 of:

- `cost`               — today's spend trend, opus burn, $/task drift
- `failure-cluster`    — a group of related failures or one big one
- `sensor-anomaly`     — a sensor fired unexpectedly or stayed silent
- `relationship-delta` — counterparty pattern that shifted
- `surprise`           — anything signal-rich that doesn't fit the above

## Quality bar

- Concrete numbers from the report — quote them, don't paraphrase.
- One sentence of framing: why a paying $50/mo member would care.
- ≤ 1200 chars total per nugget.
- Citation: `watch-report:<iso>` (e.g. `watch-report:2026-06-13T01:01:25Z`).
- `suggested_channels`: `["whop-chat", "reactive"]` — paid premium only.

## Writing a nugget

```ts
import { writeDistilled } from "../../src/artifacts.ts";

const id = writeDistilled({
  type: "watch-interior",
  produced_at: new Date().toISOString(),
  source_path: "<watch report path from task description>",
  topic: "cost",
  title: "Opus-heavy build day — $0.56/task vs $0.30 baseline",
  nugget: `Today: $74.43/134 cycles = $0.56/task. The PR #8 complex merge cost $4.98 alone (3 retries on conflict resolution before commit landed). Baseline last week was $0.30. The driver is opus model selection for multi-step LLM reasoning — haiku timed out 3 times on the merge.\n\nWhy it matters: the $50/mo room sees this kind of cost story in real time; the public surface only sees aggregates. When you ask "how does Arc decide opus vs sonnet?", today is the answer.`,
  citation: "watch-report:2026-06-13T01:01:25Z",
  suggested_channels: ["whop-chat", "reactive"],
});
console.log("wrote", id);
```

Run via `bun -e '...'`.

## Quiet day rule

If the report is operationally quiet (high success rate, boring cost, no
anomalies), write 0 or 1 nuggets. Filler dilutes the pool. Close completed with
a result_summary explaining the quiet day.

## Forbidden

- Inventing numbers.
- Press-release prose. Keep it close to the actual operational story.
- `suggested_channels` other than `["whop-chat", "reactive"]` — this is the
  premium asymmetry guarantee.
- More than 2 nuggets per task.

## Result summary

Close completed with one line, e.g.:

`"2 nuggets: cost (opus-heavy day $0.56/task), sensor-anomaly (arc-self-review fired 3x in 1h)."`

or

`"0 nuggets — quiet day. 132/134 completed, $0.29/task, no spirals or caps. Logged but nothing worth surfacing to members today."`
