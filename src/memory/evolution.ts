/**
 * Evolution State Persistence
 *
 * Reads and writes runtime evolution decisions to SQLite.
 * Also appends human-readable notes to memory/working.md.
 *
 * Two-layer persistence (ADR-001 pattern):
 * - SQLite (task_intervals): authoritative, queryable, machine-readable
 * - memory/working.md: human-readable digest for operator visibility
 *
 * Usage:
 * ```typescript
 * // Save an evolution decision
 * saveTaskInterval("github-sensor", 30000, true, "High observation rate");
 *
 * // Load all persisted intervals on startup
 * const intervals = loadTaskIntervals();
 * for (const row of intervals) {
 *   if (scheduler.hasTask(row.taskName)) {
 *     scheduler.updateInterval(row.taskName, row.intervalMs);
 *   }
 * }
 * ```
 */

import { getDb } from "./db";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * A row from the task_intervals table
 */
export interface TaskIntervalRow {
  taskName: string;
  intervalMs: number;
  enabled: boolean;
  updatedAt: string;
  reason: string | null;
}

/**
 * Persist an evolution decision for a task's interval and enabled state.
 * Uses UPSERT so repeated calls update the existing row.
 *
 * Called by scheduler methods (updateInterval, enable, disable) after
 * making a runtime change, so the decision survives process restarts.
 */
export function saveTaskInterval(
  taskName: string,
  intervalMs: number,
  enabled: boolean,
  reason?: string
): void {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO task_intervals (task_name, interval_ms, enabled, updated_at, reason)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (task_name) DO UPDATE SET
      interval_ms = excluded.interval_ms,
      enabled     = excluded.enabled,
      updated_at  = excluded.updated_at,
      reason      = excluded.reason
  `).run(taskName, intervalMs, enabled ? 1 : 0, now, reason ?? null);
}

/**
 * Load all persisted task intervals from the database.
 * Call this during scheduler startup to restore evolved state.
 *
 * Returns all rows from task_intervals, ordered by task name.
 */
export function loadTaskIntervals(): TaskIntervalRow[] {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT task_name, interval_ms, enabled, updated_at, reason
      FROM task_intervals
      ORDER BY task_name
    `)
    .all() as Record<string, unknown>[];

  return rows.map((row) => ({
    taskName: row.task_name as string,
    intervalMs: row.interval_ms as number,
    enabled: row.enabled === 1,
    updatedAt: row.updated_at as string,
    reason: (row.reason as string) ?? null,
  }));
}

/**
 * Append an evolution note to memory/working.md.
 *
 * Follows the dual-write pattern: SQLite is the authoritative source,
 * working.md is the human-readable digest. Evolution notes are appended
 * to the "Evolution Log" table in working.md so operators can see what
 * the agent has changed about itself over time.
 *
 * Format: a new table row | date | note |
 *
 * If working.md does not exist or does not contain the Evolution Log
 * header, the note is written to a fallback file (memory/evolution-log.md)
 * to avoid corrupting an unexpected file structure.
 */
export function writeEvolutionNote(note: string): void {
  const workingMdPath = join(process.cwd(), "memory", "working.md");
  const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const tableRow = `| ${date} | ${note} |`;

  try {
    if (!existsSync(workingMdPath)) {
      // working.md doesn't exist — write to fallback
      const fallbackPath = join(process.cwd(), "memory", "evolution-log.md");
      appendFileSync(fallbackPath, `${tableRow}\n`);
      console.log(`[Evolution] Note written to evolution-log.md (working.md not found)`);
      return;
    }

    const content = readFileSync(workingMdPath, "utf-8");
    const evolutionHeader = "## Evolution Log";

    if (!content.includes(evolutionHeader)) {
      // Header not found — write to fallback
      const fallbackPath = join(process.cwd(), "memory", "evolution-log.md");
      appendFileSync(fallbackPath, `${tableRow}\n`);
      console.log(`[Evolution] Note written to evolution-log.md (Evolution Log section not found)`);
      return;
    }

    // Find the table header line and insert after the last table row.
    // The table looks like:
    //   ## Evolution Log
    //   | Date | Change | Reason |
    //   |------|--------|--------|
    //   | row1 |
    //   | row2 |        <- insert new row after the last | row
    const lines = content.split("\n");
    const headerIndex = lines.findIndex((l) => l.includes(evolutionHeader));

    // Find the last table row after the header
    let lastRowIndex = -1;
    for (let i = headerIndex + 1; i < lines.length; i++) {
      if (lines[i].trimStart().startsWith("|")) {
        lastRowIndex = i;
      } else if (lastRowIndex !== -1 && lines[i].trim() === "") {
        // First blank line after the table — stop
        break;
      }
    }

    if (lastRowIndex === -1) {
      // No table rows found — append after header
      lines.splice(headerIndex + 1, 0, tableRow);
    } else {
      lines.splice(lastRowIndex + 1, 0, tableRow);
    }

    writeFileSync(workingMdPath, lines.join("\n"), "utf-8");
    console.log(`[Evolution] Note written to memory/working.md`);
  } catch (error) {
    // Never crash the agent because of a log write failure
    console.error(`[Evolution] Failed to write evolution note:`, error);
  }
}
