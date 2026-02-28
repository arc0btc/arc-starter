import { claimSensorRun } from "../../src/sensors.ts";
import {
  initDatabase,
  getDatabase,
  insertTask,
  pendingTaskExistsForSource,
  completedTaskCountForSource,
} from "../../src/db.ts";
import type { Task } from "../../src/db.ts";

const SENSOR_NAME = "failure-triage";
const INTERVAL_MINUTES = 60;
const LOOKBACK_HOURS = 24;
const OCCURRENCE_THRESHOLD = 3;

/** Normalized error signature patterns. Order matters — first match wins. */
const ERROR_PATTERNS: Array<{ signature: string; patterns: RegExp[] }> = [
  {
    signature: "payment-error",
    patterns: [/402/i, /payment/i],
  },
  {
    signature: "sqlite-lock",
    patterns: [/database is locked/i, /SQLITE_BUSY/i],
  },
  {
    signature: "wallet-error",
    patterns: [/wallet.*unlock/i, /wallet.*fail/i, /signing.*fail/i],
  },
  {
    signature: "timeout",
    patterns: [/timeout/i, /ETIMEDOUT/i, /\bhung\b/i, /timed?\s*out/i],
  },
  {
    signature: "auth-error",
    patterns: [/\b403\b/, /\b401\b/, /permission denied/i, /unauthorized/i, /forbidden/i],
  },
  {
    signature: "network-error",
    patterns: [/ECONNREFUSED/i, /ENOTFOUND/i, /fetch failed/i, /network/i],
  },
];

/** Extract a normalized error signature from a task's result_summary. */
function classifyError(text: string): string {
  for (const { signature, patterns } of ERROR_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(text)) return signature;
    }
  }
  return "unknown";
}

/** Simple hash for dedup source keys. */
function shortHash(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

export default async function failureTriageSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const db = getDatabase();

  // Query failed tasks in the lookback window
  const failedTasks = db
    .query(
      `SELECT * FROM tasks
       WHERE status = 'failed'
         AND completed_at IS NOT NULL
         AND datetime(completed_at) >= datetime('now', ?)
       ORDER BY completed_at DESC`,
    )
    .all(`-${LOOKBACK_HOURS} hours`) as Task[];

  if (failedTasks.length === 0) return "ok";

  // Group by error signature
  const groups = new Map<string, Task[]>();
  for (const task of failedTasks) {
    const text = task.result_summary ?? task.subject;
    const sig = classifyError(text);
    const existing = groups.get(sig) ?? [];
    existing.push(task);
    groups.set(sig, existing);
  }

  let created = 0;

  for (const [signature, tasks] of groups) {
    if (tasks.length < OCCURRENCE_THRESHOLD) continue;

    const source = `sensor:failure-triage:pattern:${shortHash(signature)}`;
    if (pendingTaskExistsForSource(source)) continue;
    if (completedTaskCountForSource(source) >= 2) continue;

    const taskIds = tasks.map((t) => t.id).join(", ");
    const samples = tasks
      .slice(0, 3)
      .map((t) => `  - task #${t.id}: ${t.result_summary ?? t.subject}`)
      .join("\n");

    insertTask({
      subject: `Investigate recurring failure: ${signature} (${tasks.length} occurrences)`,
      description: [
        `## Recurring Failure Pattern: ${signature}`,
        "",
        `**Occurrences:** ${tasks.length} in the last ${LOOKBACK_HOURS} hours`,
        `**Task IDs:** ${taskIds}`,
        "",
        "### Samples",
        samples,
        "",
        "### Instructions",
        "1. Read AGENT.md for this skill before starting",
        "2. Check our own code first before blaming external services",
        "3. Find the root cause, not just the symptom",
        "4. Fix if it's our bug, file ONE issue if external, document if transient",
      ].join("\n"),
      skills: '["failure-triage", "manage-skills"]',
      priority: 3,
      source,
    });

    created++;
  }

  return created > 0 ? `ok: created ${created} investigation task(s)` : "ok";
}
