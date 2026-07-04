// skills/arc-attribution/lib/follower-cache.ts
//
// Shared TTL cache for the live X follower count, read by BOTH the CEO report
// (skills/whop/lib/events.ts formatReadout()) and the attribution report — so a report tick
// never spends more than one X API read per TTL window, and both surfaces show the identical
// number (P8 goal: "no two reports disagreeing").
//
// TTL matches north-star-gauge.ts's own "stale anchor" threshold (20h) — reusing an existing
// threshold rather than inventing a new one. State file: db/hook-state/arc-attribution-follower-cache.json
// (same convention src/sensors.ts already establishes for every sensor).

import { readHookState, writeHookState } from "../../../src/sensors.ts";
import { runGauge } from "../../social-engine/north-star-gauge.ts";

const CACHE_NAME = "arc-attribution-follower-cache";
const TTL_HOURS = 20;

export interface CachedFollowers {
  followers: number | null;
  delta_24h: number | null;
  delta_7d: number | null;
  degraded: boolean;
  note: string;
  fetched_at: string | null;
}

/**
 * Returns the cached follower reading, refreshing it (one X API call via north-star-gauge.ts)
 * only if the cache is missing or older than TTL_HOURS. On refresh failure, returns the
 * last-known cached value annotated as stale rather than reverting to a hardcoded placeholder.
 */
export async function readCachedFollowers(forceRefresh = false): Promise<CachedFollowers> {
  const state = await readHookState(CACHE_NAME);
  const ageHours = state?.last_ran
    ? (Date.now() - new Date(state.last_ran as string).getTime()) / 3_600_000
    : Infinity;

  if (!forceRefresh && state && ageHours < TTL_HOURS) {
    return {
      followers: (state.followers as number | undefined) ?? null,
      delta_24h: (state.delta_24h as number | null | undefined) ?? null,
      delta_7d: (state.delta_7d as number | null | undefined) ?? null,
      degraded: false,
      note: `cached ${ageHours.toFixed(1)}h ago (TTL ${TTL_HOURS}h)`,
      fetched_at: state.last_ran as string,
    };
  }

  try {
    const gauge = await runGauge();
    await writeHookState(CACHE_NAME, {
      last_ran: new Date().toISOString(),
      last_result: "ok",
      version: ((state?.version as number | undefined) ?? 0) + 1,
      followers: gauge.followers,
      delta_24h: gauge.delta_24h,
      delta_7d: gauge.delta_7d,
    });
    if (gauge.degraded) {
      return {
        followers: gauge.followers,
        delta_24h: gauge.delta_24h,
        delta_7d: gauge.delta_7d,
        degraded: true,
        note: gauge.warn_msg ?? "gauge degraded",
        fetched_at: new Date().toISOString(),
      };
    }
    return {
      followers: gauge.followers,
      delta_24h: gauge.delta_24h,
      delta_7d: gauge.delta_7d,
      degraded: false,
      note: "freshly fetched",
      fetched_at: new Date().toISOString(),
    };
  } catch (err) {
    // Refresh failed — fall back to last-known cache (even if stale) rather than a placeholder.
    if (state) {
      return {
        followers: (state.followers as number | undefined) ?? null,
        delta_24h: (state.delta_24h as number | null | undefined) ?? null,
        delta_7d: (state.delta_7d as number | null | undefined) ?? null,
        degraded: true,
        note: `refresh failed (${err instanceof Error ? err.message : String(err)}) — using stale cache, ${ageHours.toFixed(1)}h old`,
        fetched_at: state.last_ran as string,
      };
    }
    return {
      followers: null,
      delta_24h: null,
      delta_7d: null,
      degraded: true,
      note: `no cache and refresh failed: ${err instanceof Error ? err.message : String(err)}`,
      fetched_at: null,
    };
  }
}
