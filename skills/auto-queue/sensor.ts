/**
 * auto-queue sensor
 *
 * Every 2 hours, analyzes task completion patterns by skill domain.
 * Detects "hungry" domains (completing faster than new tasks arrive)
 * and creates a batch-generation task for dispatch to fill.
 *
 * Pure TypeScript — no LLM calls. The batch task is executed by dispatch
 * with full context to make intelligent decisions about what to queue.
 */

import { join } from "node:path";
import {
  claimSensorRun,
  createSensorLogger,
  insertTaskIfNew,
  readHookState,
  writeHookState,
} from "../../src/sensors.ts";
import { getDatabase } from "../../src/db.ts";

const SENSOR_NAME = "auto-queue";
const INTERVAL_MINUTES = 360; // 6 hours — don't generate work faster than consumed
const TASK_SOURCE = "sensor:auto-queue";

const log = createSensorLogger(SENSOR_NAME);

// ---- Thresholds ----

const LOOKBACK_HOURS = 6;
const MIN_COMPLETIONS = 3;
const MAX_PENDING_FOR_HUNGRY = 2;
const MIN_RATIO_FOR_HUNGRY = 0.5; // created/completed < 0.5 means domain is draining

// ---- Types ----

export interface DomainStats {
  domain: string;
  completed: number;
  failed: number;
  created: number;
  pending: number;
  active: number;
  avg_cost_usd: number;
  hungry: boolean;
  reason: string;
}

// ---- Analysis ----

/**
 * Extract the primary domain from a task's skills JSON array.
 * Returns the first skill name, or "_general" if no skills.
 */
function extractDomain(skillsJson: string | null): string {
  if (!skillsJson) return "_general";
  try {
    const skillsArray = JSON.parse(skillsJson);
    if (Array.isArray(skillsArray) && skillsArray.length > 0 && typeof skillsArray[0] === "string") {
      return skillsArray[0];
    }
  } catch {
    // malformed JSON
  }
  return "_general";
}

/**
 * Collect per-domain stats from the task table.
 */
export function collectDomainStats(): DomainStats[] {
  const db = getDatabase();
  const now = new Date();
  const since = new Date(now.getTime() - LOOKBACK_HOURS * 3600_000).toISOString();

  // Completed tasks in window (with skills and cost)
  const completed = db.query(
    `SELECT skills, cost_usd FROM tasks
     WHERE completed_at >= ? AND status = 'completed'`,
  ).all(since) as Array<{ skills: string | null; cost_usd: number }>;

  // Failed tasks in window
  const failed = db.query(
    `SELECT skills FROM tasks
     WHERE completed_at >= ? AND status = 'failed'`,
  ).all(since) as Array<{ skills: string | null }>;

  // Created tasks in window
  const created = db.query(
    `SELECT skills FROM tasks
     WHERE created_at >= ?`,
  ).all(since) as Array<{ skills: string | null }>;

  // Current pending tasks
  const pending = db.query(
    `SELECT skills FROM tasks WHERE status = 'pending'`,
  ).all() as Array<{ skills: string | null }>;

  // Current active tasks
  const active = db.query(
    `SELECT skills FROM tasks WHERE status = 'active'`,
  ).all() as Array<{ skills: string | null }>;

  // Aggregate by domain
  const domains = new Map<string, {
    completed: number;
    failed: number;
    created: number;
    pending: number;
    active: number;
    total_cost: number;
  }>();

  function ensure(domain: string) {
    if (!domains.has(domain)) {
      domains.set(domain, { completed: 0, failed: 0, created: 0, pending: 0, active: 0, total_cost: 0 });
    }
    return domains.get(domain)!;
  }

  for (const row of completed) {
    const d = ensure(extractDomain(row.skills));
    d.completed++;
    d.total_cost += row.cost_usd ?? 0;
  }

  for (const row of failed) {
    ensure(extractDomain(row.skills)).failed++;
  }

  for (const row of created) {
    ensure(extractDomain(row.skills)).created++;
  }

  for (const row of pending) {
    ensure(extractDomain(row.skills)).pending++;
  }

  for (const row of active) {
    ensure(extractDomain(row.skills)).active++;
  }

  // Build stats with hunger detection
  const stats: DomainStats[] = [];

  for (const [domain, d] of domains) {
    let hungry = false;
    let reason = "";

    // Condition 1: Active domain with low queue depth
    if (d.completed >= MIN_COMPLETIONS && d.pending <= MAX_PENDING_FOR_HUNGRY) {
      hungry = true;
      reason = `${d.completed} completed, only ${d.pending} pending`;
    }

    // Condition 2: Creation rate not keeping up with completion rate
    if (d.completed >= MIN_COMPLETIONS) {
      const ratio = d.completed > 0 ? d.created / d.completed : 0;
      if (ratio < MIN_RATIO_FOR_HUNGRY && !hungry) {
        hungry = true;
        reason = `creation/completion ratio ${ratio.toFixed(2)} (draining)`;
      }
    }

    // Don't mark _general as hungry — it's a catch-all, not a real domain
    if (domain === "_general") {
      hungry = false;
      reason = "";
    }

    stats.push({
      domain,
      completed: d.completed,
      failed: d.failed,
      created: d.created,
      pending: d.pending,
      active: d.active,
      avg_cost_usd: d.completed > 0
        ? Math.round((d.total_cost / d.completed) * 1000) / 1000
        : 0,
      hungry,
      reason,
    });
  }

  // Sort: hungry domains first, then by completion count descending
  stats.sort((a, b) => {
    if (a.hungry !== b.hungry) return a.hungry ? -1 : 1;
    return b.completed - a.completed;
  });

  return stats;
}

// ---- Sensor entry point ----

export default async function autoQueueSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const stats = collectDomainStats();
  const hungryDomains = stats.filter((s) => s.hungry);

  // Persist stats snapshot for CLI inspection
  const state = await readHookState(SENSOR_NAME);
  await writeHookState(SENSOR_NAME, {
    ...(state ?? { version: 0 }),
    last_ran: new Date().toISOString(),
    last_result: "ok",
    version: (state?.version ?? 0) + 1,
    total_domains: stats.length,
    hungry_count: hungryDomains.length,
    stats_summary: stats.slice(0, 10).map((s) => ({
      domain: s.domain,
      completed: s.completed,
      pending: s.pending,
      hungry: s.hungry,
    })),
  });

  log(
    `analyzed ${stats.length} domains: ${hungryDomains.length} hungry, ` +
    `${stats.reduce((a, s) => a + s.completed, 0)} total completions in ${LOOKBACK_HOURS}h`,
  );

  if (hungryDomains.length === 0) {
    log("all domains have sufficient queue depth");
    return "ok";
  }

  // Build description for the batch task
  const domainLines = hungryDomains.map((d) =>
    `- **${d.domain}**: ${d.reason} (completed=${d.completed}, failed=${d.failed}, pending=${d.pending}, avg_cost=$${d.avg_cost_usd.toFixed(2)})`
  ).join("\n");

  const topCompletions = stats
    .filter((s) => s.completed > 0 && !s.hungry)
    .slice(0, 5)
    .map((s) => `- ${s.domain}: ${s.completed} completed, ${s.pending} pending`)
    .join("\n");

  const description = [
    `Auto-queue sensor detected ${hungryDomains.length} hungry domain(s) in the last ${LOOKBACK_HOURS}h.\n`,
    "## Hungry Domains (need work queued)\n",
    domainLines,
    "",
    "## Healthy Domains (for context)\n",
    topCompletions || "- (none with completions)",
    "",
    "## Instructions\n",
    "1. Read GOALS.md to align new tasks with current priorities",
    "2. For each hungry domain, create 3-5 follow-up tasks using `arc tasks add`",
    "3. Match priority to the domain's typical work (check recent completions for patterns)",
    "4. Include the domain skill in `--skills` so dispatch loads the right context",
    "5. Prefer actionable, specific tasks over vague exploration tasks",
    "6. If a domain has high failure rate, investigate before queuing more work",
  ].join("\n");

  const created = insertTaskIfNew(TASK_SOURCE, {
    subject: `Auto-queue: ${hungryDomains.length} hungry domain(s) need work`,
    description,
    priority: 5,
    skills: '["auto-queue"]',
  });

  if (created !== null) {
    log(`created batch task #${created} for ${hungryDomains.length} hungry domains`);
  } else {
    log("batch task already pending, skipping");
  }

  return "ok";
}
