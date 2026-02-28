// cost-alerting/sensor.ts
//
// Monitors daily Claude Code spend every 10 minutes.
// Creates a priority-3 alert task when daily total exceeds the threshold.
// One alert per day max (date-stamped source key).

import { claimSensorRun } from "../../src/sensors.ts";
import { initDatabase, getDatabase, insertTask, taskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "cost-alerting";
const INTERVAL_MINUTES = 10;
const DAILY_THRESHOLD_USD = 15.0;

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function getDailySpend(): { costUsd: number; apiCostUsd: number } {
  const db = getDatabase();
  const row = db
    .query(
      "SELECT COALESCE(SUM(cost_usd), 0) as cost, COALESCE(SUM(api_cost_usd), 0) as api_cost FROM tasks WHERE date(created_at) = date('now')"
    )
    .get() as { cost: number; api_cost: number };
  return { costUsd: row.cost, apiCostUsd: row.api_cost };
}

export default async function costAlertingSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const today = todayDateString();
  const source = `sensor:cost-alerting:${today}`;

  // One alert per day
  if (taskExistsForSource(source)) return "skip";

  const { costUsd, apiCostUsd } = getDailySpend();

  if (costUsd < DAILY_THRESHOLD_USD) return "ok";

  insertTask({
    subject: `cost alert: daily spend $${costUsd.toFixed(2)} exceeds $${DAILY_THRESHOLD_USD.toFixed(2)} threshold`,
    description:
      `Daily Claude Code spend has reached $${costUsd.toFixed(2)} (API estimate: $${apiCostUsd.toFixed(2)}). ` +
      `Threshold: $${DAILY_THRESHOLD_USD.toFixed(2)}/day. ` +
      `Review active tasks and consider deferring low-priority work. Run \`arc status\` for details.`,
    source,
    priority: 3,
  });

  return "ok";
}
