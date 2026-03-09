// skills/arc-catalog/sensor.ts
// Detects changes in skills/ directory and queues catalog regeneration.
//
// State tracked via hook-state:
//   last_skills_hash — hash of skills directory structure at last catalog generation

import { claimSensorRun, createSensorLogger, readHookState, writeHookState } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import { join } from "node:path";
import { readdirSync, existsSync, statSync } from "node:fs";

const SENSOR_NAME = "arc-catalog";
const INTERVAL_MINUTES = 720; // 12 hours — skills don't change often
const TASK_SOURCE = "sensor:arc-catalog";
const SKILLS_DIR = join(import.meta.dir, "..");
const SITE_DIR = join(import.meta.dir, "../../github/arc0btc/arc0me-site");

const log = createSensorLogger(SENSOR_NAME);

function computeSkillsHash(): string {
  const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .sort();

  const parts: string[] = [];
  for (const dir of dirs) {
    const skillMd = join(SKILLS_DIR, dir.name, "SKILL.md");
    const sensorTs = join(SKILLS_DIR, dir.name, "sensor.ts");
    if (existsSync(skillMd)) {
      const stat = statSync(skillMd);
      parts.push(`${dir.name}:${stat.mtimeMs}`);
    }
    if (existsSync(sensorTs)) {
      const stat = statSync(sensorTs);
      parts.push(`${dir.name}/sensor:${stat.mtimeMs}`);
    }
  }

  const hasher = new Bun.CryptoHasher("md5");
  hasher.update(parts.join("|"));
  return hasher.digest("hex").substring(0, 12);
}

export default async function arcCatalogSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) return "skip";

    if (!existsSync(SITE_DIR)) {
      log("arc0me-site not found, skipping");
      return "skip";
    }

    const currentHash = computeSkillsHash();
    const state = await readHookState(SENSOR_NAME);
    const lastHash = (state?.last_skills_hash as string) ?? "";

    if (currentHash === lastHash) {
      log(`no skill changes since last catalog (${currentHash})`);
      return "skip";
    }

    if (pendingTaskExistsForSource(TASK_SOURCE)) {
      log("catalog task already pending");
      return "skip";
    }

    insertTask({
      subject: "Regenerate and deploy skills/sensors catalog",
      description:
        `Skills directory changed (${lastHash || "initial"} -> ${currentHash}).\n\n` +
        `Run: arc skills run --name arc-catalog -- generate\n` +
        `Then commit arc0me-site to trigger blog-deploy.\n\n` +
        `Verify the catalog page renders correctly at arc0.me/catalog/.`,
      skills: JSON.stringify(["arc-catalog", "blog-deploy"]),
      source: TASK_SOURCE,
      priority: 7,
      model: "sonnet",
    });

    await writeHookState(SENSOR_NAME, { last_skills_hash: currentHash });
    log(`queued catalog regeneration (${lastHash || "initial"} -> ${currentHash})`);
    return "ok";
  } catch (e) {
    log(`sensor error: ${e instanceof Error ? e.message : String(e)}`);
    return "skip";
  }
}
