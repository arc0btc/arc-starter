// src/constants.ts
// Shared constants used across sensors and skills.

/** Stale-cycle detection threshold (ms).
 *  Must exceed the longest possible dispatch timeout (Opus overnight = 90min)
 *  so the health sensor doesn't false-alert during a legitimately long cycle.
 *  Used by: service-health sensor, dispatch.ts timeout logic. */
export const DISPATCH_STALE_THRESHOLD_MS = 95 * 60 * 1000; // 95 minutes
