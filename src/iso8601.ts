// Shared ISO8601 timestamp helpers. Two forms in use across the codebase:
//
//   isoSeconds  — "2026-06-12T20:15:00Z" — keeps colons. Used in source-artifact
//                 filenames (research/arxiv/*) where humans read the date.
//   isoBasic    — "2026-06-12T201500Z"   — strips colons. Filesystem-basic-form
//                 basename, safe on every OS. Used in audit-artifact JSON files
//                 and the distilled-artifact pool.
//
// Two-tick-per-second collisions are impossible at our sensor cadences (5min
// minimum) so second-resolution is enough for both shapes.

/** Strip milliseconds; keep colons. "2026-06-12T20:15:00Z". */
export function isoSeconds(date: Date = new Date()): string {
  return date.toISOString().replace(/\.\d+Z$/, "Z");
}

/** Strip milliseconds and colons. "2026-06-12T201500Z". Filesystem-basic form. */
export function isoBasic(date: Date = new Date()): string {
  return isoSeconds(date).replace(/:/g, "");
}
