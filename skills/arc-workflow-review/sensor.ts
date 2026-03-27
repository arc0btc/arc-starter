// workflow-review/sensor.ts
//
// Evaluates workflow system health and detects new repeating patterns.
// Two-pass approach:
//   Pass 1: Template health — utilization, completion rates, stale instances
//   Pass 2: Pattern detection — repeating multi-step chains not yet modeled
//
// Also enforces a 30-day auto-stale TTL on non-completed workflows.
// Runs every 12 hours. Pure TypeScript — no LLM.

import { claimSensorRun, createSensorLogger, readHookState, writeHookState } from "../../src/sensors.ts";
import {
  getDatabase,
  insertTask,
  pendingTaskExistsForSource,
} from "../../src/db.ts";
import type { Task } from "../../src/db.ts";
import { getTemplateByName } from "../arc-workflows/state-machine.ts";

const SENSOR_NAME = "arc-workflow-review";
const INTERVAL_MINUTES = 720; // 12 hours
const TASK_SOURCE = "sensor:arc-workflow-review";
const LOOKBACK_DAYS = 7;
const MIN_RECURRENCES = 3;
const STALE_WORKFLOW_DAYS = 30;

const log = createSensorLogger(SENSOR_NAME);

/** Known process patterns that already have workflow templates or dedicated sensors. */
const KNOWN_PATTERNS = new Set([
  "blog-posting",
  "signal-filing",
  "beat-claiming",
  "pr-lifecycle",
  "reputation-feedback",
  "validation-request",
  "inscription",
  // Sensor sources with established handling (no workflow needed — they're atomic)
  "sensor:aibtc-heartbeat",
  "sensor:arc-service-health",
  "sensor:arc-memory-consolidate",
  // Generic sources that aren't meaningful patterns
  "unknown",
  "task:*",
]);

/** Source prefixes to skip — human-initiated tasks are inherently varied. */
const SKIP_SOURCE_PREFIXES = ["human:"];

const KNOWN_SUBJECT_PREFIXES = [
  "[github-issue-monitor]",
  "for re-review",
];

function normalizeSource(source: string | null): string {
  if (!source) return "unknown";
  if (source.startsWith("task:")) return "task:*";
  const parts = source.split(":");
  if (parts.length > 3) return parts.slice(0, 3).join(":");
  return source;
}

function normalizeRootSubject(subject: string): string {
  return (
    subject
      .toLowerCase()
      .replace(/\s*[—–]\s*.*/g, "")
      .replace(/\s*\(.*\)/g, "")
      .replace(/\s*:\s*.*/g, "")
      .replace(/\d{4}-\d{2}-\d{2}[T\s]?\d{2}:\d{2}(:\d{2})?Z?/g, "")
      .replace(/\b[a-f0-9]{7,40}\b/g, "")
      .replace(/\b\d+\b/g, "")
      .replace(/\bfrom\s+\w+(\s+\w)?/g, "from")
      .replace(/\s+/g, " ")
      .trim()
  );
}

interface ChainInfo {
  rootId: number;
  rootSubject: string;
  rootSource: string | null;
  childCount: number;
  childSubjects: string[];
  skills: Set<string>;
}

function buildChainInfos(tasks: Task[]): ChainInfo[] {
  const byId = new Map<number, Task>();
  for (const t of tasks) byId.set(t.id, t);

  const childrenOf = new Map<number, Task[]>();
  for (const t of tasks) {
    if (t.parent_id && byId.has(t.parent_id)) {
      const children = childrenOf.get(t.parent_id) ?? [];
      if (!children.some((c) => c.id === t.id)) {
        children.push(t);
        childrenOf.set(t.parent_id, children);
      }
    }
    if (t.source?.startsWith("task:")) {
      const parentId = parseInt(t.source.slice(5), 10);
      if (!isNaN(parentId) && byId.has(parentId) && parentId !== t.id) {
        const children = childrenOf.get(parentId) ?? [];
        if (!children.some((c) => c.id === t.id)) {
          children.push(t);
          childrenOf.set(parentId, children);
        }
      }
    }
  }

  const isChild = new Set<number>();
  for (const children of childrenOf.values()) {
    for (const c of children) isChild.add(c.id);
  }

  function collectDescendants(parentId: number): Task[] {
    const direct = childrenOf.get(parentId) ?? [];
    const all: Task[] = [...direct];
    for (const c of direct) all.push(...collectDescendants(c.id));
    return all;
  }

  const chains: ChainInfo[] = [];
  for (const t of tasks) {
    if (isChild.has(t.id)) continue;
    const descendants = collectDescendants(t.id);
    if (descendants.length === 0) continue;

    const skills = new Set<string>();
    for (const d of [t, ...descendants]) {
      if (d.skills) {
        try {
          const parsed = JSON.parse(d.skills) as string[];
          for (const s of parsed) skills.add(s);
        } catch {
          // ignore
        }
      }
    }

    chains.push({
      rootId: t.id,
      rootSubject: t.subject,
      rootSource: t.source,
      childCount: descendants.length,
      childSubjects: descendants.slice(0, 5).map((d) => d.subject),
      skills,
    });
  }

  return chains;
}

interface DetectedPattern {
  key: string;
  description: string;
  recurrences: number;
  avgSteps: number;
  examples: string[];
  childExamples: string[];
  involvedSkills: string[];
}

function detectPatterns(chains: ChainInfo[]): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  const bySource = new Map<string, ChainInfo[]>();
  for (const chain of chains) {
    const src = normalizeSource(chain.rootSource);
    const sourceGroup = bySource.get(src) ?? [];
    sourceGroup.push(chain);
    bySource.set(src, sourceGroup);
  }

  for (const [src, group] of bySource) {
    if (group.length < MIN_RECURRENCES) continue;
    if (KNOWN_PATTERNS.has(src)) continue;
    if (SKIP_SOURCE_PREFIXES.some((p) => src.startsWith(p))) continue;

    const avgSteps =
      group.reduce((sum, c) => sum + 1 + c.childCount, 0) / group.length;
    const allSkills = new Set<string>();
    for (const c of group) {
      for (const s of c.skills) allSkills.add(s);
    }

    patterns.push({
      key: `source:${src}`,
      description: `Tasks from "${src}" consistently spawn follow-up chains`,
      recurrences: group.length,
      avgSteps,
      examples: group.slice(0, 3).map((c) => c.rootSubject),
      childExamples: group
        .flatMap((c) => c.childSubjects.slice(0, 1))
        .slice(0, 3),
      involvedSkills: [...allSkills],
    });
  }

  const bySubject = new Map<string, ChainInfo[]>();
  for (const chain of chains) {
    const key = normalizeRootSubject(chain.rootSubject);
    if (key.length < 3) continue;
    const subjectGroup = bySubject.get(key) ?? [];
    subjectGroup.push(chain);
    bySubject.set(key, subjectGroup);
  }

  for (const [subj, group] of bySubject) {
    if (group.length < MIN_RECURRENCES) continue;
    const src = normalizeSource(group[0].rootSource);
    if (patterns.some((p) => p.key === `source:${src}`)) continue;
    if (KNOWN_SUBJECT_PREFIXES.some((p) => subj.startsWith(p))) continue;

    const avgSteps =
      group.reduce((sum, c) => sum + 1 + c.childCount, 0) / group.length;
    const allSkills = new Set<string>();
    for (const c of group) {
      for (const s of c.skills) allSkills.add(s);
    }

    patterns.push({
      key: `subject:${subj}`,
      description: `"${subj}" tasks consistently create follow-up chains`,
      recurrences: group.length,
      avgSteps,
      examples: group.slice(0, 3).map((c) => c.rootSubject),
      childExamples: group
        .flatMap((c) => c.childSubjects.slice(0, 1))
        .slice(0, 3),
      involvedSkills: [...allSkills],
    });
  }

  patterns.sort((a, b) => b.recurrences * b.avgSteps - a.recurrences * a.avgSteps);
  return patterns;
}

function patternAlreadyModeled(patternKey: string): boolean {
  const candidates: string[] = [];

  if (patternKey.startsWith("source:")) {
    const parts = patternKey.slice("source:".length).split(":");
    const meaningful = parts.filter((p) => p && p !== "sensor");
    for (const part of meaningful) {
      candidates.push(part);
      if (part.startsWith("arc-")) candidates.push(part.slice(4));
    }
    for (let i = 0; i < meaningful.length - 1; i++) {
      const a = meaningful[i];
      const b = meaningful[i + 1];
      candidates.push(`${a}-${b}`);
      if (a.startsWith("arc-")) candidates.push(`${a.slice(4)}-${b}`);
    }
  } else if (patternKey.startsWith("subject:")) {
    const subject = patternKey.slice("subject:".length);
    candidates.push(subject.replace(/\s+/g, "-"));
    const firstWord = subject.split(/[\s-]+/)[0];
    if (firstWord && firstWord.length > 2) candidates.push(firstWord);
  }

  return candidates.some((name) => getTemplateByName(name) !== null);
}

// --- Pass 1: Template Health Evaluation ---

interface TemplateHealth {
  template: string;
  total: number;
  completed: number;
  stale: number;
  active: number;
  completionRate: number;
  lastActivity: string | null;
  stuckStates: string[]; // non-terminal states with instances stuck >7d
}

function evaluateTemplateHealth(db: ReturnType<typeof getDatabase>): {
  health: TemplateHealth[];
  staleCount: number;
  orphanCount: number;
} {
  // Get all workflow stats grouped by template
  const rows = db
    .query(
      `SELECT
        template,
        current_state,
        count(*) as cnt,
        max(updated_at) as last_update,
        sum(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) as completed_cnt,
        sum(CASE WHEN completed_at IS NULL AND updated_at < datetime('now', '-7 days') THEN 1 ELSE 0 END) as stuck_cnt,
        sum(CASE WHEN completed_at IS NULL AND updated_at < datetime('now', '-${STALE_WORKFLOW_DAYS} days') THEN 1 ELSE 0 END) as stale_cnt
      FROM workflows
      GROUP BY template, current_state
      ORDER BY template, cnt DESC`
    )
    .all() as Array<{
      template: string;
      current_state: string;
      cnt: number;
      last_update: string;
      completed_cnt: number;
      stuck_cnt: number;
      stale_cnt: number;
    }>;

  // Aggregate by template
  const byTemplate = new Map<string, TemplateHealth>();
  let totalStale = 0;
  let orphanCount = 0;

  for (const row of rows) {
    // Check if template is registered
    const isRegistered = getTemplateByName(row.template) !== null;
    if (!isRegistered) {
      orphanCount += row.cnt;
      continue;
    }

    const existing = byTemplate.get(row.template) ?? {
      template: row.template,
      total: 0,
      completed: 0,
      stale: 0,
      active: 0,
      completionRate: 0,
      lastActivity: null,
      stuckStates: [],
    };

    existing.total += row.cnt;
    existing.completed += row.completed_cnt;
    existing.stale += row.stale_cnt;
    existing.active += row.cnt - row.completed_cnt;
    totalStale += row.stale_cnt;

    if (!existing.lastActivity || row.last_update > existing.lastActivity) {
      existing.lastActivity = row.last_update;
    }

    if (row.stuck_cnt > 0 && row.completed_cnt === 0) {
      existing.stuckStates.push(`${row.current_state} (${row.stuck_cnt})`);
    }

    byTemplate.set(row.template, existing);
  }

  // Calculate completion rates
  for (const h of byTemplate.values()) {
    h.completionRate = h.total > 0 ? (h.completed / h.total) * 100 : 0;
  }

  return {
    health: [...byTemplate.values()].sort((a, b) => a.completionRate - b.completionRate),
    staleCount: totalStale,
    orphanCount,
  };
}

// --- Auto-stale: close workflows past TTL ---

function autoStaleWorkflows(db: ReturnType<typeof getDatabase>): number {
  const result = db
    .query(
      `UPDATE workflows
       SET current_state = 'closed-stale', completed_at = datetime('now')
       WHERE completed_at IS NULL
         AND current_state != 'closed-stale'
         AND updated_at < datetime('now', '-${STALE_WORKFLOW_DAYS} days')`
    )
    .run();
  return result.changes;
}

export default async function workflowReviewSensor(): Promise<string> {
  const statePre = await readHookState(SENSOR_NAME);
  const proposedKeys: string[] = (statePre?.proposed_keys as string[]) ?? [];

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  if (pendingTaskExistsForSource(TASK_SOURCE)) {
    log("pending review task exists — skipping");
    return "skip";
  }

  const hookState = await readHookState(SENSOR_NAME);
  const db = getDatabase();

  // --- Auto-stale enforcement ---
  const staleClosed = autoStaleWorkflows(db);
  if (staleClosed > 0) {
    log(`auto-stale: closed ${staleClosed} workflow(s) past ${STALE_WORKFLOW_DAYS}-day TTL`);
  }

  // --- Pass 1: Template health evaluation ---
  const { health, staleCount, orphanCount } = evaluateTemplateHealth(db);

  const unhealthy = health.filter(
    (h) => h.completionRate < 70 || h.stuckStates.length > 0 || h.stale > 0
  );
  const unused = health.filter((h) => h.total === 0);

  log(`template health: ${health.length} templates, ${unhealthy.length} unhealthy, ${orphanCount} orphan rows`);

  // --- Pass 2: Pattern detection (existing logic) ---
  const tasks = db
    .query(
      `SELECT * FROM tasks
       WHERE status = 'completed'
         AND completed_at > datetime('now', '-${LOOKBACK_DAYS} days')
       ORDER BY completed_at DESC`
    )
    .all() as Task[];

  log(`analyzing ${tasks.length} completed tasks from last ${LOOKBACK_DAYS} days`);

  let unmodeled: DetectedPattern[] = [];
  if (tasks.length >= 10) {
    const chains = buildChainInfos(tasks);
    log(`found ${chains.length} task chains with children`);

    const patterns = detectPatterns(chains);
    const novel = patterns.filter((p) => !proposedKeys.includes(p.key));
    unmodeled = novel.filter((p) => !patternAlreadyModeled(p.key));
    log(`${unmodeled.length} unmodeled patterns after filtering`);
  }

  // --- Decide whether to create a task ---
  const hasHealthIssues = unhealthy.length > 0 || orphanCount > 0;
  const hasNewPatterns = unmodeled.length > 0;

  if (!hasHealthIssues && !hasNewPatterns) {
    log("no health issues or new patterns — skipping");
    if (proposedKeys.length > 0 && hookState) {
      await writeHookState(SENSOR_NAME, { ...hookState, proposed_keys: proposedKeys });
    }
    return "ok";
  }

  // --- Build task description ---
  const lines: string[] = [];
  let subject = "";

  if (hasHealthIssues) {
    lines.push("# Workflow System Health\n");

    if (staleClosed > 0) {
      lines.push(`Auto-stale: ${staleClosed} workflow(s) closed past ${STALE_WORKFLOW_DAYS}-day TTL this cycle.\n`);
    }

    if (orphanCount > 0) {
      lines.push(`## Orphan Workflows: ${orphanCount} rows`);
      lines.push(`Workflows using template names not registered in state-machine.ts. These can never advance.`);
      lines.push(`Action: bulk-close as \`closed-stale\` via \`arc skills run --name arc-workflows -- delete\` or direct SQL.\n`);
    }

    if (unhealthy.length > 0) {
      lines.push("## Template Health Report\n");
      lines.push("| Template | Total | Completed | Rate | Active | Stale | Stuck States | Last Activity |");
      lines.push("|----------|-------|-----------|------|--------|-------|-------------|---------------|");
      for (const h of unhealthy) {
        lines.push(
          `| ${h.template} | ${h.total} | ${h.completed} | ${h.completionRate.toFixed(0)}% | ${h.active} | ${h.stale} | ${h.stuckStates.join(", ") || "—"} | ${h.lastActivity?.slice(0, 10) ?? "never"} |`
        );
      }
      lines.push("");
      lines.push("**Actions to consider:**");
      lines.push("- Templates with <70% completion rate: investigate failure patterns, fix or simplify the state machine");
      lines.push("- Templates with stuck instances: transition or close stuck workflows");
      lines.push("- Templates with stale instances: close as stale or fix the advancement path");
      lines.push("");
    }
  }

  if (hasNewPatterns) {
    lines.push("# New Patterns Detected\n");
    lines.push(`${unmodeled.length} repeating multi-step process(es) not yet modeled as workflow state machines.\n`);
    lines.push("For each pattern, evaluate whether a formal state machine would add value.");
    lines.push("If yes, design the template in skills/arc-workflows/state-machine.ts and register in getTemplateByName().\n");

    for (const pattern of unmodeled.slice(0, 5)) {
      lines.push(`## ${pattern.key}`);
      lines.push(`${pattern.description}`);
      lines.push(`- Recurrences: ${pattern.recurrences}`);
      lines.push(`- Avg steps per chain: ${pattern.avgSteps.toFixed(1)}`);
      lines.push(`- Skills involved: ${pattern.involvedSkills.join(", ") || "none"}`);
      lines.push(`- Root examples: ${pattern.examples.join("; ")}`);
      lines.push(`- Child examples: ${pattern.childExamples.join("; ")}`);
      lines.push("");
    }
  }

  // Build subject line
  const parts: string[] = [];
  if (hasHealthIssues) {
    const issues = unhealthy.length + (orphanCount > 0 ? 1 : 0);
    parts.push(`${issues} health issue(s)`);
  }
  if (hasNewPatterns) {
    parts.push(`${unmodeled.length} new pattern(s)`);
  }
  subject = `workflow review — ${parts.join(", ")}`;

  insertTask({
    subject,
    description: lines.join("\n"),
    skills: '["arc-workflows", "arc-skill-manager"]',
    source: TASK_SOURCE,
    priority: 7,
    model: "sonnet",
  });

  // Record proposed keys
  const updatedKeys = [
    ...unmodeled.map((p) => p.key),
    ...proposedKeys.slice(0, 20),
  ];

  const stateToWrite = hookState
    ? { ...hookState, proposed_keys: updatedKeys }
    : {
        last_ran: new Date().toISOString(),
        last_result: "ok",
        version: 1,
        consecutive_failures: 0,
        proposed_keys: updatedKeys,
      };

  await writeHookState(SENSOR_NAME, stateToWrite);

  log(`created review task: ${subject}`);
  return "ok";
}
