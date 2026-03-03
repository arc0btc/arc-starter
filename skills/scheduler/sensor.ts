// scheduler/sensor.ts
//
// Monitors the scheduled task queue every 5 minutes.
// Tracks upcoming tasks, detects overdue tasks that dispatch hasn't picked up,
// and creates health alerts if the scheduled queue is backing up.
//
// The primary scheduling mechanism lives in getPendingTasks(): tasks with
// scheduled_for <= now are automatically eligible for dispatch. Past-due tasks
// get a +2 effective priority boost in the sort order. This sensor adds
// observability and a safety net for stuck queues.

import { claimSensorRun, insertTaskIfNew } from "../../src/sensors.ts";
import { getDatabase } from "../../src/db.ts";
import type { Task } from "../../src/db.ts";

const SENSOR_NAME = "scheduler";
const INTERVAL_MINUTES = 5;
const OVERDUE_ALERT_SOURCE = "sensor:scheduler:overdue";
const OVERDUE_ALERT_THRESHOLD = 5;    // alert if >5 overdue tasks
const OVERDUE_MINUTES = 30;           // tasks past-due by this long without being dispatched

/** Tasks with scheduled_for in the future (not yet eligible). */
function getUpcomingTasks(): Task[] {
  const db = getDatabase();
  return db
    .query(
      `SELECT * FROM tasks
       WHERE status = 'pending'
         AND scheduled_for IS NOT NULL
         AND datetime(scheduled_for) > datetime('now')
       ORDER BY datetime(scheduled_for) ASC`
    )
    .all() as Task[];
}

/**
 * Tasks that are past their scheduled_for time but still sitting as pending —
 * i.e., they should have been dispatched but haven't been yet.
 * Normal if dispatch is temporarily busy; abnormal if accumulating.
 */
function getOverdueTasks(overdueMinutes: number): Task[] {
  const db = getDatabase();
  return db
    .query(
      `SELECT * FROM tasks
       WHERE status = 'pending'
         AND scheduled_for IS NOT NULL
         AND datetime(scheduled_for) <= datetime('now', ? || ' minutes')
       ORDER BY datetime(scheduled_for) ASC`,
      [`-${overdueMinutes}`]
    )
    .all() as Task[];
}

export default async function schedulerSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const upcoming = getUpcomingTasks();
  const overdue = getOverdueTasks(OVERDUE_MINUTES);

  // Create a health alert if scheduled tasks are accumulating without being dispatched.
  // This shouldn't happen in normal operation — dispatch picks them up within 1 minute.
  if (overdue.length > OVERDUE_ALERT_THRESHOLD) {
    const nextSubject = overdue[0]?.subject ?? "unknown";
    insertTaskIfNew(OVERDUE_ALERT_SOURCE, {
      subject: `scheduler alert: ${overdue.length} scheduled tasks overdue by >${OVERDUE_MINUTES}m`,
      description:
        `${overdue.length} tasks with past scheduled_for times are still pending after ${OVERDUE_MINUTES}+ minutes. ` +
        `Dispatch may be stuck or the task queue is saturated. ` +
        `Earliest overdue: "${nextSubject}". ` +
        `Check: arc status, arc tasks --status pending, systemd dispatch timer.`,
      priority: 3,
    });
  }

  const nextDue = upcoming[0]?.scheduled_for ?? null;
  const parts = [`upcoming=${upcoming.length}`, `overdue=${overdue.length}`];
  if (nextDue) parts.push(`next=${nextDue}`);

  return `ok: ${parts.join(", ")}`;
}
