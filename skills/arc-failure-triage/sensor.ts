import { claimSensorRun } from "../../src/sensors.ts";
import {
  getDatabase,
  insertTask,
  pendingTaskExistsForSource,
  completedTaskCountForSource,
  insertWorkflow,
  getWorkflowByInstanceKey,
} from "../../src/db.ts";
import type { Task } from "../../src/db.ts";

const SENSOR_NAME = "arc-failure-triage";
const INTERVAL_MINUTES = 60;
const LOOKBACK_HOURS = 24;
const OCCURRENCE_THRESHOLD = 3;

/** Normalized error signature patterns. Order matters — first match wins. */
const ERROR_PATTERNS: Array<{ signature: string; patterns: RegExp[] }> = [
  {
    signature: "rate-limit",
    patterns: [/\b429\b/, /rate.?limit/i],
  },
  {
    signature: "beat-conflict",
    patterns: [/beat.*claimed/i, /beat.*ownership/i, /claimed by another/i, /wrong beat/i],
  },
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
  {
    signature: "crash-recovery",
    patterns: [/crash recovery/i, /left active from a previous cycle/i, /stuck active/i],
  },
  {
    signature: "external-constraint",
    patterns: [
      /cannot access.*programmatically/i,
      /requires.*browser.*session/i,
      /browser.?only feature/i,
      /ui.?only feature/i,
      /no.*programmatic api/i,
    ],
  },
  {
    signature: "tool-constraint",
    patterns: [
      /only sends to verified/i,
      /verified.*address/i,
    ],
  },
  {
    signature: "dismissed",
    patterns: [
      /too noisy/i,
      /cleaning queue/i,
      /duplicate.*brief/i,
      /wrong priority/i,
      /focusing on mentions/i,
      /recreating with/i,
      /test task/i,
      /cancelled.*already/i,
      /already supported/i,
      /auto.?recovered/i,
    ],
  },
];

/** Signatures that should never trigger an investigation task — handled elsewhere or intentional. */
const SKIP_SIGNATURES = new Set(["dismissed", "crash-recovery", "tool-constraint"]);

/** Extract a normalized error signature from a task's result_summary. */
function classifyError(text: string): string {
  for (const { signature, patterns } of ERROR_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(text)) return signature;
    }
  }
  return "unknown";
}


export default async function failureTriageSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const db = getDatabase();

  // Query failed tasks in the lookback window, excluding bulk-close operations
  // which inflate the failure count artificially (these are intentional closures).
  const failedTasks = db
    .query(
      `SELECT * FROM tasks
       WHERE status = 'failed'
         AND completed_at IS NOT NULL
         AND datetime(completed_at) >= datetime('now', ?)
         AND (result_summary IS NULL OR result_summary NOT LIKE 'Bulk closed%')
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
    if (SKIP_SIGNATURES.has(signature)) continue;

    const today = new Date().toISOString().slice(0, 10);
    const instanceKey = `recurring-failure-${signature}-${today}`;
    if (getWorkflowByInstanceKey(instanceKey)) continue;

    insertWorkflow({
      template: "recurring-failure",
      instance_key: instanceKey,
      current_state: "detected",
      context: JSON.stringify({
        failureType: signature,
        occurrences: tasks.length,
        sourceSkill: "arc-failure-triage",
      }),
    });

    created++;
  }

  // --- Daily retrospective pass ---
  // Create a single daily task to review all recent failures for learnings,
  // even if they don't form a recurring pattern (below OCCURRENCE_THRESHOLD).
  const today = new Date().toISOString().slice(0, 10);
  const retroSource = `sensor:arc-failure-triage:retro:${today}`;
  if (!pendingTaskExistsForSource(retroSource) && completedTaskCountForSource(retroSource) === 0) {
    // Only create if there are failures worth reviewing
    const nonDismissed = failedTasks.filter((t) => {
      const sig = classifyError(t.result_summary ?? t.subject);
      return !SKIP_SIGNATURES.has(sig);
    });

    if (nonDismissed.length > 0) {
      const listing = nonDismissed
        .slice(0, 10)
        .map((t) => {
          const sig = classifyError(t.result_summary ?? t.subject);
          return `  - #${t.id} [${sig}]: ${t.result_summary ?? t.subject}`;
        })
        .join("\n");

      insertTask({
        subject: `Daily failure retrospective: ${nonDismissed.length} failed task(s)`,
        description: [
          `## Failure Retrospective — ${today}`,
          "",
          `**Failed tasks (last ${LOOKBACK_HOURS}h):** ${nonDismissed.length}`,
          "",
          "### Tasks to Review",
          listing,
          nonDismissed.length > 10 ? `  - ... and ${nonDismissed.length - 10} more` : "",
          "",
          "### Instructions",
          "1. Read each failed task's result_summary and result_detail",
          "2. For each failure, extract one concrete learning (if any)",
          "3. Look for systemic patterns: task chaining without gates, missing preconditions, scope creep",
          "4. Write learnings to memory/MEMORY.md or the relevant topic file",
          "5. If a failure reveals a fixable bug, create a follow-up task — don't fix inline",
          "6. Close with a summary of learnings extracted",
        ].join("\n"),
        skills: '["arc-failure-triage"]',
        priority: 7,
        model: "sonnet",
        source: retroSource,
      });

      created++;
    }
  }

  return created > 0 ? `ok: created ${created} task(s)` : "ok";
}
