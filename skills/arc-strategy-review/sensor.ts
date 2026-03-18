// arc-strategy-review/sensor.ts
//
// Fires once a week. Creates a lightweight strategic review task to check
// directive and milestone progress. No LLM — pure scheduling logic.

import { claimSensorRun } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "arc-strategy-review";
const INTERVAL_MINUTES = 10080; // 7 days
const TASK_SOURCE = "sensor:arc-strategy-review";

export default async function arcStrategyReviewSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Don't stack reviews
  if (pendingTaskExistsForSource(TASK_SOURCE)) return "skip";

  insertTask({
    subject: "Weekly strategic review: directive + milestone check",
    description:
      "Lightweight weekly check-in against the Five Directives and active milestones.\n\n" +
      "Follow the protocol in skills/arc-strategy-review/SKILL.md:\n" +
      "1. Read MEMORY.md for current directives and milestones\n" +
      "2. Review recent 7 days of completed tasks and current pending queue\n" +
      "3. Assess each directive (D1–D5) and milestone for progress\n" +
      "4. Write a brief report (5–10 lines, under 200 words)\n" +
      "5. Create at most 1 follow-up task if something is stalled\n" +
      "6. Append a dated one-liner to MEMORY.md\n" +
      "7. Close this task\n\n" +
      "Constraints: no queue manipulation, no reprioritizing, no killing tasks.",
    skills: '["arc-strategy-review", "arc-ceo-strategy"]',
    source: TASK_SOURCE,
    priority: 5,
  });

  return "ok";
}
