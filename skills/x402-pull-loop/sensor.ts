// skills/x402-pull-loop/sensor.ts
// Gives the x402-pull-loop sync a verifiable cadence (defect-register row 18, control-plane-
// remediation P4). cli.ts's own checklist previously said "No sensor.ts (manual trigger only)" --
// confirmed genuinely never invoked anywhere (no crontab, no systemd timer, no calling code in
// the repo), so the x402_sale table's only sync path was whoever remembered to run the CLI by
// hand. This sensor queues a periodic dispatch task (matching worker-deploy's detect-and-queue
// pattern) rather than doing the fetch/DB work inline, so db/hook-state/x402-pull-loop.json now
// gives an independent cadence signal separate from x402_sale's own row timestamps (register
// row 13's staleness concern).
//
// State tracked via hook-state: standard claimSensorRun last_ran/last_result only.

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "x402-pull-loop";
const INTERVAL_MINUTES = 60;
const TASK_SOURCE = "sensor:x402-pull-loop";

const log = createSensorLogger(SENSOR_NAME);

export default async function x402PullLoopSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) return "skip";

    if (pendingTaskExistsForSource(TASK_SOURCE)) {
      log("pull task already pending");
      return "skip";
    }

    insertTask({
      subject: "Sync x402 honored entries from Worker",
      description:
        `Pull honored x402 payment entries from the arc0btc Worker's /api/x402/honored ` +
        `endpoint into db/arc.sqlite's x402_sale table.\n\n` +
        `Run: arc skills run --name x402-pull-loop\n\n` +
        `A 404 (endpoint not yet implemented on the Worker) is an EXPECTED, handled outcome -- ` +
        `cli.ts logs it and exits 0. Only a non-404 error or an unhandled exception is a real ` +
        `failure worth investigating.`,
      script: "arc skills run --name x402-pull-loop",
      source: TASK_SOURCE,
      priority: 8,
      model: "script",
    });

    log("queued x402-pull-loop sync task");
    return "ok";
  } catch (e) {
    log(`sensor error: ${e instanceof Error ? e.message : String(e)}`);
    return `error: ${e instanceof Error ? e.message : String(e)}`;
  }
}
