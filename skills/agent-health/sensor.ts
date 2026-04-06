// skills/agent-health/sensor.ts
//
// External health monitor for Loom (Rising Leviathan).
// Runs every 2 hours on Arc (Trustless Indra), SSHes into Loom to gather:
//   - cycle_log metrics (token consumption, cost, spikes)
//   - task failure patterns (repeated source failures, retry storms)
//   - git history (changes to watched behavior-critical paths)
//   - gate/watchdog state (dispatch-gate.json, external-watchdog.json)
//
// Bakes all data into a structured description block and creates a Haiku
// analysis task. Haiku reads the block, classifies GREEN/YELLOW/RED,
// and sends email only on YELLOW or RED.
//
// Key constraints:
//   - SSH via Bun.spawn (not child_process)
//   - SQLite queries on Loom via `bun --eval` over SSH (no sqlite3 CLI on Loom)
//   - GREEN conditions -> skip task creation (cost optimization)
//   - All data gathered BEFORE task creation (Haiku needs zero tool calls)

import { join } from "node:path";
import {
  claimSensorRun,
  insertTaskIfNew,
  createSensorLogger,
} from "../../src/sensors.ts";
import { initDatabase } from "../../src/db.ts";

// ---- Constants ----

const SENSOR_NAME = "agent-health-loom";
const INTERVAL_MINUTES = 120;
const TASK_SOURCE = "sensor:agent-health:loom";
// Check the last 4 hours (2x interval for overlap — catches any cycles we might have missed)
const LOOKBACK_HOURS = 4;

const log = createSensorLogger(SENSOR_NAME);

// ---- Types ----

interface AgentConfig {
  name: string;
  codename: string;
  ssh: {
    host: string;
    user: string;
    auth: "key" | "password";
  };
  paths: {
    root: string;
    db: string;
    gate_state: string;
    watchdog_state: string;
  };
  watched_paths: string[];
  thresholds: {
    tokens_in_per_cycle: number;
    cost_per_cycle_usd: number;
    daily_cost_usd: number;
    failed_source_repeat_count: number;
    pending_task_age_hours: number;
  };
  noise_patterns: {
    ignored_sources: string[];
    ignored_subjects: string[];
  };
  alert: {
    email_to: string;
    email_skill: string;
  };
}

interface CycleMetrics {
  cycles_checked: number;
  total_tokens_in: number;
  total_cost_usd: number;
  avg_tokens_per_cycle: number;
  avg_cost_per_cycle: number;
  max_tokens_in_single_cycle: number;
  max_cost_single_cycle: number;
  spike_cycles: Array<{
    started_at: string;
    tokens_in: number;
    cost_usd: number;
    model: string | null;
    duration_ms: number | null;
    task_subject: string | null;
  }>;
  error?: string;
}

interface TaskFailures {
  failed_sources: Array<{
    source: string;
    count: number;
    last_subject: string | null;
  }>;
  error?: string;
}

interface GitCommit {
  hash: string;
  date: string;
  message: string;
  files_changed: string[];
}

interface GitActivity {
  commits_since_last_check: number;
  watched_path_commits: GitCommit[];
  error?: string;
}

interface GateState {
  dispatch_gate: {
    status: string;
    consecutive_failures?: number;
    stopped_at?: string;
    stop_reason?: string;
    [key: string]: unknown;
  };
  watchdog: {
    last_ran?: string;
    last_alert_at?: string;
    last_result?: string;
    [key: string]: unknown;
  };
  error?: string;
}

interface PendingTask {
  id: number;
  subject: string;
  source: string | null;
  created_at: string;
  age_hours: number;
}

interface PendingTaskAge {
  oldest_tasks: PendingTask[];
  error?: string;
}

interface HealthData {
  cycle_metrics: CycleMetrics;
  task_failures: TaskFailures;
  git_activity: GitActivity;
  gate_state: GateState;
  pending_task_age: PendingTaskAge;
  gathered_at: string;
}

// ---- Config Loader ----

async function loadAgentConfig(): Promise<AgentConfig> {
  const configPath = new URL("./agents/loom.json", import.meta.url).pathname;
  const file = Bun.file(configPath);
  return (await file.json()) as AgentConfig;
}

// ---- SSH Helper ----

/**
 * Execute a command on a remote host via SSH.
 * Uses key auth (no password). Assumes keys are set up for the host.
 */
async function sshExec(
  host: string,
  user: string,
  command: string,
): Promise<string> {
  const proc = Bun.spawn(
    [
      "ssh",
      "-o", "ConnectTimeout=10",
      "-o", "StrictHostKeyChecking=no",
      "-o", "BatchMode=yes",
      `${user}@${host}`,
      command,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  // 30-second timeout
  const timeout = setTimeout(() => proc.kill(), 30_000);

  try {
    const [stdout, _stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    clearTimeout(timeout);

    if (exitCode !== 0) {
      throw new Error(`SSH command failed with exit code ${exitCode}: ${command.slice(0, 80)}`);
    }

    return stdout.trim();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ---- SQLite Query Helper ----

/**
 * Run a SQL query on Loom's SQLite database via `bun --eval` over SSH.
 * Returns parsed JSON array of rows.
 *
 * The bun --eval string is single-line and avoids special characters that
 * would break SSH transport. The query must not contain single quotes.
 * For queries with string literals, use parameterized approaches or double quotes.
 */
async function queryLoomDb(
  config: AgentConfig,
  sql: string,
): Promise<Array<Record<string, unknown>>> {
  const dbPath = join(config.paths.root, config.paths.db).replace("~", "/home/dev");
  // Escape double quotes in SQL for embedding in the bun --eval string
  const escapedSql = sql.replace(/"/g, '\\"');

  const bunCmd = `cd ~/arc-starter && bun --eval 'import{Database}from"bun:sqlite";const db=new Database("${dbPath}",{readonly:true});const r=db.prepare("${escapedSql}").all();process.stdout.write(JSON.stringify(r));'`;

  const output = await sshExec(config.ssh.host, config.ssh.user, bunCmd);
  if (!output || output === "") return [];

  try {
    return JSON.parse(output) as Array<Record<string, unknown>>;
  } catch {
    throw new Error(`Failed to parse SQLite query output: ${output.slice(0, 200)}`);
  }
}

// ---- Data Gathering ----

async function gatherCycleMetrics(config: AgentConfig): Promise<CycleMetrics> {
  try {
    const sql = `SELECT started_at, completed_at, duration_ms, cost_usd, api_cost_usd, tokens_in, tokens_out, model, skills_loaded, task_id FROM cycle_log WHERE started_at > datetime('now', '-${LOOKBACK_HOURS} hours') ORDER BY started_at DESC`;

    const rows = await queryLoomDb(config, sql);

    if (rows.length === 0) {
      return {
        cycles_checked: 0,
        total_tokens_in: 0,
        total_cost_usd: 0,
        avg_tokens_per_cycle: 0,
        avg_cost_per_cycle: 0,
        max_tokens_in_single_cycle: 0,
        max_cost_single_cycle: 0,
        spike_cycles: [],
      };
    }

    let totalTokensIn = 0;
    let totalCostUsd = 0;
    let maxTokensIn = 0;
    let maxCost = 0;

    for (const row of rows) {
      const tokensIn = Number(row.tokens_in ?? 0);
      const cost = Number(row.cost_usd ?? 0);
      totalTokensIn += tokensIn;
      totalCostUsd += cost;
      if (tokensIn > maxTokensIn) maxTokensIn = tokensIn;
      if (cost > maxCost) maxCost = cost;
    }

    const n = rows.length;

    // Identify spike cycles (exceed either threshold)
    const spikeCycles = rows
      .filter(
        (row) =>
          Number(row.tokens_in ?? 0) > config.thresholds.tokens_in_per_cycle ||
          Number(row.cost_usd ?? 0) > config.thresholds.cost_per_cycle_usd,
      )
      .map((row) => ({
        started_at: String(row.started_at ?? ""),
        tokens_in: Number(row.tokens_in ?? 0),
        cost_usd: Number(row.cost_usd ?? 0),
        model: row.model != null ? String(row.model) : null,
        duration_ms: row.duration_ms != null ? Number(row.duration_ms) : null,
        task_subject: null as string | null, // populated below if task_id present
      }));

    // Attempt to resolve task subjects for spike cycles
    for (const spike of spikeCycles) {
      const matchRow = rows.find(
        (r) =>
          String(r.started_at ?? "") === spike.started_at && r.task_id != null,
      );
      if (matchRow?.task_id != null) {
        try {
          const taskRows = await queryLoomDb(
            config,
            `SELECT subject FROM tasks WHERE id = ${Number(matchRow.task_id)} LIMIT 1`,
          );
          if (taskRows.length > 0 && taskRows[0].subject != null) {
            spike.task_subject = String(taskRows[0].subject);
          }
        } catch {
          // Non-fatal: proceed without task subject
        }
      }
    }

    return {
      cycles_checked: n,
      total_tokens_in: totalTokensIn,
      total_cost_usd: Math.round(totalCostUsd * 100) / 100,
      avg_tokens_per_cycle: Math.round(totalTokensIn / n),
      avg_cost_per_cycle: Math.round((totalCostUsd / n) * 100) / 100,
      max_tokens_in_single_cycle: maxTokensIn,
      max_cost_single_cycle: Math.round(maxCost * 100) / 100,
      spike_cycles: spikeCycles,
    };
  } catch (err) {
    return {
      cycles_checked: 0,
      total_tokens_in: 0,
      total_cost_usd: 0,
      avg_tokens_per_cycle: 0,
      avg_cost_per_cycle: 0,
      max_tokens_in_single_cycle: 0,
      max_cost_single_cycle: 0,
      spike_cycles: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function gatherTaskFailures(config: AgentConfig): Promise<TaskFailures> {
  try {
    const sql = `SELECT source, COUNT(*) as count, MAX(subject) as last_subject FROM tasks WHERE status = 'failed' AND completed_at > datetime('now', '-${LOOKBACK_HOURS} hours') GROUP BY source HAVING count >= 2 ORDER BY count DESC`;

    const rows = await queryLoomDb(config, sql);

    // Filter out known noise sources
    const ignoredSources = new Set(config.noise_patterns.ignored_sources);
    const filtered = rows
      .filter((row) => !ignoredSources.has(String(row.source ?? "")))
      .map((row) => ({
        source: String(row.source ?? "unknown"),
        count: Number(row.count ?? 0),
        last_subject: row.last_subject != null ? String(row.last_subject) : null,
      }));

    return { failed_sources: filtered };
  } catch (err) {
    return {
      failed_sources: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function gatherGitActivity(config: AgentConfig): Promise<GitActivity> {
  try {
    const watchedPathArgs = config.watched_paths.join(" ");
    const gitCmd = `cd ~/arc-starter && git log --oneline --since="${LOOKBACK_HOURS} hours ago" --name-only -- ${watchedPathArgs}`;

    const output = await sshExec(config.ssh.host, config.ssh.user, gitCmd);

    if (!output) {
      return { commits_since_last_check: 0, watched_path_commits: [] };
    }

    // Parse git log --oneline --name-only output format:
    // <hash> <message>
    // <file1>
    // <file2>
    // (blank line)
    // <hash> <message>
    // ...
    const commits: GitCommit[] = [];
    const lines = output.split("\n");
    let currentCommit: GitCommit | null = null;

    for (const line of lines) {
      if (!line.trim()) {
        // Blank line: end of current commit block
        if (currentCommit) {
          commits.push(currentCommit);
          currentCommit = null;
        }
        continue;
      }

      // Check if this looks like a commit hash line: starts with 7-char hex + space
      const hashMatch = line.match(/^([0-9a-f]{7,40})\s+(.+)$/i);
      if (hashMatch) {
        // Save previous commit if any
        if (currentCommit) commits.push(currentCommit);
        currentCommit = {
          hash: hashMatch[1],
          date: new Date().toISOString().slice(0, 10), // approximate; git oneline doesn't include date
          message: hashMatch[2],
          files_changed: [],
        };
      } else if (currentCommit && line.trim()) {
        // File path line
        currentCommit.files_changed.push(line.trim());
      }
    }
    // Capture last commit if output didn't end with blank line
    if (currentCommit) commits.push(currentCommit);

    // Skip merge commits (common noise)
    const nonMerge = commits.filter(
      (c) => !c.message.toLowerCase().startsWith("merge "),
    );

    return {
      commits_since_last_check: nonMerge.length,
      watched_path_commits: nonMerge,
    };
  } catch (err) {
    return {
      commits_since_last_check: 0,
      watched_path_commits: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function gatherGateState(config: AgentConfig): Promise<GateState> {
  try {
    const gateCmd = `cat ~/arc-starter/${config.paths.gate_state} 2>/dev/null || echo '{}'`;
    const watchdogCmd = `cat ~/arc-starter/${config.paths.watchdog_state} 2>/dev/null || echo '{}'`;

    const [gateOutput, watchdogOutput] = await Promise.all([
      sshExec(config.ssh.host, config.ssh.user, gateCmd),
      sshExec(config.ssh.host, config.ssh.user, watchdogCmd),
    ]);

    let gateData: Record<string, unknown> = {};
    let watchdogData: Record<string, unknown> = {};

    try {
      gateData = JSON.parse(gateOutput || "{}") as Record<string, unknown>;
    } catch {
      gateData = { parse_error: gateOutput };
    }

    try {
      watchdogData = JSON.parse(watchdogOutput || "{}") as Record<string, unknown>;
    } catch {
      watchdogData = { parse_error: watchdogOutput };
    }

    return {
      dispatch_gate: {
        status: String(gateData.status ?? "unknown"),
        consecutive_failures: gateData.consecutive_failures != null
          ? Number(gateData.consecutive_failures)
          : undefined,
        stopped_at: gateData.stopped_at != null ? String(gateData.stopped_at) : undefined,
        stop_reason: gateData.stop_reason != null ? String(gateData.stop_reason) : undefined,
        ...gateData,
      },
      watchdog: {
        last_ran: watchdogData.last_ran != null ? String(watchdogData.last_ran) : undefined,
        last_alert_at: watchdogData.last_alert_at != null ? String(watchdogData.last_alert_at) : undefined,
        last_result: watchdogData.last_result != null ? String(watchdogData.last_result) : undefined,
        ...watchdogData,
      },
    };
  } catch (err) {
    return {
      dispatch_gate: { status: "unknown" },
      watchdog: {},
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function gatherPendingTaskAge(config: AgentConfig): Promise<PendingTaskAge> {
  try {
    const sql = `SELECT id, subject, source, created_at, ROUND((julianday('now') - julianday(created_at)) * 24, 1) as age_hours FROM tasks WHERE status = 'pending' ORDER BY created_at ASC LIMIT 5`;

    const rows = await queryLoomDb(config, sql);

    const tasks = rows.map((row) => ({
      id: Number(row.id ?? 0),
      subject: String(row.subject ?? ""),
      source: row.source != null ? String(row.source) : null,
      created_at: String(row.created_at ?? ""),
      age_hours: Number(row.age_hours ?? 0),
    }));

    return { oldest_tasks: tasks };
  } catch (err) {
    return {
      oldest_tasks: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---- Data Block Formatter ----

function formatDataBlock(data: HealthData, config: AgentConfig): string {
  const { cycle_metrics: cm, task_failures: tf, git_activity: ga, gate_state: gs, pending_task_age: pa } = data;

  const lines: string[] = [
    `=== AGENT HEALTH DATA: ${config.name} (${config.codename}) ===`,
    `Checked: ${data.gathered_at}`,
    `Period: last ${LOOKBACK_HOURS} hours`,
    "",
    "## Cycle Metrics",
    `cycles_checked: ${cm.cycles_checked}`,
    `total_tokens_in: ${cm.total_tokens_in}`,
    `total_cost_usd: ${cm.total_cost_usd.toFixed(2)}`,
    `avg_tokens_per_cycle: ${cm.avg_tokens_per_cycle}`,
    `avg_cost_per_cycle: ${cm.avg_cost_per_cycle.toFixed(2)}`,
    `max_tokens_in_single_cycle: ${cm.max_tokens_in_single_cycle}`,
    `max_cost_single_cycle: ${cm.max_cost_single_cycle.toFixed(2)}`,
  ];

  if (cm.spike_cycles.length > 0) {
    lines.push(`spike_cycles: ${JSON.stringify(cm.spike_cycles, null, 2)}`);
  } else {
    lines.push("spike_cycles: []");
  }

  if (cm.error) lines.push(`cycle_metrics_error: ${cm.error}`);

  lines.push("");
  lines.push("## Task Failures");

  if (tf.failed_sources.length > 0) {
    lines.push(`failed_sources: ${JSON.stringify(tf.failed_sources, null, 2)}`);
  } else {
    lines.push("failed_sources: []");
  }

  if (tf.error) lines.push(`task_failures_error: ${tf.error}`);

  lines.push("");
  lines.push("## Git Activity");
  lines.push(`commits_since_last_check: ${ga.commits_since_last_check}`);

  if (ga.watched_path_commits.length > 0) {
    lines.push(`watched_path_commits: ${JSON.stringify(ga.watched_path_commits, null, 2)}`);
  } else {
    lines.push("watched_path_commits: []");
  }

  if (ga.error) lines.push(`git_activity_error: ${ga.error}`);

  lines.push("");
  lines.push("## Gate State");
  lines.push(`dispatch_gate: ${JSON.stringify(gs.dispatch_gate, null, 2)}`);
  lines.push(`watchdog: ${JSON.stringify(gs.watchdog, null, 2)}`);
  if (gs.error) lines.push(`gate_state_error: ${gs.error}`);

  lines.push("");
  lines.push("## Pending Tasks");
  if (pa.oldest_tasks.length > 0) {
    lines.push(`oldest_pending_tasks: ${JSON.stringify(pa.oldest_tasks, null, 2)}`);
  } else {
    lines.push("oldest_pending_tasks: []");
  }
  if (pa.error) lines.push(`pending_task_error: ${pa.error}`);

  lines.push("");
  lines.push("## Thresholds");
  lines.push(`tokens_in_per_cycle: ${config.thresholds.tokens_in_per_cycle}`);
  lines.push(`cost_per_cycle_usd: ${config.thresholds.cost_per_cycle_usd.toFixed(2)}`);
  lines.push(`daily_cost_usd: ${config.thresholds.daily_cost_usd}`);
  lines.push(`failed_source_repeat_count: ${config.thresholds.failed_source_repeat_count}`);
  lines.push(`pending_task_age_hours: ${config.thresholds.pending_task_age_hours}`);

  lines.push("");
  lines.push("=== END DATA ===");

  return lines.join("\n");
}

// ---- Pre-Classifier ----

interface ClassificationResult {
  level: "GREEN" | "YELLOW" | "RED";
  reasons: string[];
}

function preClassify(data: HealthData, config: AgentConfig): ClassificationResult {
  const reasons: string[] = [];
  let level: "GREEN" | "YELLOW" | "RED" = "GREEN";

  const { thresholds } = config;
  const { cycle_metrics: cm, task_failures: tf, git_activity: ga, gate_state: gs, pending_task_age: pa } = data;

  // RED conditions

  // Token spiral: any cycle exceeded token threshold
  if (cm.max_tokens_in_single_cycle > thresholds.tokens_in_per_cycle) {
    reasons.push(
      `Token spiral: max ${cm.max_tokens_in_single_cycle.toLocaleString()} tokens in a single cycle (threshold: ${thresholds.tokens_in_per_cycle.toLocaleString()})`,
    );
    level = "RED";
  }

  // Cost spiral: any cycle exceeded cost threshold
  if (cm.max_cost_single_cycle > thresholds.cost_per_cycle_usd) {
    reasons.push(
      `Cost spike: max $${cm.max_cost_single_cycle.toFixed(2)} in a single cycle (threshold: $${thresholds.cost_per_cycle_usd.toFixed(2)})`,
    );
    level = "RED";
  }

  // Retry storm: any non-noise source exceeded failure count threshold
  for (const fs of tf.failed_sources) {
    if (fs.count > thresholds.failed_source_repeat_count) {
      reasons.push(
        `Retry storm: ${fs.source} failed ${fs.count} times (threshold: ${thresholds.failed_source_repeat_count})`,
      );
      level = "RED";
    }
  }

  // Gate stopped
  if (gs.dispatch_gate.status === "stopped") {
    const reason = gs.dispatch_gate.stop_reason ?? "unknown reason";
    reasons.push(`Dispatch gate STOPPED: ${reason}`);
    level = "RED";
  }

  // YELLOW conditions (only if not already RED)
  // Note: still collect YELLOW reasons even if RED for full context in email

  // Daily cost pace check: extrapolate from LOOKBACK_HOURS to 24h
  const dailyEquivalentCost = (cm.total_cost_usd / LOOKBACK_HOURS) * 24;
  if (dailyEquivalentCost > thresholds.daily_cost_usd) {
    reasons.push(
      `Daily cost pace: $${dailyEquivalentCost.toFixed(2)} projected/day (threshold: $${thresholds.daily_cost_usd})`,
    );
    if (level === "GREEN") level = "YELLOW";
  }

  // Watched-path git commits (non-trivial code changes)
  if (ga.commits_since_last_check > 0) {
    const paths = ga.watched_path_commits
      .map((c) => c.message.slice(0, 60))
      .join("; ");
    reasons.push(`Watched-path changes: ${ga.commits_since_last_check} commit(s) — ${paths}`);
    if (level === "GREEN") level = "YELLOW";
  }

  // Pending task age
  const staleTasks = pa.oldest_tasks.filter(
    (t) => t.age_hours > thresholds.pending_task_age_hours,
  );
  if (staleTasks.length > 0) {
    const oldest = staleTasks[0];
    reasons.push(
      `Stale pending task: "${oldest.subject}" has been pending ${oldest.age_hours}h (threshold: ${thresholds.pending_task_age_hours}h)`,
    );
    if (level === "GREEN") level = "YELLOW";
  }

  return { level, reasons };
}

// ---- Main Sensor ----

export default async function agentHealthSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  log("Starting health check for Loom...");

  let config: AgentConfig;
  try {
    config = await loadAgentConfig();
    log(`Loaded config for ${config.name} (${config.codename})`);
  } catch (err) {
    log(`Failed to load agent config: ${err}`);
    return "error";
  }

  // Gather all data in parallel; use allSettled so one failure doesn't abort everything
  const gatheredAt = new Date().toISOString();
  const [cycleResult, failureResult, gitResult, gateResult, pendingResult] =
    await Promise.allSettled([
      gatherCycleMetrics(config),
      gatherTaskFailures(config),
      gatherGitActivity(config),
      gatherGateState(config),
      gatherPendingTaskAge(config),
    ]);

  // Check if all SSH calls failed (indicates connectivity problem)
  const allFailed = [cycleResult, failureResult, gitResult, gateResult, pendingResult].every(
    (r) => r.status === "rejected",
  );

  if (allFailed) {
    log("All SSH gather operations failed — connectivity issue with Loom");
    return "error";
  }

  // Assemble health data (use empty defaults for any rejected promises)
  const data: HealthData = {
    gathered_at: gatheredAt,
    cycle_metrics:
      cycleResult.status === "fulfilled"
        ? cycleResult.value
        : {
            cycles_checked: 0,
            total_tokens_in: 0,
            total_cost_usd: 0,
            avg_tokens_per_cycle: 0,
            avg_cost_per_cycle: 0,
            max_tokens_in_single_cycle: 0,
            max_cost_single_cycle: 0,
            spike_cycles: [],
            error: cycleResult.reason instanceof Error ? cycleResult.reason.message : String(cycleResult.reason),
          },
    task_failures:
      failureResult.status === "fulfilled"
        ? failureResult.value
        : { failed_sources: [], error: String((failureResult as PromiseRejectedResult).reason) },
    git_activity:
      gitResult.status === "fulfilled"
        ? gitResult.value
        : { commits_since_last_check: 0, watched_path_commits: [], error: String((gitResult as PromiseRejectedResult).reason) },
    gate_state:
      gateResult.status === "fulfilled"
        ? gateResult.value
        : { dispatch_gate: { status: "unknown" }, watchdog: {}, error: String((gateResult as PromiseRejectedResult).reason) },
    pending_task_age:
      pendingResult.status === "fulfilled"
        ? pendingResult.value
        : { oldest_tasks: [], error: String((pendingResult as PromiseRejectedResult).reason) },
  };

  const { level, reasons } = preClassify(data, config);

  log(`Classification: ${level}${reasons.length > 0 ? ` — ${reasons[0]}` : ""}`);

  if (level === "GREEN") {
    log("All metrics within thresholds — no task created");
    return "ok";
  }

  // YELLOW or RED: format data block and create task for Haiku analysis
  const dataBlock = formatDataBlock(data, config);

  const subject = `[Loom Health] ${level} - ${reasons[0]}`;
  const description = [
    `External health check for Loom (${config.codename}) detected ${level} condition.`,
    "",
    "## Signals",
    ...reasons.map((r) => `- ${r}`),
    "",
    dataBlock,
  ].join("\n");

  const taskId = insertTaskIfNew(TASK_SOURCE, {
    subject,
    description,
    priority: level === "RED" ? 7 : 5,
    skills: JSON.stringify(["agent-health", "arc-email-sync"]),
    model: "haiku",
  });

  if (taskId !== null) {
    log(`Created ${level} task #${taskId}: ${subject}`);
  } else {
    log(`Task already pending for ${TASK_SOURCE} — skipped duplicate`);
  }

  return "ok";
}
