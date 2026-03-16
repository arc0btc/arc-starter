// strategic-planner/cli.ts
//
// CLI for the strategic planner skill.
// Commands: status, trigger

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { insertTask, pendingTaskExistsForSource, getDatabase, initDatabase } from "../../src/db.ts";

const ROOT = new URL("../..", import.meta.url).pathname;
const FLEET_STATUS_FILE = join(ROOT, "memory", "fleet-status.json");
const TASK_SOURCE = "sensor:strategic-planner";

function log(msg: string): void {
  console.log(msg);
}

function readFleetStatus(): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(FLEET_STATUS_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function showStatus(): void {
  const status = readFleetStatus();
  if (!status) {
    log("fleet-status.json not found");
    process.exit(1);
  }

  log("=== Strategic Planner Status ===\n");
  log(`Idle: ${status.idle}`);
  if (status.idle && status.idle_since) {
    const idleMs = Date.now() - new Date(status.idle_since as string).getTime();
    log(`Idle since: ${status.idle_since} (${Math.round(idleMs / 60_000)}m ago)`);
  }

  const hasPending = pendingTaskExistsForSource(TASK_SOURCE);
  log(`Pending planning task: ${hasPending ? "yes" : "no"}`);

  // Show recent planning tasks
  const db = getDatabase();
  const recent = db
    .query(
      "SELECT id, status, created_at, result_summary FROM tasks WHERE source = ? ORDER BY created_at DESC LIMIT 5"
    )
    .all(TASK_SOURCE) as Array<{
    id: number;
    status: string;
    created_at: string;
    result_summary: string | null;
  }>;

  if (recent.length > 0) {
    log("\nRecent planning tasks:");
    for (const t of recent) {
      log(`  #${t.id} [${t.status}] ${t.created_at}${t.result_summary ? ` — ${t.result_summary}` : ""}`);
    }
  } else {
    log("\nNo planning tasks found yet.");
  }
}

function manualTrigger(): void {
  if (pendingTaskExistsForSource(TASK_SOURCE)) {
    log("A planning task is already pending. Skipping.");
    process.exit(0);
  }

  const taskId = insertTask({
    subject: "Strategic planner: propose directive-aligned tasks and email plan to whoabuddy",
    description: [
      "Manual trigger — review D1-D5 directives and current fleet state.",
      "Generate 3-5 high-priority strategic tasks with rationale.",
      "Email the proposed plan to whoabuddy for approval — do NOT create tasks directly.",
      "Use: arc skills run --name arc-email-sync -- send --to whoabuddy@gmail.com --subject 'Arc Strategic Plan: Proposed Tasks' --body '<plan>'",
      "Close this task after sending the email.",
    ].join("\n"),
    priority: 4,
    source: TASK_SOURCE,
    skills: JSON.stringify(["strategic-planner", "arc-email-sync"]),
  });

  log(`Created planning task #${taskId}`);
}

// ---- Main ----

const args = process.argv.slice(2);
const command = args[0];

initDatabase();

switch (command) {
  case "status":
    showStatus();
    break;
  case "trigger":
    manualTrigger();
    break;
  default:
    log("Usage: arc skills run --name strategic-planner -- <command>");
    log("Commands:");
    log("  status   — Show idle state and planner history");
    log("  trigger  — Manually create a planning task");
    process.exit(1);
}
