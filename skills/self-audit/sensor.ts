// self-audit/sensor.ts
//
// Daily operational self-audit. Gathers metrics across task queue, costs,
// skill/sensor health, and recent codebase changes. Creates a single
// P7 audit task per day with structured findings.
// Pure TypeScript — no LLM.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { claimSensorRun, createSensorLogger, readHookState, writeHookState } from "../../src/sensors.ts";
import {
  insertTask,
  pendingTaskExistsForSource,
  getDatabase,
  getPendingTasks,
  getActiveTasks,
  getRecentCycles,
  getTodayCostUsd,
} from "../../src/db.ts";
import { discoverSkills } from "../../src/skills.ts";

const SENSOR_NAME = "self-audit";
const INTERVAL_MINUTES = 1440; // 24 hours
const TASK_SOURCE = "sensor:self-audit";

const ROOT = join(import.meta.dir, "../..");
const DAILY_BUDGET_USD = parseFloat(process.env.DAILY_BUDGET_USD ?? "200");

const log = createSensorLogger(SENSOR_NAME);

// ---- Metric collectors ----

interface TaskQueueMetrics {
  pendingCount: number;
  activeCount: number;
  activeStuck: number; // active > 2h
  failedLast24h: number;
  completedLast24h: number;
}

function collectTaskQueueMetrics(): TaskQueueMetrics {
  const db = getDatabase();
  const pending = getPendingTasks();
  const active = getActiveTasks();

  const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
  const stuck = active.filter(
    (t) => t.started_at && t.started_at < twoHoursAgo
  );

  const failedRow = db
    .query(
      "SELECT COUNT(*) as count FROM tasks WHERE status = 'failed' AND completed_at > datetime('now', '-1 day')"
    )
    .get() as { count: number };

  const completedRow = db
    .query(
      "SELECT COUNT(*) as count FROM tasks WHERE status = 'completed' AND completed_at > datetime('now', '-1 day')"
    )
    .get() as { count: number };

  return {
    pendingCount: pending.length,
    activeCount: active.length,
    activeStuck: stuck.length,
    failedLast24h: failedRow.count,
    completedLast24h: completedRow.count,
  };
}

interface CostMetrics {
  todayCostUsd: number;
  yesterdayCostUsd: number;
  budgetPct: number;
  cyclesLast24h: number;
  avgCostPerCycle: number;
  failedCycles: number;
}

function collectCostMetrics(): CostMetrics {
  const db = getDatabase();
  const todayCost = getTodayCostUsd();

  const yesterdayRow = db
    .query(
      "SELECT COALESCE(SUM(cost_usd), 0) as total FROM cycle_log WHERE date(started_at) = date('now', '-1 day')"
    )
    .get() as { total: number };

  const cyclesRow = db
    .query(
      "SELECT COUNT(*) as count FROM cycle_log WHERE started_at > datetime('now', '-1 day')"
    )
    .get() as { count: number };

  const failedCyclesRow = db
    .query(
      "SELECT COUNT(*) as count FROM cycle_log WHERE started_at > datetime('now', '-1 day') AND (cost_usd IS NULL OR cost_usd = 0)"
    )
    .get() as { count: number };

  const avgCost =
    cyclesRow.count > 0 ? todayCost / Math.max(cyclesRow.count, 1) : 0;

  return {
    todayCostUsd: todayCost,
    yesterdayCostUsd: yesterdayRow.total,
    budgetPct:
      DAILY_BUDGET_USD > 0 ? (todayCost / DAILY_BUDGET_USD) * 100 : 0,
    cyclesLast24h: cyclesRow.count,
    avgCostPerCycle: avgCost,
    failedCycles: failedCyclesRow.count,
  };
}

interface SkillHealthMetrics {
  totalSkills: number;
  totalSensors: number;
  sensorFailures: string[]; // sensor names with consecutive_failures > 0
}

async function collectSkillHealthMetrics(): Promise<SkillHealthMetrics> {
  const skills = discoverSkills();
  const sensorsWithIssues: string[] = [];

  const hookStateDir = join(ROOT, "db/hook-state");
  if (existsSync(hookStateDir)) {
    const files = readdirSync(hookStateDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const name = file.replace(".json", "");
        const state = await readHookState(name);
        if (state && (state as Record<string, unknown>).consecutive_failures) {
          const failures = (state as Record<string, unknown>)
            .consecutive_failures as number;
          if (failures > 0) {
            sensorsWithIssues.push(`${name} (${failures} failures)`);
          }
        }
      } catch {
        // skip unreadable state files
      }
    }
  }

  return {
    totalSkills: skills.length,
    totalSensors: skills.filter((s) => s.hasSensor).length,
    sensorFailures: sensorsWithIssues,
  };
}

interface CodebaseMetrics {
  commitsLast24h: number;
  uncommittedChanges: number;
  branchName: string;
  aheadBehind: string;
  recentCommitSubjects: string[];
}

function collectCodebaseMetrics(): CodebaseMetrics {
  // Commits in last 24h
  const commitCountResult = Bun.spawnSync(
    ["git", "rev-list", "--count", "--since=24 hours ago", "HEAD"],
    { cwd: ROOT }
  );
  const commitsLast24h = parseInt(
    commitCountResult.stdout.toString().trim() || "0",
    10
  );

  // Recent commit subjects (last 10)
  const commitLogResult = Bun.spawnSync(
    ["git", "log", "--oneline", "-10", "--format=%s"],
    { cwd: ROOT }
  );
  const recentCommitSubjects = commitLogResult.stdout.toString().trim()
    .split("\n")
    .filter(Boolean)
    .slice(0, 5);

  // Uncommitted changes
  const statusResult = Bun.spawnSync(["git", "status", "--porcelain"], {
    cwd: ROOT,
  });
  const statusLines = statusResult.stdout.toString().trim()
    .split("\n")
    .filter(Boolean);

  // Branch name
  const branchResult = Bun.spawnSync(["git", "branch", "--show-current"], {
    cwd: ROOT,
  });
  const branchName = branchResult.stdout.toString().trim() || "unknown";

  // Ahead/behind remote
  let aheadBehind = "no remote tracking";
  const abResult = Bun.spawnSync(
    ["git", "rev-list", "--left-right", "--count", `${branchName}...origin/${branchName}`],
    { cwd: ROOT }
  );
  if (abResult.exitCode === 0) {
    const parts = abResult.stdout.toString().trim().split(/\s+/);
    if (parts.length === 2) {
      aheadBehind = `${parts[0]} ahead, ${parts[1]} behind`;
    }
  }

  return {
    commitsLast24h,
    uncommittedChanges: statusLines.length,
    branchName,
    aheadBehind,
    recentCommitSubjects,
  };
}

interface RecentCycleMetrics {
  total: number;
  avgDurationMs: number;
  avgCostUsd: number;
}

function collectRecentCycleMetrics(): RecentCycleMetrics {
  const cycles = getRecentCycles(10);
  if (cycles.length === 0) {
    return { total: 0, avgDurationMs: 0, avgCostUsd: 0 };
  }

  const totalDuration = cycles.reduce(
    (sum, c) => sum + (c.duration_ms ?? 0),
    0
  );
  const totalCost = cycles.reduce((sum, c) => sum + (c.cost_usd ?? 0), 0);

  return {
    total: cycles.length,
    avgDurationMs: Math.round(totalDuration / cycles.length),
    avgCostUsd: totalCost / cycles.length,
  };
}

// ---- Format audit report ----

function formatAuditReport(
  tasks: TaskQueueMetrics,
  cost: CostMetrics,
  skills: SkillHealthMetrics,
  codebase: CodebaseMetrics,
  cycles: RecentCycleMetrics
): string {
  const sections: string[] = [];

  // Task queue
  sections.push(
    `## Task Queue\n` +
      `- Pending: ${tasks.pendingCount}\n` +
      `- Active: ${tasks.activeCount}` +
      (tasks.activeStuck > 0 ? ` (${tasks.activeStuck} stuck >2h)` : "") +
      `\n` +
      `- Completed (24h): ${tasks.completedLast24h}\n` +
      `- Failed (24h): ${tasks.failedLast24h}`
  );

  // Cost
  sections.push(
    `## Cost\n` +
      `- Today: $${cost.todayCostUsd.toFixed(2)} / $${DAILY_BUDGET_USD} (${cost.budgetPct.toFixed(1)}%)\n` +
      `- Yesterday: $${cost.yesterdayCostUsd.toFixed(2)}\n` +
      `- Cycles (24h): ${cost.cyclesLast24h}\n` +
      `- Avg cost/cycle: $${cost.avgCostPerCycle.toFixed(4)}`
  );

  // Skills/sensors
  let skillSection =
    `## Skills & Sensors\n` +
    `- Skills: ${skills.totalSkills}\n` +
    `- Sensors: ${skills.totalSensors}`;
  if (skills.sensorFailures.length > 0) {
    skillSection += `\n- Sensor failures: ${skills.sensorFailures.join(", ")}`;
  }
  sections.push(skillSection);

  // Codebase
  let codeSection =
    `## Codebase\n` +
    `- Branch: ${codebase.branchName} (${codebase.aheadBehind})\n` +
    `- Commits (24h): ${codebase.commitsLast24h}\n` +
    `- Uncommitted changes: ${codebase.uncommittedChanges}`;
  if (codebase.recentCommitSubjects.length > 0) {
    codeSection +=
      `\n- Recent commits:\n` +
      codebase.recentCommitSubjects.map((s) => `  - ${s}`).join("\n");
  }
  sections.push(codeSection);

  // Recent cycles
  sections.push(
    `## Recent Cycles (last ${cycles.total})\n` +
      `- Avg duration: ${(cycles.avgDurationMs / 1000).toFixed(1)}s\n` +
      `- Avg cost: $${cycles.avgCostUsd.toFixed(4)}`
  );

  return sections.join("\n\n");
}

// ---- Detect anomalies ----

function detectAnomalies(
  tasks: TaskQueueMetrics,
  cost: CostMetrics,
  skills: SkillHealthMetrics,
  codebase: CodebaseMetrics
): string[] {
  const anomalies: string[] = [];

  if (tasks.pendingCount > 30)
    anomalies.push(`high pending backlog (${tasks.pendingCount} tasks)`);
  if (tasks.activeStuck > 0)
    anomalies.push(`${tasks.activeStuck} stuck active task(s)`);
  if (tasks.failedLast24h > 5)
    anomalies.push(`${tasks.failedLast24h} task failures in 24h`);
  if (cost.budgetPct > 80)
    anomalies.push(`budget usage at ${cost.budgetPct.toFixed(0)}%`);
  if (skills.sensorFailures.length > 0)
    anomalies.push(
      `${skills.sensorFailures.length} sensor(s) with consecutive failures`
    );
  if (codebase.uncommittedChanges > 10)
    anomalies.push(
      `${codebase.uncommittedChanges} uncommitted changes (drift risk)`
    );

  return anomalies;
}

// ---- Main sensor ----

export default async function selfAuditSensor(): Promise<string> {
  // Read state before claiming to check lastAuditDate
  const statePre = await readHookState(SENSOR_NAME);
  const lastAuditDate = (statePre as Record<string, unknown> | null)
    ?.lastAuditDate as string | undefined;
  const today = new Date().toISOString().split("T")[0];

  // Date-based dedup: only one audit per day
  if (lastAuditDate === today) {
    return "skip";
  }

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  if (pendingTaskExistsForSource(TASK_SOURCE)) {
    log("audit task already pending — skipping");
    return "skip";
  }

  log("collecting daily audit metrics...");

  // Gather all metrics
  const taskMetrics = collectTaskQueueMetrics();
  const costMetrics = collectCostMetrics();
  const skillMetrics = await collectSkillHealthMetrics();
  const codebaseMetrics = collectCodebaseMetrics();
  const cycleMetrics = collectRecentCycleMetrics();

  // Build report
  const report = formatAuditReport(
    taskMetrics,
    costMetrics,
    skillMetrics,
    codebaseMetrics,
    cycleMetrics
  );

  // Detect anomalies
  const anomalies = detectAnomalies(
    taskMetrics,
    costMetrics,
    skillMetrics,
    codebaseMetrics
  );

  const anomalyNote =
    anomalies.length > 0
      ? `\n\n## Anomalies\n${anomalies.map((a) => `- ⚠ ${a}`).join("\n")}`
      : "\n\n## Anomalies\nNone detected.";

  const subject =
    anomalies.length > 0
      ? `daily self-audit: ${anomalies.length} anomaly(ies) detected`
      : "daily self-audit: all systems nominal";

  insertTask({
    subject,
    description:
      `Daily operational audit for ${today}.\n\n` +
      report +
      anomalyNote +
      `\n\nReview findings. Address any anomalies. Update MEMORY.md if patterns emerge.`,
    skills: '["self-audit", "manage-skills"]',
    source: TASK_SOURCE,
    priority: 7,
  });

  log(`audit task created: ${subject}`);

  // Record today's audit date
  const statePost = await readHookState(SENSOR_NAME);
  if (statePost) {
    await writeHookState(SENSOR_NAME, {
      ...statePost,
      lastAuditDate: today,
    });
  }

  return "ok";
}
