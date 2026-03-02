import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { claimSensorRun } from "../../src/sensors.ts";
import { initDatabase, insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import { Glob } from "bun";

const SENSOR_NAME = "manage-skills";
const INTERVAL_MINUTES = 360;
const TASK_SOURCE = "sensor:consolidate-memory";
const SENSOR_VALIDATION_SOURCE = "sensor:sensor-validation";
const MEMORY_PATH = join(import.meta.dir, "../../memory/MEMORY.md");
const LINE_THRESHOLD = 200;
const SKILLS_ROOT = join(import.meta.dir, "../../skills");

function validateSensorPattern(filePath: string, content: string): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check for export default
  const hasExportDefault = /export\s+default\s+async\s+function/.test(content);
  if (!hasExportDefault) {
    issues.push("Missing 'export default async function' declaration");
  }

  // Check for claimSensorRun usage
  const hasClaimSensorRun = /claimSensorRun\(/.test(content);
  if (!hasClaimSensorRun) {
    issues.push("Missing claimSensorRun() call");
  }

  // Check for dedup pattern (pendingTaskExistsForSource or recentTaskExistsForSourcePrefix)
  const hasDedup = /pendingTaskExistsForSource|recentTaskExistsForSourcePrefix|taskExists/.test(content);
  if (!hasDedup) {
    issues.push("Missing dedup pattern (pendingTaskExistsForSource or recentTaskExistsForSourcePrefix)");
  }

  // Check for side-effect pattern (await main() at end)
  const hasSideEffect = /await\s+\w+\(\);?\s*$/.test(content.trim());
  if (hasSideEffect) {
    issues.push("Uses side-effect pattern (await main()) instead of export default");
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

async function checkSensorPatterns(): Promise<{ valid: boolean; errors: Array<{ file: string; issues: string[] }> }> {
  const errors: Array<{ file: string; issues: string[] }> = [];

  try {
    // Find all sensor.ts files
    for await (const file of new Glob("*/sensor.ts").scan(SKILLS_ROOT)) {
      const sensorPath = join(SKILLS_ROOT, file);
      const content = readFileSync(sensorPath, "utf-8");
      const result = validateSensorPattern(sensorPath, content);

      if (!result.valid) {
        errors.push({
          file: `skills/${file}`,
          issues: result.issues,
        });
      }
    }
  } catch (e) {
    const err = e as Error;
    console.error(`[sensor:manage-skills] sensor validation error: ${err.message}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export default async function manageSkillsSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Check 1: Memory consolidation
  if (existsSync(MEMORY_PATH)) {
    const content = readFileSync(MEMORY_PATH, "utf-8");
    const lineCount = content.split("\n").length;

    if (lineCount > LINE_THRESHOLD && !pendingTaskExistsForSource(TASK_SOURCE)) {
      insertTask({
        subject: `Consolidate MEMORY.md (${lineCount} lines, threshold ${LINE_THRESHOLD})`,
        description: [
          "MEMORY.md has grown past the consolidation threshold.",
          "",
          "Steps:",
          "1. Run: arc skills run --name manage-skills -- consolidate-memory check",
          "2. Read memory/MEMORY.md and compress: merge duplicates, remove stale entries, tighten prose",
          "3. Keep under 2k tokens and 200 lines (sweet spot for context + compression)",
          "4. Run: arc skills run --name manage-skills -- consolidate-memory commit",
        ].join("\n"),
        skills: '["manage-skills"]',
        priority: 8,
        source: TASK_SOURCE,
      });
    }
  }

  // Check 2: Sensor export pattern validation
  const validation = await checkSensorPatterns();
  if (!validation.valid && !pendingTaskExistsForSource(SENSOR_VALIDATION_SOURCE)) {
    const errorList = validation.errors
      .map((e) => `  - ${e.file}:\n${e.issues.map((issue) => `    * ${issue}`).join("\n")}`)
      .join("\n");

    insertTask({
      subject: `Sensor validation: ${validation.errors.length} sensor(s) need export pattern fix`,
      description: [
        "The following sensors do not follow the standard export pattern.",
        "Standard: export default async function NAME(): Promise<string>",
        "",
        errorList,
        "",
        "Fix pattern: Convert 'await main()' side-effect to 'export default async function'.",
        "Return status: 'skip'|'ok'|'error'|'rate-limited' based on execution.",
      ].join("\n"),
      skills: '["manage-skills"]',
      priority: 8,
      source: SENSOR_VALIDATION_SOURCE,
    });
  }

  return "ok";
}
