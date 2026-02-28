import { claimSensorRun } from "../../src/sensors.ts";
import { initDatabase, insertTask, getAllActiveWorkflows } from "../../src/db.ts";

const SENSOR_NAME = "workflows";
const INTERVAL_MINUTES = 60;

export default async function workflowsSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  try {
    const workflows = getAllActiveWorkflows();

    // Find stale workflows: active for >7 days without updates
    const now = new Date();
    const staleCount = workflows.filter((w) => {
      const updatedAt = new Date(w.updated_at);
      const ageMs = now.getTime() - updatedAt.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      return ageDays > 7;
    }).length;

    if (staleCount > 0) {
      const source = "sensor:workflows";
      insertTask({
        subject: `Review ${staleCount} stale workflow(s)`,
        description: `Found ${staleCount} active workflow(s) stale >7 days. Review and either advance or complete them.`,
        source,
        skills: "workflows",
        priority: 6,
      });
      return "ok";
    }

    return "skip";
  } catch (err) {
    console.error(`workflows sensor error: ${err instanceof Error ? err.message : String(err)}`);
    return "skip";
  }
}
