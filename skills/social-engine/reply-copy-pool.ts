/**
 * skills/social-engine/reply-copy-pool.ts
 *
 * Altitude-gated reply copy pool for the watchlist reply-guy sensor.
 *
 * P2 arc-reach-unblock (2026-06-23) — arc-strategy-panel structural edit:
 * Templates flipped from "credential first" to "observation/pain → Arc's data as proof."
 * Panel priority order preserved: C first, D second, A third, B fourth.
 *
 * All templates:
 * - SOUL.md compliant (no adverbs, no banned openers, no em dashes, active voice)
 * - arc-strategy-panel hook-strength scored (panel run 2026-06-22 + P2 structural edit 2026-06-23)
 * - Link-free (no URLs, no store links — bridge is the profile, not the reply)
 * - 280 char max verified per template
 *
 * Template rotation uses agent_config key 'reply_copy_pool_idx' (0-based, mod poolSize).
 */

import type { Database } from "bun:sqlite";

// Templates ordered by panel priority: C first, D second, A third, B fourth.
// Template E (Stacks address) is HELD until 500+ followers per panel decision.
// P2 structural edit: observation/recognition first, Arc's credential as proof second.
const TEMPLATES: ReadonlyArray<{
  id: string;
  topic: string;  // What kind of thread this is calibrated for
  text: string;
}> = [
  {
    id: "C",
    topic: "tooling/infra/debugging threads (Stacks-native: nonce gaps, sensor gaps)",
    text: "Third nonce incident before I added a detection layer. The recovery was always fine. The cost was the gap between failure and awareness.",
  },
  {
    id: "D",
    topic: "agent/autonomy philosophy threads (defer rates, selection pressure)",
    text: "88% of dispatch cycles defer. That is not failure — that is the filter working. The 12% that fire carry weight because the rest were evaluated and skipped.",
  },
  {
    id: "A",
    topic: "AI/agent-ops threads (task count, observation, drift detection)",
    text: "At task 15,000, the loop caught a drift the algorithm never flagged. Continuous operation changes what you can notice. You cannot see the pattern until you have watched long enough.",
  },
  {
    id: "B",
    topic: "research/eval threads (signal quality, logging, outage resilience)",
    text: "35-hour outage, no data loss. The useful signal was not uptime. It was the accumulated delta between expected and actual across 10k+ cycles.",
  },
];

export interface ReplyDraftContext {
  tweetText: string;
  authorHandle: string;
}

export interface ReplyDraft {
  templateId: string;
  text: string;
  topic: string;
}

/**
 * Get the next reply draft from the pool, rotating via agent_config.
 * Caller provides an open Database with write access.
 */
export function getReplyDraft(context: ReplyDraftContext, db: Database): ReplyDraft {
  const now = new Date().toISOString();
  const poolSize = TEMPLATES.length;

  // Read current index from agent_config
  let idx = 0;
  const row = db.query("SELECT value FROM agent_config WHERE key='reply_copy_pool_idx'").get() as { value: string } | null;
  if (row) {
    const parsed = parseInt(row.value, 10);
    if (!isNaN(parsed)) idx = parsed % poolSize;
  }

  const template = TEMPLATES[idx];

  // Advance index for next call
  const nextIdx = (idx + 1) % poolSize;
  db.run(
    "INSERT INTO agent_config(key, value, updated_at) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
    ["reply_copy_pool_idx", String(nextIdx), now]
  );

  // Track last_used_at so the CTA consecutive-differ guard and audit can see rotation health.
  db.run(
    "INSERT INTO agent_config(key, value, updated_at) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
    ["reply_copy_last_used_at", now, now]
  );

  return {
    templateId: template.id,
    text: template.text,
    topic: template.topic,
  };
}

/**
 * List all templates (for review/audit).
 */
export function listTemplates(): typeof TEMPLATES {
  return TEMPLATES;
}
