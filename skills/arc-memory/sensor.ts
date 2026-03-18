// arc-memory/sensor.ts
//
// Weekly retrospective sensor. Queries completed tasks from the past 7 days,
// builds a briefing of failures/high-cost cycles/recurring subjects, and
// creates a P7 pattern extraction task for a dispatched Sonnet session.
//
// The dispatched session reads the briefing, extracts reusable patterns,
// and writes them to memory/patterns.md.
//
// Pure TypeScript — no LLM.

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
} from "../../src/db.ts";

const SENSOR_NAME = "arc-memory";
const INTERVAL_MINUTES = 10080; // 7 days
const TASK_SOURCE = "sensor:arc-memory";

const log = createSensorLogger(SENSOR_NAME);

// ---- Types ----

interface TaskRow {
  id: number;
  subject: string;
  skills: string | null;
  priority: number;
  status: string;
  source: string | null;
  result_summary: string | null;
  cost_usd: number;
  model: string | null;
  attempt_count: number;
}

interface RetrospectiveData {
  windowDays: number;
  completed: TaskRow[];
  failed: TaskRow[];
  highCost: TaskRow[];
  multiAttempt: TaskRow[];
  topSubjectPatterns: Array<{ prefix: string; count: number }>;
  totalCost: number;
  totalTasks: number;
}

// ---- Data Collection ----

function collectRetrospectiveData(windowDays: number): RetrospectiveData {
  const db = getDatabase();
  const window = `-${windowDays} days`;

  const allTasks = db
    .query(
      `SELECT t.id, t.subject, t.skills, t.priority, t.status, t.source,
              t.result_summary, t.model, t.attempt_count,
              COALESCE(t.cost_usd, 0) as cost_usd
       FROM tasks t
       WHERE t.status IN ('completed', 'failed')
         AND t.completed_at > datetime('now', ?)
       ORDER BY t.cost_usd DESC`
    )
    .all(window) as TaskRow[];

  const completed = allTasks.filter((t) => t.status === "completed");
  const failed = allTasks.filter((t) => t.status === "failed");
  const highCost = allTasks.filter((t) => t.cost_usd > 1.0).slice(0, 10);
  const multiAttempt = allTasks.filter((t) => t.attempt_count > 1);

  // Extract subject word patterns (first 3 words → frequency)
  const subjectPrefixes = new Map<string, number>();
  for (const task of allTasks) {
    const prefix = task.subject.split(/\s+/).slice(0, 3).join(" ").toLowerCase();
    subjectPrefixes.set(prefix, (subjectPrefixes.get(prefix) ?? 0) + 1);
  }
  const topSubjectPatterns = [...subjectPrefixes.entries()]
    .filter(([, count]) => count >= 3)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([prefix, count]) => ({ prefix, count }));

  const totalCost = allTasks.reduce((sum, t) => sum + t.cost_usd, 0);

  return {
    windowDays,
    completed,
    failed,
    highCost,
    multiAttempt,
    topSubjectPatterns,
    totalCost,
    totalTasks: allTasks.length,
  };
}

// ---- Briefing Formatter ----

function formatRetrospectiveBriefing(data: RetrospectiveData): string {
  const sections: string[] = [];
  const successRate =
    data.totalTasks > 0
      ? ((data.completed.length / data.totalTasks) * 100).toFixed(0)
      : "N/A";

  sections.push(
    `## ${data.windowDays}-Day Summary\n` +
      `- Total tasks: ${data.totalTasks}\n` +
      `- Completed: ${data.completed.length} (${successRate}% success)\n` +
      `- Failed: ${data.failed.length}\n` +
      `- Multi-attempt (retried): ${data.multiAttempt.length}\n` +
      `- Total cost: $${data.totalCost.toFixed(2)}`
  );

  if (data.failed.length > 0) {
    const failLines = data.failed.slice(0, 15).map((t) => {
      const summary = t.result_summary
        ? ` — ${t.result_summary.slice(0, 80)}`
        : "";
      const attempts =
        t.attempt_count > 1 ? ` [${t.attempt_count} attempts]` : "";
      return `- [#${t.id}] ${t.subject.slice(0, 70)}${attempts}${summary}`;
    });
    sections.push(`## Failed Tasks\n${failLines.join("\n")}`);
  }

  if (data.highCost.length > 0) {
    const costLines = data.highCost.map(
      (t) =>
        `- [#${t.id}] $${t.cost_usd.toFixed(3)} P${t.priority} ${t.model ?? "?"} — ${t.subject.slice(0, 60)}`
    );
    sections.push(`## High-Cost Tasks (>$1.00)\n${costLines.join("\n")}`);
  }

  if (data.multiAttempt.length > 0) {
    const retryLines = data.multiAttempt.slice(0, 10).map(
      (t) =>
        `- [#${t.id}] ${t.attempt_count}x — ${t.subject.slice(0, 60)} (${t.status})`
    );
    sections.push(`## Retried Tasks\n${retryLines.join("\n")}`);
  }

  if (data.topSubjectPatterns.length > 0) {
    const patternLines = data.topSubjectPatterns.map(
      ({ prefix, count }) => `- "${prefix}..." — ${count} tasks`
    );
    sections.push(
      `## Recurring Subject Patterns (≥3 occurrences)\n${patternLines.join("\n")}`
    );
  }

  return sections.join("\n\n");
}

// ---- Main sensor ----

export default async function arcMemorySensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  if (pendingTaskExistsForSource(TASK_SOURCE)) {
    log("pattern extraction task already pending — skipping");
    return "skip";
  }

  log("collecting 7-day retrospective data for pattern extraction...");

  const data = collectRetrospectiveData(7);

  if (data.totalTasks < 10) {
    log(`only ${data.totalTasks} tasks in window — skipping (need ≥10)`);
    return "skip";
  }

  const briefing = formatRetrospectiveBriefing(data);
  const week = new Date().toISOString().split("T")[0];

  const subject = `weekly pattern extraction: ${data.totalTasks} tasks, ${data.failed.length} failed, $${data.totalCost.toFixed(2)} spent`;

  insertTask({
    subject,
    description:
      `Weekly retrospective for the 7 days ending ${week}.\n\n` +
      `Review the briefing below. Extract reusable patterns and add them to memory/patterns.md ` +
      `under the most specific applicable section. Apply the pattern quality bar:\n` +
      `- Reusable: applies to ≥3 future task types\n` +
      `- Actionable: changes what you DO, not just what you know\n` +
      `- Validated: observed in ≥2 distinct cycles\n` +
      `- Deduplicated: check existing patterns.md entries first\n\n` +
      briefing +
      `\n\n## Instructions\n` +
      `1. Read memory/patterns.md to understand existing patterns (avoid duplicates)\n` +
      `2. Identify 2-5 new patterns from this week's data that meet the quality bar\n` +
      `3. Append them to the relevant section in memory/patterns.md\n` +
      `4. Update the timestamp at the top of patterns.md\n` +
      `5. If decision frameworks need updating, edit memory/frameworks.md\n` +
      `6. Close this task with a summary of patterns added`,
    skills: '["arc-memory", "arc-introspection"]',
    source: TASK_SOURCE,
    priority: 7,
  });

  log(`pattern extraction task created for week ending ${week}`);

  return "ok";
}
