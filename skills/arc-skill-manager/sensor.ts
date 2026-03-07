import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import { Glob } from "bun";

const SENSOR_NAME = "arc-skill-manager";
const MEMORY_SENSOR_NAME = "arc-memory-consolidate";
const MEMORY_INTERVAL_MINUTES = 120;
const VALIDATION_INTERVAL_MINUTES = 360;
const log = createSensorLogger(SENSOR_NAME);
const TASK_SOURCE = "sensor:arc-memory-consolidate";
const SENSOR_VALIDATION_SOURCE = "sensor:arc-sensor-validation";
const MEMORY_PATH = join(import.meta.dir, "../../memory/MEMORY.md");
const PATTERNS_PATH = join(import.meta.dir, "../../memory/patterns.md");
const LINE_THRESHOLD = 500;
const PATTERNS_LINE_THRESHOLD = 150;
const PATTERNS_TASK_SOURCE = "sensor:arc-patterns-consolidate";
const SKILLS_ROOT = join(import.meta.dir, "../../skills");
const DECAY_SENSOR_NAME = "arc-research-decay";
const DECAY_INTERVAL_MINUTES = 1440; // 24 hours
const ARXIV_REPORT_CAP = 5;
const RESEARCH_ARCHIVE_DAYS = 30;
const RESEARCH_DIR = join(import.meta.dir, "../../research");
const RESEARCH_ARCHIVE_DIR = join(import.meta.dir, "../../research/archive");

/** Extract publish date from a research report filename.
 * Matches ISO prefix (2026-03-04T..._name.md) or ISO suffix (name-2026-03-05.md). */
function extractReportDate(filename: string): Date | null {
  const prefixMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  if (prefixMatch) return new Date(prefixMatch[1]);
  const suffixMatch = filename.match(/-(\d{4}-\d{2}-\d{2})(?:\.md)?$/);
  if (suffixMatch) return new Date(suffixMatch[1]);
  return null;
}

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

  // Check for dedup pattern (pendingTaskExistsForSource, recentTaskExistsForSourcePrefix,
  // taskExists, or insertTaskIfNew which wraps pendingTaskExistsForSource internally)
  const hasDedup = /pendingTaskExistsForSource|recentTaskExistsForSourcePrefix|taskExists|insertTaskIfNew/.test(content);
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
    const error = e as Error;
    log(`sensor validation error: ${error.message}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export default async function manageSkillsSensor(): Promise<string> {
  const results: string[] = [];

  // Check 1: Memory consolidation (every 2 hours)
  const memoryClaimed = await claimSensorRun(MEMORY_SENSOR_NAME, MEMORY_INTERVAL_MINUTES);
  if (memoryClaimed) {
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
            "3. Keep under 5k tokens and 500 lines (balance usable knowledge with compression)",
            "4. Run: arc skills run --name manage-skills -- consolidate-memory commit",
          ].join("\n"),
          skills: '["arc-skill-manager"]',
          priority: 8,
          model: "sonnet",
          source: TASK_SOURCE,
        });
        results.push("memory-task-created");
      } else {
        results.push("memory-ok");
      }
    }
  }

  // Check 1b: patterns.md consolidation (piggybacks on memory check interval)
  if (memoryClaimed) {
    if (existsSync(PATTERNS_PATH)) {
      const pContent = readFileSync(PATTERNS_PATH, "utf-8");
      const pLineCount = pContent.split("\n").length;

      if (pLineCount > PATTERNS_LINE_THRESHOLD && !pendingTaskExistsForSource(PATTERNS_TASK_SOURCE)) {
        insertTask({
          subject: `Consolidate patterns.md (${pLineCount} lines, threshold ${PATTERNS_LINE_THRESHOLD})`,
          description: [
            "memory/patterns.md has grown past the 150-line cap.",
            "",
            "Steps:",
            "1. Read memory/patterns.md",
            "2. Archive or prune the oldest/most-specific entries",
            "3. Merge duplicate or closely related patterns",
            "4. Keep the file under ~150 lines while preserving reusable operational knowledge",
            "5. Commit the result",
          ].join("\n"),
          skills: '["arc-skill-manager"]',
          priority: 8,
          model: "sonnet",
          source: PATTERNS_TASK_SOURCE,
        });
        results.push("patterns-task-created");
      } else {
        results.push("patterns-ok");
      }
    }
  }

  // Check 2: Research report decay (every 24 hours)
  const decayClaimed = await claimSensorRun(DECAY_SENSOR_NAME, DECAY_INTERVAL_MINUTES);
  if (decayClaimed) {
    const decayResults: string[] = [];

    // 2a: Cap arxiv reports at ARXIV_REPORT_CAP most recent (sorted by mtime)
    try {
      const arxivDir = join(RESEARCH_DIR, "arxiv");
      if (existsSync(arxivDir)) {
        const arxivFiles = readdirSync(arxivDir)
          .filter((f) => f.endsWith(".md"))
          .map((f) => ({ name: f, mtime: statSync(join(arxivDir, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime);
        const toDelete = arxivFiles.slice(ARXIV_REPORT_CAP);
        for (const f of toDelete) {
          unlinkSync(join(arxivDir, f.name));
          log(`pruned arxiv report: ${f.name}`);
        }
        if (toDelete.length > 0) decayResults.push(`arxiv-pruned:${toDelete.length}`);
      }
    } catch (e) {
      log(`warn: arxiv prune failed: ${(e as Error).message}`);
    }

    // 2b: Archive research/*.md files older than RESEARCH_ARCHIVE_DAYS by publish date
    try {
      mkdirSync(RESEARCH_ARCHIVE_DIR, { recursive: true });
      const cutoffMs = Date.now() - RESEARCH_ARCHIVE_DAYS * 24 * 60 * 60 * 1000;
      const researchFiles = readdirSync(RESEARCH_DIR).filter((f) => f.endsWith(".md"));
      let archived = 0;
      for (const f of researchFiles) {
        const reportDate = extractReportDate(f);
        if (!reportDate || reportDate.getTime() >= cutoffMs) continue;
        renameSync(join(RESEARCH_DIR, f), join(RESEARCH_ARCHIVE_DIR, f));
        log(`archived research report: ${f}`);
        archived++;
      }
      if (archived > 0) decayResults.push(`research-archived:${archived}`);
    } catch (e) {
      log(`warn: research archive failed: ${(e as Error).message}`);
    }

    results.push(decayResults.length > 0 ? decayResults.join(",") : "decay-ok");
  }

  // Check 3: Sensor export pattern validation (every 6 hours)
  const validationClaimed = await claimSensorRun(SENSOR_NAME, VALIDATION_INTERVAL_MINUTES);
  if (validationClaimed) {
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
        skills: '["arc-skill-manager"]',
        priority: 8,
        model: "sonnet",
        source: SENSOR_VALIDATION_SOURCE,
      });
      results.push("validation-task-created");
    } else {
      results.push("validation-ok");
    }
  }

  if (results.length === 0) return "skip";
  return `ok: ${results.join(", ")}`;
}
