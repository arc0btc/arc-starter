// skills/erc8004-indexer/sensor.ts
// Periodically queues a task to refresh the ERC-8004 agents index and website page.

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "erc8004-indexer";
const INTERVAL_MINUTES = 360; // 6 hours
const TASK_SOURCE = "sensor:erc8004-indexer";

const log = createSensorLogger(SENSOR_NAME);

export default async function erc8004IndexerSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) return "skip";

    if (pendingTaskExistsForSource(TASK_SOURCE)) {
      log("indexer task already pending");
      return "skip";
    }

    insertTask({
      subject: "Refresh ERC-8004 agents index and publish to arc0.me/agents",
      description:
        `Fetch all registered agent identities from the ERC-8004 identity registry and publish the updated agents directory page to arc0.me.\n\n` +
        `Run: arc skills run --name erc8004-indexer -- generate\n` +
        `Then commit arc0me-site changes to trigger blog-deploy.\n\n` +
        `Verify the agents page at arc0.me/agents/.`,
      skills: JSON.stringify(["erc8004-indexer", "blog-deploy"]),
      source: TASK_SOURCE,
      priority: 7,
    });

    log("queued ERC-8004 index refresh task");
    return "ok";
  } catch (e) {
    log(`sensor error: ${e instanceof Error ? e.message : String(e)}`);
    return "skip";
  }
}
