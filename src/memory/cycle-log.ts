/**
 * Cycle Log
 *
 * Write and read operations for the cycle_log table.
 * One row per agent execution cycle — records what happened,
 * how long each phase took, and the final status.
 *
 * Enables trend analysis: is the agent getting faster?
 * Are certain phases failing repeatedly?
 */

import { getDb } from "./db";

/**
 * Phase status values
 */
export type PhaseStatus = "ok" | "fail" | "skip";

/**
 * Cycle status values
 */
export type CycleStatus = "ok" | "degraded" | "error" | "idle";

/**
 * Per-phase result map
 */
export interface PhaseResults {
  gather?: PhaseStatus;
  think?: PhaseStatus;
  validate?: PhaseStatus;
  execute?: PhaseStatus;
  queue?: PhaseStatus;
  reflect?: PhaseStatus;
  evolve?: PhaseStatus;
  log?: PhaseStatus;
}

/**
 * Per-phase timing map (milliseconds)
 */
export interface PhaseTiming {
  gather?: number;
  think?: number;
  validate?: number;
  execute?: number;
  queue?: number;
  reflect?: number;
  evolve?: number;
  log?: number;
}

/**
 * Input for writing a cycle record
 */
export interface CycleLogInput {
  cycleNum: number;
  startedAt: string;
  endedAt?: string;
  status: CycleStatus;
  isIdle?: boolean;
  phases?: PhaseResults;
  phaseMs?: PhaseTiming;
  tasksExecuted?: number;
  eventsObserved?: number;
  learningsAdded?: number;
  errorsCount?: number;
  summary?: string;
}

/**
 * A row from cycle_log
 */
export interface CycleLogRow {
  id: number;
  cycleNum: number;
  startedAt: string;
  endedAt: string | null;
  status: CycleStatus;
  isIdle: boolean;
  phases: PhaseResults | null;
  phaseMs: PhaseTiming | null;
  tasksExecuted: number;
  eventsObserved: number;
  learningsAdded: number;
  errorsCount: number;
  summary: string | null;
}

/**
 * Write a cycle record to the database.
 * Returns the inserted row ID.
 */
export function writeCycleLog(input: CycleLogInput): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO cycle_log (
      cycle_num, started_at, ended_at, status, is_idle,
      phases, phase_ms,
      tasks_executed, events_observed, learnings_added, errors_count,
      summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.cycleNum,
    input.startedAt,
    input.endedAt ?? null,
    input.status,
    input.isIdle ? 1 : 0,
    input.phases ? JSON.stringify(input.phases) : null,
    input.phaseMs ? JSON.stringify(input.phaseMs) : null,
    input.tasksExecuted ?? 0,
    input.eventsObserved ?? 0,
    input.learningsAdded ?? 0,
    input.errorsCount ?? 0,
    input.summary ?? null
  );

  return Number(result.lastInsertRowid);
}

/**
 * Get the most recent N cycles, excluding idle cycles by default.
 */
export function queryRecentCycles(
  count: number = 10,
  includeIdle: boolean = false
): CycleLogRow[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT
      id, cycle_num, started_at, ended_at, status, is_idle,
      phases, phase_ms,
      tasks_executed, events_observed, learnings_added, errors_count,
      summary
    FROM cycle_log
    ${includeIdle ? "" : "WHERE is_idle = 0"}
    ORDER BY started_at DESC
    LIMIT ?
  `);

  const rows = stmt.all(count) as Record<string, unknown>[];
  return rows.map(mapCycleRow);
}

/**
 * Get a specific cycle by cycle number.
 */
export function getCycleByNum(cycleNum: number): CycleLogRow | null {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT
      id, cycle_num, started_at, ended_at, status, is_idle,
      phases, phase_ms,
      tasks_executed, events_observed, learnings_added, errors_count,
      summary
    FROM cycle_log
    WHERE cycle_num = ?
  `);

  const row = stmt.get(cycleNum) as Record<string, unknown> | undefined;
  return row ? mapCycleRow(row) : null;
}

/**
 * Map a raw SQLite row to a CycleLogRow
 */
function mapCycleRow(row: Record<string, unknown>): CycleLogRow {
  return {
    id: row.id as number,
    cycleNum: row.cycle_num as number,
    startedAt: row.started_at as string,
    endedAt: (row.ended_at as string) ?? null,
    status: row.status as CycleStatus,
    isIdle: row.is_idle === 1,
    phases: row.phases ? (JSON.parse(row.phases as string) as PhaseResults) : null,
    phaseMs: row.phase_ms ? (JSON.parse(row.phase_ms as string) as PhaseTiming) : null,
    tasksExecuted: row.tasks_executed as number,
    eventsObserved: row.events_observed as number,
    learningsAdded: row.learnings_added as number,
    errorsCount: row.errors_count as number,
    summary: (row.summary as string) ?? null,
  };
}
