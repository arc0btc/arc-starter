/**
 * Memory topic resolution — maps skills to relevant memory topic files.
 * Part of memory architecture v2 (Phase 1: topical file split).
 *
 * Instead of loading the entire MEMORY.md into every dispatch prompt,
 * this resolves only the topic files relevant to the task's skills.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const TOPICS_DIR = join(ROOT, "memory", "topics");

/** Maps skill names to the memory topic files they need. */
const SKILL_TOPIC_MAP: Record<string, string[]> = {
  "blog-publishing":       ["publishing"],
  "blog-deploy":           ["publishing", "infrastructure"],
  "arc0btc-site-health":   ["publishing", "infrastructure"],
  "arc-payments":          ["integrations", "defi"],
  "arc-email-sync":        ["integrations"],
  "fleet-handoff":         ["fleet"],
  "fleet-task-sync":       ["fleet"],
  "arc-service-health":    ["incidents", "infrastructure"],
  "dao-zero-authority":    ["defi"],
  "x402-sponsor-relay":    ["integrations", "identity"],
  "arc-skill-manager":     ["fleet"],
  "arc-cost-report":       ["cost"],
  "arc-failure-triage":    ["incidents"],
  "arc-workflows":         ["integrations", "infrastructure"],
  "contacts":              ["fleet", "identity"],
  "arc-x":                 ["identity", "publishing"],
  "aibtc-news-editorial":  ["publishing", "integrations"],
  "github-release-watcher": ["integrations"],
};

/** Default topics loaded when no skill-specific mapping exists. */
const DEFAULT_TOPICS = ["fleet", "incidents"];

function readFile(filePath: string): string {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Resolve memory context for a dispatch prompt.
 * Always loads the slim MEMORY.md index, plus topic files mapped to the task's skills.
 * Falls back to loading full MEMORY.md if topics/ directory doesn't exist.
 */
export function resolveMemoryContext(skillNames: string[]): string {
  const indexPath = join(ROOT, "memory", "MEMORY.md");
  const index = readFile(indexPath);

  // Fallback: if topics dir doesn't exist, return full MEMORY.md (backwards compat)
  if (!existsSync(TOPICS_DIR)) {
    return index;
  }

  // Collect unique topics from all skills
  const topics = new Set<string>(DEFAULT_TOPICS);
  for (const skill of skillNames) {
    const mapped = SKILL_TOPIC_MAP[skill];
    if (mapped) {
      for (const t of mapped) topics.add(t);
    }
  }

  // Load topic files
  const topicContents = [...topics]
    .map((topic) => {
      const content = readFile(join(TOPICS_DIR, topic + ".md"));
      return content ? `## Memory: ${topic}\n${content}` : "";
    })
    .filter(Boolean)
    .join("\n\n");

  return [index, topicContents].filter(Boolean).join("\n\n");
}

/**
 * List which topics would be loaded for a given set of skills.
 * Useful for debugging and the consolidation CLI.
 */
export function resolveTopics(skillNames: string[]): string[] {
  const topics = new Set<string>(DEFAULT_TOPICS);
  for (const skill of skillNames) {
    const mapped = SKILL_TOPIC_MAP[skill];
    if (mapped) {
      for (const t of mapped) topics.add(t);
    }
  }
  return [...topics];
}
