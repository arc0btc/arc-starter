// arc-dispatch-eval/sensor.ts
//
// Post-dispatch evaluation sensor. Reviews recently completed tasks,
// scores them on result quality, cost efficiency, and convention adherence.
// Creates improvement tasks when multiple low-scoring tasks are detected.

import {
  claimSensorRun,
  createSensorLogger,
  pendingTaskExistsForSource,
  insertTask,
} from "../../src/sensors.ts";
import { getDatabase } from "../../src/db.ts";
import type { Task } from "../../src/db.ts";

const SENSOR_NAME = "arc-dispatch-eval";
const INTERVAL_MINUTES = 480; // 8 hours — quality review, not urgent
const LOOKBACK_HOURS = 4;
const FLAG_THRESHOLD = 2; // min flagged tasks to create improvement task
const LOW_SCORE_CUTOFF = 2; // total score ≤ this gets flagged

const log = createSensorLogger(SENSOR_NAME);

// ---- Cost ceilings by priority tier ----

function costCeiling(priority: number): number {
  if (priority <= 4) return 1.0; // opus tier
  if (priority <= 7) return 0.5; // sonnet tier
  return 0.25; // haiku tier
}

// ---- Expected model for priority ----

function expectedModel(priority: number): string {
  if (priority <= 4) return "opus";
  if (priority <= 7) return "sonnet";
  return "haiku";
}

// ---- Generic result patterns ----

const GENERIC_PATTERNS = [
  /^completed\.?$/i,
  /^done\.?$/i,
  /^ok\.?$/i,
  /^finished\.?$/i,
  /^task completed\.?$/i,
  /^success\.?$/i,
  /^marked as completed\.?$/i,
];

function isGenericSummary(summary: string): boolean {
  const trimmed = summary.trim();
  return GENERIC_PATTERNS.some((p) => p.test(trimmed));
}

// ---- Scoring functions ----

interface TaskScore {
  task: Task;
  resultQuality: number;
  costEfficiency: number;
  conventionAdherence: number;
  total: number;
  notes: string[];
}

function scoreResultQuality(task: Task): { score: number; note: string } {
  const summary = task.result_summary;
  if (!summary || summary.trim().length === 0) {
    return { score: 0, note: "missing result_summary" };
  }
  if (isGenericSummary(summary)) {
    return { score: 0, note: `generic summary: "${summary.trim()}"` };
  }
  if (summary.trim().length < 50) {
    return { score: 1, note: "short summary (<50 chars)" };
  }
  return { score: 2, note: "" };
}

function scoreCostEfficiency(task: Task): { score: number; note: string } {
  const cost = task.cost_usd ?? 0;
  if (cost === 0) {
    // Zero cost is suspicious but not necessarily bad (fast tasks)
    return { score: 2, note: "" };
  }
  const ceiling = costCeiling(task.priority ?? 5);
  if (cost > ceiling * 2) {
    return { score: 0, note: `cost $${cost.toFixed(2)} > 2× ceiling $${ceiling.toFixed(2)}` };
  }
  if (cost > ceiling) {
    return { score: 1, note: `cost $${cost.toFixed(2)} > ceiling $${ceiling.toFixed(2)}` };
  }
  return { score: 2, note: "" };
}

function scoreConventionAdherence(task: Task): { score: number; note: string } {
  const priority = task.priority ?? 5;
  const model = (task as Record<string, unknown>).model as string | null;
  const skills = task.skills;
  const expected = expectedModel(priority);

  let issues = 0;
  const notes: string[] = [];

  // Model mismatch (only flag if model was explicitly set to wrong tier)
  if (model && model !== expected) {
    // Allow opus for anything (overqualified but not wrong)
    if (model !== "opus") {
      issues++;
      notes.push(`model "${model}" vs expected "${expected}" for P${priority}`);
    }
  }

  // Missing skills (tasks without skills get no context scoping)
  if (!skills || skills === "[]" || skills === "null") {
    issues++;
    notes.push("no skills specified");
  }

  if (issues >= 2) return { score: 0, note: notes.join("; ") };
  if (issues === 1) return { score: 1, note: notes.join("; ") };
  return { score: 2, note: "" };
}

function scoreTask(task: Task): TaskScore {
  const rq = scoreResultQuality(task);
  const ce = scoreCostEfficiency(task);
  const ca = scoreConventionAdherence(task);

  const notes = [rq.note, ce.note, ca.note].filter((n) => n.length > 0);

  return {
    task,
    resultQuality: rq.score,
    costEfficiency: ce.score,
    conventionAdherence: ca.score,
    total: rq.score + ce.score + ca.score,
    notes,
  };
}

// ---- Sensor entry point ----

export default async function dispatchEvalSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const db = getDatabase();

  // Fetch recently completed tasks
  const completedTasks = db
    .query(
      `SELECT * FROM tasks
       WHERE status = 'completed'
         AND completed_at IS NOT NULL
         AND datetime(completed_at) >= datetime('now', ?)
       ORDER BY completed_at DESC`,
    )
    .all(`-${LOOKBACK_HOURS} hours`) as Task[];

  if (completedTasks.length === 0) {
    log("no completed tasks in lookback window");
    return "ok";
  }

  // Score all tasks
  const scores = completedTasks.map(scoreTask);
  const flagged = scores.filter((s) => s.total <= LOW_SCORE_CUTOFF);

  log(`evaluated ${scores.length} tasks, ${flagged.length} flagged (score ≤${LOW_SCORE_CUTOFF})`);

  if (flagged.length < FLAG_THRESHOLD) return "ok";

  // Check dedup — one improvement task per evaluation window
  const now = new Date();
  const windowKey = `${now.toISOString().slice(0, 10)}T${String(Math.floor(now.getUTCHours() / 4) * 4).padStart(2, "0")}`;
  const source = `sensor:arc-dispatch-eval:${windowKey}`;

  if (pendingTaskExistsForSource(source)) {
    log("improvement task already pending for this window");
    return "ok";
  }

  // Build improvement task description
  const listing = flagged
    .slice(0, 10)
    .map((s) => {
      const model = (s.task as Record<string, unknown>).model as string | null;
      return [
        `- **#${s.task.id}** (P${s.task.priority ?? 5}, ${model ?? "default"}): score ${s.total}/6`,
        `  Subject: ${s.task.subject}`,
        s.notes.length > 0 ? `  Issues: ${s.notes.join("; ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  // Compute aggregate stats
  const avgScore = scores.reduce((sum, s) => sum + s.total, 0) / scores.length;
  const avgCost = completedTasks.reduce((sum, t) => sum + (t.cost_usd ?? 0), 0) / completedTasks.length;

  insertTask({
    subject: `dispatch eval: ${flagged.length}/${scores.length} tasks scored low (avg ${avgScore.toFixed(1)}/6)`,
    description: [
      `## Post-Dispatch Evaluation — ${windowKey}`,
      "",
      `**Window:** last ${LOOKBACK_HOURS} hours | **Evaluated:** ${scores.length} tasks`,
      `**Average score:** ${avgScore.toFixed(1)}/6 | **Average cost:** $${avgCost.toFixed(3)}`,
      `**Flagged (score ≤${LOW_SCORE_CUTOFF}):** ${flagged.length}`,
      "",
      "### Flagged Tasks",
      listing,
      flagged.length > 10 ? `\n... and ${flagged.length - 10} more` : "",
      "",
      "### Scoring Guide",
      "Each dimension 0–2 (bad/ok/good). Total 0–6.",
      "- **Result quality:** summary exists, substantive, not generic",
      "- **Cost efficiency:** within tier ceiling (P1-4: $1, P5-7: $0.50, P8+: $0.25)",
      "- **Convention adherence:** correct model for priority, skills specified",
      "",
      "### Instructions",
      "1. Review each flagged task — is the low score warranted or a false positive?",
      "2. For result quality issues: identify tasks/skills that need better completion reporting",
      "3. For cost issues: check if the task was mis-prioritized or if the work genuinely needed more tokens",
      "4. For convention issues: check if task creators are forgetting --skills or --model flags",
      "5. Create targeted follow-up tasks for systemic issues (e.g., sensor creating tasks without skills)",
      "6. Update scoring thresholds in sensor.ts if false positive rate is too high",
    ].join("\n"),
    skills: '["arc-dispatch-eval"]',
    priority: 7,
    model: "sonnet",
    source,
  });

  log(`created improvement task: ${flagged.length} flagged tasks`);
  return `ok: ${flagged.length}/${scores.length} flagged`;
}
