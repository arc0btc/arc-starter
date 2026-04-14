/**
 * UTC time helpers for sensor scheduling and date boundaries.
 * The aibtc.news platform uses midnight-to-midnight UTC as the editorial day.
 * All sensor firing windows, API queries, and hook state dates use UTC.
 */

/** Get the current UTC hour (0-23) and date (YYYY-MM-DD). */
export function getUTCInfo(now: Date = new Date()): { hour: number; date: string } {
  return {
    hour: now.getUTCHours(),
    date: now.toISOString().slice(0, 10),
  };
}

/** Get today's date in UTC as YYYY-MM-DD. */
export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}
