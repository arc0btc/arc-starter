// skills/blog-deploy/sensor.ts
// Detects new commits in arc0me-site and queues a deploy task.
//
// State tracked via hook-state:
//   last_deployed_sha — git HEAD SHA of arc0me-site at last successful deploy

import { claimSensorRun, createSensorLogger, readHookState } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import { join } from "node:path";
import { existsSync } from "node:fs";

const SENSOR_NAME = "blog-deploy";
const INTERVAL_MINUTES = 5;
const TASK_SOURCE = "sensor:blog-deploy";
const SITE_DIR = join(import.meta.dir, "../../github/arc0btc/arc0me-site");

const log = createSensorLogger(SENSOR_NAME);

function getCurrentSha(): string {
  try {
    const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: SITE_DIR });
    return result.stdout.toString().trim().substring(0, 12);
  } catch {
    return "";
  }
}

export default async function blogDeploySensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) return "skip";

    if (!existsSync(SITE_DIR)) {
      log("arc0me-site not found, skipping");
      return "skip";
    }

    const currentSha = getCurrentSha();
    if (!currentSha) {
      log("could not read git HEAD, skipping");
      return "skip";
    }

    const state = await readHookState(SENSOR_NAME);
    const lastDeployedSha = (state?.last_deployed_sha as string) ?? "";

    if (currentSha === lastDeployedSha) {
      log(`no changes since last deploy (${currentSha})`);
      return "skip";
    }

    if (pendingTaskExistsForSource(TASK_SOURCE)) {
      log("deploy task already pending");
      return "skip";
    }

    const changeDesc = lastDeployedSha
      ? `${lastDeployedSha} → ${currentSha}`
      : `initial deploy (${currentSha})`;

    insertTask({
      subject: `Deploy arc0me-site to Cloudflare (${currentSha})`,
      description:
        `arc0me-site has new commits. Build and deploy to production.\n\n` +
        `Change: ${changeDesc}\n\n` +
        `Run: arc skills run --name blog-deploy -- deploy\n\n` +
        `This will: npm run build → npx wrangler deploy --env production → verify-deploy.`,
      skills: JSON.stringify(["blog-deploy", "blog-publishing"]),
      source: TASK_SOURCE,
      priority: 7,
      model: "opus",
    });

    log(`queued deploy task for ${changeDesc}`);
    return "ok";
  } catch (e) {
    log(`sensor error: ${e instanceof Error ? e.message : String(e)}`);
    return "skip";
  }
}
