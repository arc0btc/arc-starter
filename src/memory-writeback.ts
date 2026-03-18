/**
 * Memory write-back — auto-extracts learnings from completed task results
 * and stores them as structured memory entries with dedup, TTL, and tagging.
 *
 * Called post-dispatch for P1-4 tasks to ensure memory grows deliberately.
 */

import {
  type Task,
  type ArcMemoryFull,
  searchArcMemory,
  upsertMemory,
  countArcMemories,
  consolidateMemories,
} from "./db.ts";

// ---- Types ----

export interface ExtractedLearning {
  key: string;
  domain: string;
  content: string;
  importance: number;
  ttl_days: number;
  tags: string;
}

export interface WriteBackResult {
  extracted: number;
  stored: number;
  duplicates: number;
  consolidated: boolean;
}

// ---- Pattern definitions ----

interface ExtractionPattern {
  /** Regex to match a learning block in result text */
  pattern: RegExp;
  /** Domain to file the learning under */
  domain: string;
  /** Key prefix for the memory entry */
  keyPrefix: string;
  /** Default importance (1=critical, 10=ephemeral) */
  importance: number;
  /** TTL in days */
  ttl_days: number;
}

const EXTRACTION_PATTERNS: ExtractionPattern[] = [
  // Incident patterns — root cause / fix documentation
  {
    pattern: /(?:Root cause|ROOT CAUSE)[:\s]+(.{20,500}?)(?:\n\n|\nFix[:\s]|\nResolution[:\s]|$)/gis,
    domain: "incidents",
    keyPrefix: "incident",
    importance: 3,
    ttl_days: 90,
  },
  {
    pattern: /(?:Symptom)[:\s]+(.{15,300}?)(?:\s*Root cause[:\s]+.{15,300}?)(?:\s*Fix[:\s]+.{15,300})/gis,
    domain: "incidents",
    keyPrefix: "incident",
    importance: 3,
    ttl_days: 90,
  },
  // Pattern learnings
  {
    pattern: /(?:Pattern|PATTERN)[:\s]+(.{20,400}?)(?:\n\n|$)/gis,
    domain: "patterns",
    keyPrefix: "pattern",
    importance: 4,
    ttl_days: 180,
  },
  // Explicit learnings / lessons
  {
    pattern: /(?:Lesson learned|Learning|KEY LEARNING|LEARNING)[:\s]+(.{20,400}?)(?:\n\n|$)/gis,
    domain: "incidents",
    keyPrefix: "learning",
    importance: 4,
    ttl_days: 365,
  },
  // Prevention notes
  {
    pattern: /(?:Prevention|PREVENTION|To prevent this)[:\s]+(.{20,300}?)(?:\n\n|$)/gis,
    domain: "incidents",
    keyPrefix: "prevention",
    importance: 3,
    ttl_days: 180,
  },
  // Architecture decisions
  {
    pattern: /(?:Architecture decision|DECISION|Design decision)[:\s]+(.{20,400}?)(?:\n\n|$)/gis,
    domain: "patterns",
    keyPrefix: "decision",
    importance: 2,
    ttl_days: 365,
  },
  // Memory add commands executed during the task (capture what was stored)
  {
    pattern: /arc memory add --key "([^"]+)" --domain (\w+)[^\n]*--content "([^"]{20,})"/gi,
    domain: "_from_match",
    keyPrefix: "_from_match",
    importance: 5,
    ttl_days: 60,
  },
];

/** Threshold: if a domain exceeds this count after writing, trigger consolidation */
const DOMAIN_CONSOLIDATION_THRESHOLD = 75;

/** Max learnings to extract per task to avoid flooding memory */
const MAX_LEARNINGS_PER_TASK = 5;

/** Minimum similarity score (0-1) to consider a duplicate */
const DEDUP_SIMILARITY_THRESHOLD = 0.6;

// ---- Core logic ----

/**
 * Extract structured learnings from a task's result_detail using pattern matching.
 */
export function extractLearnings(task: Task): ExtractedLearning[] {
  const text = task.result_detail ?? task.result_summary ?? "";
  if (text.length < 50) return [];

  const learnings: ExtractedLearning[] = [];
  const seen = new Set<string>();

  for (const spec of EXTRACTION_PATTERNS) {
    // Reset regex state for each task
    spec.pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = spec.pattern.exec(text)) !== null) {
      if (learnings.length >= MAX_LEARNINGS_PER_TASK) break;

      // For arc memory add commands, extract from captured groups
      if (spec.keyPrefix === "_from_match") {
        // Already written via CLI — skip to avoid double-write
        continue;
      }

      const content = match[1].trim();
      if (content.length < 20) continue;

      // Deduplicate within this extraction pass
      const contentHash = content.slice(0, 80).toLowerCase();
      if (seen.has(contentHash)) continue;
      seen.add(contentHash);

      const slug = slugify(content.slice(0, 50));
      const key = `${spec.keyPrefix}:${slug}-t${task.id}`;

      const skills = parseSkillsList(task.skills);
      const tags = [
        `source:task:${task.id}`,
        `priority:${task.priority}`,
        ...skills.map((s) => `skill:${s}`),
      ].join(" ");

      learnings.push({
        key,
        domain: spec.domain,
        content: `[Task #${task.id}] ${content}`,
        importance: spec.importance,
        ttl_days: spec.ttl_days,
        tags,
      });
    }
  }

  return learnings;
}

/**
 * Check if a learning is a duplicate of an existing memory entry.
 * Uses FTS5 search + simple word-overlap similarity.
 */
function isDuplicate(learning: ExtractedLearning): boolean {
  // Extract significant words for search query
  const queryWords = learning.content
    .replace(/\[Task #\d+\]\s*/, "")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 5)
    .join(" ");

  if (!queryWords) return false;

  let existing: ArcMemoryFull[];
  try {
    existing = searchArcMemory(queryWords, learning.domain, 5);
  } catch {
    return false;
  }

  if (existing.length === 0) return false;

  // Compare word-level similarity
  const learningWords = new Set(
    learning.content.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
  );

  for (const entry of existing) {
    const entryWords = new Set(
      entry.content.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
    );

    const intersection = [...learningWords].filter((w) => entryWords.has(w)).length;
    const union = new Set([...learningWords, ...entryWords]).size;

    if (union > 0 && intersection / union >= DEDUP_SIMILARITY_THRESHOLD) {
      return true;
    }
  }

  return false;
}

/**
 * Main entry point: extract learnings from a completed task and store them.
 * Only processes P1-4 tasks (high-value work worth remembering).
 */
export function writeBackLearnings(task: Task, costUsd: number, apiCostUsd: number): WriteBackResult {
  const result: WriteBackResult = {
    extracted: 0,
    stored: 0,
    duplicates: 0,
    consolidated: false,
  };

  // Only process P1-4 tasks
  if (task.priority > 4) return result;

  const learnings = extractLearnings(task);
  result.extracted = learnings.length;

  if (learnings.length === 0) return result;

  const affectedDomains = new Set<string>();

  for (const learning of learnings) {
    if (isDuplicate(learning)) {
      result.duplicates++;
      continue;
    }

    upsertMemory({
      key: learning.key,
      domain: learning.domain,
      content: learning.content,
      tags: learning.tags,
      ttl_days: learning.ttl_days,
      importance: learning.importance,
      source_task_id: task.id,
      cost_usd: costUsd,
      api_cost_usd: apiCostUsd,
    });

    affectedDomains.add(learning.domain);
    result.stored++;
  }

  // Trigger consolidation if any affected domain exceeds threshold
  for (const domain of affectedDomains) {
    const count = countArcMemories(domain);
    if (count > DOMAIN_CONSOLIDATION_THRESHOLD) {
      consolidateMemories(domain);
      result.consolidated = true;
    }
  }

  return result;
}

// ---- Helpers ----

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function parseSkillsList(skills: string | null): string[] {
  if (!skills) return [];
  try {
    const parsed = JSON.parse(skills);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
