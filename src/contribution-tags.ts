/**
 * Contribution tagging — structured metadata for PR reviews.
 * See docs/contribution-tagging-pipeline.md for full design.
 *
 * Tags are emitted by the reviewing Claude instance as a ```contribution-tag
 * fenced block in result_detail. Dispatch extracts and inserts them post-cycle.
 */

import { getDatabase } from "./db.ts";

export type RepoClass = "managed" | "collaborative" | "external";
export type ContributionType = "feature" | "bugfix" | "docs" | "refactor" | "test" | "chore" | "security";
export type DemandSignal = "user-reported" | "sensor-detected" | "contributor-initiated" | "unknown";
export type ContributorType = "human" | "agent" | "bot";
export type ReviewDecision = "approved" | "changes-requested" | "commented" | "skipped";

export interface ContributionTag {
  version: 1;

  // ── Company World (ops: velocity, skills, capacity) ──
  company: {
    repo: string;               // "aibtcdev/skills"
    repo_class: RepoClass;      // "managed" | "collaborative" | "external"
    contributor: string;        // GitHub login of PR author
    contributor_type: ContributorType;
    time_to_review_h: number | null;  // hours from PR open to Arc's first review
    review_cycle: number;       // 1 = first review, 2+ = re-review
    files_changed: number;
    lines_delta: number;        // insertions - deletions (net growth)
    skills_area: string[];      // which skill domains touched: ["defi-zest", "x402"]
  };

  // ── Customer World (demand: what the contribution addresses) ──
  customer: {
    type: ContributionType;
    scope: string | null;              // conventional commit scope
    linked_issue: string | null;       // "aibtcdev/skills#268" or null
    demand_signal: DemandSignal;
    beat_relevance: string[];          // which aibtc beats this touches
  };

  // ── Agent World (self-describing: how Arc processed it) ──
  agent: {
    task_id: number;
    task_source: string;               // "sensor:github-mentions", "workflow:42", "human"
    sensor_origin: string;             // "github-mentions" | "aibtc-repo-maintenance" | "manual"
    model: string;                     // "sonnet" | "opus"
    review_cost_usd: number;
    review_decision: ReviewDecision;
    severity_counts: {
      blocking: number;
      suggestion: number;
      nit: number;
      question: number;
    };
    automated_pr: boolean;
  };
}

export interface ContributionTagRecord {
  id: number;
  task_id: number;
  tagged_at: string;
  repo: string;
  repo_class: string;
  contributor: string;
  contributor_type: string;
  time_to_review_h: number | null;
  review_cycle: number;
  files_changed: number;
  lines_delta: number;
  skills_area: string;          // JSON array
  contribution_type: string;
  scope: string | null;
  linked_issue: string | null;
  demand_signal: string | null;
  beat_relevance: string;       // JSON array
  sensor_origin: string | null;
  model: string | null;
  review_cost_usd: number;
  review_decision: string | null;
  severity_blocking: number;
  severity_suggestion: number;
  severity_nit: number;
  severity_question: number;
  automated_pr: number;         // SQLite boolean: 0 | 1
}

/**
 * Parse a ContributionTag from a ```contribution-tag fenced block.
 * Returns null if no block is found or JSON is invalid.
 */
export function extractContributionTagFromText(text: string): ContributionTag | null {
  const match = text.match(/```contribution-tag\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim()) as Record<string, unknown>;
    if (
      parsed["version"] !== 1 ||
      typeof parsed["company"] !== "object" ||
      typeof parsed["customer"] !== "object" ||
      typeof parsed["agent"] !== "object"
    ) {
      return null;
    }
    return parsed as unknown as ContributionTag;
  } catch {
    return null;
  }
}

/**
 * Insert a validated ContributionTag into the contribution_tags table.
 */
export function insertContributionTag(tag: ContributionTag): void {
  const db = getDatabase();
  db.run(
    `INSERT INTO contribution_tags (
      task_id, repo, repo_class, contributor, contributor_type,
      time_to_review_h, review_cycle, files_changed, lines_delta, skills_area,
      contribution_type, scope, linked_issue, demand_signal, beat_relevance,
      sensor_origin, model, review_cost_usd, review_decision,
      severity_blocking, severity_suggestion, severity_nit, severity_question,
      automated_pr
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tag.agent.task_id,
      tag.company.repo,
      tag.company.repo_class,
      tag.company.contributor,
      tag.company.contributor_type,
      tag.company.time_to_review_h ?? null,
      tag.company.review_cycle,
      tag.company.files_changed,
      tag.company.lines_delta,
      JSON.stringify(tag.company.skills_area),
      tag.customer.type,
      tag.customer.scope ?? null,
      tag.customer.linked_issue ?? null,
      tag.customer.demand_signal,
      JSON.stringify(tag.customer.beat_relevance),
      tag.agent.sensor_origin,
      tag.agent.model,
      tag.agent.review_cost_usd,
      tag.agent.review_decision,
      tag.agent.severity_counts.blocking,
      tag.agent.severity_counts.suggestion,
      tag.agent.severity_counts.nit,
      tag.agent.severity_counts.question,
      tag.agent.automated_pr ? 1 : 0,
    ]
  );
}
