// skills/worker-deploy/sensor.ts
// Detects new commits in arc0btc-worker and queues a deploy task.
//
// State tracked via hook-state:
//   last_deployed_sha — git HEAD SHA of arc0btc-worker at last successful deploy

import { claimSensorRun, createSensorLogger, readHookState } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import { join } from "node:path";
import { existsSync } from "node:fs";

const SENSOR_NAME = "worker-deploy";
const INTERVAL_MINUTES = 5;
const TASK_SOURCE = "sensor:worker-deploy";
const WORKER_DIR = join(process.env.HOME ?? "/home/dev", "arc0btc-worker");

const log = createSensorLogger(SENSOR_NAME);

function getCurrentSha(): string {
  try {
    const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: WORKER_DIR });
    return result.stdout.toString().trim().substring(0, 12);
  } catch {
    return "";
  }
}

export default async function workerDeploySensor(): Promise<string> {
  try {
    // DISABLED 2026-07-08 (arc-storefront-revamp P5, deployed-source hunt): this sensor targets
    // ~/arc0btc-worker, a checkout that is NOT the live arc0btc.com deployment. Deterministic proof
    // (CF Workers API deployments list for script arc0btc-worker-production): the live version
    // (id 431aaba8-..., created 2026-07-03T22:28:21Z, 100% traffic) carries FEEDS_KV/PAYMENTS_KV
    // bindings, which belong to the OTHER checkout
    // (~/arc-starter/github/arc0btc/arc0btc-worker) -- RESEARCH_KV (this checkout's binding) is
    // absent from the live version entirely. This checkout's last deploy predates 2026-03-16 and has
    // been silently superseded. If this sensor ever fires again (e.g. a future commit lands in
    // ~/arc0btc-worker), it would silently overwrite the ACTUAL live worker with 4-month-stale code,
    // re-opening the exact deployed-source ambiguity a prior phase (P3) had to punt on. Disabled as a
    // no-op until the two checkouts are consolidated. See
    // docs/specs/2026-07-08-arc0btc-worker-deployed-source.md (manage-agents repo) for the full
    // evidence trail. Reversal: delete this early return to re-arm (not recommended without first
    // consolidating the checkouts or repointing WORKER_DIR at the actually-live one).
    log("disabled: this sensor targets a non-live arc0btc-worker checkout -- see docs/specs/2026-07-08-arc0btc-worker-deployed-source.md");
    return "skip";

    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) return "skip";

    if (!existsSync(WORKER_DIR)) {
      log("arc0btc-worker not found, skipping");
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
      subject: `Deploy arc0btc-worker to Cloudflare (${currentSha})`,
      description:
        `arc0btc-worker has new commits. Build and deploy to production.\n\n` +
        `Change: ${changeDesc}\n\n` +
        `Run: arc skills run --name worker-deploy -- deploy\n\n` +
        `This will: npm run build:client → npx wrangler deploy --env production → verify health.`,
      script: "arc skills run --name worker-deploy -- deploy",
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
