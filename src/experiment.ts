/**
 * Experiment evaluation for worktree-isolated self-improvement tasks.
 *
 * Adds an outcome evaluation gate between syntax validation and merge.
 * Since we can't A/B test in a single cycle, the pattern is:
 *   1. Capture baseline metrics before experiment
 *   2. Classify what changed (sensor, config, prompt, code)
 *   3. Apply heuristic gates per change type
 *   4. If merge is approved, schedule a deferred verification task
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getDatabase, getRecentCycles, insertTask, type CycleLog } from "./db.js";

// ---- Types ----

export interface BaselineSnapshot {
  capturedAt: string;
  windowHours: number;
  cycleCount: number;
  successRate: number;       // 0-1
  avgCostUsd: number;
  avgDurationMs: number;
  p95DurationMs: number;
  failureRate: number;       // 0-1
}

export type ChangeCategory = "sensor" | "config" | "prompt" | "code" | "memory" | "unknown";

export interface ChangedFile {
  path: string;
  category: ChangeCategory;
}

export interface EvalResult {
  approved: boolean;
  reason: string;
  warnings: string[];
  changedFiles: ChangedFile[];
  baseline: BaselineSnapshot;
}

// ---- Baseline capture ----

/** Snapshot recent dispatch metrics as a baseline for comparison. */
export function captureBaseline(windowHours: number = 6): BaselineSnapshot {
  const db = getDatabase();
  const cutoff = new Date(Date.now() - windowHours * 3600_000).toISOString();

  const cycles = db
    .query("SELECT * FROM cycle_log WHERE started_at >= ? AND completed_at IS NOT NULL ORDER BY started_at DESC")
    .all(cutoff) as CycleLog[];

  if (cycles.length === 0) {
    return {
      capturedAt: new Date().toISOString(),
      windowHours,
      cycleCount: 0,
      successRate: 1,
      avgCostUsd: 0,
      avgDurationMs: 0,
      p95DurationMs: 0,
      failureRate: 0,
    };
  }

  // Match cycles to their tasks to get success/failure
  const taskIds = cycles.map((c) => c.task_id).filter(Boolean);
  let completed = 0;
  let failed = 0;
  if (taskIds.length > 0) {
    const placeholders = taskIds.map(() => "?").join(",");
    const completedRow = db
      .query(`SELECT COUNT(*) as n FROM tasks WHERE id IN (${placeholders}) AND status = 'completed'`)
      .get(...taskIds) as { n: number };
    const failedRow = db
      .query(`SELECT COUNT(*) as n FROM tasks WHERE id IN (${placeholders}) AND status = 'failed'`)
      .get(...taskIds) as { n: number };
    completed = completedRow.n;
    failed = failedRow.n;
  }

  const total = completed + failed || 1;
  const durations = cycles.map((c) => c.duration_ms ?? 0).filter((d) => d > 0).sort((a, b) => a - b);
  const costs = cycles.map((c) => c.cost_usd);

  const p95Index = Math.min(Math.floor(durations.length * 0.95), durations.length - 1);

  return {
    capturedAt: new Date().toISOString(),
    windowHours,
    cycleCount: cycles.length,
    successRate: completed / total,
    avgCostUsd: costs.reduce((a, b) => a + b, 0) / costs.length,
    avgDurationMs: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
    p95DurationMs: durations.length > 0 ? durations[p95Index] : 0,
    failureRate: failed / total,
  };
}

// ---- Change classification ----

const CATEGORY_PATTERNS: Array<[RegExp, ChangeCategory]> = [
  [/skills\/.*\/sensor\.ts$/, "sensor"],
  [/skills\/.*\/SKILL\.md$/, "prompt"],
  [/skills\/.*\/AGENT\.md$/, "prompt"],
  [/SOUL\.md$/, "prompt"],
  [/memory\//, "memory"],
  [/\.env$/, "config"],
  [/templates\//, "config"],
  [/src\//, "code"],
  [/skills\/.*\/cli\.ts$/, "code"],
];

export function classifyFile(path: string): ChangeCategory {
  for (const [pattern, category] of CATEGORY_PATTERNS) {
    if (pattern.test(path)) return category;
  }
  return "unknown";
}

export function classifyChanges(files: string[]): ChangedFile[] {
  return files.map((path) => ({ path, category: classifyFile(path) }));
}

// ---- Heuristic gates ----

interface GateContext {
  worktreePath: string;
  mainTreePath: string;
  changedFiles: ChangedFile[];
  baseline: BaselineSnapshot;
}

/** Gate: sensor interval changes must stay within sane bounds (1min - 1440min). */
function gateSensorIntervals(ctx: GateContext): string[] {
  const warnings: string[] = [];
  const sensorFiles = ctx.changedFiles.filter((f) => f.category === "sensor");

  for (const file of sensorFiles) {
    try {
      const content = readFileSync(join(ctx.worktreePath, file.path), "utf-8");
      // Look for claimSensorRun interval values
      const intervalMatch = content.match(/claimSensorRun\s*\(\s*["'][^"']+["']\s*,\s*(\d+)\s*\)/);
      if (intervalMatch) {
        const interval = parseInt(intervalMatch[1], 10);
        if (interval < 1) {
          warnings.push(`${file.path}: sensor interval ${interval}min is below minimum (1min)`);
        }
        if (interval > 1440) {
          warnings.push(`${file.path}: sensor interval ${interval}min exceeds 24h — likely too infrequent`);
        }
      }
    } catch {
      // File read error — syntax gate already covers this
    }
  }
  return warnings;
}

/** Gate: prompt/SKILL.md changes shouldn't delete >50% of content. */
function gatePromptChanges(ctx: GateContext): string[] {
  const warnings: string[] = [];
  const promptFiles = ctx.changedFiles.filter((f) => f.category === "prompt");

  for (const file of promptFiles) {
    try {
      const newContent = readFileSync(join(ctx.worktreePath, file.path), "utf-8");
      const oldPath = join(ctx.mainTreePath, file.path);
      let oldContent = "";
      try {
        oldContent = readFileSync(oldPath, "utf-8");
      } catch {
        continue; // New file — no comparison
      }

      const oldLen = oldContent.length;
      const newLen = newContent.length;

      if (oldLen > 0 && newLen < oldLen * 0.5) {
        warnings.push(
          `${file.path}: content reduced by ${Math.round((1 - newLen / oldLen) * 100)}% — large deletion may lose important context`
        );
      }

      // Check for identity anchor deletion in SOUL.md
      if (file.path.endsWith("SOUL.md") && oldContent.includes("## Who I Am") && !newContent.includes("## Who I Am")) {
        warnings.push(`${file.path}: CRITICAL — identity anchor section removed from SOUL.md`);
      }
    } catch {
      // Read error
    }
  }
  return warnings;
}

/** Gate: code changes to core dispatch/sensor files need extra scrutiny. */
function gateCoreCodeChanges(ctx: GateContext): string[] {
  const warnings: string[] = [];
  const coreFiles = ["src/dispatch.ts", "src/sensors.ts", "src/db.ts", "src/cli.ts", "src/services.ts"];

  const coreChanges = ctx.changedFiles.filter((f) => coreFiles.includes(f.path));
  if (coreChanges.length > 0) {
    warnings.push(
      `Core files modified: ${coreChanges.map((f) => f.path).join(", ")} — changes will be merged but verify service health post-merge`
    );
  }
  return warnings;
}

/** Gate: config changes should not remove critical entries. */
function gateConfigChanges(ctx: GateContext): string[] {
  const warnings: string[] = [];
  const configFiles = ctx.changedFiles.filter((f) => f.category === "config");

  for (const file of configFiles) {
    if (file.path === ".env") {
      warnings.push(`${file.path}: .env modified — verify no credentials were removed`);
    }
  }
  return warnings;
}

// ---- Main evaluation ----

/**
 * Evaluate whether a worktree experiment should be merged.
 *
 * Returns an EvalResult with approval decision, reasoning, and any warnings.
 * Hard failures (critical gates) block the merge. Warnings are logged but don't block.
 */
export function evaluateExperiment(
  worktreePath: string,
  mainTreePath: string,
  changedFilePaths: string[],
  baseline: BaselineSnapshot,
): EvalResult {
  const changedFiles = classifyChanges(changedFilePaths);

  const ctx: GateContext = { worktreePath, mainTreePath, changedFiles, baseline };

  // Run all gates
  const allWarnings: string[] = [];
  const blockers: string[] = [];

  // Sensor interval gate
  const sensorWarnings = gateSensorIntervals(ctx);
  for (const w of sensorWarnings) {
    if (w.includes("below minimum")) {
      blockers.push(w);
    } else {
      allWarnings.push(w);
    }
  }

  // Prompt change gate
  const promptWarnings = gatePromptChanges(ctx);
  for (const w of promptWarnings) {
    if (w.includes("CRITICAL")) {
      blockers.push(w);
    } else {
      allWarnings.push(w);
    }
  }

  // Core code gate (warning only — syntax already validated)
  allWarnings.push(...gateCoreCodeChanges(ctx));

  // Config gate
  allWarnings.push(...gateConfigChanges(ctx));

  if (blockers.length > 0) {
    return {
      approved: false,
      reason: `Blocked by ${blockers.length} critical gate(s): ${blockers.join("; ")}`,
      warnings: allWarnings,
      changedFiles,
      baseline,
    };
  }

  return {
    approved: true,
    reason: `Passed all gates. ${changedFiles.length} file(s) across ${new Set(changedFiles.map((f) => f.category)).size} category(s).`,
    warnings: allWarnings,
    changedFiles,
    baseline,
  };
}

/**
 * Schedule a deferred verification task to check if an experiment improved metrics.
 * Runs after enough cycles have accumulated to compare against baseline.
 */
export function scheduleVerification(
  taskId: number,
  baseline: BaselineSnapshot,
  changedFiles: ChangedFile[],
): number {
  const categories = [...new Set(changedFiles.map((f) => f.category))];
  const fileList = changedFiles.map((f) => f.path).join(", ");

  const description = [
    `Verify that changes from experiment task #${taskId} improved or maintained metrics.`,
    "",
    "## Baseline (pre-experiment)",
    `- Window: ${baseline.windowHours}h (${baseline.cycleCount} cycles)`,
    `- Success rate: ${(baseline.successRate * 100).toFixed(1)}%`,
    `- Avg cost: $${baseline.avgCostUsd.toFixed(4)}`,
    `- Avg duration: ${Math.round(baseline.avgDurationMs)}ms`,
    `- P95 duration: ${Math.round(baseline.p95DurationMs)}ms`,
    "",
    "## Changes",
    `Categories: ${categories.join(", ")}`,
    `Files: ${fileList}`,
    "",
    "## Instructions",
    "1. Capture current metrics for the same window",
    "2. Compare against baseline above",
    "3. If metrics degraded significantly (>10% worse), create a revert task",
    "4. If metrics improved or stayed stable, mark verified",
  ].join("\n");

  return insertTask({
    subject: `Verify experiment from task #${taskId} — check metric impact`,
    description,
    priority: 8,
    source: `task:${taskId}`,
    // Schedule 2 hours out to allow enough cycles to accumulate
    scheduled_for: new Date(Date.now() + 2 * 3600_000).toISOString(),
    skills: "arc-worktrees",
  });
}
