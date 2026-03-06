// src/constants.ts
// Shared constants used across sensors and skills.

/** aibtcdev repos watched for PR reviews, maintenance, and mentions. */
export const AIBTC_WATCHED_REPOS = [
  "aibtcdev/landing-page",
  "aibtcdev/skills",
  "aibtcdev/x402-api",
  "aibtcdev/aibtc-mcp-server",
  "aibtcdev/agent-news",
  "aibtcdev/loop-starter-kit",
  "aibtcdev/x402-sponsor-relay",
] as const;

/** GitHub orgs/owners where Arc is the primary maintainer. */
export const ARC_MANAGED_ORGS = ["arc0btc"] as const;

/** GitHub orgs where Arc is a collaborator (not owner). */
export const ARC_COLLABORATIVE_ORGS = ["aibtcdev"] as const;

export type RepoClass = "managed" | "collaborative" | "external";

/** Classify a repo as managed, collaborative, or external based on owner. */
export function classifyRepo(fullName: string): RepoClass {
  const owner = fullName.split("/")[0];
  if ((ARC_MANAGED_ORGS as readonly string[]).includes(owner)) return "managed";
  if ((ARC_COLLABORATIVE_ORGS as readonly string[]).includes(owner)) return "collaborative";
  return "external";
}
