// skills/arc-starter-publish/sensor.ts
// Detects when v2 branch is ahead of main and queues a publish task.

import { claimSensorRun, createSensorLogger, readHookState, writeHookState } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "arc-starter-publish";
const INTERVAL_MINUTES = 60;
const TASK_SOURCE = "sensor:arc-starter-publish";
const REPO_DIR = import.meta.dir.replace(/\/skills\/arc-starter-publish$/, "");

const log = createSensorLogger(SENSOR_NAME);

function git(args: string[]): { ok: boolean; stdout: string } {
  const result = Bun.spawnSync(["git", ...args], { cwd: REPO_DIR });
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout.toString().trim(),
  };
}

/** Count commits in v2 that are not in main. */
function commitsAhead(): number {
  // Fetch latest refs from origin (non-fatal if offline)
  git(["fetch", "origin", "main", "v2", "--quiet"]);

  const result = git(["rev-list", "--count", "main..v2"]);
  if (!result.ok) return -1;
  const count = parseInt(result.stdout, 10);
  return Number.isNaN(count) ? -1 : count;
}

function v2HeadSha(): string {
  const result = git(["rev-parse", "--short=12", "v2"]);
  return result.ok ? result.stdout : "";
}

export default async function arcStarterPublishSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) return "skip";

    const ahead = commitsAhead();

    if (ahead < 0) {
      log("could not determine v2 vs main difference");
      return "skip";
    }

    if (ahead === 0) {
      log("v2 and main are in sync");
      return "ok";
    }

    // v2 is ahead — check for existing pending task
    if (pendingTaskExistsForSource(TASK_SOURCE)) {
      log(`v2 is ${ahead} commit(s) ahead but publish task already pending`);
      return "ok";
    }

    const sha = v2HeadSha();

    insertTask({
      subject: `Publish arc-starter: merge v2 into main (${ahead} commit${ahead > 1 ? "s" : ""} ahead)`,
      description: [
        `v2 is ${ahead} commit(s) ahead of main.`,
        `v2 HEAD: ${sha}`,
        "",
        "Run: arc skills run --name arc-starter-publish -- publish",
        "",
        "This will fast-forward merge v2 into main and push to origin.",
      ].join("\n"),
      script: "arc skills run --name arc-starter-publish -- publish",
      source: TASK_SOURCE,
      priority: 7,
      model: "script",
    });

    log(`queued publish task — v2 is ${ahead} commit(s) ahead (${sha})`);
    return "ok";
  } catch (e) {
    log(`sensor error: ${e instanceof Error ? e.message : String(e)}`);
    return "skip";
  }
}
