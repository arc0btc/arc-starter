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
  // --- Publishing ---
  "blog-publishing":          ["publishing"],
  "blog-deploy":              ["publishing", "infrastructure"],
  "arc-starter-publish":      ["publishing", "infrastructure"],
  "arc-content-quality":      ["publishing"],
  "arc-brand-voice":          ["identity", "publishing"],
  "arc-link-research":        ["publishing"],
  "dev-landing-page-review":  ["publishing"],
  "site-consistency":         ["publishing"],
  "aibtc-news-editorial":     ["publishing", "integrations"],
  "aibtc-news-classifieds":   ["publishing"],
  "aibtc-news-deal-flow":     ["publishing", "defi"],
  "review-commitments":       ["integrations", "publishing"],

  // --- Identity ---
  "erc8004-identity":         ["identity"],
  "erc8004-reputation":       ["identity"],
  "erc8004-trust":            ["identity"],
  "erc8004-validation":       ["identity"],
  "arc-reputation":           ["identity"],
  "arc-introspection":        ["identity"],
  "identity-guard":           ["identity", "incidents"],
  "arc-x":                    ["identity", "publishing"],

  // --- Social ---
  "social-agent-engagement":  ["identity", "publishing"],
  "social-x-ecosystem":       ["identity", "publishing"],
  "social-x-posting":         ["identity", "publishing"],

  // --- DeFi ---
  "arc-payments":             ["integrations", "defi"],
  "dao-zero-authority":       ["defi"],
  "bitflow":                  ["defi"],
  "defi-bitflow":             ["defi"],
  "defi-stacks-market":       ["defi"],
  "defi-zest":                ["defi"],
  "zest-v2":                  ["defi"],
  "mempool-watch":            ["defi"],
  "stacks-stackspot":         ["defi"],
  "bitcoin-wallet":           ["defi", "identity"],
  "bitcoin-quorumclaw":       ["defi", "identity"],
  "bitcoin-taproot-multisig": ["defi", "identity"],

  // --- Fleet ---
  "fleet-handoff":            ["fleet"],
  "fleet-task-sync":          ["fleet"],
  "fleet-comms":              ["fleet"],
  "fleet-dashboard":          ["fleet"],
  "fleet-escalation":         ["fleet", "incidents"],
  "fleet-health":             ["fleet", "infrastructure"],
  "fleet-log-pull":           ["fleet"],
  "fleet-memory":             ["fleet"],
  "fleet-push":               ["fleet"],
  "fleet-rebalance":          ["fleet"],
  "fleet-router":             ["fleet"],
  "fleet-self-sync":          ["fleet"],
  "fleet-sync":               ["fleet"],
  "agent-hub":                ["fleet"],
  "arc-catalog":              ["fleet"],
  "arc-skill-manager":        ["fleet"],
  "contacts":                 ["fleet", "identity"],
  "quest-create":             ["fleet"],
  "worker-deploy":            ["fleet", "infrastructure"],
  "worker-logs-monitor":      ["fleet", "infrastructure"],
  "github-worker-logs":       ["fleet", "integrations"],
  "skill-effectiveness":      ["cost", "fleet"],

  // --- Integrations ---
  "arc-email-sync":           ["integrations"],
  "x402-sponsor-relay":       ["integrations", "identity"],
  "github-release-watcher":   ["integrations"],
  "github-ci-status":         ["integrations"],
  "github-interceptor":       ["integrations"],
  "github-issue-monitor":     ["integrations"],
  "github-mentions":          ["integrations"],
  "github-security-alerts":   ["integrations", "incidents"],
  "claude-code-releases":     ["integrations"],
  "arxiv-research":           ["integrations"],
  "aibtc-inbox-sync":         ["integrations"],
  "aibtc-welcome":            ["integrations"],
  "arc0btc-ask-service":      ["integrations", "identity"],
  "arc0btc-pr-review":        ["integrations"],
  "arc-mcp-server":           ["infrastructure", "integrations"],

  // --- Cost ---
  "arc-cost-report":          ["cost"],
  "arc-cost-reporting":       ["cost"],
  "arc-reporting":            ["cost"],
  "arc-report-email":         ["integrations", "cost"],
  "arc-performance-analytics": ["cost", "infrastructure"],
  "arc0btc-monetization":     ["cost", "identity"],
  "arc-ceo-review":           ["cost", "fleet"],
  "arc-ceo-strategy":         ["cost", "fleet"],

  // --- Incidents ---
  "arc-failure-triage":       ["incidents"],
  "arc-blocked-review":       ["incidents"],
  "arc-dispatch-eval":        ["incidents", "infrastructure"],
  "arc-dispatch-evals":       ["incidents", "infrastructure"],
  "dispatch-watchdog":        ["incidents", "infrastructure"],
  "arc-operational-review":   ["incidents", "cost"],
  "arc-ops-review":           ["incidents", "cost"],
  "arc-self-audit":           ["incidents", "identity"],
  "compliance-review":        ["identity", "incidents"],
  "credential-health":        ["infrastructure", "incidents"],

  // --- Infrastructure ---
  "arc0btc-site-health":      ["publishing", "infrastructure"],
  "arc-service-health":       ["incidents", "infrastructure"],
  "arc-workflows":            ["integrations", "infrastructure"],
  "arc-alive-check":          ["infrastructure"],
  "arc-architecture-review":  ["infrastructure"],
  "arc-credentials":          ["infrastructure"],
  "arc-housekeeping":         ["infrastructure"],
  "arc-memory-expiry":        ["infrastructure"],
  "arc-observatory":          ["fleet", "infrastructure"],
  "arc-remote-setup":         ["infrastructure", "fleet"],
  "arc-scheduler":            ["infrastructure"],
  "arc-umbrel":               ["infrastructure"],
  "arc-web-dashboard":        ["infrastructure", "cost"],
  "arc-workflow-review":      ["infrastructure"],
  "arc-worktrees":            ["infrastructure"],
  "auto-queue":               ["infrastructure"],
  "context-review":           ["infrastructure"],
  "styx":                     ["infrastructure"],

  // --- Cross-domain ---
  "aibtc-dev-ops":            ["integrations", "infrastructure"],
  "aibtc-heartbeat":          ["fleet", "infrastructure"],
  "aibtc-repo-maintenance":   ["infrastructure"],
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
