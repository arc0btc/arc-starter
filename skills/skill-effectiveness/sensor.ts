// skill-effectiveness/sensor.ts
//
// Weekly sensor: finds skills with >10 dispatch samples and <70% completion rate
// over the last 7 days, then queues a P6 Sonnet report task for investigation.
//
// Cadence: 10080 minutes (7 days / weekly)

import {
  claimSensorRun,
  createSensorLogger,
  insertTask,
  pendingTaskExistsForSource,
} from "../../src/sensors.ts";
import { getDatabase } from "../../src/db.ts";

const SENSOR_NAME = "skill-effectiveness";
const INTERVAL_MINUTES = 10080; // weekly (7 days × 24h × 60min)
const LOOKBACK_DAYS = 7;
const MIN_SAMPLES = 10;
const FAIL_RATE_THRESHOLD = 0.30; // >30% failure = <70% completion
const SOURCE = "sensor:skill-effectiveness";

const log = createSensorLogger(SENSOR_NAME);

interface SkillStats {
  skillName: string;
  total: number;
  completed: number;
  failed: number;
  completionRate: number;
}

export default async function skillEffectivenessSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  if (pendingTaskExistsForSource(SOURCE)) {
    log("report task already pending");
    return "skip";
  }

  const db = getDatabase();

  // Load cycles from the past 7 days that have skill_hashes and resolved tasks
  const rows = db
    .query(
      `SELECT cl.skill_hashes, t.status
       FROM cycle_log cl
       LEFT JOIN tasks t ON cl.task_id = t.id
       WHERE cl.skill_hashes IS NOT NULL
         AND t.status IN ('completed', 'failed')
         AND cl.started_at >= datetime('now', ?)`,
    )
    .all(`-${LOOKBACK_DAYS} days`) as { skill_hashes: string; status: string }[];

  if (rows.length === 0) {
    log("no cycles with skill_hashes in lookback window");
    return "ok";
  }

  // Aggregate per skill name (not per version — we want skill-level health)
  const statsMap = new Map<string, { total: number; completed: number; failed: number }>();

  for (const row of rows) {
    let hashes: Record<string, string>;
    try {
      hashes = JSON.parse(row.skill_hashes) as Record<string, string>;
    } catch {
      continue;
    }

    for (const skillName of Object.keys(hashes)) {
      const s = statsMap.get(skillName) ?? { total: 0, completed: 0, failed: 0 };
      s.total++;
      if (row.status === "completed") s.completed++;
      else s.failed++;
      statsMap.set(skillName, s);
    }
  }

  // Filter to skills with enough samples and below the completion threshold
  const underperforming: SkillStats[] = [];
  for (const [skillName, s] of statsMap) {
    if (s.total < MIN_SAMPLES) continue;
    const completionRate = s.completed / s.total;
    if (completionRate < (1 - FAIL_RATE_THRESHOLD)) {
      underperforming.push({ skillName, ...s, completionRate });
    }
  }

  log(
    `scanned ${rows.length} cycles across ${statsMap.size} skills; ` +
    `${underperforming.length} underperforming (n>${MIN_SAMPLES}, completion<${Math.round((1 - FAIL_RATE_THRESHOLD) * 100)}%)`
  );

  if (underperforming.length === 0) return "ok";

  // Sort worst first
  underperforming.sort((a, b) => a.completionRate - b.completionRate);

  const lines = underperforming.map((s) =>
    `- **${s.skillName}**: ${(s.completionRate * 100).toFixed(1)}% completion  (${s.completed}/${s.total} over last ${LOOKBACK_DAYS}d)`
  );

  const now = new Date().toISOString();

  insertTask({
    subject: `skill-effectiveness: ${underperforming.length} underperforming skill(s) — weekly report`,
    description: [
      `## Skill Effectiveness — Weekly Report (${now.slice(0, 10)})`,
      "",
      `Sensor found **${underperforming.length}** skill(s) with >${MIN_SAMPLES} samples and <${Math.round((1 - FAIL_RATE_THRESHOLD) * 100)}% completion rate over the last ${LOOKBACK_DAYS} days:`,
      "",
      ...lines,
      "",
      "### Instructions",
      "For each underperforming skill:",
      "1. Run `arc skills run --name skill-effectiveness -- report --skill <name> --period week` to see version-level breakdown.",
      "2. Check if failures are task-level (bad prompts, missing context) or skill-level (broken sensor/CLI).",
      "3. Review recent failed task `result_summary` fields for patterns.",
      "4. If the SKILL.md phrasing is stale or missing key context, rewrite it.",
      "5. If a sensor or CLI is broken, file a follow-up fix task.",
      "6. Commit any SKILL.md changes so the new version gets tracked.",
    ].join("\n"),
    skills: '["skill-effectiveness"]',
    priority: 6,
    model: "sonnet",
    source: SOURCE,
  });

  log(`queued report task for ${underperforming.length} underperforming skill(s)`);
  return `ok: ${underperforming.length} underperforming`;
}
