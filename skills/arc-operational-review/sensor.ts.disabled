/**
 * arc-operational-review sensor
 *
 * Runs every 6 hours. Queries completed/failed/blocked tasks from the review
 * window and surfaces unresolved issues for dispatch to triage.
 *
 * No LLM calls — pure SQL queries over the tasks table.
 */

import {
  claimSensorRun,
  createSensorLogger,
  insertTaskIfNew,
} from "../../src/sensors.ts";
import { getDatabase } from "../../src/db.ts";

const SENSOR_NAME = "arc-operational-review";
const INTERVAL_MINUTES = 360; // 6 hours
const REVIEW_HOURS = 6;

interface ReviewFindings {
  failedNoFollowUp: Array<{ id: number; subject: string; completed_at: string }>;
  blockedOver24h: Array<{ id: number; subject: string; created_at: string }>;
  stalePendingFollowUps: Array<{ id: number; subject: string; priority: number; created_at: string }>;
}

/** Query the tasks table for operational issues within the review window. */
function runReview(hours: number): ReviewFindings {
  const db = getDatabase();

  // 1. Failed tasks with no follow-up task referencing them as parent
  const failedNoFollowUp = db
    .query<{ id: number; subject: string; completed_at: string }, [string]>(
      `SELECT t.id, t.subject, t.completed_at
       FROM tasks t
       WHERE t.status = 'failed'
         AND t.completed_at >= datetime('now', '-' || ? || ' hours')
         AND NOT EXISTS (
           SELECT 1 FROM tasks f
           WHERE f.parent_id = t.id
             AND f.status IN ('pending', 'active', 'completed')
         )
         AND NOT EXISTS (
           SELECT 1 FROM tasks f
           WHERE f.source = 'task:' || t.id
             AND f.status IN ('pending', 'active', 'completed')
         )
       ORDER BY t.completed_at DESC`,
    )
    .all(String(hours));

  // 2. Blocked tasks older than 24 hours
  const blockedOver24h = db
    .query<{ id: number; subject: string; created_at: string }, []>(
      `SELECT id, subject, created_at
       FROM tasks
       WHERE status = 'blocked'
         AND created_at < datetime('now', '-24 hours')
       ORDER BY created_at ASC`,
    )
    .all();

  // 3. Pending follow-up tasks (source starts with "task:") that have been
  //    sitting at low priority (>=7) for more than 6 hours
  const stalePendingFollowUps = db
    .query<{ id: number; subject: string; priority: number; created_at: string }, [string]>(
      `SELECT id, subject, priority, created_at
       FROM tasks
       WHERE status = 'pending'
         AND source LIKE 'task:%'
         AND priority >= 7
         AND created_at < datetime('now', '-' || ? || ' hours')
       ORDER BY priority DESC, created_at ASC`,
    )
    .all(String(hours));

  return { failedNoFollowUp, blockedOver24h, stalePendingFollowUps };
}

/** Format findings into a markdown report. */
function formatReport(findings: ReviewFindings, hours: number): string {
  const lines: string[] = [`## Operational Review — last ${hours}h\n`];

  const totalIssues =
    findings.failedNoFollowUp.length +
    findings.blockedOver24h.length +
    findings.stalePendingFollowUps.length;

  if (totalIssues === 0) {
    lines.push("No issues found. All clear.");
    return lines.join("\n");
  }

  if (findings.failedNoFollowUp.length > 0) {
    lines.push(`### Failed tasks with no follow-up (${findings.failedNoFollowUp.length})\n`);
    for (const t of findings.failedNoFollowUp) {
      lines.push(`- **#${t.id}** ${t.subject} (failed ${t.completed_at})`);
    }
    lines.push("");
  }

  if (findings.blockedOver24h.length > 0) {
    lines.push(`### Blocked tasks >24h (${findings.blockedOver24h.length})\n`);
    for (const t of findings.blockedOver24h) {
      lines.push(`- **#${t.id}** ${t.subject} (created ${t.created_at})`);
    }
    lines.push("");
  }

  if (findings.stalePendingFollowUps.length > 0) {
    lines.push(`### Stale low-priority follow-ups (${findings.stalePendingFollowUps.length})\n`);
    for (const t of findings.stalePendingFollowUps) {
      lines.push(`- **#${t.id}** [P${t.priority}] ${t.subject} (created ${t.created_at})`);
    }
    lines.push("");
  }

  lines.push(`**Total issues: ${totalIssues}**`);
  return lines.join("\n");
}

export default async function sensor(): Promise<string> {
  const log = createSensorLogger(SENSOR_NAME);

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  log("Running operational review...");

  const findings = runReview(REVIEW_HOURS);
  const totalIssues =
    findings.failedNoFollowUp.length +
    findings.blockedOver24h.length +
    findings.stalePendingFollowUps.length;

  if (totalIssues === 0) {
    log("No issues found.");
    return "ok";
  }

  const report = formatReport(findings, REVIEW_HOURS);
  const today = new Date().toISOString().slice(0, 10);
  const source = `sensor:${SENSOR_NAME}:${today}`;

  const taskId = insertTaskIfNew(source, {
    subject: `Operational review: ${totalIssues} issue(s) found`,
    description: report,
    skills: JSON.stringify(["arc-operational-review"]),
    priority: 7,
    model: "sonnet",
  });

  if (taskId !== null) {
    log(`Created review task #${taskId} with ${totalIssues} issue(s).`);
  } else {
    log("Review task already exists for today, skipping.");
  }

  return "ok";
}

export { runReview, formatReport };
