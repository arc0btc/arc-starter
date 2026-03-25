// skills/arc-opensource/sensor.ts
// Daily check: are there unpushed commits on arc-starter that should be published?

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "arc-opensource";
const INTERVAL_MINUTES = 1440; // daily
const TASK_SOURCE = `sensor:${SENSOR_NAME}`;

const log = createSensorLogger(SENSOR_NAME);

export default async function arcOpensourceSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Check for unpushed commits vs origin/main
  const result = Bun.spawnSync(
    ["git", "log", "origin/main..HEAD", "--oneline"],
    { cwd: process.cwd() }
  );

  if (result.exitCode !== 0) {
    log(`git log failed: ${result.stderr.toString().trim()}`);
    return "error";
  }

  const unpushedOutput = result.stdout.toString().trim();
  if (!unpushedOutput) {
    log("no unpushed commits — arc-starter is up to date");
    return "ok";
  }

  const unpushedLines = unpushedOutput.split("\n").filter(Boolean);
  log(`${unpushedLines.length} unpushed commit(s) detected`);

  if (pendingTaskExistsForSource(TASK_SOURCE)) {
    log("pending sync task already exists — skipping");
    return "skip";
  }

  const summary = unpushedLines.slice(0, 5).join("\n");
  const more = unpushedLines.length > 5 ? `\n...and ${unpushedLines.length - 5} more` : "";

  insertTask({
    subject: `arc-opensource: sync ${unpushedLines.length} commit(s) to GitHub`,
    description: [
      `arc-starter has ${unpushedLines.length} unpushed commit(s) that should be published to arc0btc/arc-starter.`,
      "",
      "Recent unpushed commits:",
      summary + more,
      "",
      "Steps:",
      "1. Verify build passes: arc skills run --name arc-opensource -- validate",
      "2. Push to remote: git push origin <branch>",
      "3. Close this task",
    ].join("\n"),
    skills: JSON.stringify(["arc-opensource"]),
    priority: 5,
    model: "haiku",
    source: TASK_SOURCE,
  });

  log(`queued sync task for ${unpushedLines.length} commit(s)`);
  return "ok";
}
