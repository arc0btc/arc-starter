// arc-strategy-review/sensor.ts
//
// Fires once a day. Creates a daily PURPOSE.md self-evaluation + directive
// check task. Aligned with watch report cadence. No LLM — pure scheduling logic.

import { claimSensorRun } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "arc-strategy-review";
const INTERVAL_MINUTES = 1440; // 1 day
const TASK_SOURCE = "sensor:arc-strategy-review";

export default async function arcStrategyReviewSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Don't stack reviews
  if (pendingTaskExistsForSource(TASK_SOURCE)) return "skip";

  insertTask({
    subject: "Daily self-evaluation: PURPOSE.md rubric + directive check",
    description:
      "Daily evaluation against the PURPOSE.md rubric and Five Directives. Aligned with the watch report cycle.\n\n" +
      "Follow the protocol in skills/arc-strategy-review/SKILL.md:\n" +
      "1. Read PURPOSE.md for the Daily Self-Evaluation rubric\n" +
      "2. Read MEMORY.md for current directives and milestones\n" +
      "3. Review the last 24h of completed tasks and current pending queue\n" +
      "4. Score each PURPOSE.md criterion (Signal Quality, Operational Health, Ecosystem Impact, Cost Efficiency, Growth, Collaboration)\n" +
      "5. Assess each directive (D1–D5) and milestone for progress\n" +
      "6. Write a brief report (5–10 lines, under 200 words)\n" +
      "7. Create at most 1 follow-up task if something is clearly stalled\n" +
      "8. Append a dated one-liner with scores to MEMORY.md\n" +
      "9. Close this task\n\n" +
      "Constraints: no queue manipulation, no reprioritizing, no killing tasks.",
    skills: '["arc-strategy-review", "arc-ceo-strategy"]',
    source: TASK_SOURCE,
    priority: 5,
    model: "opus",
  });

  return "ok";
}
