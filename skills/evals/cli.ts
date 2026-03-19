#!/usr/bin/env bun

// evals/cli.ts
//
// Dispatch quality evaluation: error analysis, human labeling, LLM judges, calibration.
// Adapted from hamelsmu/evals-skills methodology.
//
// Usage: arc skills run --name evals -- <subcommand>

import { Database } from "bun:sqlite";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const DB_PATH = join(ROOT, "db/arc.sqlite");

// ---- Types ----

interface TaskTrace {
  id: number;
  subject: string;
  description: string | null;
  skills: string | null;
  priority: number;
  status: string;
  source: string | null;
  result_summary: string | null;
  result_detail: string | null;
  cost_usd: number;
  tokens_in: number;
  tokens_out: number;
  model: string | null;
  created_at: string;
  completed_at: string | null;
  attempt_count: number;
  duration_ms: number | null;
  cycle_cost: number | null;
  cycle_model: string | null;
}

interface EvalLabel {
  id: number;
  task_id: number;
  category: string;
  pass: number; // 1 = pass, 0 = fail
  notes: string | null;
  labeled_at: string;
}

interface EvalJudge {
  id: number;
  category: string;
  prompt: string;
  few_shot_ids: string | null; // JSON array of task IDs used as examples
  created_at: string;
  updated_at: string;
}

interface FailureCategory {
  name: string;
  count: number;
  rate: number;
  examples: number[];
}

// ---- DB helpers ----

function getDb(): Database {
  const db = new Database(DB_PATH);
  db.run("PRAGMA busy_timeout = 5000");
  ensureEvalTables(db);
  return db;
}

function ensureEvalTables(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS eval_labels (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      pass INTEGER NOT NULL,
      notes TEXT,
      labeled_at TEXT DEFAULT (datetime('now')),
      UNIQUE(task_id, category),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_eval_labels_category ON eval_labels(category)");
  db.run("CREATE INDEX IF NOT EXISTS idx_eval_labels_task ON eval_labels(task_id)");

  db.run(`
    CREATE TABLE IF NOT EXISTS eval_judges (
      id INTEGER PRIMARY KEY,
      category TEXT UNIQUE NOT NULL,
      prompt TEXT NOT NULL,
      few_shot_ids TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

// ---- Parse flags ----

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    }
  }
  return flags;
}

// ---- Error Analysis ----

function cmdErrorAnalysis(args: string[]): void {
  const flags = parseFlags(args);
  const limit = Number(flags["limit"]) || 100;
  const statusFilter = (flags["status"] as string) || "completed,failed";
  const statuses = statusFilter.split(",").map((s) => s.trim());

  const db = getDb();

  // Query task traces joined with cycle_log
  const placeholders = statuses.map(() => "?").join(",");
  const traces = db
    .query(
      `SELECT
        t.id, t.subject, t.description, t.skills, t.priority, t.status,
        t.source, t.result_summary, t.result_detail,
        t.cost_usd, t.tokens_in, t.tokens_out, t.model,
        t.created_at, t.completed_at, t.attempt_count,
        c.duration_ms, c.cost_usd as cycle_cost, c.model as cycle_model
      FROM tasks t
      LEFT JOIN cycle_log c ON c.task_id = t.id
      WHERE t.status IN (${placeholders})
      ORDER BY t.id DESC
      LIMIT ?`
    )
    .all(...statuses, limit) as TaskTrace[];

  const total = traces.length;
  const failed = traces.filter((t) => t.status === "failed");
  const completed = traces.filter((t) => t.status === "completed");

  // Auto-categorize observed failure patterns
  const categories = new Map<string, number[]>();

  for (const trace of traces) {
    const cats = categorizeTrace(trace);
    for (const cat of cats) {
      if (!categories.has(cat)) categories.set(cat, []);
      categories.get(cat)!.push(trace.id);
    }
  }

  // Sort by frequency
  const sorted: FailureCategory[] = Array.from(categories.entries())
    .map(([name, ids]) => ({
      name,
      count: ids.length,
      rate: ids.length / total,
      examples: ids.slice(0, 5),
    }))
    .sort((a, b) => b.count - a.count);

  // Output
  process.stdout.write(`\n# Error Analysis Report\n\n`);
  process.stdout.write(`Analyzed ${total} traces (${completed.length} completed, ${failed.length} failed)\n`);
  process.stdout.write(`Overall failure rate: ${((failed.length / total) * 100).toFixed(1)}%\n\n`);

  // Cost stats
  const costs = traces.filter((t) => t.cost_usd > 0).map((t) => t.cost_usd);
  if (costs.length > 0) {
    const avgCost = costs.reduce((a, b) => a + b, 0) / costs.length;
    const maxCost = Math.max(...costs);
    const minCost = Math.min(...costs);
    process.stdout.write(`Cost: avg=$${avgCost.toFixed(3)}, min=$${minCost.toFixed(3)}, max=$${maxCost.toFixed(3)}\n\n`);
  }

  // Duration stats
  const durations = traces.filter((t) => t.duration_ms != null && t.duration_ms > 0).map((t) => t.duration_ms!);
  if (durations.length > 0) {
    durations.sort((a, b) => a - b);
    const median = durations[Math.floor(durations.length / 2)];
    const p95 = durations[Math.floor(durations.length * 0.95)];
    process.stdout.write(`Duration: median=${(median / 1000).toFixed(0)}s, p95=${(p95 / 1000).toFixed(0)}s\n\n`);
  }

  // Failure categories
  process.stdout.write(`## Failure Categories (${sorted.length} detected)\n\n`);
  process.stdout.write(`| Category | Count | Rate | Example Task IDs |\n`);
  process.stdout.write(`|----------|-------|------|------------------|\n`);
  for (const cat of sorted) {
    process.stdout.write(
      `| ${cat.name} | ${cat.count} | ${(cat.rate * 100).toFixed(1)}% | ${cat.examples.join(", ")} |\n`
    );
  }
  process.stdout.write(`\n`);

  // Actionable recommendations
  process.stdout.write(`## Recommendations\n\n`);
  for (const cat of sorted.slice(0, 5)) {
    const action = recommendAction(cat.name);
    process.stdout.write(`- **${cat.name}** (${cat.count}x): ${action}\n`);
  }
  process.stdout.write(`\n`);

  // Show uncategorized traces
  const categorizedIds = new Set(Array.from(categories.values()).flat());
  const uncategorized = traces.filter((t) => !categorizedIds.has(t.id));
  if (uncategorized.length > 0) {
    process.stdout.write(`## Uncategorized Traces (${uncategorized.length})\n\n`);
    for (const t of uncategorized.slice(0, 10)) {
      process.stdout.write(`- Task #${t.id} [${t.status}]: ${t.subject.slice(0, 80)}\n`);
      if (t.result_summary) {
        process.stdout.write(`  Summary: ${t.result_summary.slice(0, 120)}\n`);
      }
    }
    process.stdout.write(`\n`);
  }

  db.close();
}

function categorizeTrace(trace: TaskTrace): string[] {
  const cats: string[] = [];
  const summary = (trace.result_summary || "").toLowerCase();
  const subject = trace.subject.toLowerCase();

  // Crash recovery
  if (summary.includes("crash recovery") || summary.includes("left active from a previous cycle")) {
    cats.push("crash-recovery");
  }

  // Rate limiting
  if (summary.includes("rate-limit") || summary.includes("rate limit") || summary.includes("429")) {
    cats.push("rate-limited");
  }

  // Duplicate/dedup
  if (summary.includes("duplicate") || summary.includes("already") || summary.includes("dedup")) {
    cats.push("duplicate-task");
  }

  // Permission/auth errors
  if (summary.includes("403") || summary.includes("401") || summary.includes("permission") ||
      summary.includes("restricted") || summary.includes("denied")) {
    cats.push("auth-error");
  }

  // Timeout / long-running
  if (trace.duration_ms != null && trace.duration_ms > 25 * 60 * 1000) {
    cats.push("near-timeout");
  }

  // High cost outlier (>3x average)
  if (trace.cost_usd > 1.5) {
    cats.push("high-cost");
  }

  // Low-value completion (cost > 0 but trivial result)
  if (trace.status === "completed" && trace.cost_usd > 0.3 &&
      trace.result_summary && trace.result_summary.length < 30) {
    cats.push("low-value-completion");
  }

  // Sensor spam (multiple tasks from same sensor prefix in subject)
  if (summary.includes("artifact") || summary.includes("not a real task")) {
    cats.push("sensor-spam");
  }

  // Scope creep (task failed with partial completion)
  if (trace.status === "failed" && summary.includes("partial")) {
    cats.push("partial-failure");
  }

  // Blocked tasks
  if (trace.status === "failed" && (summary.includes("blocked") || summary.includes("awaiting"))) {
    cats.push("blocked-dependency");
  }

  // Retry exhaustion
  if (trace.attempt_count >= 3) {
    cats.push("retry-exhaustion");
  }

  // Empty/no result
  if (trace.status === "completed" && (!trace.result_summary || trace.result_summary.trim() === "")) {
    cats.push("empty-result");
  }

  return cats;
}

function recommendAction(category: string): string {
  const actions: Record<string, string> = {
    "crash-recovery": "Fix dispatch stability — investigate why sessions are dying mid-task. Check timeout settings and memory limits.",
    "rate-limited": "Implement backoff in sensor scheduling. Add rate-limit awareness to API-calling skills.",
    "duplicate-task": "Strengthen dedup gates in sensors. Use pendingTaskExistsForSource() before insertTask().",
    "auth-error": "Stop retrying on 401/403. Fail immediately and escalate. Check credential freshness.",
    "near-timeout": "Break large tasks into subtasks. Set tighter scope in task descriptions.",
    "high-cost": "Review task scoping. Consider if Haiku could handle these tasks. Check for context bloat.",
    "low-value-completion": "Task completed but produced little value. Tighten task acceptance criteria.",
    "sensor-spam": "Fix sensor dedup logic. Sensors should check for existing pending tasks before creating new ones.",
    "partial-failure": "Task partially completed then failed. Consider checkpointing or breaking into smaller subtasks.",
    "blocked-dependency": "Improve dependency detection. Don't queue tasks when prerequisites aren't met.",
    "retry-exhaustion": "Task retried 3+ times and still failing. Investigate root cause instead of retrying.",
    "empty-result": "Task marked completed but has no result summary. Improve dispatch result capture.",
  };
  return actions[category] || "Investigate traces manually to determine fix.";
}

// ---- Summary ----

function cmdSummary(): void {
  const db = getDb();

  const totalTasks = (db.query("SELECT COUNT(*) as c FROM tasks").get() as { c: number }).c;
  const completed = (db.query("SELECT COUNT(*) as c FROM tasks WHERE status = 'completed'").get() as { c: number }).c;
  const failed = (db.query("SELECT COUNT(*) as c FROM tasks WHERE status = 'failed'").get() as { c: number }).c;
  const pending = (db.query("SELECT COUNT(*) as c FROM tasks WHERE status = 'pending'").get() as { c: number }).c;
  const totalCycles = (db.query("SELECT COUNT(*) as c FROM cycle_log").get() as { c: number }).c;
  const labelCount = (db.query("SELECT COUNT(*) as c FROM eval_labels").get() as { c: number }).c;
  const judgeCount = (db.query("SELECT COUNT(*) as c FROM eval_judges").get() as { c: number }).c;

  // Category distribution from labels
  const labelCats = db
    .query(
      `SELECT category,
              COUNT(*) as total,
              SUM(pass) as passes,
              COUNT(*) - SUM(pass) as fails
       FROM eval_labels GROUP BY category ORDER BY total DESC`
    )
    .all() as Array<{ category: string; total: number; passes: number; fails: number }>;

  // Cost by model tier (last 7 days)
  const modelCosts = db
    .query(
      `SELECT
        COALESCE(model, 'unknown') as model,
        COUNT(*) as tasks,
        ROUND(AVG(cost_usd), 3) as avg_cost,
        ROUND(SUM(cost_usd), 2) as total_cost
      FROM cycle_log
      WHERE started_at > datetime('now', '-7 days') AND cost_usd > 0
      GROUP BY model ORDER BY total_cost DESC`
    )
    .all() as Array<{ model: string; tasks: number; avg_cost: number; total_cost: number }>;

  // Success rate by priority band
  const priorityBands = db
    .query(
      `SELECT
        CASE
          WHEN priority <= 4 THEN 'P1-4 (Opus)'
          WHEN priority <= 7 THEN 'P5-7 (Sonnet)'
          ELSE 'P8+ (Haiku)'
        END as band,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM tasks
      WHERE status IN ('completed', 'failed')
      GROUP BY band ORDER BY band`
    )
    .all() as Array<{ band: string; total: number; completed: number; failed: number }>;

  process.stdout.write(`\n# Evals Summary\n\n`);
  process.stdout.write(`## Pipeline\n\n`);
  process.stdout.write(`- Tasks: ${totalTasks} total (${completed} completed, ${failed} failed, ${pending} pending)\n`);
  process.stdout.write(`- Cycles: ${totalCycles}\n`);
  process.stdout.write(`- Labels: ${labelCount}\n`);
  process.stdout.write(`- Judges: ${judgeCount}\n`);
  process.stdout.write(`- Overall success rate: ${((completed / (completed + failed)) * 100).toFixed(1)}%\n\n`);

  if (priorityBands.length > 0) {
    process.stdout.write(`## Success Rate by Priority Band\n\n`);
    process.stdout.write(`| Band | Total | Completed | Failed | Success Rate |\n`);
    process.stdout.write(`|------|-------|-----------|--------|-------------|\n`);
    for (const b of priorityBands) {
      const rate = b.total > 0 ? ((b.completed / b.total) * 100).toFixed(1) : "N/A";
      process.stdout.write(`| ${b.band} | ${b.total} | ${b.completed} | ${b.failed} | ${rate}% |\n`);
    }
    process.stdout.write(`\n`);
  }

  if (modelCosts.length > 0) {
    process.stdout.write(`## Cost by Model (Last 7 Days)\n\n`);
    process.stdout.write(`| Model | Cycles | Avg Cost | Total Cost |\n`);
    process.stdout.write(`|-------|--------|----------|------------|\n`);
    for (const m of modelCosts) {
      process.stdout.write(`| ${m.model} | ${m.tasks} | $${m.avg_cost} | $${m.total_cost} |\n`);
    }
    process.stdout.write(`\n`);
  }

  if (labelCats.length > 0) {
    process.stdout.write(`## Label Distribution\n\n`);
    process.stdout.write(`| Category | Labels | Pass | Fail | Pass Rate |\n`);
    process.stdout.write(`|----------|--------|------|------|----------|\n`);
    for (const lc of labelCats) {
      const rate = lc.total > 0 ? ((lc.passes / lc.total) * 100).toFixed(1) : "N/A";
      process.stdout.write(`| ${lc.category} | ${lc.total} | ${lc.passes} | ${lc.fails} | ${rate}% |\n`);
    }
    process.stdout.write(`\n`);
  }

  db.close();
}

// ---- Label ----

function cmdLabel(args: string[]): void {
  const flags = parseFlags(args);
  const taskId = Number(flags["task-id"]);
  const pass = flags["pass"] === true;
  const fail = flags["fail"] === true;
  const category = flags["category"] as string;
  const notes = (flags["notes"] as string) || null;

  if (!taskId || isNaN(taskId)) {
    process.stderr.write("Error: --task-id is required\n");
    process.exit(1);
  }
  if (!pass && !fail) {
    process.stderr.write("Error: --pass or --fail is required\n");
    process.exit(1);
  }
  if (pass && fail) {
    process.stderr.write("Error: cannot specify both --pass and --fail\n");
    process.exit(1);
  }
  if (!category) {
    process.stderr.write("Error: --category is required\n");
    process.exit(1);
  }

  const db = getDb();

  // Verify task exists
  const task = db.query("SELECT id, subject FROM tasks WHERE id = ?").get(taskId) as { id: number; subject: string } | null;
  if (!task) {
    process.stderr.write(`Error: task #${taskId} not found\n`);
    process.exit(1);
  }

  // Upsert label
  db.query(
    `INSERT INTO eval_labels (task_id, category, pass, notes)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(task_id, category) DO UPDATE SET
       pass = excluded.pass,
       notes = excluded.notes,
       labeled_at = datetime('now')`
  ).run(taskId, category, pass ? 1 : 0, notes);

  const verdict = pass ? "PASS" : "FAIL";
  process.stdout.write(`Labeled task #${taskId} [${category}] = ${verdict}\n`);
  process.stdout.write(`  Subject: ${task.subject.slice(0, 80)}\n`);
  if (notes) process.stdout.write(`  Notes: ${notes}\n`);

  db.close();
}

// ---- Labels list ----

function cmdLabels(args: string[]): void {
  const flags = parseFlags(args);
  const category = flags["category"] as string | undefined;

  const db = getDb();

  let labels: EvalLabel[];
  if (category) {
    labels = db
      .query("SELECT * FROM eval_labels WHERE category = ? ORDER BY labeled_at DESC")
      .all(category) as EvalLabel[];
  } else {
    labels = db
      .query("SELECT * FROM eval_labels ORDER BY category, labeled_at DESC")
      .all() as EvalLabel[];
  }

  if (labels.length === 0) {
    process.stdout.write("No labels found. Use `evals label --task-id N --pass|--fail --category CAT` to add labels.\n");
    db.close();
    return;
  }

  process.stdout.write(`\n# Eval Labels (${labels.length})\n\n`);
  process.stdout.write(`| Task | Category | Verdict | Notes | Labeled At |\n`);
  process.stdout.write(`|------|----------|---------|-------|------------|\n`);
  for (const l of labels) {
    const verdict = l.pass ? "PASS" : "FAIL";
    process.stdout.write(`| #${l.task_id} | ${l.category} | ${verdict} | ${(l.notes || "-").slice(0, 40)} | ${l.labeled_at} |\n`);
  }
  process.stdout.write(`\n`);

  db.close();
}

// ---- Judge ----

async function cmdJudge(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const taskId = Number(flags["task-id"]);
  const category = flags["category"] as string;

  if (!category) {
    // List existing judges
    const db = getDb();
    const judges = db.query("SELECT * FROM eval_judges ORDER BY category").all() as EvalJudge[];
    if (judges.length === 0) {
      process.stdout.write("No judges defined. Create one with:\n");
      process.stdout.write("  evals judge --category <name> --create --prompt-file <path>\n");
    db.close();
      return;
    }
    process.stdout.write(`\n# Eval Judges (${judges.length})\n\n`);
    for (const j of judges) {
      const fewShot = j.few_shot_ids ? JSON.parse(j.few_shot_ids).length : 0;
      process.stdout.write(`- **${j.category}**: ${fewShot} few-shot examples, updated ${j.updated_at}\n`);
    }
    process.stdout.write(`\n`);
    db.close();
    return;
  }

  if (flags["create"]) {
    const promptFile = flags["prompt-file"] as string;
    if (!promptFile) {
      process.stderr.write("Error: --prompt-file is required with --create\n");
      process.exit(1);
    }
    const prompt = await Bun.file(promptFile).text();
    const db = getDb();
    db.query(
      `INSERT INTO eval_judges (category, prompt)
       VALUES (?, ?)
       ON CONFLICT(category) DO UPDATE SET
         prompt = excluded.prompt,
         updated_at = datetime('now')`
    ).run(category, prompt);
    process.stdout.write(`Judge created/updated for category: ${category}\n`);
    db.close();
    return;
  }

  if (!taskId || isNaN(taskId)) {
    // Show judge details for this category
    const db = getDb();
    const judge = db.query("SELECT * FROM eval_judges WHERE category = ?").get(category) as EvalJudge | null;
    if (!judge) {
      process.stdout.write(`No judge defined for category: ${category}\n`);
      process.stdout.write(`Create one with: evals judge --category ${category} --create --prompt-file <path>\n`);
    } else {
      process.stdout.write(`\n# Judge: ${category}\n\n`);
      process.stdout.write(`Created: ${judge.created_at}\n`);
      process.stdout.write(`Updated: ${judge.updated_at}\n`);
      if (judge.few_shot_ids) {
        process.stdout.write(`Few-shot task IDs: ${judge.few_shot_ids}\n`);
      }
      process.stdout.write(`\n## Prompt\n\n${judge.prompt}\n`);
    }
    db.close();
    return;
  }

  // Run judge on a specific task
  const db = getDb();
  const judge = db.query("SELECT * FROM eval_judges WHERE category = ?").get(category) as EvalJudge | null;
  if (!judge) {
    process.stderr.write(`Error: no judge defined for category '${category}'. Create one first.\n`);
    process.exit(1);
  }

  const task = db.query("SELECT * FROM tasks WHERE id = ?").get(taskId) as TaskTrace | null;
  if (!task) {
    process.stderr.write(`Error: task #${taskId} not found\n`);
    process.exit(1);
  }

  // Output the judge input for manual or LLM evaluation
  process.stdout.write(`\n# Judge Evaluation: ${category} → Task #${taskId}\n\n`);
  process.stdout.write(`## Task Context\n\n`);
  process.stdout.write(`- Subject: ${task.subject}\n`);
  process.stdout.write(`- Status: ${task.status}\n`);
  process.stdout.write(`- Priority: ${task.priority}\n`);
  if (task.description) process.stdout.write(`- Description: ${task.description.slice(0, 200)}\n`);
  if (task.result_summary) process.stdout.write(`- Result: ${task.result_summary}\n`);
  process.stdout.write(`\n## Judge Prompt\n\n${judge.prompt}\n\n`);
  process.stdout.write(`## Instructions\n\n`);
  process.stdout.write(`Feed the task context above into the judge prompt via LLM to get a PASS/FAIL verdict.\n`);
  process.stdout.write(`Then record the label: evals label --task-id ${taskId} --pass|--fail --category ${category}\n`);

  db.close();
}

// ---- Validate ----

function cmdValidate(args: string[]): void {
  const flags = parseFlags(args);
  const category = flags["category"] as string;

  if (!category) {
    process.stderr.write("Error: --category is required\n");
    process.exit(1);
  }

  const db = getDb();

  // Get all labels for this category
  const labels = db
    .query("SELECT * FROM eval_labels WHERE category = ? ORDER BY task_id")
    .all(category) as EvalLabel[];

  if (labels.length < 20) {
    process.stdout.write(`Only ${labels.length} labels for '${category}'. Need at least 20 (ideally 40+) for validation.\n`);
    process.stdout.write(`Label more tasks with: evals label --task-id N --pass|--fail --category ${category}\n`);
    db.close();
    return;
  }

  const passes = labels.filter((l) => l.pass === 1);
  const fails = labels.filter((l) => l.pass === 0);

  process.stdout.write(`\n# Validation Report: ${category}\n\n`);
  process.stdout.write(`## Label Distribution\n\n`);
  process.stdout.write(`- Total labels: ${labels.length}\n`);
  process.stdout.write(`- Pass: ${passes.length} (${((passes.length / labels.length) * 100).toFixed(1)}%)\n`);
  process.stdout.write(`- Fail: ${fails.length} (${((fails.length / labels.length) * 100).toFixed(1)}%)\n\n`);

  if (passes.length < 10 || fails.length < 10) {
    process.stdout.write(`WARNING: Imbalanced labels. Need ~50/50 split for reliable calibration.\n`);
    process.stdout.write(`Currently: ${passes.length} pass, ${fails.length} fail. Label more ${passes.length < fails.length ? "pass" : "fail"} examples.\n\n`);
  }

  // Suggest data splits
  const testSize = Math.floor(labels.length * 0.4);
  const trainSize = Math.floor(labels.length * 0.15);
  const devSize = labels.length - testSize - trainSize;

  process.stdout.write(`## Recommended Splits\n\n`);
  process.stdout.write(`| Split | Size | Purpose |\n`);
  process.stdout.write(`|-------|------|---------|\n`);
  process.stdout.write(`| Train | ${trainSize} | Few-shot examples in judge prompt |\n`);
  process.stdout.write(`| Dev | ${devSize} | Iterative judge refinement |\n`);
  process.stdout.write(`| Test | ${testSize} | Final TPR/TNR measurement (use once) |\n\n`);

  process.stdout.write(`## Next Steps\n\n`);
  process.stdout.write(`1. Create a judge prompt: evals judge --category ${category} --create --prompt-file <path>\n`);
  process.stdout.write(`2. Run judge on dev set tasks and compare to human labels\n`);
  process.stdout.write(`3. Compute TPR = (judge pass ∩ human pass) / (human pass)\n`);
  process.stdout.write(`4. Compute TNR = (judge fail ∩ human fail) / (human fail)\n`);
  process.stdout.write(`5. Target: TPR > 90% AND TNR > 90%\n`);
  process.stdout.write(`6. If both met, run once on test set for final measurement\n\n`);

  // Bias correction formula
  process.stdout.write(`## Rogan-Gladen Bias Correction\n\n`);
  process.stdout.write(`When reporting aggregate pass rate on unlabeled production data:\n`);
  process.stdout.write(`  θ_hat = (p_obs + TNR - 1) / (TPR + TNR - 1)\n`);
  process.stdout.write(`Where p_obs = fraction judge scored as Pass on production data.\n`);

  db.close();
}

// ---- Usage ----

function printUsage(): void {
  process.stdout.write(`evals CLI — dispatch quality evaluation

USAGE
  arc skills run --name evals -- <subcommand>

SUBCOMMANDS
  error-analysis  Analyze task traces for failure patterns
    --limit N       Number of traces to analyze (default: 100)
    --status S      Comma-separated statuses (default: completed,failed)

  summary         Overview of eval pipeline state

  label           Add a human label to a task
    --task-id N     Task ID to label (required)
    --pass|--fail   Binary verdict (required)
    --category CAT  Failure category name (required)
    --notes TEXT    Optional annotation

  labels          List existing labels
    --category CAT  Filter by category

  judge           Manage/run LLM judges
    --category CAT  Judge category
    --task-id N     Task to evaluate
    --create        Create/update judge
    --prompt-file P Prompt file path (with --create)

  validate        Check calibration readiness for a category
    --category CAT  Category to validate (required)

  help            Show this help text
`);
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "error-analysis":
      cmdErrorAnalysis(args.slice(1));
      break;
    case "summary":
      cmdSummary();
      break;
    case "label":
      cmdLabel(args.slice(1));
      break;
    case "labels":
      cmdLabels(args.slice(1));
      break;
    case "judge":
      await cmdJudge(args.slice(1));
      break;
    case "validate":
      cmdValidate(args.slice(1));
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      break;
    default:
      process.stderr.write(`Error: unknown subcommand '${sub}'\n\n`);
      printUsage();
      process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
