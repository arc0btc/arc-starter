/**
 * arc-self-review sensor
 *
 * Consolidated 6-hour self-review. Replaces arc-introspection,
 * arc-ops-review, arc-operational-review, and arc-self-audit.
 *
 * Collects: task metrics, cost, triage issues, system health,
 * work patterns. Creates one review task per 6h cycle.
 *
 * Pure TypeScript — no LLM.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  claimSensorRun,
  createSensorLogger,
  readHookState,
  writeHookState,
} from "../../src/sensors.ts";
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

const SENSOR_NAME = "arc-self-review";
const INTERVAL_MINUTES = 360; // 6 hours
const TASK_SOURCE = "sensor:arc-self-review";
const WINDOW_HOURS = 6;

const ROOT = join(import.meta.dir, "../..");
const MEMORY_DIR = join(ROOT, "memory");
const DAILY_BUDGET_USD = parseFloat(process.env.DAILY_BUDGET_USD ?? "200");

const log = createSensorLogger(SENSOR_NAME);

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface TaskMetrics {
  completedWindow: number;
  failedWindow: number;
  completedDay: number;
  failedDay: number;
  pendingCount: number;
  activeCount: number;
  activeStuck: number;
}

interface CostMetrics {
  todayCostUsd: number;
  windowCostUsd: number;
  budgetPct: number;
  cyclesWindow: number;
  costPerCompletion: number;
}

interface TriageIssue {
  type: "failed-no-followup" | "blocked-stale" | "stale-followup";
  id: number;
  subject: string;
  detail: string;
}

interface WorkPatterns {
  modelDistribution: Record<string, number>;
  skillFrequency: Record<string, number>;
  sourceBreakdown: Record<string, number>;
  topCostTasks: Array<{ id: number; subject: string; cost_usd: number }>;
}

interface SystemHealth {
  sensorFailures: string[];
  branchName: string;
  uncommittedChanges: number;
  commitsWindow: number;
  aheadBehind: string;
}

// ──────────────────────────────────────────────
// Collectors
// ──────────────────────────────────────────────

function collectTaskMetrics(): TaskMetrics {
  const db = getDatabase();
  const pending = getPendingTasks();
  const active = getActiveTasks();
  const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
  const stuck = active.filter((t) => t.started_at && t.started_at < twoHoursAgo);

  const windowQuery = (status: string): number => {
    const row = db
      .query(
        `SELECT COUNT(*) as c FROM tasks WHERE status = ? AND completed_at > datetime('now', '-${WINDOW_HOURS} hours')`
      )
      .get(status) as { c: number };
    return row.c;
  };

  const dayQuery = (status: string): number => {
    const row = db
      .query(
        `SELECT COUNT(*) as c FROM tasks WHERE status = ? AND completed_at > datetime('now', '-1 day')`
      )
      .get(status) as { c: number };
    return row.c;
  };

  return {
    completedWindow: windowQuery("completed"),
    failedWindow: windowQuery("failed"),
    completedDay: dayQuery("completed"),
    failedDay: dayQuery("failed"),
    pendingCount: pending.length,
    activeCount: active.length,
    activeStuck: stuck.length,
  };
}

function collectCostMetrics(): CostMetrics {
  const db = getDatabase();
  const todayCost = getTodayCostUsd();

  const windowCostRow = db
    .query(
      `SELECT COALESCE(SUM(cost_usd), 0) as total, COUNT(*) as cycles
       FROM cycle_log WHERE started_at > datetime('now', '-${WINDOW_HOURS} hours')`
    )
    .get() as { total: number; cycles: number };

  const completedInWindow = db
    .query(
      `SELECT COUNT(*) as c FROM tasks WHERE status = 'completed' AND completed_at > datetime('now', '-${WINDOW_HOURS} hours')`
    )
    .get() as { c: number };

  const costPerCompletion =
    completedInWindow.c > 0 ? windowCostRow.total / completedInWindow.c : 0;

  return {
    todayCostUsd: todayCost,
    windowCostUsd: windowCostRow.total,
    budgetPct: DAILY_BUDGET_USD > 0 ? (todayCost / DAILY_BUDGET_USD) * 100 : 0,
    cyclesWindow: windowCostRow.cycles,
    costPerCompletion,
  };
}

function collectTriageIssues(): TriageIssue[] {
  const db = getDatabase();
  const issues: TriageIssue[] = [];

  // Failed tasks with no follow-up
  const failedNoFollowUp = db
    .query(
      `SELECT t.id, t.subject, t.completed_at
       FROM tasks t
       WHERE t.status = 'failed'
         AND t.completed_at >= datetime('now', '-${WINDOW_HOURS} hours')
         AND NOT EXISTS (
           SELECT 1 FROM tasks f WHERE f.parent_id = t.id AND f.status IN ('pending','active','completed')
         )
         AND NOT EXISTS (
           SELECT 1 FROM tasks f WHERE f.source = 'task:' || t.id AND f.status IN ('pending','active','completed')
         )
       ORDER BY t.completed_at DESC`
    )
    .all() as Array<{ id: number; subject: string; completed_at: string }>;

  for (const t of failedNoFollowUp) {
    issues.push({
      type: "failed-no-followup",
      id: t.id,
      subject: t.subject,
      detail: `failed ${t.completed_at}, no follow-up`,
    });
  }

  // Blocked tasks >24h
  const blocked = db
    .query(
      `SELECT id, subject, created_at FROM tasks
       WHERE status = 'blocked' AND created_at < datetime('now', '-24 hours')
       ORDER BY created_at ASC`
    )
    .all() as Array<{ id: number; subject: string; created_at: string }>;

  for (const t of blocked) {
    issues.push({
      type: "blocked-stale",
      id: t.id,
      subject: t.subject,
      detail: `blocked since ${t.created_at}`,
    });
  }

  // Stale low-priority follow-ups
  const stale = db
    .query(
      `SELECT id, subject, priority, created_at FROM tasks
       WHERE status = 'pending' AND source LIKE 'task:%'
         AND priority >= 7
         AND created_at < datetime('now', '-${WINDOW_HOURS} hours')
       ORDER BY priority DESC, created_at ASC`
    )
    .all() as Array<{ id: number; subject: string; priority: number; created_at: string }>;

  for (const t of stale) {
    issues.push({
      type: "stale-followup",
      id: t.id,
      subject: t.subject,
      detail: `P${t.priority}, pending since ${t.created_at}`,
    });
  }

  return issues;
}

function collectWorkPatterns(): WorkPatterns {
  const db = getDatabase();

  const tasks = db
    .query(
      `SELECT t.id, t.subject, t.skills, t.source, t.model,
              COALESCE(t.cost_usd, 0) as cost_usd
       FROM tasks t
       WHERE t.status IN ('completed', 'failed')
         AND t.completed_at > datetime('now', '-${WINDOW_HOURS} hours')`
    )
    .all() as Array<{
    id: number;
    subject: string;
    skills: string | null;
    source: string | null;
    model: string | null;
    cost_usd: number;
  }>;

  const modelDistribution: Record<string, number> = {};
  const skillFrequency: Record<string, number> = {};
  const sourceBreakdown: Record<string, number> = {};

  for (const t of tasks) {
    // Model
    const model = t.model ?? "unknown";
    modelDistribution[model] = (modelDistribution[model] ?? 0) + 1;

    // Skills
    if (t.skills) {
      try {
        const skills = JSON.parse(t.skills) as string[];
        for (const s of skills) {
          skillFrequency[s] = (skillFrequency[s] ?? 0) + 1;
        }
      } catch {
        // skip
      }
    }

    // Source
    const srcType = !t.source
      ? "unknown"
      : t.source === "human"
        ? "human"
        : t.source.startsWith("sensor:")
          ? "sensor"
          : t.source.startsWith("task:")
            ? "follow-up"
            : "other";
    sourceBreakdown[srcType] = (sourceBreakdown[srcType] ?? 0) + 1;
  }

  const topCostTasks = [...tasks]
    .sort((a, b) => b.cost_usd - a.cost_usd)
    .slice(0, 5)
    .filter((t) => t.cost_usd > 0)
    .map((t) => ({ id: t.id, subject: t.subject, cost_usd: t.cost_usd }));

  return { modelDistribution, skillFrequency, sourceBreakdown, topCostTasks };
}

async function collectSystemHealth(): Promise<SystemHealth> {
  const sensorsWithIssues: string[] = [];
  const hookStateDir = join(ROOT, "db/hook-state");

  if (existsSync(hookStateDir)) {
    const files = readdirSync(hookStateDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const state = await readHookState(file.replace(".json", ""));
        if (state && (state.consecutive_failures as number) > 0) {
          sensorsWithIssues.push(
            `${file.replace(".json", "")} (${state.consecutive_failures} failures)`
          );
        }
      } catch {
        // skip
      }
    }
  }

  const spawnGit = (args: string[]): string =>
    Bun.spawnSync(["git", ...args], { cwd: ROOT }).stdout.toString().trim();

  const branchName = spawnGit(["branch", "--show-current"]) || "unknown";
  const commitsWindow = parseInt(
    spawnGit(["rev-list", "--count", `--since=${WINDOW_HOURS} hours ago`, "HEAD"]) || "0",
    10
  );
  const statusLines = spawnGit(["status", "--porcelain"])
    .split("\n")
    .filter(Boolean);

  let aheadBehind = "no remote tracking";
  const abResult = Bun.spawnSync(
    ["git", "rev-list", "--left-right", "--count", `${branchName}...origin/${branchName}`],
    { cwd: ROOT }
  );
  if (abResult.exitCode === 0) {
    const parts = abResult.stdout.toString().trim().split(/\s+/);
    if (parts.length === 2) aheadBehind = `${parts[0]} ahead, ${parts[1]} behind`;
  }

  return {
    sensorFailures: sensorsWithIssues,
    branchName,
    uncommittedChanges: statusLines.length,
    commitsWindow,
    aheadBehind,
  };
}

// ──────────────────────────────────────────────
// Anomaly detection
// ──────────────────────────────────────────────

function detectAnomalies(
  tasks: TaskMetrics,
  cost: CostMetrics,
  health: SystemHealth
): string[] {
  const anomalies: string[] = [];

  if (tasks.pendingCount > 30)
    anomalies.push(`high pending backlog (${tasks.pendingCount})`);
  if (tasks.activeStuck > 0)
    anomalies.push(`${tasks.activeStuck} stuck active task(s) >2h`);
  if (tasks.failedDay > 5)
    anomalies.push(`${tasks.failedDay} failures in 24h`);
  if (cost.budgetPct > 80)
    anomalies.push(`budget at ${cost.budgetPct.toFixed(0)}%`);
  if (cost.costPerCompletion > 1.0)
    anomalies.push(`high cost/completion: $${cost.costPerCompletion.toFixed(2)}`);
  if (health.sensorFailures.length > 0)
    anomalies.push(`${health.sensorFailures.length} sensor(s) with failures`);
  if (health.uncommittedChanges > 10)
    anomalies.push(`${health.uncommittedChanges} uncommitted changes`);

  return anomalies;
}

// ──────────────────────────────────────────────
// Reflection prompts (from arc-introspection)
// ──────────────────────────────────────────────

function generateReflectionPrompts(
  tasks: TaskMetrics,
  cost: CostMetrics,
  patterns: WorkPatterns
): string[] {
  const prompts: string[] = [];
  const total = tasks.completedWindow + tasks.failedWindow;

  if (tasks.failedWindow > 0) {
    const rate = ((tasks.failedWindow / total) * 100).toFixed(0);
    prompts.push(
      `${tasks.failedWindow} tasks failed (${rate}%). Common patterns? Retry or deprioritize?`
    );
  }

  if (cost.todayCostUsd > 50) {
    prompts.push(
      `$${cost.todayCostUsd.toFixed(2)} spent today. Were expensive tasks worth it? Any that could route cheaper?`
    );
  }

  const sensorCount = patterns.sourceBreakdown["sensor"] ?? 0;
  const humanCount = patterns.sourceBreakdown["human"] ?? 0;
  if (sensorCount > 0 && humanCount === 0 && total > 3) {
    prompts.push(
      `All work sensor-driven (${sensorCount} tasks). Working on what matters, or just what's detected?`
    );
  }

  const topSkill = Object.entries(patterns.skillFrequency).sort(
    ([, a], [, b]) => b - a
  )[0];
  if (topSkill && topSkill[1] > total * 0.4 && total > 5) {
    prompts.push(
      `${topSkill[0]} dominated (${topSkill[1]}/${total} tasks). Proportional to importance?`
    );
  }

  if (total < 3) {
    prompts.push(`Only ${total} tasks in ${WINDOW_HOURS}h. Queue starved or intentional?`);
  }

  if (prompts.length === 0) {
    prompts.push("Routine cycle. Most valuable thing accomplished? What should next cycle prioritize?");
  }

  return prompts;
}

// ──────────────────────────────────────────────
// Report formatting
// ──────────────────────────────────────────────

function formatReport(
  tasks: TaskMetrics,
  cost: CostMetrics,
  triage: TriageIssue[],
  patterns: WorkPatterns,
  health: SystemHealth,
  anomalies: string[],
  reflectionPrompts: string[]
): string {
  const sections: string[] = [];
  const total = tasks.completedWindow + tasks.failedWindow;
  const successRate = total > 0 ? ((tasks.completedWindow / total) * 100).toFixed(0) : "N/A";

  // Task queue
  sections.push(
    `## Task Queue\n` +
      `- Window (${WINDOW_HOURS}h): ${tasks.completedWindow} completed, ${tasks.failedWindow} failed (${successRate}% success)\n` +
      `- 24h totals: ${tasks.completedDay} completed, ${tasks.failedDay} failed\n` +
      `- Pending: ${tasks.pendingCount} | Active: ${tasks.activeCount}` +
      (tasks.activeStuck > 0 ? ` (${tasks.activeStuck} stuck >2h)` : "")
  );

  // Cost
  sections.push(
    `## Cost\n` +
      `- Today: $${cost.todayCostUsd.toFixed(2)} / $${DAILY_BUDGET_USD} (${cost.budgetPct.toFixed(1)}%)\n` +
      `- Window: $${cost.windowCostUsd.toFixed(2)} across ${cost.cyclesWindow} cycles\n` +
      `- Cost/completion: $${cost.costPerCompletion.toFixed(2)}`
  );

  // Work patterns
  if (Object.keys(patterns.modelDistribution).length > 0) {
    const modelLines = Object.entries(patterns.modelDistribution)
      .sort(([, a], [, b]) => b - a)
      .map(([m, c]) => `${m}: ${c}`)
      .join(", ");
    const sourceLines = Object.entries(patterns.sourceBreakdown)
      .sort(([, a], [, b]) => b - a)
      .map(([s, c]) => `${s}: ${c}`)
      .join(", ");
    sections.push(`## Work Patterns\n- Models: ${modelLines}\n- Sources: ${sourceLines}`);

    if (Object.keys(patterns.skillFrequency).length > 0) {
      const skillLines = Object.entries(patterns.skillFrequency)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 8)
        .map(([s, c]) => `${s}: ${c}`)
        .join(", ");
      sections[sections.length - 1] += `\n- Top skills: ${skillLines}`;
    }
  }

  // Top cost tasks
  if (patterns.topCostTasks.length > 0) {
    const costLines = patterns.topCostTasks
      .map((t) => `- #${t.id} $${t.cost_usd.toFixed(3)} — ${t.subject.slice(0, 60)}`)
      .join("\n");
    sections.push(`## Highest Cost Tasks\n${costLines}`);
  }

  // Triage issues
  if (triage.length > 0) {
    const grouped = {
      "failed-no-followup": triage.filter((t) => t.type === "failed-no-followup"),
      "blocked-stale": triage.filter((t) => t.type === "blocked-stale"),
      "stale-followup": triage.filter((t) => t.type === "stale-followup"),
    };
    const triageLines: string[] = [];
    if (grouped["failed-no-followup"].length > 0) {
      triageLines.push(`**Failed, no follow-up (${grouped["failed-no-followup"].length}):**`);
      for (const t of grouped["failed-no-followup"].slice(0, 10)) {
        triageLines.push(`- #${t.id} ${t.subject.slice(0, 60)} — ${t.detail}`);
      }
    }
    if (grouped["blocked-stale"].length > 0) {
      triageLines.push(`**Blocked >24h (${grouped["blocked-stale"].length}):**`);
      for (const t of grouped["blocked-stale"].slice(0, 10)) {
        triageLines.push(`- #${t.id} ${t.subject.slice(0, 60)} — ${t.detail}`);
      }
    }
    if (grouped["stale-followup"].length > 0) {
      triageLines.push(`**Stale follow-ups (${grouped["stale-followup"].length}):**`);
      for (const t of grouped["stale-followup"].slice(0, 10)) {
        triageLines.push(`- #${t.id} ${t.subject.slice(0, 60)} — ${t.detail}`);
      }
    }
    sections.push(`## Triage (${triage.length} issues)\n${triageLines.join("\n")}`);
  }

  // System health
  let healthSection =
    `## System Health\n` +
    `- Branch: ${health.branchName} (${health.aheadBehind})\n` +
    `- Commits (${WINDOW_HOURS}h): ${health.commitsWindow}\n` +
    `- Uncommitted changes: ${health.uncommittedChanges}`;
  if (health.sensorFailures.length > 0) {
    healthSection += `\n- Sensor failures: ${health.sensorFailures.join(", ")}`;
  }
  sections.push(healthSection);

  // Anomalies
  if (anomalies.length > 0) {
    sections.push(
      `## Anomalies\n${anomalies.map((a) => `- ${a}`).join("\n")}`
    );
  }

  // Reflection
  sections.push(
    `## Reflection Prompts\n${reflectionPrompts.map((p) => `- ${p}`).join("\n")}`
  );

  return sections.join("\n\n");
}

// ──────────────────────────────────────────────
// Write ops-metrics.json snapshot (from arc-ops-review)
// ──────────────────────────────────────────────

async function writeMetricsSnapshot(
  tasks: TaskMetrics,
  cost: CostMetrics,
  triage: TriageIssue[],
  anomalies: string[]
): Promise<void> {
  const snapshot = {
    timestamp: new Date().toISOString(),
    window_hours: WINDOW_HOURS,
    completed: tasks.completedWindow,
    failed: tasks.failedWindow,
    pending_count: tasks.pendingCount,
    active_count: tasks.activeCount,
    today_cost_usd: Math.round(cost.todayCostUsd * 1000) / 1000,
    window_cost_usd: Math.round(cost.windowCostUsd * 1000) / 1000,
    cost_per_completion: Math.round(cost.costPerCompletion * 1000) / 1000,
    budget_pct: Math.round(cost.budgetPct * 10) / 10,
    triage_issues: triage.length,
    anomalies: anomalies.length,
  };

  await Bun.write(
    join(MEMORY_DIR, "ops-metrics.json"),
    JSON.stringify(snapshot, null, 2)
  );
}

// ──────────────────────────────────────────────
// Main sensor
// ──────────────────────────────────────────────

export default async function selfReviewSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  if (pendingTaskExistsForSource(TASK_SOURCE)) {
    log("review task already pending — skipping");
    return "skip";
  }

  log("collecting self-review metrics...");

  // Gather all data
  const taskMetrics = collectTaskMetrics();
  const costMetrics = collectCostMetrics();
  const triageIssues = collectTriageIssues();
  const workPatterns = collectWorkPatterns();
  const systemHealth = await collectSystemHealth();

  // Analysis
  const anomalies = detectAnomalies(taskMetrics, costMetrics, systemHealth);
  const reflectionPrompts = generateReflectionPrompts(taskMetrics, costMetrics, workPatterns);

  // Write snapshot
  await writeMetricsSnapshot(taskMetrics, costMetrics, triageIssues, anomalies);

  // Skip if truly nothing happened and no issues
  const totalActivity = taskMetrics.completedWindow + taskMetrics.failedWindow;
  if (totalActivity === 0 && triageIssues.length === 0 && anomalies.length === 0) {
    log("no activity and no issues — skipping task creation");
    return "ok";
  }

  // Build report
  const report = formatReport(
    taskMetrics,
    costMetrics,
    triageIssues,
    workPatterns,
    systemHealth,
    anomalies,
    reflectionPrompts
  );

  // Priority: P5 if issues found, P8 if nominal
  const hasIssues = anomalies.length > 0 || triageIssues.length > 0;
  const priority = hasIssues ? 5 : 8;

  const issueCount = anomalies.length + triageIssues.length;
  const subject = hasIssues
    ? `self-review: ${issueCount} issue(s), $${costMetrics.todayCostUsd.toFixed(2)} today`
    : `self-review: nominal, ${taskMetrics.completedWindow} completed, $${costMetrics.windowCostUsd.toFixed(2)} window`;

  insertTask({
    subject,
    description:
      `Self-review for ${new Date().toISOString().slice(0, 16)}Z (${WINDOW_HOURS}h window).\n\n` +
      report +
      `\n\n## Instructions\n` +
      `1. Review findings above\n` +
      `2. Address anomalies or triage issues if present\n` +
      `3. Update memory if patterns worth preserving\n` +
      `4. Close with one-line summary`,
    skills: '["arc-self-review"]',
    source: TASK_SOURCE,
    priority,
    model: hasIssues ? "sonnet" : "haiku",
  });

  log(`review task created (P${priority}): ${subject}`);

  // Update hook state with trend data
  const state = await readHookState(SENSOR_NAME);
  await writeHookState(SENSOR_NAME, {
    ...(state ?? { version: 0 }),
    last_ran: new Date().toISOString(),
    last_result: "ok",
    version: ((state?.version as number) ?? 0) + 1,
    prev_pending: taskMetrics.pendingCount,
    prev_cost_per_completion: costMetrics.costPerCompletion,
  });

  return "ok";
}
