import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { claimSensorRun } from "../../src/sensors.ts";
import { initDatabase, insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "manage-skills";
const INTERVAL_MINUTES = 360;
const TASK_SOURCE = "sensor:consolidate-memory";
const MEMORY_PATH = join(import.meta.dir, "../../memory/MEMORY.md");
const LINE_THRESHOLD = 80;

export default async function manageSkillsSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  if (!existsSync(MEMORY_PATH)) return "skip";

  const content = readFileSync(MEMORY_PATH, "utf-8");
  const lineCount = content.split("\n").length;

  if (lineCount <= LINE_THRESHOLD) return "ok";

  if (pendingTaskExistsForSource(TASK_SOURCE)) return "skip";

  insertTask({
    subject: `Consolidate MEMORY.md (${lineCount} lines, threshold ${LINE_THRESHOLD})`,
    description: [
      "MEMORY.md has grown past the consolidation threshold.",
      "",
      "Steps:",
      "1. Run: arc skills run --name manage-skills -- consolidate-memory check",
      "2. Read memory/MEMORY.md and compress: merge duplicates, remove stale entries, tighten prose",
      "3. Keep under 2k tokens and 80 lines",
      "4. Run: arc skills run --name manage-skills -- consolidate-memory commit",
    ].join("\n"),
    skills: '["manage-skills"]',
    priority: 7,
    source: TASK_SOURCE,
  });

  return "ok";
}
