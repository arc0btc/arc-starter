// skills/blog-deploy/sensor.ts
// Detects new commits in arc0me-site and queues a deploy task.
//
// State tracked via hook-state:
//   last_deployed_sha — git HEAD SHA of arc0me-site at last successful deploy
//
// DEPLOY-HOLD CONVENTION (added 2026-07-09, arc-storefront-revamp P7 / C-P7-1 fix):
//   Every VM-local commit to arc0me-site is a production deploy within ~5 minutes by default --
//   there is no way to distinguish "staged, awaiting operator sign-off" from routine blog
//   publishing at the commit level. C-P7-1 found this defeated the prod-site-flip hard gate twice
//   (this quest's P3, arc-day-n-publishing's P2) without either phase knowing.
//
//   To stage a change without triggering an auto-deploy, create a hold marker file at:
//     github/arc0btc/arc0me-site/.deploy-hold
//   (an empty file or one with a short reason is fine; content is not parsed). While the file is
//   present, this sensor logs a clear skip reason and does NOT queue a deploy task, no matter how
//   many commits land. Committing freely is safe during a hold.
//
//   To ship the held change (operator sign-off), delete the hold file:
//     rm github/arc0btc/arc0me-site/.deploy-hold
//   The very next sensor tick (up to 5 min) will queue the deploy for current HEAD, same as normal.
//
//   DEFAULT (no hold file present) = unchanged prior behavior: commit to arc0me-site main = deploy.
//   This is deliberate -- Arc's daily blog posts must keep flowing untouched; the hold is opt-in,
//   not opt-out.

import { claimSensorRun, createSensorLogger, readHookState } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import { join } from "node:path";
import { existsSync } from "node:fs";

const SENSOR_NAME = "blog-deploy";
const INTERVAL_MINUTES = 5;
const TASK_SOURCE = "sensor:blog-deploy";
const SITE_DIR = join(import.meta.dir, "../../github/arc0btc/arc0me-site");
const DEPLOY_HOLD_FILE = join(SITE_DIR, ".deploy-hold");

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

    if (existsSync(DEPLOY_HOLD_FILE)) {
      log(`deploy hold active (${DEPLOY_HOLD_FILE} present) — skipping auto-deploy until hold is removed (operator sign-off)`);
      return "skip";
    }

    const currentSha = getCurrentSha();
    if (!currentSha) {
      log("could not read git HEAD, skipping");
      return "skip";
    }

    const state = await readHookState(SENSOR_NAME);
    const lastDeployedSha = (state?.last_deployed_sha as string) ?? "";
    const lastFailedSha = (state?.last_failed_sha as string) ?? "";

    if (currentSha === lastDeployedSha) {
      log(`no changes since last deploy (${currentSha})`);
      return "skip";
    }

    if (currentSha === lastFailedSha) {
      log(`last build failed for ${currentSha} — skipping until content is fixed`);
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
      script: "arc skills run --name blog-deploy -- deploy",
      source: TASK_SOURCE,
      priority: 7,
      model: "script",
    });

    log(`queued deploy task for ${changeDesc}`);
    return "ok";
  } catch (e) {
    log(`sensor error: ${e instanceof Error ? e.message : String(e)}`);
    return "skip";
  }
}
