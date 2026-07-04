// src/follower-cache.ts
//
// Shared TTL cache for the live X follower count. Lives in src/ (core), not inside any one
// skill, because it is a cross-cutting dependency of BOTH skills/whop/lib/events.ts
// (formatReadout()'s "audience growth" line) and skills/arc-attribution/lib/report.ts (the
// reach section) — putting it inside either skill would make the other skill depend on a
// sibling skill's internals for no architectural reason. Both callers importing this one
// module (instead of each independently calling north-star-gauge.ts) is what guarantees they
// never spend more than one X API read per TTL window and always show the identical number
// (P8 goal: "no two reports disagreeing").
//
// TTL matches north-star-gauge.ts's own "stale anchor" threshold (20h) — reusing an existing
// threshold rather than inventing a new one. State file:
// db/hook-state/arc-attribution-follower-cache.json (same convention this file's own
// readHookState/writeHookState establishes for every sensor's hook state).
//
// dev-council (kleppmann/lamport/newman/hohpe, 2026-07-05, parallel review) findings applied:
// - CACHE POISONING (kleppmann, newman): the original version wrote a DEGRADED gauge read into
//   the cache with a fresh timestamp, so one transient X-budget blip got served as
//   authoritative-fresh for a full 20h TTL window. Fixed: `last_good_at` + the cached values
//   only advance on a NON-degraded gauge read; a degraded attempt is recorded separately
//   (`last_attempt_at`/`last_attempt_degraded`) and NEVER overwrites the last-good values. The
//   cache-hit path also now re-checks `last_good_degraded` instead of hardcoding `degraded:false`.
// - RACE (lamport, kleppmann #7): two callers hitting a cold cache simultaneously could both
//   issue an X API read (double-spend against the read budget) and race a lost-update on the
//   cache file. Mitigated (not fully eliminated — see known limitation below) by gating the
//   refresh through `claimSensorRun`, the same primitive every sensor already uses to serialize
//   its own cadence, rather than a bespoke lock.
// - NO TIMEOUT (hohpe #7): `runGauge()` had no wall-clock bound; a hung X API call would hang
//   this cache (and anything awaiting it) indefinitely. Fixed: a 15s timeout wraps the refresh.
// - KNOWN, NOT FIXED (lamport I3, disclosed not silently accepted): `writeHookState()` in
//   src/sensors.ts is a plain `Bun.write(path, JSON.stringify(...))` — not atomic
//   (write-tmp-then-rename). A read racing an in-flight write could see a torn/empty file.
//   `readHookState()`'s try/catch already treats a parse failure as "no cache" (safe direction:
//   triggers a refresh, not a bad value), so the failure mode is an extra read, not a wrong
//   number — judged acceptable for this phase's "thin guardrails" budget since it's a pre-existing
//   primitive shared by every sensor in the codebase, not something introduced here. Hardening
//   `writeHookState` itself (fixing it for all ~15 sensors) is out of scope for this file;
//   carried forward in CHECKPOINTS.md.

import { readHookState, writeHookState, claimSensorRun } from "./sensors.ts";
import { runGauge } from "../skills/social-engine/north-star-gauge.ts";

const CACHE_NAME = "arc-attribution-follower-cache";
const CLAIM_NAME = "arc-attribution-follower-refresh-claim";
const TTL_HOURS = 20;
const REFRESH_TIMEOUT_MS = 15_000;

export interface CachedFollowers {
  followers: number | null;
  delta_24h: number | null;
  delta_7d: number | null;
  degraded: boolean;
  note: string;
  fetched_at: string | null;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

function fromGoodState(state: Record<string, unknown>, note: string): CachedFollowers {
  return {
    followers: (state.followers as number | undefined) ?? null,
    delta_24h: (state.delta_24h as number | null | undefined) ?? null,
    delta_7d: (state.delta_7d as number | null | undefined) ?? null,
    degraded: false,
    note,
    fetched_at: (state.last_good_at as string | undefined) ?? null,
  };
}

/**
 * Returns the cached follower reading, refreshing it (one X API call via north-star-gauge.ts)
 * only if the last KNOWN-GOOD read is missing or older than TTL_HOURS. A degraded/failed
 * refresh attempt never overwrites the last known-good value — it is reported as a stale-but-
 * honest fallback instead.
 */
export async function readCachedFollowers(forceRefresh = false): Promise<CachedFollowers> {
  const state = await readHookState(CACHE_NAME);
  const lastGoodAt = state?.last_good_at as string | undefined;
  const ageHours = lastGoodAt ? (Date.now() - new Date(lastGoodAt).getTime()) / 3_600_000 : Infinity;

  if (!forceRefresh && state && lastGoodAt && ageHours < TTL_HOURS) {
    return fromGoodState(state, `cached ${ageHours.toFixed(1)}h ago (TTL ${TTL_HOURS}h)`);
  }

  // Serialize the refresh attempt across concurrent callers (CEO report / Discord monitor /
  // manual CLI could all race a cold cache). claimSensorRun's own underlying state file has the
  // same non-atomic-write property noted above, so this narrows the race window rather than
  // eliminating it — a reasonable mitigation for a low-frequency report generator, not a hot path.
  const claimed = await claimSensorRun(CLAIM_NAME, TTL_HOURS * 60);
  if (!claimed && state && lastGoodAt) {
    // Someone else refreshed (or is refreshing) very recently — reuse whatever the last known
    // good value is rather than issuing a second concurrent X read.
    return fromGoodState(state, `refresh claimed by a concurrent caller — reusing last known-good (${ageHours.toFixed(1)}h old)`);
  }

  try {
    const gauge = await withTimeout(runGauge(), REFRESH_TIMEOUT_MS, "runGauge()");
    const nowIso = new Date().toISOString();

    if (gauge.degraded) {
      // Record the attempt WITHOUT touching last_good_at/followers/delta_* — a degraded read
      // must never poison the cache with a stale-forever "fresh" timestamp.
      await writeHookState(CACHE_NAME, {
        ...state,
        last_ran: nowIso,
        last_result: "ok",
        version: ((state?.version as number | undefined) ?? 0) + 1,
        last_attempt_at: nowIso,
        last_attempt_degraded: true,
      });
      if (state && lastGoodAt) {
        return {
          ...fromGoodState(state, ""),
          degraded: true,
          note: `refresh degraded (${gauge.warn_msg ?? "gauge degraded"}) — using last known-good, ${ageHours.toFixed(1)}h old`,
        };
      }
      return {
        followers: gauge.followers || null,
        delta_24h: null,
        delta_7d: null,
        degraded: true,
        note: gauge.warn_msg ?? "gauge degraded, no prior known-good cache",
        fetched_at: null,
      };
    }

    // Real, non-degraded read — this is the only path allowed to advance last_good_at.
    await writeHookState(CACHE_NAME, {
      last_ran: nowIso,
      last_result: "ok",
      version: ((state?.version as number | undefined) ?? 0) + 1,
      last_good_at: nowIso,
      last_attempt_at: nowIso,
      last_attempt_degraded: false,
      followers: gauge.followers,
      delta_24h: gauge.delta_24h,
      delta_7d: gauge.delta_7d,
    });
    return {
      followers: gauge.followers,
      delta_24h: gauge.delta_24h,
      delta_7d: gauge.delta_7d,
      degraded: false,
      note: "freshly fetched",
      fetched_at: nowIso,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (state && lastGoodAt) {
      return {
        ...fromGoodState(state, ""),
        degraded: true,
        note: `refresh failed (${msg}) — using last known-good, ${ageHours.toFixed(1)}h old`,
      };
    }
    return {
      followers: null,
      delta_24h: null,
      delta_7d: null,
      degraded: true,
      note: `no known-good cache and refresh failed: ${msg}`,
      fetched_at: null,
    };
  }
}
