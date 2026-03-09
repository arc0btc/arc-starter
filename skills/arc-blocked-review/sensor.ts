import {
  claimSensorRun,
  createSensorLogger,
  insertTaskIfNew,
} from "../../src/sensors.ts";
import { getDatabase } from "../../src/db.ts";
import type { Task } from "../../src/db.ts";

const SENSOR_NAME = "arc-blocked-review";
const INTERVAL_MINUTES = 240;
const TASK_SOURCE = "sensor:arc-blocked-review";

const log = createSensorLogger(SENSOR_NAME);

/** Hours after which a blocked task always gets flagged for review. */
const STALE_BLOCKED_HOURS = 48;

export default async function blockedReviewSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const db = getDatabase();

  // Get all blocked tasks
  const blockedTasks = db
    .query("SELECT * FROM tasks WHERE status = 'blocked' ORDER BY priority ASC")
    .all() as Task[];

  if (blockedTasks.length === 0) {
    log("no blocked tasks");
    return "ok";
  }

  const candidates: Array<{ task: Task; reasons: string[] }> = [];

  for (const task of blockedTasks) {
    const reasons: string[] = [];

    // 1. Check if sibling tasks (same parent) completed after this task was blocked
    if (task.parent_id !== null) {
      const completedSiblings = db
        .query(
          `SELECT id, subject, completed_at FROM tasks
           WHERE parent_id = ? AND id != ? AND status IN ('completed', 'failed')
           AND completed_at > COALESCE(?, created_at)
           ORDER BY completed_at DESC LIMIT 5`
        )
        .all(task.parent_id, task.id, task.started_at) as Array<{
        id: number;
        subject: string;
        completed_at: string;
      }>;

      if (completedSiblings.length > 0) {
        reasons.push(
          `${completedSiblings.length} sibling task(s) completed since blocked (e.g. #${completedSiblings[0].id})`
        );
      }
    }

    // 2. Check if child tasks (source = "task:<id>") completed
    const completedChildren = db
      .query(
        `SELECT id, subject, status FROM tasks
         WHERE source = ? AND status IN ('completed', 'failed')`
      )
      .all(`task:${task.id}`) as Array<{
      id: number;
      subject: string;
      status: string;
    }>;

    if (completedChildren.length > 0) {
      const completed = completedChildren.filter((c) => c.status === "completed");
      if (completed.length > 0) {
        reasons.push(
          `${completed.length} child task(s) completed (e.g. #${completed[0].id})`
        );
      }
    }

    // 3. Check if tasks referencing this blocked task's ID in their subject/description completed
    const mentioningTasks = db
      .query(
        `SELECT id, subject, status FROM tasks
         WHERE status = 'completed'
         AND (subject LIKE ? OR description LIKE ?)
         AND id != ?
         LIMIT 5`
      )
      .all(`%#${task.id}%`, `%#${task.id}%`, task.id) as Array<{
      id: number;
      subject: string;
      status: string;
    }>;

    if (mentioningTasks.length > 0) {
      reasons.push(
        `${mentioningTasks.length} task(s) mention #${task.id} and completed`
      );
    }

    // 4. Stale check — blocked for too long without review
    const blockedSince = task.started_at ?? task.created_at;
    const ageHours =
      (Date.now() - new Date(blockedSince + "Z").getTime()) / 3_600_000;
    if (ageHours > STALE_BLOCKED_HOURS) {
      reasons.push(`blocked for ${Math.round(ageHours)}h (>${STALE_BLOCKED_HOURS}h threshold)`);
    }

    if (reasons.length > 0) {
      candidates.push({ task, reasons });
    }
  }

  if (candidates.length === 0) {
    log(`${blockedTasks.length} blocked task(s), none flagged for review`);
    return "ok";
  }

  // Build a single review task listing all candidates
  const description = candidates
    .map(
      ({ task, reasons }) =>
        `### Task #${task.id} (P${task.priority}): ${task.subject}\n` +
        `Blocked reason: ${task.result_summary ?? "(none)"}\n` +
        `Signals:\n${reasons.map((r) => `- ${r}`).join("\n")}`
    )
    .join("\n\n");

  const id = insertTaskIfNew(TASK_SOURCE, {
    subject: `Review ${candidates.length} blocked task(s) for possible unblock`,
    description,
    skills: '["arc-blocked-review"]',
    priority: 7,
    model: "sonnet",
  });

  if (id !== null) {
    log(`created review task #${id} for ${candidates.length} candidate(s)`);
  } else {
    log("review task already exists, skipping");
  }

  return "ok";
}
