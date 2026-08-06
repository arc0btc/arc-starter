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
  countRecentTasksBySubject,
  getDatabase,
  insertTask,
  pendingTaskExistsForSource,
} from "../../src/db.ts";

const SENSOR_NAME = "arc-purpose-eval";
const INTERVAL_MINUTES = 720; // 12 hours — twice daily
const TASK_SOURCE = "sensor:arc-purpose-eval";
// Mirrors the local SIGNAL_FILING_DISABLED flag in aibtc-news-editorial/bitcoin-macro/arxiv-research
// (policy, whoabuddy 2026-05-19, task #17094). Signal filing is categorically impossible while true —
// don't spawn a "go research signals" follow-up for a capability that can't act on its findings.
const SIGNAL_FILING_DISABLED = true;
// Cost score stays at/near the floor under normal legitimate operation (baseline daily spend
// runs $100-160/day, well above the PURPOSE.md $70/day "5-point" threshold) — without a cooldown
// this follow-up re-fires every 12h sensor cycle even the day after a review already concluded
// "root lever unchanged, no new action" (see task #21309 -> #21504, same-day duplicate audit).
const COST_REVIEW_SUBJECT = "Review cost efficiency — daily spend elevated";
const COST_REVIEW_COOLDOWN_DAYS = 2;
// Same rationale as COST_REVIEW_COOLDOWN_DAYS: a low prReviewAvgPerDay can legitimately mean
// "nothing needs Arc's independent review right now" (bot PRs, self-authored PRs already
// verified via gh pr comment, or substantive PRs already covered by another org agent) rather
// than a real backlog — #21996 confirmed this directly on 2026-07-11. Without a cooldown this
// follow-up re-fires every 12h even the cycle after a clean check already concluded there's no
// actionable gap. See #21998.
const ECOSYSTEM_REVIEW_SUBJECT = "Check for pending PR reviews across ecosystem repos";
const ECOSYSTEM_REVIEW_COOLDOWN_DAYS = 2;

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
  prReviewCount3d: number;
  prReviewAvgPerDay: number;
  totalTasks: number;
}

// ---- Narrative types (merged from arc-introspection, 2026-07-04) ----

interface CompletedTask {
  id: number;
  subject: string;
  skills: string | null;
  priority: number;
  status: string;
  source: string | null;
  result_summary: string | null;
  cost_usd: number;
  model: string | null;
  duration_ms: number | null;
}

interface NarrativeData {
  completed: CompletedTask[];
  failed: CompletedTask[];
  modelDistribution: Record<string, number>;
  skillFrequency: Record<string, number>;
  sourceBreakdown: Record<string, number>;
  topCostTasks: CompletedTask[];
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

  // PR reviews completed in last 24h — kept for display, but scoring uses the
  // 3-day rolling average below (see prReviewCount3d). A single exact-24h
  // snapshot is highly sensitive to natural external PR-open burstiness and
  // reads a legitimate lull as an internal capacity problem (task #21437,
  // investigation #21435 found near-zero queue latency for pr-review tasks —
  // there was no crowd-out, just a 51h gap in external PR volume).
  // Match subjects like "Review PR #N", "review PR", etc. Requires a literal
  // '#' (every real review subject references a PR number, e.g. "PR #1028" or
  // "x402-api#126") to rule out two confirmed false positives (#21996,
  // #21998): SQLite LIKE is case-insensitive, so "%PR%" alone matches "pr" in
  // unrelated words like "prompt", and this filter previously matched its own
  // generated follow-up subject ("Check for pending PR reviews across
  // ecosystem repos"), inflating the count with a task that reviewed nothing.
  // This also means self-authored CVE-fix PRs verified via `gh pr comment`
  // (GitHub blocks self-approval) already count here today, since those
  // completed tasks are titled "Review PR <repo>#<N>: ..." — see #21998.
  const PR_REVIEW_SUBJECT_FILTER = `(
         subject LIKE '%#%' AND (
           subject LIKE 'Review %PR%'
           OR subject LIKE 'review %PR%'
           OR subject LIKE '%PR review%'
           OR subject LIKE '%PR %review%'
           OR subject LIKE 'Review and%PR%'
         )
       )`;

  const prRow = db
    .query(
      `SELECT COUNT(*) as count FROM tasks
       WHERE status = 'completed'
       AND completed_at > datetime('now', '-1 day')
       AND ${PR_REVIEW_SUBJECT_FILTER}`
    )
    .get() as { count: number };

  // Rolling 3-day count, used for scoring instead of the bursty 24h snapshot.
  const prRow3d = db
    .query(
      `SELECT COUNT(*) as count FROM tasks
       WHERE status = 'completed'
       AND completed_at > datetime('now', '-3 day')
       AND ${PR_REVIEW_SUBJECT_FILTER}`
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
    prReviewCount3d: prRow3d.count,
    prReviewAvgPerDay: prRow3d.count / 3,
    totalTasks: total,
  };
}

// ---- Narrative Collection (merged from arc-introspection, 2026-07-04) ----

function categorizeSource(source: string | null): string {
  if (!source) return "unknown";
  if (source === "human") return "human";
  if (source.startsWith("sensor:")) return "sensor";
  if (source.startsWith("task:")) return "follow-up";
  return "other";
}

function collectNarrativeData(): NarrativeData {
  const db = getDatabase();

  const completedRows = db
    .query(
      `SELECT t.id, t.subject, t.skills, t.priority, t.status, t.source,
              t.result_summary, t.model,
              COALESCE(t.cost_usd, 0) as cost_usd,
              (SELECT SUM(c.duration_ms) FROM cycle_log c WHERE c.task_id = t.id) as duration_ms
       FROM tasks t
       WHERE t.status = 'completed'
         AND t.completed_at > datetime('now', '-1 day')
       ORDER BY t.completed_at DESC`
    )
    .all() as CompletedTask[];

  const failedRows = db
    .query(
      `SELECT t.id, t.subject, t.skills, t.priority, t.status, t.source,
              t.result_summary, t.model,
              COALESCE(t.cost_usd, 0) as cost_usd,
              (SELECT SUM(c.duration_ms) FROM cycle_log c WHERE c.task_id = t.id) as duration_ms
       FROM tasks t
       WHERE t.status = 'failed'
         AND t.completed_at > datetime('now', '-1 day')
       ORDER BY t.completed_at DESC`
    )
    .all() as CompletedTask[];

  const modelDistribution: Record<string, number> = {};
  const skillFrequency: Record<string, number> = {};
  const sourceBreakdown: Record<string, number> = {};

  for (const task of [...completedRows, ...failedRows]) {
    const model = task.model ?? "unknown";
    modelDistribution[model] = (modelDistribution[model] ?? 0) + 1;

    if (task.skills) {
      try {
        const skills = JSON.parse(task.skills) as string[];
        for (const skill of skills) {
          skillFrequency[skill] = (skillFrequency[skill] ?? 0) + 1;
        }
      } catch {
        // skip unparseable
      }
    }

    const sourceType = categorizeSource(task.source);
    sourceBreakdown[sourceType] = (sourceBreakdown[sourceType] ?? 0) + 1;
  }

  const topCostTasks = [...completedRows, ...failedRows]
    .sort((a, b) => b.cost_usd - a.cost_usd)
    .slice(0, 5);

  return {
    completed: completedRows,
    failed: failedRows,
    modelDistribution,
    skillFrequency,
    sourceBreakdown,
    topCostTasks,
  };
}

function formatNarrative(data: NarrativeData): string {
  const sections: string[] = [];

  if (Object.keys(data.modelDistribution).length > 0) {
    const modelLines = Object.entries(data.modelDistribution)
      .sort(([, a], [, b]) => b - a)
      .map(([model, count]) => `- ${model}: ${count} tasks`);
    sections.push(`## Model Distribution\n${modelLines.join("\n")}`);
  }

  if (Object.keys(data.sourceBreakdown).length > 0) {
    const sourceLines = Object.entries(data.sourceBreakdown)
      .sort(([, a], [, b]) => b - a)
      .map(([source, count]) => `- ${source}: ${count}`);
    sections.push(`## Work Sources\n${sourceLines.join("\n")}`);
  }

  if (Object.keys(data.skillFrequency).length > 0) {
    const skillLines = Object.entries(data.skillFrequency)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([skill, count]) => `- ${skill}: ${count}`);
    sections.push(`## Active Skill Domains (top 10)\n${skillLines.join("\n")}`);
  }

  if (data.completed.length > 0) {
    const taskLines = data.completed.slice(0, 20).map((t) => {
      const cost = t.cost_usd > 0 ? ` ($${t.cost_usd.toFixed(3)})` : "";
      const summary = t.result_summary
        ? ` — ${t.result_summary.slice(0, 80)}`
        : "";
      return `- [#${t.id}] ${t.subject.slice(0, 60)}${cost}${summary}`;
    });
    sections.push(`## Completed Tasks\n${taskLines.join("\n")}`);
  }

  if (data.failed.length > 0) {
    const failLines = data.failed.map((t) => {
      const summary = t.result_summary
        ? ` — ${t.result_summary.slice(0, 80)}`
        : "";
      return `- [#${t.id}] ${t.subject.slice(0, 60)}${summary}`;
    });
    sections.push(`## Failed Tasks\n${failLines.join("\n")}`);
  }

  if (data.topCostTasks.length > 0 && data.topCostTasks[0].cost_usd > 0) {
    const costLines = data.topCostTasks
      .filter((t) => t.cost_usd > 0)
      .map(
        (t) =>
          `- [#${t.id}] $${t.cost_usd.toFixed(3)} — ${t.subject.slice(0, 60)}`
      );
    sections.push(`## Highest Cost Tasks\n${costLines.join("\n")}`);
  }

  return sections.join("\n\n");
}

function generateReflectionPrompts(data: NarrativeData): string {
  const prompts: string[] = [];
  const total = data.completed.length + data.failed.length;

  if (data.failed.length > 0) {
    const rate = ((data.failed.length / total) * 100).toFixed(0);
    prompts.push(
      `- ${data.failed.length} tasks failed (${rate}% failure rate). Are there common patterns? Should any be retried or deprioritized?`
    );
  }

  const sensorCount = data.sourceBreakdown["sensor"] ?? 0;
  const humanCount = data.sourceBreakdown["human"] ?? 0;
  if (sensorCount > 0 && humanCount === 0) {
    prompts.push(
      `- All work was sensor-driven (${sensorCount} tasks). No human-initiated tasks. Is the agent working on what matters, or just what's detected?`
    );
  }

  const topSkill = Object.entries(data.skillFrequency).sort(
    ([, a], [, b]) => b - a
  )[0];
  if (topSkill && topSkill[1] > total * 0.4 && total > 5) {
    prompts.push(
      `- ${topSkill[0]} dominated today (${topSkill[1]}/${total} tasks). Is this proportional to its importance, or crowding out other work?`
    );
  }

  if (total < 5) {
    prompts.push(
      `- Only ${total} tasks in 24h. Is the queue starved, or was this intentional low-activity?`
    );
  }

  if (total > 50) {
    prompts.push(
      `- ${total} tasks in 24h is high volume. Is the queue creating busywork, or is this genuine throughput?`
    );
  }

  if (prompts.length === 0) {
    prompts.push(
      `- Routine day. What's the most valuable thing accomplished? What should tomorrow prioritize?`
    );
  }

  return prompts.join("\n");
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

function scoreEcosystem(prReviewAvgPerDay: number): number {
  // PURPOSE.md: 1=<3 reviews, 2=3-5, 3=5-10+1skill, 4=10++newskill, 5=10++upstream
  // Without skill tracking, approximate from PR count alone.
  // Uses a 3-day rolling average/day (not a single 24h snapshot) so a
  // legitimate lull in external PR volume doesn't score as a capacity
  // problem — see the comment on prRow3d in collectMetrics().
  if (prReviewAvgPerDay >= 10) return 4;
  if (prReviewAvgPerDay >= 5) return 3;
  if (prReviewAvgPerDay >= 3) return 2;
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
  const ecosystem = scoreEcosystem(m.prReviewAvgPerDay);
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

  // Low signals → research task to find signal-worthy topics (skip while filing is disabled —
  // there's nothing to file the research into, so it's pure churn)
  if (scores.signal <= 2 && metrics.signalCount < 3 && !SIGNAL_FILING_DISABLED) {
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

  // High cost → cost optimization review (cooldown-gated: don't re-spawn an identical
  // audit while a prior one is still fresh — see COST_REVIEW_COOLDOWN_DAYS above)
  if (
    scores.cost <= 1 &&
    metrics.costPerDay > 70 &&
    countRecentTasksBySubject(COST_REVIEW_SUBJECT, COST_REVIEW_COOLDOWN_DAYS) === 0
  ) {
    followUps.push({
      subject: COST_REVIEW_SUBJECT,
      skills: '["arc-cost-reporting"]',
      priority: 5,
      model: "sonnet",
      description:
        `PURPOSE eval: cost score ${scores.cost}/5 ($${metrics.costPerTask.toFixed(3)}/task, $${metrics.costPerDay.toFixed(2)}/day). ` +
        `Review top-cost tasks. Identify tasks that could use a cheaper model (sonnet→haiku). ` +
        `Check for unnecessary sensor-generated work inflating task count.`,
    });
  }

  // Low ecosystem → prompt PR review activity. Gated on the 3-day rolling
  // average, not the raw 24h count, so a natural lull in external PR volume
  // (no PRs opened, nothing to review) doesn't spawn a queue-rebalance-style
  // task off a bursty single-day snapshot (see #21437 / #21435).
  if (
    scores.ecosystem <= 1 &&
    metrics.prReviewAvgPerDay < 3 &&
    countRecentTasksBySubject(ECOSYSTEM_REVIEW_SUBJECT, ECOSYSTEM_REVIEW_COOLDOWN_DAYS) === 0
  ) {
    followUps.push({
      subject: ECOSYSTEM_REVIEW_SUBJECT,
      skills: '["aibtc-repo-maintenance"]',
      priority: 5,
      model: "sonnet",
      description:
        `PURPOSE eval: ecosystem score ${scores.ecosystem}/5 (${metrics.prReviewCount} PR reviews in 24h, ` +
        `${metrics.prReviewAvgPerDay.toFixed(1)}/day avg over 3d). ` +
        `Before filing a queue-rebalance or priority-boost task off this metric, verify pr-review queue latency ` +
        `directly (time-to-pickup) — a low count can reflect zero external PRs opened, not internal crowd-out. ` +
        `Run \`arc skills run --name aibtc-repo-maintenance -- status\` FIRST to get the actual unreviewed-PR count ` +
        `(it filters out already-approved/reviewed PRs via GraphQL review data) — do not conclude a backlog exists ` +
        `from \`gh pr list\` open-state alone, that flags already-approved PRs as unreviewed (recurring false ` +
        `positive: #24478, #25155, #25158). Target: 5+ reviews/day for ecosystem contribution.`,
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
    `| Ecosystem Impact | ${scores.ecosystem}/5 | ${metrics.prReviewCount} PR reviews (24h), ${metrics.prReviewAvgPerDay.toFixed(1)}/day avg (3d rolling) |`,
    `| Cost Efficiency | ${scores.cost}/5 | $${metrics.costPerTask.toFixed(3)}/task, $${metrics.costPerDay.toFixed(2)}/day |`,
    `| **Weighted (measured)** | **${scores.weighted}/5** | Signal×25% + Ops×20% + Eco×20% + Cost×15% |`,
    "",
    `_Unmeasured: Adaptation (10%), Collaboration (5%), Security (5%) — require LLM eval_`,
  ];
  if (SIGNAL_FILING_DISABLED && scores.signal <= 2) {
    lines.push(
      "",
      `_Signal Quality low because signal filing is policy-PAUSED (whoabuddy, 2026-05-19) — not a research gap. No follow-up spawned._`,
    );
  }
  return lines.join("\n");
}

// ---- Dedup Helpers ----

// Belt-and-suspenders guard alongside the source-based pendingTaskExistsForSource(TASK_SOURCE)
// check below: that check only catches a duplicate if the earlier eval task is still
// pending/active under the exact same source string. #23138/#23145 (2026-07-19) showed a gap —
// by the time the second sensor run fired, the first eval task's source-scoped check no longer
// held (see memory/shared/entries/daily-eval-duplicate-task-same-day.md). This checks by subject
// prefix + creation date instead, independent of source, right before the insert.
function evalTaskPendingToday(): boolean {
  const db = getDatabase();
  const row = db
    .query(
      `SELECT 1 FROM tasks
       WHERE subject LIKE 'PURPOSE eval:%'
       AND status IN ('pending', 'active')
       AND DATE(created_at) = DATE('now')
       LIMIT 1`
    )
    .get();
  return row !== null;
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

  const narrativeData = collectNarrativeData();
  const narrative = formatNarrative(narrativeData);
  const reflectionPrompts = generateReflectionPrompts(narrativeData);

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

  // Create summary task with computed scores for memory update — guarded against a same-day
  // duplicate subject (see evalTaskPendingToday() above).
  if (evalTaskPendingToday()) {
    log("eval task with matching subject already pending today — skipping duplicate creation");
  } else {
    insertTask({
      subject: `PURPOSE eval: ${scores.weighted}/5 — S:${scores.signal} O:${scores.ops} E:${scores.ecosystem} C:${scores.cost}`,
      description:
        report +
        "\n\n## Narrative (merged from arc-introspection, 2026-07-04)\n\n" +
        narrative +
        `\n\n### Reflection Prompts\n${reflectionPrompts}` +
        "\n\n## Instructions\n" +
        "1. Review the data-driven scores and narrative above\n" +
        "2. Score the 3 unmeasured dimensions using Council DSL v1 moves (see agent-runtime/specs/agent-council-dsl-grammar-v1.md §1):\n" +
        "   a. For each dimension emit: `[A] PROPOSE score-ad-N conf=0.X` (Adaptation), `[B] PROPOSE score-co-N conf=0.X` (Collaboration), `[C] PROPOSE score-se-N conf=0.X` (Security), where N is 1-5\n" +
        "   b. Back each PROPOSE with one CLAIM: `[X] CLAIM -> score-XX-N SHOULD conf=0.X ev=#<memory-slug> \"one-line reason\"`\n" +
        "   c. Close with: `[chair] SYNTH from=score-ad-N+score-co-N+score-se-N open=[] conf=0.X \"Adaptation=N Collaboration=N Security=N\"`\n" +
        "   d. Write the @phase propose + moves + @phase synth block to /tmp/daily-eval-council.dsl\n" +
        "   e. Validate: `arc skills run --name council-dsl -- validate /tmp/daily-eval-council.dsl`\n" +
        "   f. Fix any validation errors (missing ev=, malformed lines) before proceeding\n" +
        "3. Compute final weighted PURPOSE score including all 7 dimensions (use scores from SYNTH note)\n" +
        "4. Append dated one-liner to memory/MEMORY.md: `**daily-eval** [ROLLING, last DATE] X.XX/5 — S:N O:N E:N C:N Ad:N Co:N Se:N | ...` (overwrite previous rolling line)\n" +
        "5. Write a concise 3-5 sentence self-assessment (what went well, what didn't, what to focus on) using the narrative + reflection prompts above\n" +
        `6. ${followUpCount} follow-up tasks were auto-created for low scores — no additional follow-ups needed\n` +
        "7. Close this task with the final 7-dimension score and one-line summary of the reflection",
      skills: '["arc-purpose-eval", "arc-strategy-review"]',
      source: TASK_SOURCE,
      priority: 6,
      model: "sonnet", // Lighter than opus — most scoring already done
    });

    log(`eval task created: weighted=${scores.weighted}, ${followUpCount} follow-ups`);
  }

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
      prReviewCount3d: metrics.prReviewCount3d,
      prReviewAvgPerDay: metrics.prReviewAvgPerDay,
      totalTasks: metrics.totalTasks,
    },
  });

  return "ok";
}
