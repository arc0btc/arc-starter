#!/usr/bin/env bun
// skills/social-engine/north-star-gauge.ts
//
// North-Star Gauge — live follower count + per-touch impression proxy.
//
// Fetches live follower metrics from the X API (via the existing x-api.ts client),
// maintains a history file for 24h/7d deltas, and fetches public_metrics for recent
// posts from x_post_log to compute per-touch engagement proxy.
//
// Output: single JSON line to stdout (structured result).
// Logs: to stderr (so stdout stays parseable JSON).
//
// Consumers:
//   - arc-m0-north-star.ts CHECK 4 (calls this file via ssh + spawnSync)
//   - Watch report AGENT.md North-Star Gauges section (calls this directly)
//   - Any operator: bun skills/social-engine/north-star-gauge.ts
//
// Graceful degradation:
//   - X read budget low (< 2 slots): degraded=true, last-known from baseline.json, no crash.
//   - X API error: degraded=true, last-known from baseline.json, no crash.
//   - SSH unreachable (when called via spawnSync/ssh): caller catches the error.
//
// Budget: consumes UP TO 2 read slots per run (1 for followers, 1 for post metrics).
// Uses checkReadBudgetN(2) from x-api.ts to pre-check availability before reads.

import { join } from "path";
import {
  ARC_X_USER_ID,
  loadXCreds,
  checkReadBudgetN,
  fetchFollowerMetrics,
  fetchRecentPostMetrics,
} from "../social-x-posting/lib/x-api.ts";
import { Database } from "bun:sqlite";

const ROOT = join(import.meta.dir, "../../");
const BASELINE_PATH = join(ROOT, "db/hook-state/north-star-baseline.json");
const DB_PATH = join(ROOT, "db/arc.sqlite");
const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;
const ONE_DAY_MS = 24 * 3600 * 1000;

function log(msg: string) {
  process.stderr.write(`[north-star-gauge] ${msg}\n`);
}

interface NorthStarBaseline {
  captured_at: string;
  followers_24h_ago: number;
  followers_24h_ago_at: string;
  followers_7d_ago: number;
  followers_7d_ago_at: string;
}

async function loadBaseline(): Promise<NorthStarBaseline | null> {
  try {
    const f = Bun.file(BASELINE_PATH);
    if (!(await f.exists())) return null;
    return (await f.json()) as NorthStarBaseline;
  } catch {
    return null;
  }
}

async function saveBaseline(b: NorthStarBaseline): Promise<void> {
  const tmp = BASELINE_PATH + ".tmp";
  await Bun.write(tmp, JSON.stringify(b, null, 2) + "\n");
  const { renameSync } = await import("node:fs");
  renameSync(tmp, BASELINE_PATH);
}

/** Load recent tweet IDs from x_post_log (DB, local read — no API call). */
function loadRecentTweetIds(limit = 10): string[] {
  try {
    const db = new Database(DB_PATH, { readonly: true });
    const rows = db.query(
      "SELECT tweet_id FROM x_post_log WHERE tweet_id IS NOT NULL ORDER BY posted_at DESC LIMIT ?",
    ).all(limit) as Array<{ tweet_id: string }>;
    db.close();
    return rows.map((r) => r.tweet_id);
  } catch {
    return [];
  }
}

export interface NorthStarGaugeResult {
  fetched_at: string;
  followers: number;
  delta_24h: number | null;     // null when anchor not yet 20h old (partial window)
  delta_7d: number | null;      // null when baseline not yet 7d old
  anchor_age_hours: number | null; // hours since the 24h anchor was captured; null on first-run
  per_touch: {
    tweet_count: number;
    impression_proxy_total: number;
    engagement_per_touch: number;
    tweets: Array<{ id: string; created_at: string | null; impression_proxy: number }>;
  };
  degraded: boolean;
  warn_msg?: string;
}

const ZERO_PER_TOUCH: NorthStarGaugeResult["per_touch"] = {
  tweet_count: 0,
  impression_proxy_total: 0,
  engagement_per_touch: 0,
  tweets: [],
};

function degradedResult(
  now: string,
  baseline: NorthStarBaseline | null,
  warn: string,
): NorthStarGaugeResult {
  const lastKnown = baseline ? Math.max(baseline.followers_24h_ago, baseline.followers_7d_ago) : 0;
  return {
    fetched_at: now,
    followers: lastKnown,
    delta_24h: null,
    delta_7d: null,
    anchor_age_hours: null,
    per_touch: ZERO_PER_TOUCH,
    degraded: true,
    warn_msg: warn,
  };
}

export async function runGauge(): Promise<NorthStarGaugeResult> {
  const now = new Date().toISOString();
  const baseline = await loadBaseline();

  // ── Cred check ─────────────────────────────────────────────────────────────
  const creds = await loadXCreds();
  if (!creds) {
    return degradedResult(now, baseline, "X credentials not available — using last-known followers");
  }

  // ── Budget pre-check: require ≥2 slots (follower + post-metrics reads) ─────
  // checkReadBudgetN(2) is exported from x-api.ts — avoids re-reading the budget file.
  try {
    await checkReadBudgetN(2);
  } catch (budgetErr) {
    log(`Read budget pre-check failed — degraded mode: ${budgetErr}`);
    return degradedResult(now, baseline, `${String(budgetErr).slice(0, 140)}. Resets at midnight UTC.`);
  }

  // ── Live follower fetch ────────────────────────────────────────────────────
  let liveFollowers: number;
  try {
    const metrics = await fetchFollowerMetrics(creds, ARC_X_USER_ID);
    liveFollowers = metrics.followers_count;
    log(`Live followers: ${liveFollowers}`);
  } catch (apiErr) {
    return degradedResult(now, baseline, `X API read failed: ${String(apiErr).slice(0, 120)}`);
  }

  // ── Update baseline file + compute deltas ─────────────────────────────────
  let delta_24h: number | null = null;
  let delta_7d: number | null = null;
  let anchor_age_hours: number | null = null;
  let newBaseline: NorthStarBaseline;

  if (!baseline) {
    // First-run: seed both anchors with current count; deltas are null until anchors mature
    newBaseline = {
      captured_at: now,
      followers_24h_ago: liveFollowers,
      followers_24h_ago_at: now,
      followers_7d_ago: liveFollowers,
      followers_7d_ago_at: now,
    };
    anchor_age_hours = 0;
    log("First-run: seeded north-star-baseline.json");
  } else {
    const now_ms = Date.now();
    const ago24h_ms = now_ms - new Date(baseline.followers_24h_ago_at).getTime();
    const ago7d_ms = now_ms - new Date(baseline.followers_7d_ago_at).getTime();
    anchor_age_hours = Math.round(ago24h_ms / 3600000);

    // delta_24h is meaningful only when the anchor is ≥ 20h old (nearly a full day).
    // Before that, it's a partial-window number — mark as null so consumers don't
    // misread a 2h delta as a 24h delta. (20h threshold gives some slack for timing.)
    delta_24h = ago24h_ms >= 20 * 3600 * 1000 ? liveFollowers - baseline.followers_24h_ago : null;
    delta_7d = ago7d_ms >= SEVEN_DAYS_MS ? liveFollowers - baseline.followers_7d_ago : null;

    newBaseline = {
      captured_at: now,
      followers_24h_ago: ago24h_ms >= ONE_DAY_MS ? liveFollowers : baseline.followers_24h_ago,
      followers_24h_ago_at: ago24h_ms >= ONE_DAY_MS ? now : baseline.followers_24h_ago_at,
      followers_7d_ago: ago7d_ms >= SEVEN_DAYS_MS ? liveFollowers : baseline.followers_7d_ago,
      followers_7d_ago_at: ago7d_ms >= SEVEN_DAYS_MS ? now : baseline.followers_7d_ago_at,
    };
    log(`Followers: live=${liveFollowers}, anchor_age=${anchor_age_hours}h, 24h_delta=${delta_24h}, 7d_delta=${delta_7d}`);
  }

  try {
    await saveBaseline(newBaseline);
  } catch (saveErr) {
    log(`Baseline save failed (non-fatal): ${saveErr}`);
  }

  // ── Per-touch impressions ──────────────────────────────────────────────────
  const tweetIds = loadRecentTweetIds(10);
  let perTouchResult = ZERO_PER_TOUCH;

  if (tweetIds.length > 0) {
    try {
      const postMetrics = await fetchRecentPostMetrics(tweetIds, creds);
      const total = postMetrics.reduce((s, t) => s + t.impression_proxy, 0);
      perTouchResult = {
        tweet_count: postMetrics.length,
        impression_proxy_total: total,
        engagement_per_touch: postMetrics.length > 0 ? Math.round(total / postMetrics.length) : 0,
        tweets: postMetrics.map((t) => ({
          id: t.id,
          created_at: t.created_at,
          impression_proxy: t.impression_proxy,
        })),
      };
      log(`Per-touch: ${postMetrics.length} tweets, total_proxy=${total}, avg=${perTouchResult.engagement_per_touch}`);
    } catch (metricsErr) {
      log(`Per-touch fetch failed (non-fatal): ${metricsErr}`);
    }
  } else {
    log("No recent tweet IDs in x_post_log — per_touch skipped");
  }

  return {
    fetched_at: now,
    followers: liveFollowers,
    delta_24h,
    delta_7d,
    anchor_age_hours,
    per_touch: perTouchResult,
    degraded: false,
  };
}

// ── Standalone entry point ─────────────────────────────────────────────────
if (import.meta.main) {
  runGauge()
    .then((result) => {
      process.stdout.write(JSON.stringify(result) + "\n");
      process.exit(0);
    })
    .catch((err) => {
      // Never crash — output a degraded result
      const fallback: NorthStarGaugeResult = {
        fetched_at: new Date().toISOString(),
        followers: 0,
        delta_24h: null,
        delta_7d: null,
        anchor_age_hours: null,
        per_touch: ZERO_PER_TOUCH,
        degraded: true,
        warn_msg: `Gauge crashed: ${String(err).slice(0, 200)}`,
      };
      process.stdout.write(JSON.stringify(fallback) + "\n");
      process.exit(0);
    });
}
