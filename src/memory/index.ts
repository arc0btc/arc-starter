/**
 * Memory Module — Public API
 *
 * All pipeline phases and query-tools import from this module.
 * They never touch SQLite directly.
 *
 * Two-layer architecture (ADR-001):
 * - SQLite: authoritative machine-queryable operational history
 * - markdown files: human-readable digest (memory/working.md, memory/learnings.md)
 *
 * Usage:
 * ```typescript
 * import { writeCycleLog, writeEvent, insertLearning, searchLearnings } from "../memory";
 * ```
 */

// Database initialization
export { getDb, closeDb, resetDbForTesting } from "./db";

// Cycle log operations
export {
  writeCycleLog,
  queryRecentCycles,
  getCycleByNum,
  type CycleLogInput,
  type CycleLogRow,
  type CycleStatus,
  type PhaseStatus,
  type PhaseResults,
  type PhaseTiming,
} from "./cycle-log";

// Event history operations
export {
  writeEvent,
  queryEventHistory,
  queryEventsByCycle,
  queryEventsAfter,
  type EventHistoryInput,
  type EventHistoryRow,
} from "./event-history";

// Learning operations
export {
  insertLearning,
  searchLearnings,
  queryLearningsByImportance,
  type LearningInput,
  type LearningRow,
  type LearningSearchResult,
  type LearningArea,
  type LearningSource,
} from "./learnings";

// Evolution state persistence
export {
  saveTaskInterval,
  loadTaskIntervals,
  writeEvolutionNote,
  type TaskIntervalRow,
} from "./evolution";
