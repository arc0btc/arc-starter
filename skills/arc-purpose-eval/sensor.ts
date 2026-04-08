// arc-purpose-eval/sensor.ts
//
// Data-driven PURPOSE evaluation sensor. Queries tasks + cycle_log directly
// to compute scores for measurable PURPOSE dimensions (Signal Quality,
// Operational Health, Cost Efficiency, Ecosystem Impact). Generates follow-up
// tasks when scores are low.
//
// Pure TypeScript — no LLM. Scores computed from SQL, not memory summaries.

import {
  claimSensorRun,
  createSensorLogger,
  readHookState,
  writeHookState,
} from "../../src/sensors.ts";
import {
  getDatabase,
  insertTask,
  pendingTaskExistsForSource,
} from "../../src/db.ts";

const SENSOR_NAME = "arc-purpose-eval";
const INTERVAL_MINUTES = 720; // 12 hours — twice daily
const TASK_SOURCE = "sensor:arc-purpose-eval";

const log = createSensorLogger(SENSOR_NAME);

// ---- Types ----

interface PurposeScores {
  signal: number; // 1-5
  ops: number; // 1-5
  ecosystem: number; // 1-5
  cost: number; // 1-5
  weighted: number; // weighted average
}

interface EvalMetrics {
  signalCount: number;
  signalBeats: string[];
  completedCount: number;
  failedCount: number;
  successRate: number;
  costPerTask: number;
  costPerDay: number;
  prReviewCount: number;
  totalTasks: number;
}

// ---- Weights from PURPOSE.md ----

const WEIGHTS = {
  signal: 0.25,
  ops: 0.2,
  ecosystem: 0.2,
  cost: 0.15,
  // adaptation (0.10), collaboration (0.05), security (0.05) — not SQL-measurable
  // Their combined 0.20 weight is redistributed proportionally to measured dimensions
} as const;

// Normalize weights to sum to 1.0 across measured dimensions
const MEASURED_TOTAL = WEIGHTS.signal + WEIGHTS.ops + WEIGHTS.ecosystem + WEIGHTS.cost;

// ---- Data Collection ----

function collectMetrics(): EvalMetrics {
  const db = getDatabase();

  // Signal count today — match the same patterns as countSignalTasksToday()
  const signalRow = db
    .query(
      `SELECT COUNT(*) as count FROM tasks
       WHERE DATE(created_at) = DATE('now')
       AND status IN ('completed', 'pending', 'active')
       AND (
         subject LIKE 'File % signal%'
         OR subject LIKE '[MILESTONE] File % signal%'
         OR subject LIKE 'Maintain%streak%aibtc.news%'
       )`
    )
    .get() as { count: number };

  // Distinct beats from signal subjects today
  const beatRows = db
    .query(
      `SELECT DISTINCT
         CASE
           WHEN subject LIKE 'File ordinals%' OR subject LIKE '[MILESTONE] File ordinals%' THEN 'ordinals'
           WHEN subject LIKE 'File Ordinals Business%' THEN 'ordinals-business'
           WHEN subject LIKE 'File agent-trading%' OR subject LIKE '[MILESTONE] File agent-trading%' THEN 'agent-trading'
           WHEN subject LIKE 'File dev-tools%' OR subject LIKE '[MILESTONE] File dev-tools%' THEN 'dev-tools'
           WHEN subject LIKE 'File infrastructure%' OR subject LIKE '[MILESTONE] File infrastructure%' THEN 'infrastructure'
           WHEN subject LIKE 'File quantum%' OR subject LIKE '[MILESTONE] File quantum%' THEN 'quantum-computing'
           WHEN subject LIKE 'File nft-floors%' OR subject LIKE '[MILESTONE] File nft-floors%' THEN 'nft-floors'
           ELSE 'other'
         END as beat
       FROM tasks
       WHERE DATE(created_at) = DATE('now')
       AND status IN ('completed', 'pending', 'active')
       AND (
         subject LIKE 'File % signal%'
         OR subject LIKE '[MILESTONE] File % signal%'
       )`
    )
    .all() as Array<{ beat: string }>;

  // Completed + failed in last 24h
  const taskStats = db
    .query(
      `SELECT
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
       FROM tasks
       WHERE completed_at > datetime('now', '-1 day')`
    )
    .get() as { completed: number; failed: number };

  // Cost in last 24h from cycle_log
  const costStats = db
    .query(
      `SELECT
         COALESCE(SUM(cost_usd), 0) as total_cost,
         COUNT(*) as cycle_count
       FROM cycle_log
       WHERE started_at > datetime('now', '-1 day')`
    )
    .get() as { total_cost: number; cycle_count: number };

  // PR reviews completed in last 24h
  // Match subjects like "Review PR #N", "review PR", etc.
  const prRow = db
    .query(
      `SELECT COUNT(*) as count FROM tasks
       WHERE status = 'completed'
       AND completed_at > datetime('now', '-1 day')
       AND (
         subject LIKE 'Review %PR%'
         OR subject LIKE 'review %PR%'
         OR subject LIKE '%PR review%'
         OR subject LIKE '%PR %review%'
         OR subject LIKE 'Review and%PR%'
       )`
    )
    .get() as { count: number };

  const completed = taskStats.completed ?? 0;
  const failed = taskStats.failed ?? 0;
  const total = completed + failed;

  return {
    signalCount: signalRow.count,
    signalBeats: beatRows.map((r) => r.beat).filter((b) => b !== "other"),
    completedCount: completed,
    failedCount: failed,
    successRate: total > 0 ? (completed / total) * 100 : 100,
    costPerTask: total > 0 ? costStats.total_cost / total : 0,
    costPerDay: costStats.total_cost,
    prReviewCount: prRow.count,
    totalTasks: total,
  };
}

// ---- Scoring Functions (from PURPOSE.md rubric) ----

function scoreSignal(count: number, beats: string[]): number {
  const beatCount = beats.length;
  if (count >= 6 && beatCount >= 3) return 5;
  if (count >= 5 && beatCount >= 3) return 4;
  if (count >= 3 && beatCount >= 2) return 3;
  if (count >= 2) return 2;
  return 1;
}

function scoreOps(successRate: number): number {
  if (successRate >= 98) return 5;
  if (successRate >= 95) return 4;
  if (successRate >= 90) return 3;
  if (successRate >= 80) return 2;
  return 1;
}

function scoreEcosystem(prReviews: number): number {
  // PURPOSE.md: 1=<3 reviews, 2=3-5, 3=5-10+1skill, 4=10++newskill, 5=10++upstream
  // Without skill tracking, approximate from PR count alone
  if (prReviews >= 10) return 4;
  if (prReviews >= 5) return 3;
  if (prReviews >= 3) return 2;
  return 1;
}

function scoreCost(costPerTask: number, costPerDay: number): number {
  // PURPOSE.md: 1=>$0.50/task or >$70/day, 5=<$0.25/task
  if (costPerDay > 70 || costPerTask > 0.5) return 1;
  if (costPerTask > 0.4) return 2;
  if (costPerTask > 0.3) return 3;
  if (costPerTask > 0.25) return 4;
  return 5;
}

function computeScores(m: EvalMetrics): PurposeScores {
  const signal = scoreSignal(m.signalCount, m.signalBeats);
  const ops = scoreOps(m.successRate);
  const ecosystem = scoreEcosystem(m.prReviewCount);
  const cost = scoreCost(m.costPerTask, m.costPerDay);

  // Weighted average normalized to measured dimensions only
  const weighted =
    (signal * WEIGHTS.signal +
      ops * WEIGHTS.ops +
      ecosystem * WEIGHTS.ecosystem +
      cost * WEIGHTS.cost) /
    MEASURED_TOTAL;

  return {
    signal,
    ops,
    ecosystem,
    cost,
    weighted: Math.round(weighted * 100) / 100,
  };
}

// ---- Follow-up Task Generation ----

function generateFollowUps(
  scores: PurposeScores,
  metrics: EvalMetrics,
): Array<{ subject: string; skills: string; priority: number; model: string; description: string }> {
  const followUps: Array<{
    subject: string;
    skills: string;
    priority: number;
    model: string;
    description: string;
  }> = [];

  // Low signals → research task to find signal-worthy topics
  if (scores.signal <= 2 && metrics.signalCount < 3) {
    followUps.push({
      subject: "Research signal-worthy topics across active beats",
      skills: '["aibtc-news-editorial", "aibtc-agent-trading"]',
      priority: 4,
      model: "sonnet",
      description:
        `PURPOSE eval: signal score ${scores.signal}/5 (${metrics.signalCount} signals, ${metrics.signalBeats.length} beats). ` +
        `Research aibtc ecosystem activity to identify 2-3 signal-worthy topics. ` +
        `Check: agent registry changes, new PRs in aibtc repos, beat-specific data sources. ` +
        `File signals if strong topics found. Diversify across beats: ${metrics.signalBeats.join(", ") || "none today"}.`,
    });
  }

  // Low ops → triage task to investigate failures
  if (scores.ops <= 2 && metrics.failedCount > 5) {
    followUps.push({
      subject: "Triage recent task failures — ops score low",
      skills: '["arc-failure-triage"]',
      priority: 3,
      model: "sonnet",
      description:
        `PURPOSE eval: ops score ${scores.ops}/5 (${metrics.successRate.toFixed(1)}% success, ${metrics.failedCount} failures in 24h). ` +
        `Investigate top failure patterns. Check if failures share a common root cause ` +
        `(nonce conflicts, API errors, duplicate reviews). Create targeted fix tasks for actionable patterns.`,
    });
  }

  // High cost → cost optimization review
  if (scores.cost <= 1 && metrics.costPerDay > 70) {
    followUps.push({
      subject: "Review cost efficiency — daily spend elevated",
      skills: '["arc-cost-reporting"]',
      priority: 5,
      model: "sonnet",
      description:
        `PURPOSE eval: cost score ${scores.cost}/5 ($${metrics.costPerTask.toFixed(3)}/task, $${metrics.costPerDay.toFixed(2)}/day). ` +
        `Review top-cost tasks. Identify tasks that could use a cheaper model (sonnet→haiku). ` +
        `Check for unnecessary sensor-generated work inflating task count.`,
    });
  }

  // Low ecosystem → prompt PR review activity
  if (scores.ecosystem <= 1 && metrics.prReviewCount < 3) {
    followUps.push({
      subject: "Check for pending PR reviews across ecosystem repos",
      skills: '["aibtc-repo-maintenance"]',
      priority: 5,
      model: "sonnet",
      description:
        `PURPOSE eval: ecosystem score ${scores.ecosystem}/5 (${metrics.prReviewCount} PR reviews in 24h). ` +
        `Check for open PRs needing review in aibtcdev repos. Target: 5+ reviews/day for ecosystem contribution.`,
    });
  }

  return followUps;
}

// ---- Report Formatting ----

function formatReport(scores: PurposeScores, metrics: EvalMetrics): string {
  const lines: string[] = [
    `## PURPOSE Eval — ${new Date().toISOString().split("T")[0]}`,
    "",
    `| Dimension | Score | Detail |`,
    `|-----------|-------|--------|`,
    `| Signal Quality | ${scores.signal}/5 | ${metrics.signalCount} signals, ${metrics.signalBeats.length} beats (${metrics.signalBeats.join(", ") || "none"}) |`,
    `| Operational Health | ${scores.ops}/5 | ${metrics.successRate.toFixed(1)}% success (${metrics.completedCount}/${metrics.totalTasks}) |`,
    `| Ecosystem Impact | ${scores.ecosystem}/5 | ${metrics.prReviewCount} PR reviews |`,
    `| Cost Efficiency | ${scores.cost}/5 | $${metrics.costPerTask.toFixed(3)}/task, $${metrics.costPerDay.toFixed(2)}/day |`,
    `| **Weighted (measured)** | **${scores.weighted}/5** | Signal×25% + Ops×20% + Eco×20% + Cost×15% |`,
    "",
    `_Unmeasured: Adaptation (10%), Collaboration (5%), Security (5%) — require LLM eval_`,
  ];
  return lines.join("\n");
}

// ---- Main Sensor ----

export default async function purposeEvalSensor(): Promise<string> {
  // Date-based dedup: one eval per calendar day
  const statePre = await readHookState(SENSOR_NAME);
  const lastRunDate = statePre?.lastRunDate as string | undefined;
  const today = new Date().toISOString().split("T")[0];

  if (lastRunDate === today) {
    return "skip";
  }

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  if (pendingTaskExistsForSource(TASK_SOURCE)) {
    log("eval task already pending — skipping");
    return "skip";
  }

  log("collecting PURPOSE metrics from tasks + cycle_log...");

  const metrics = collectMetrics();
  const scores = computeScores(metrics);
  const report = formatReport(scores, metrics);

  log(
    `scores: signal=${scores.signal} ops=${scores.ops} eco=${scores.ecosystem} cost=${scores.cost} weighted=${scores.weighted}`,
  );

  // Generate follow-up tasks for low scores
  const followUps = generateFollowUps(scores, metrics);
  let followUpCount = 0;

  for (const fu of followUps) {
    const fuSource = `${TASK_SOURCE}:followup:${today}`;
    if (!pendingTaskExistsForSource(fuSource)) {
      insertTask({
        subject: fu.subject,
        description: fu.description,
        skills: fu.skills,
        source: fuSource,
        priority: fu.priority,
        model: fu.model,
      });
      followUpCount++;
      log(`follow-up created: ${fu.subject}`);
    }
  }

  // Create summary task with computed scores for memory update
  insertTask({
    subject: `PURPOSE eval: ${scores.weighted}/5 — S:${scores.signal} O:${scores.ops} E:${scores.ecosystem} C:${scores.cost}`,
    description:
      report +
      "\n\n## Instructions\n" +
      "1. Review the data-driven scores above\n" +
      "2. Score the 3 unmeasured dimensions (Adaptation, Collaboration, Security) from recent context\n" +
      "3. Compute final weighted PURPOSE score including all 7 dimensions\n" +
      "4. Append dated one-liner to memory/MEMORY.md: `**l-purpose-YYYY-MM-DD** [DATE] PURPOSE score X.XX (S:N O:N E:N C:N A:N Co:N Se:N)`\n" +
      `5. ${followUpCount} follow-up tasks were auto-created for low scores — no additional follow-ups needed\n` +
      "6. Close this task with the final 7-dimension score",
    skills: '["arc-purpose-eval", "arc-strategy-review"]',
    source: TASK_SOURCE,
    priority: 6,
    model: "sonnet", // Lighter than opus — most scoring already done
  });

  log(`eval task created: weighted=${scores.weighted}, ${followUpCount} follow-ups`);

  // Persist state
  await writeHookState(SENSOR_NAME, {
    ...(statePre ?? {}),
    last_ran: new Date().toISOString(),
    last_result: "ok",
    version: ((statePre?.version as number) ?? 0) + 1,
    lastRunDate: today,
    lastScores: scores,
    lastMetrics: {
      signalCount: metrics.signalCount,
      signalBeats: metrics.signalBeats,
      successRate: metrics.successRate,
      costPerTask: metrics.costPerTask,
      costPerDay: metrics.costPerDay,
      prReviewCount: metrics.prReviewCount,
      totalTasks: metrics.totalTasks,
    },
  });

  return "ok";
}
