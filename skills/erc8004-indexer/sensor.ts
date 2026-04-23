// skills/erc8004-indexer/sensor.ts
// Queues a task to refresh the ERC-8004 agents index only when registry has changed.
// Compares current lastAgentId from local data file against hook-state to detect new registrations.

import { join } from "node:path";
import { claimSensorRun, createSensorLogger, readHookState, writeHookState } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "erc8004-indexer";
const INTERVAL_MINUTES = 360; // 6 hours
const TASK_SOURCE = "sensor:erc8004-indexer";

const ROOT = new URL("../../", import.meta.url).pathname;
const AGENTS_FILE = join(ROOT, "db", "erc8004-agents.json");

const log = createSensorLogger(SENSOR_NAME);

export default async function erc8004IndexerSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) return "skip";

    if (pendingTaskExistsForSource(TASK_SOURCE)) {
      log("indexer task already pending");
      return "skip";
    }

    // Signal-gate: only create task if registry has new agents since last index
    const state = await readHookState(SENSOR_NAME);
    const lastKnownAgentId = state?.last_agent_id ?? 0;

    let currentAgentId = 0;
    try {
      const data = JSON.parse(await Bun.file(AGENTS_FILE).text());
      currentAgentId = data.lastAgentId ?? 0;
    } catch {
      // File missing or unreadable — run the index to create it
      log("agents file missing or unreadable, will index");
    }

    if (currentAgentId > 0 && currentAgentId <= lastKnownAgentId) {
      log(`no new agents (lastAgentId=${currentAgentId}, last indexed=${lastKnownAgentId})`);
      return "skip";
    }

    insertTask({
      subject: "Refresh ERC-8004 agents index and publish to arc0.me/agents",
      description:
        `Fetch all registered agent identities from the ERC-8004 identity registry and publish the updated agents directory page to arc0.me.\n\n` +
        `Run: arc skills run --name erc8004-indexer -- generate\n` +
        `Then commit arc0me-site changes to trigger blog-deploy.\n\n` +
        `Verify the agents page at arc0.me/agents/.`,
      script: "arc skills run --name erc8004-indexer -- generate",
      source: TASK_SOURCE,
      priority: 7,
      model: "script",
    });

    // Record the agent count we just saw so next run can compare
    await writeHookState(SENSOR_NAME, {
      ...(state ?? {}),
      last_agent_id: currentAgentId,
    });

    log(`queued ERC-8004 index refresh (lastAgentId=${currentAgentId}, was ${lastKnownAgentId})`);
    return "ok";
  } catch (e) {
    log(`sensor error: ${e instanceof Error ? e.message : String(e)}`);
    return "skip";
  }
}
