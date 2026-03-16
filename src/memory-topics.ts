/**
 * Memory topic resolution — maps skills to relevant memory topic files.
 * Part of memory architecture v2 (Phase 1: topical file split).
 *
 * Instead of loading the entire MEMORY.md into every dispatch prompt,
 * this resolves only the topic files relevant to the task's skills.
 *
 * Phase 3b: Also queries arc_memory FTS for high-importance entries
 * relevant to the task's skill domains.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { getHighImportanceMemories, type ArcMemoryFull } from "./db.ts";
import { readFile } from "./utils.ts";

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
  "arc-cost-reporting":    ["cost"],
  "arc-failure-triage":    ["incidents"],
  "arc-workflows":         ["integrations", "infrastructure"],
  "contacts":              ["fleet", "identity"],
  "arc-x":                 ["identity", "publishing"],
  "aibtc-news-editorial":  ["publishing", "integrations"],
  "github-release-watcher": ["integrations"],
};

/** Default topics loaded when no skill-specific mapping exists. */
const DEFAULT_TOPICS = ["fleet", "incidents"];

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

/** Maps topic file names to FTS domain names (most are 1:1 except infrastructure→infra). */
const TOPIC_TO_DOMAIN: Record<string, string> = {
  fleet: "fleet",
  incidents: "incidents",
  cost: "cost",
  integrations: "integrations",
  defi: "defi",
  publishing: "publishing",
  identity: "identity",
  infrastructure: "infra",
};

/**
 * Resolve high-importance FTS memory entries for the given skills.
 * Returns a formatted string suitable for injection into the dispatch prompt,
 * or empty string if no entries found.
 */
export function resolveFtsMemoryContext(skillNames: string[]): string {
  const topics = resolveTopics(skillNames);
  const domains = topics
    .map((t) => TOPIC_TO_DOMAIN[t] ?? t)
    .filter(Boolean);

  if (domains.length === 0) return "";

  let entries: ArcMemoryFull[];
  try {
    entries = getHighImportanceMemories(domains, 10);
  } catch {
    // FTS table may not exist yet or DB not initialized — graceful fallback
    return "";
  }

  if (entries.length === 0) return "";

  // Dedup by key (getHighImportanceMemories already returns unique rows, but guard against edge cases)
  const seen = new Set<string>();
  const deduped = entries.filter((e) => {
    if (seen.has(e.key)) return false;
    seen.add(e.key);
    return true;
  });

  const bullets = deduped.map(
    (e) => `- **[${e.domain}]** \`${e.key}\`: ${e.content.slice(0, 200)}${e.content.length > 200 ? "…" : ""}`
  );

  return `## Memory: Key Entries\n${bullets.join("\n")}`;
}
