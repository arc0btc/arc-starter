// arc-cost-reporting/sensor.ts
//
// Runs once per day. Generates a cost/token breakdown report:
// top tasks by cost, top tasks by tokens, top skills by cost, top sensors by cost.
// No thresholds or alerting — pure reporting.

import { claimSensorRun, createSensorLogger, pendingTaskExistsForSource, insertTask } from "../../src/sensors.ts";
import { getDatabase } from "../../src/db.ts";

const SENSOR_NAME = "arc-cost-reporting";
const INTERVAL_MINUTES = 60;

const log = createSensorLogger(SENSOR_NAME);

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildReport(today: string): string {
  const db = getDatabase();

  const summary = db.query(`
    SELECT COALESCE(SUM(cost_usd), 0) as total_cost,
           COALESCE(SUM(api_cost_usd), 0) as total_api_cost,
           COALESCE(SUM(tokens_in + tokens_out), 0) as total_tokens,
           COUNT(*) as task_count
    FROM tasks WHERE date(created_at) = date('now')
  `).get() as { total_cost: number; total_api_cost: number; total_tokens: number; task_count: number };

  const topByCost = db.query(`
    SELECT id, subject, cost_usd, api_cost_usd, (tokens_in + tokens_out) as tokens, model
    FROM tasks WHERE date(created_at) = date('now') AND cost_usd > 0
    ORDER BY cost_usd DESC LIMIT 5
  `).all() as Array<{ id: number; subject: string; cost_usd: number; api_cost_usd: number; tokens: number; model: string | null }>;

  const topByTokens = db.query(`
    SELECT id, subject, cost_usd, api_cost_usd, (tokens_in + tokens_out) as tokens, model
    FROM tasks WHERE date(created_at) = date('now') AND (tokens_in + tokens_out) > 0
    ORDER BY (tokens_in + tokens_out) DESC LIMIT 5
  `).all() as Array<{ id: number; subject: string; cost_usd: number; api_cost_usd: number; tokens: number; model: string | null }>;

  const topSkills = db.query(`
    SELECT skills,
           COALESCE(SUM(cost_usd), 0) as total_cost,
           COALESCE(SUM(api_cost_usd), 0) as total_api_cost,
           COALESCE(SUM(tokens_in + tokens_out), 0) as total_tokens,
           COUNT(*) as task_count
    FROM tasks WHERE date(created_at) = date('now') AND cost_usd > 0
    GROUP BY skills ORDER BY total_cost DESC LIMIT 5
  `).all() as Array<{ skills: string | null; total_cost: number; total_api_cost: number; total_tokens: number; task_count: number }>;

  // Fetch sensor-sourced tasks and aggregate by sensor name in TypeScript
  const sensorRows = db.query(`
    SELECT source, cost_usd, api_cost_usd, (tokens_in + tokens_out) as tokens
    FROM tasks WHERE date(created_at) = date('now') AND source LIKE 'sensor:%' AND cost_usd > 0
  `).all() as Array<{ source: string; cost_usd: number; api_cost_usd: number; tokens: number }>;

  const sensorMap = new Map<string, { total_cost: number; total_api_cost: number; total_tokens: number; task_count: number }>();
  for (const row of sensorRows) {
    const name = row.source.slice(7).split(":")[0];
    const s = sensorMap.get(name) ?? { total_cost: 0, total_api_cost: 0, total_tokens: 0, task_count: 0 };
    s.total_cost += row.cost_usd;
    s.total_api_cost += row.api_cost_usd;
    s.total_tokens += row.tokens;
    s.task_count += 1;
    sensorMap.set(name, s);
  }
  const topSensors = [...sensorMap.entries()]
    .sort((a, b) => b[1].total_cost - a[1].total_cost)
    .slice(0, 5);

  const lines: string[] = [];
  lines.push(`## Daily Cost Report — ${today}`);
  lines.push("");
  lines.push(
    `**Total:** Code $${summary.total_cost.toFixed(4)} | ` +
    `API est. $${summary.total_api_cost.toFixed(4)} | ` +
    `${(summary.total_tokens / 1000).toFixed(1)}k tokens | ` +
    `${summary.task_count} tasks`
  );
  lines.push("");

  if (topByCost.length > 0) {
    lines.push("### Top Tasks by Cost");
    for (const t of topByCost) {
      const sub = t.subject.length > 55 ? t.subject.slice(0, 52) + "..." : t.subject;
      lines.push(
        `- #${t.id} Code $${t.cost_usd.toFixed(4)} (API $${t.api_cost_usd.toFixed(4)}) [${t.model ?? "unknown"}] — ${sub}`
      );
    }
    lines.push("");
  }

  if (topByTokens.length > 0) {
    lines.push("### Top Tasks by Tokens");
    for (const t of topByTokens) {
      const sub = t.subject.length > 55 ? t.subject.slice(0, 52) + "..." : t.subject;
      lines.push(
        `- #${t.id} ${(t.tokens / 1000).toFixed(1)}k tokens — Code $${t.cost_usd.toFixed(4)} (API $${t.api_cost_usd.toFixed(4)}) — ${sub}`
      );
    }
    lines.push("");
  }

  if (topSkills.length > 0) {
    lines.push("### Top Skills by Cost");
    for (const s of topSkills) {
      let label = "(none)";
      if (s.skills) {
        try {
          const skillNames = JSON.parse(s.skills) as string[];
          label = skillNames.join(", ");
        } catch {
          label = s.skills;
        }
      }
      lines.push(
        `- ${label}: Code $${s.total_cost.toFixed(4)} (API $${s.total_api_cost.toFixed(4)}) | ` +
        `${(s.total_tokens / 1000).toFixed(1)}k tokens | ` +
        `${s.task_count} tasks`
      );
    }
    lines.push("");
  }

  if (topSensors.length > 0) {
    lines.push("### Top Sensors by Cost");
    for (const [name, stats] of topSensors) {
      lines.push(
        `- ${name}: Code $${stats.total_cost.toFixed(4)} (API $${stats.total_api_cost.toFixed(4)}) | ` +
        `${(stats.total_tokens / 1000).toFixed(1)}k tokens | ` +
        `${stats.task_count} tasks`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

export default async function costReportingSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const today = todayStr();
  const source = `sensor:${SENSOR_NAME}:${today}`;

  if (pendingTaskExistsForSource(source)) return "skip";

  const report = buildReport(today);

  insertTask({
    subject: `daily cost report — ${today}`,
    description: report,
    skills: '["arc-cost-reporting"]',
    priority: 9,
    model: "haiku",
    source,
  });

  log(`daily cost report created for ${today}`);
  return "ok";
}
