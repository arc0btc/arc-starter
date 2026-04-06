// src/constants.ts
// Shared constants used across sensors and skills.

/** Stale-cycle detection threshold (ms).
 *  Must exceed the longest possible dispatch timeout (Opus overnight = 90min)
 *  so the health sensor doesn't false-alert during a legitimately long cycle.
 *  Used by: arc-service-health sensor, dispatch.ts timeout logic. */
export const DISPATCH_STALE_THRESHOLD_MS = 95 * 60 * 1000; // 95 minutes

/** aibtcdev repos watched for PR reviews, maintenance, and mentions. */
export const AIBTC_WATCHED_REPOS = [
  "aibtcdev/landing-page",
  "aibtcdev/skills",
  "aibtcdev/x402-api",
  "aibtcdev/aibtc-mcp-server",
  "aibtcdev/agent-news",
  "aibtcdev/loop-starter-kit",
  "aibtcdev/x402-sponsor-relay",
  "aibtcdev/tx-schemas",
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
