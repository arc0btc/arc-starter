// arc-introspection/sensor.ts
//
// Daily introspection sensor. Synthesizes 24h of dispatch cycles into a
// qualitative self-assessment briefing. Creates a P5 task for a dispatched
// session to reflect on accomplishments, patterns, and focus areas.
//
// Differentiates from arc-self-audit (operational health) by focusing on
// *what was done* and *what it means*, not *are systems working*.
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

const SENSOR_NAME = "arc-introspection";
const INTERVAL_MINUTES = 720; // 12 hours — daily introspection
const TASK_SOURCE = "sensor:arc-introspection";

const log = createSensorLogger(SENSOR_NAME);

// ---- Types ----

interface CompletedTask {
  id: number;
  subject: string;
  skills: string | null;
  priority: number;
  status: string;
  source: string | null;
  result_summary: string | null;
  cost_usd: number;
  model: string | null;
  duration_ms: number | null;
}

interface IntrospectionData {
  completed: CompletedTask[];
  failed: CompletedTask[];
  totalCost: number;
  totalCycles: number;
  modelDistribution: Record<string, number>;
  skillFrequency: Record<string, number>;
  sourceBreakdown: Record<string, number>;
  topCostTasks: CompletedTask[];
}

// ---- Data Collection ----

function collectIntrospectionData(): IntrospectionData {
  const db = getDatabase();

  // Completed tasks in last 24h with cycle cost/duration
  const completedRows = db
    .query(
      `SELECT t.id, t.subject, t.skills, t.priority, t.status, t.source,
              t.result_summary, t.model,
              COALESCE(t.cost_usd, 0) as cost_usd,
              (SELECT SUM(c.duration_ms) FROM cycle_log c WHERE c.task_id = t.id) as duration_ms
       FROM tasks t
       WHERE t.status = 'completed'
         AND t.completed_at > datetime('now', '-1 day')
       ORDER BY t.completed_at DESC`
    )
    .all() as CompletedTask[];

  // Failed tasks in last 24h
  const failedRows = db
    .query(
      `SELECT t.id, t.subject, t.skills, t.priority, t.status, t.source,
              t.result_summary, t.model,
              COALESCE(t.cost_usd, 0) as cost_usd,
              (SELECT SUM(c.duration_ms) FROM cycle_log c WHERE c.task_id = t.id) as duration_ms
       FROM tasks t
       WHERE t.status = 'failed'
         AND t.completed_at > datetime('now', '-1 day')
       ORDER BY t.completed_at DESC`
    )
    .all() as CompletedTask[];

  // Total cycles and cost in last 24h
  const cycleStats = db
    .query(
      `SELECT COUNT(*) as count, COALESCE(SUM(cost_usd), 0) as total_cost
       FROM cycle_log
       WHERE started_at > datetime('now', '-1 day')`
    )
    .get() as { count: number; total_cost: number };

  // Model distribution
  const modelDistribution: Record<string, number> = {};
  for (const task of [...completedRows, ...failedRows]) {
    const model = task.model ?? "unknown";
    modelDistribution[model] = (modelDistribution[model] ?? 0) + 1;
  }

  // Skill frequency — parse JSON skills arrays
  const skillFrequency: Record<string, number> = {};
  for (const task of [...completedRows, ...failedRows]) {
    if (task.skills) {
      try {
        const skills = JSON.parse(task.skills) as string[];
        for (const skill of skills) {
          skillFrequency[skill] = (skillFrequency[skill] ?? 0) + 1;
        }
      } catch {
        // skip unparseable
      }
    }
  }

  // Source breakdown (sensor vs human vs task)
  const sourceBreakdown: Record<string, number> = {};
  for (const task of [...completedRows, ...failedRows]) {
    const sourceType = categorizeSource(task.source);
    sourceBreakdown[sourceType] = (sourceBreakdown[sourceType] ?? 0) + 1;
  }

  // Top cost tasks (top 5)
  const allTasks = [...completedRows, ...failedRows];
  const topCostTasks = allTasks
    .sort((a, b) => b.cost_usd - a.cost_usd)
    .slice(0, 5);

  return {
    completed: completedRows,
    failed: failedRows,
    totalCost: cycleStats.total_cost,
    totalCycles: cycleStats.count,
    modelDistribution,
    skillFrequency,
    sourceBreakdown,
    topCostTasks,
  };
}

function categorizeSource(source: string | null): string {
  if (!source) return "unknown";
  if (source === "human") return "human";
  if (source.startsWith("sensor:")) return "sensor";
  if (source.startsWith("task:")) return "follow-up";
  return "other";
}

// ---- Report Formatting ----

function formatIntrospectionBriefing(data: IntrospectionData): string {
  const sections: string[] = [];
  const total = data.completed.length + data.failed.length;
  const successRate =
    total > 0
      ? ((data.completed.length / total) * 100).toFixed(0)
      : "N/A";

  // Summary
  sections.push(
    `## Summary\n` +
      `- Tasks completed: ${data.completed.length}\n` +
      `- Tasks failed: ${data.failed.length}\n` +
      `- Success rate: ${successRate}%\n` +
      `- Total cycles: ${data.totalCycles}\n` +
      `- Total cost: $${data.totalCost.toFixed(2)}\n` +
      `- Avg cost/task: $${total > 0 ? (data.totalCost / total).toFixed(3) : "0"}`
  );

  // Model distribution
  if (Object.keys(data.modelDistribution).length > 0) {
    const modelLines = Object.entries(data.modelDistribution)
      .sort(([, a], [, b]) => b - a)
      .map(([model, count]) => `- ${model}: ${count} tasks`);
    sections.push(`## Model Distribution\n${modelLines.join("\n")}`);
  }

  // Source breakdown
  if (Object.keys(data.sourceBreakdown).length > 0) {
    const sourceLines = Object.entries(data.sourceBreakdown)
      .sort(([, a], [, b]) => b - a)
      .map(([source, count]) => `- ${source}: ${count}`);
    sections.push(`## Work Sources\n${sourceLines.join("\n")}`);
  }

  // Skill domains active
  if (Object.keys(data.skillFrequency).length > 0) {
    const skillLines = Object.entries(data.skillFrequency)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([skill, count]) => `- ${skill}: ${count}`);
    sections.push(`## Active Skill Domains (top 10)\n${skillLines.join("\n")}`);
  }

  // Completed task subjects (grouped for readability)
  if (data.completed.length > 0) {
    const taskLines = data.completed.slice(0, 20).map((t) => {
      const cost = t.cost_usd > 0 ? ` ($${t.cost_usd.toFixed(3)})` : "";
      const summary = t.result_summary
        ? ` — ${t.result_summary.slice(0, 80)}`
        : "";
      return `- [#${t.id}] ${t.subject.slice(0, 60)}${cost}${summary}`;
    });
    sections.push(`## Completed Tasks\n${taskLines.join("\n")}`);
  }

  // Failed tasks
  if (data.failed.length > 0) {
    const failLines = data.failed.map((t) => {
      const summary = t.result_summary
        ? ` — ${t.result_summary.slice(0, 80)}`
        : "";
      return `- [#${t.id}] ${t.subject.slice(0, 60)}${summary}`;
    });
    sections.push(`## Failed Tasks\n${failLines.join("\n")}`);
  }

  // Top cost tasks
  if (data.topCostTasks.length > 0 && data.topCostTasks[0].cost_usd > 0) {
    const costLines = data.topCostTasks
      .filter((t) => t.cost_usd > 0)
      .map(
        (t) =>
          `- [#${t.id}] $${t.cost_usd.toFixed(3)} — ${t.subject.slice(0, 60)}`
      );
    sections.push(`## Highest Cost Tasks\n${costLines.join("\n")}`);
  }

  return sections.join("\n\n");
}

function generateReflectionPrompts(data: IntrospectionData): string {
  const prompts: string[] = [];
  const total = data.completed.length + data.failed.length;

  // Success rate prompt
  if (data.failed.length > 0) {
    const rate = ((data.failed.length / total) * 100).toFixed(0);
    prompts.push(
      `- ${data.failed.length} tasks failed (${rate}% failure rate). Are there common patterns? Should any be retried or deprioritized?`
    );
  }

  // Cost efficiency
  if (data.totalCost > 50) {
    prompts.push(
      `- Spent $${data.totalCost.toFixed(2)} in 24h. Were the expensive tasks worth it? Any that could route to a cheaper model?`
    );
  }

  // Sensor-heavy day
  const sensorCount = data.sourceBreakdown["sensor"] ?? 0;
  const humanCount = data.sourceBreakdown["human"] ?? 0;
  if (sensorCount > 0 && humanCount === 0) {
    prompts.push(
      `- All work was sensor-driven (${sensorCount} tasks). No human-initiated tasks. Is the agent working on what matters, or just what's detected?`
    );
  }

  // Skill concentration
  const topSkill = Object.entries(data.skillFrequency).sort(
    ([, a], [, b]) => b - a
  )[0];
  if (topSkill && topSkill[1] > total * 0.4 && total > 5) {
    prompts.push(
      `- ${topSkill[0]} dominated today (${topSkill[1]}/${total} tasks). Is this proportional to its importance, or crowding out other work?`
    );
  }

  // Low activity
  if (total < 5) {
    prompts.push(
      `- Only ${total} tasks in 24h. Is the queue starved, or was this intentional low-activity?`
    );
  }

  // High activity
  if (total > 50) {
    prompts.push(
      `- ${total} tasks in 24h is high volume. Is the queue creating busywork, or is this genuine throughput?`
    );
  }

  if (prompts.length === 0) {
    prompts.push(
      `- Routine day. What's the most valuable thing accomplished? What should tomorrow prioritize?`
    );
  }

  return prompts.join("\n");
}

// ---- Main sensor ----

export default async function introspectionSensor(): Promise<string> {
  // Date-based dedup: only one introspection per calendar day
  const statePre = await readHookState(SENSOR_NAME);
  const lastRunDate = statePre?.lastRunDate as string | undefined;
  const today = new Date().toISOString().split("T")[0];

  if (lastRunDate === today) {
    return "skip";
  }

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  if (pendingTaskExistsForSource(TASK_SOURCE)) {
    log("introspection task already pending — skipping");
    return "skip";
  }

  log("collecting 24h introspection data...");

  const data = collectIntrospectionData();
  const total = data.completed.length + data.failed.length;

  // Don't create introspection if nothing happened
  if (total === 0 && data.totalCycles === 0) {
    log("no activity in last 24h — skipping introspection");
    // Still record the date so we don't keep checking
    await writeHookState(SENSOR_NAME, {
      ...(statePre ?? {}),
      last_ran: new Date().toISOString(),
      last_result: "skip",
      version: ((statePre?.version as number) ?? 0) + 1,
      lastRunDate: today,
    });
    return "skip";
  }

  const briefing = formatIntrospectionBriefing(data);
  const reflectionPrompts = generateReflectionPrompts(data);

  const subject = `daily introspection: ${total} tasks, ${data.completed.length} completed, $${data.totalCost.toFixed(2)} spent`;

  insertTask({
    subject,
    description:
      `Daily introspection for ${today}. Review the 24h activity briefing below, ` +
      `then write a 3-5 sentence self-assessment. Update memory/MEMORY.md if patterns are worth preserving.\n\n` +
      briefing +
      `\n\n## Reflection Prompts\n${reflectionPrompts}` +
      `\n\n## Instructions\n` +
      `1. Read the briefing above\n` +
      `2. Write a concise self-assessment (what went well, what didn't, what to focus on)\n` +
      `3. If any patterns are worth remembering, update memory/MEMORY.md\n` +
      `4. Close this task with a one-line summary of the reflection`,
    skills: '["arc-introspection", "arc-skill-manager"]',
    source: TASK_SOURCE,
    priority: 7,
    model: "sonnet",
  });

  log(`introspection task created: ${subject}`);

  // Record today's run
  await writeHookState(SENSOR_NAME, {
    ...(statePre ?? {}),
    last_ran: new Date().toISOString(),
    last_result: "ok",
    version: ((statePre?.version as number) ?? 0) + 1,
    lastRunDate: today,
  });

  return "ok";
}
