/**
 * github-interceptor sensor
 *
 * Worker-only. Detects tasks blocked on GitHub credentials and auto-routes
 * them to Arc via fleet-handoff. On Arc, this is a no-op.
 *
 * Fixes the recurring pattern where workers create blocked escalations
 * for GitHub PAT/SSH credentials instead of handing off to Arc.
 */

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { getDatabase, recentTaskExistsForSourcePrefix } from "../../src/db.ts";
import { AGENT_NAME } from "../../src/identity.ts";

const SENSOR_NAME = "github-interceptor";
const INTERVAL_MINUTES = 10;

/** Patterns that indicate a GitHub credential blocker */
const GITHUB_PATTERNS = [
  "github",
  "git push",
  "git clone",
  "PAT",
  "personal access token",
  "SSH key",
  "github credential",
  "github token",
  "gh auth",
  "GITHUB_TOKEN",
];

const PATTERN_RE = new RegExp(GITHUB_PATTERNS.join("|"), "i");

/** Patterns for pending tasks — catch credential requests, escalations, AND GitHub operations */
const CREDENTIAL_REQUEST_RE = /credential|request.*(?:PAT|token|access)|escalat.*github|need.*github.*(?:access|token|credential)|obtain.*(?:PAT|token)|git\s*push|create.*PR|open.*PR|merge.*PR|pull request|gh\s+(?:pr|issue|auth|repo)/i;

interface BlockedTask {
  id: number;
  subject: string;
  description: string | null;
  result_summary: string | null;
  skills: string | null;
  priority: number;
  status: string;
}

export default async function githubInterceptorSensor(): Promise<string> {
  // Arc owns GitHub — this sensor only runs on workers
  if (AGENT_NAME === "arc0") return "skip";

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const log = createSensorLogger(SENSOR_NAME);
  const db = getDatabase();

  // Find blocked OR pending tasks that mention GitHub/credentials.
  // Forge dispatch creates pending escalation tasks requesting creds
  // instead of setting blocked — we must catch both statuses.
  const githubTasks = db
    .query(
      `SELECT id, subject, description, result_summary, skills, priority, status
       FROM tasks
       WHERE status IN ('blocked', 'pending')
       ORDER BY id DESC
       LIMIT 50`
    )
    .all() as BlockedTask[];

  if (githubTasks.length === 0) return "ok";

  let intercepted = 0;

  for (const task of githubTasks) {
    const searchText = [
      task.subject,
      task.description ?? "",
      task.result_summary ?? "",
    ].join(" ");

    if (!PATTERN_RE.test(searchText)) continue;

    // For pending tasks, require a stricter credential-request pattern
    // to avoid intercepting legitimate pending tasks that just mention GitHub
    if (task.status === "pending" && !CREDENTIAL_REQUEST_RE.test(searchText)) continue;

    // Dedup: skip if this task was already handed off recently (guards against
    // re-routing when fleet-handoff succeeded but local task close failed)
    if (recentTaskExistsForSourcePrefix(`sensor:${SENSOR_NAME}:task:${task.id}`, 120)) {
      log(`Task #${task.id} already intercepted recently, skipping`);
      continue;
    }

    log(`Intercepted GitHub task #${task.id} (${task.status}): ${task.subject}`);

    // Route to Arc via fleet-handoff
    const progress = task.result_summary ?? "Task blocked on GitHub credentials";
    const remaining = `Complete the GitHub operation: ${task.subject}`;

    const handoff = Bun.spawnSync({
      cmd: [
        "bash", "bin/arc", "skills", "run", "--name", "fleet-handoff", "--",
        "initiate",
        "--agent", "arc",
        "--task-id", String(task.id),
        "--progress", progress,
        "--remaining", remaining,
        "--reason", "GitHub is Arc-only (auto-intercepted by github-interceptor sensor)",
      ],
      cwd: import.meta.dir.replace(/\/skills\/github-interceptor$/, ""),
      stdout: "pipe",
      stderr: "pipe",
    });

    if (handoff.exitCode === 0) {
      // Close the local task as completed
      db.query(
        `UPDATE tasks SET status = 'completed',
         result_summary = 'Auto-routed to Arc via github-interceptor (GitHub is Arc-only)',
         completed_at = datetime('now')
         WHERE id = ?`
      ).run(task.id);
      // Record interception so the dedup check fires if the task somehow resurfaces
      db.query(
        `INSERT INTO tasks (subject, source, priority, status, completed_at)
         VALUES (?, ?, 9, 'completed', datetime('now'))`
      ).run(
        `[intercepted] GitHub task #${task.id} routed to Arc`,
        `sensor:${SENSOR_NAME}:task:${task.id}`
      );
      intercepted++;
      log(`Handed off task #${task.id} to Arc`);
    } else {
      const stderr = handoff.stderr.toString().trim();
      log(`Fleet-handoff failed for task #${task.id}: ${stderr}`);
      // Don't block on handoff failure — task stays blocked, will retry next cycle
    }
  }

  return intercepted > 0 ? `intercepted ${intercepted} task(s)` : "ok";
}
