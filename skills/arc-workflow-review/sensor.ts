// workflow-review/sensor.ts
//
// Detects repeating multi-step task patterns and proposes workflow state machines.
// Runs every 4 hours. Pure TypeScript — no LLM.
//
// Detection strategy (two-pronged):
// 1. Source-chain patterns: sensor sources that consistently spawn follow-up tasks
// 2. Root-subject patterns: normalized root subjects that recur with child tasks
//
// A pattern qualifies when it recurs ≥3 times with ≥2 steps per chain.

import { claimSensorRun, createSensorLogger, readHookState, writeHookState } from "../../src/sensors.ts";
import {
  getDatabase,
  insertTask,
  pendingTaskExistsForSource,
} from "../../src/db.ts";
import type { Task } from "../../src/db.ts";

const SENSOR_NAME = "arc-workflow-review";
const INTERVAL_MINUTES = 720; // 12 hours — pattern detection is slow-burn
const TASK_SOURCE = "sensor:arc-workflow-review";
const LOOKBACK_DAYS = 7;
const MIN_RECURRENCES = 3;

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

/**
 * Normalize a source into a groupable prefix.
 * Strips instance-specific suffixes to group by "type" of source.
 * "sensor:arc-email-sync:thread:whoabuddy@gmail.com" → "sensor:arc-email-sync:thread"
 * "sensor:aibtc-repo-maintenance:pr:aibtcdev/skills#65" → "sensor:aibtc-repo-maintenance:pr"
 * "task:42" → "task:*"
 */
function normalizeSource(source: string | null): string {
  if (!source) return "unknown";
  if (source.startsWith("task:")) return "task:*";

  // Strip instance-specific parts: anything after the 3rd colon segment
  // sensor:arc-email-sync:thread:whoabuddy@gmail.com → sensor:arc-email-sync:thread
  // sensor:aibtc-repo-maintenance:pr:aibtcdev/skills#65 → sensor:aibtc-repo-maintenance:pr
  const parts = source.split(":");
  if (parts.length > 3) return parts.slice(0, 3).join(":");
  return source;
}

/**
 * Normalize a task subject for root-level grouping.
 * More aggressive than per-child normalization — extracts the "type" of task.
 * "CEO review — 2026-03-02T21:03" → "ceo review"
 * "Email thread from Jason S (1 messages)" → "email thread"
 * "architecture review — diagram stale" → "architecture review"
 */
function normalizeRootSubject(subject: string): string {
  return (
    subject
      .toLowerCase()
      // Remove everything after em-dash, colon, or parenthetical
      .replace(/\s*[—–]\s*.*/g, "")
      .replace(/\s*\(.*\)/g, "")
      .replace(/\s*:\s*.*/g, "")
      // Remove dates, numbers, hashes
      .replace(/\d{4}-\d{2}-\d{2}[T\s]?\d{2}:\d{2}(:\d{2})?Z?/g, "")
      .replace(/\b[a-f0-9]{7,40}\b/g, "")
      .replace(/\b\d+\b/g, "")
      // Remove "from NAME" patterns
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

/**
 * Build chain info for all root tasks that spawn children.
 */
function buildChainInfos(tasks: Task[]): ChainInfo[] {
  const byId = new Map<number, Task>();
  for (const t of tasks) byId.set(t.id, t);

  // Build parent→children map
  const childrenOf = new Map<number, Task[]>();
  for (const t of tasks) {
    // Link via parent_id
    if (t.parent_id && byId.has(t.parent_id)) {
      const children = childrenOf.get(t.parent_id) ?? [];
      if (!children.some((c) => c.id === t.id)) {
        children.push(t);
        childrenOf.set(t.parent_id, children);
      }
    }
    // Link via "task:N" source
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

  // Identify child task IDs
  const isChild = new Set<number>();
  for (const children of childrenOf.values()) {
    for (const c of children) isChild.add(c.id);
  }

  // Collect all descendants recursively
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
  key: string; // grouping key
  description: string;
  recurrences: number;
  avgSteps: number;
  examples: string[]; // example root subjects
  childExamples: string[]; // example child subjects
  involvedSkills: string[];
}

/**
 * Detect patterns by grouping chains two ways:
 * 1. By normalized source prefix (same sensor type → same chain structure)
 * 2. By normalized root subject (same kind of root task → same chain structure)
 */
function detectPatterns(chains: ChainInfo[]): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  // Strategy 1: Group by source prefix
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

  // Strategy 2: Group by normalized root subject
  const bySubject = new Map<string, ChainInfo[]>();
  for (const chain of chains) {
    const key = normalizeRootSubject(chain.rootSubject);
    if (key.length < 3) continue; // skip too-short keys
    const subjectGroup = bySubject.get(key) ?? [];
    subjectGroup.push(chain);
    bySubject.set(key, subjectGroup);
  }

  for (const [subj, group] of bySubject) {
    if (group.length < MIN_RECURRENCES) continue;
    // Skip if already detected by source-prefix strategy
    const src = normalizeSource(group[0].rootSource);
    if (patterns.some((p) => p.key === `source:${src}`)) continue;

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

  // Sort by recurrences × avgSteps (highest impact first)
  patterns.sort((a, b) => b.recurrences * b.avgSteps - a.recurrences * a.avgSteps);

  return patterns;
}

export default async function workflowReviewSensor(): Promise<string> {
  // Read state BEFORE claimSensorRun to preserve custom fields (proposed_keys)
  const statePre = await readHookState(SENSOR_NAME);
  const proposedKeys: string[] = (statePre?.proposed_keys as string[]) ?? [];

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  if (pendingTaskExistsForSource(TASK_SOURCE)) {
    log("pending review task exists — skipping");
    return "skip";
  }

  // Re-read hook state after claim (has updated version/timestamp)
  const hookState = await readHookState(SENSOR_NAME);

  // Query completed tasks from the lookback window
  const db = getDatabase();
  const tasks = db
    .query(
      `SELECT * FROM tasks
       WHERE status = 'completed'
         AND completed_at > datetime('now', '-${LOOKBACK_DAYS} days')
       ORDER BY completed_at DESC`
    )
    .all() as Task[];

  log(`analyzing ${tasks.length} completed tasks from last ${LOOKBACK_DAYS} days`);

  if (tasks.length < 10) {
    log("too few tasks for pattern detection — skipping");
    if (proposedKeys.length > 0 && hookState) {
      await writeHookState(SENSOR_NAME, { ...hookState, proposed_keys: proposedKeys });
    }
    return "ok";
  }

  // Build chains and detect patterns
  const chains = buildChainInfos(tasks);
  log(`found ${chains.length} task chains with children`);

  const patterns = detectPatterns(chains);
  log(`detected ${patterns.length} recurring patterns`);

  // Filter already-proposed patterns
  const novel = patterns.filter((p) => !proposedKeys.includes(p.key));
  log(`${novel.length} novel patterns after filtering previously proposed`);

  if (novel.length === 0) {
    log("no novel patterns — skipping");
    // Restore proposed_keys that claimSensorRun wiped
    if (proposedKeys.length > 0 && hookState) {
      await writeHookState(SENSOR_NAME, { ...hookState, proposed_keys: proposedKeys });
    }
    return "ok";
  }

  // Build task description
  const lines: string[] = [
    `Workflow review detected ${novel.length} repeating multi-step process(es) not yet modeled as workflow state machines.\n`,
    "For each pattern, evaluate whether a formal state machine would add value.",
    "If yes, design the template in skills/arc-workflows/state-machine.ts and register in getTemplateByName().\n",
  ];

  for (const pattern of novel.slice(0, 5)) {
    lines.push(`## ${pattern.key}`);
    lines.push(`${pattern.description}`);
    lines.push(`- Recurrences: ${pattern.recurrences}`);
    lines.push(`- Avg steps per chain: ${pattern.avgSteps.toFixed(1)}`);
    lines.push(`- Skills involved: ${pattern.involvedSkills.join(", ") || "none"}`);
    lines.push(`- Root examples: ${pattern.examples.join("; ")}`);
    lines.push(`- Child examples: ${pattern.childExamples.join("; ")}`);
    lines.push("");
  }

  insertTask({
    subject: `Workflow design: ${novel.length} repeating pattern(s) detected`,
    description: lines.join("\n"),
    skills: '["arc-workflows", "arc-skill-manager"]',
    source: TASK_SOURCE,
    priority: 5,
    model: "sonnet",
  });

  // Record proposed keys to avoid re-proposing
  const updatedKeys = [
    ...novel.map((p) => p.key),
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

  log(`created review task for ${novel.length} pattern(s)`);
  return "ok";
}
