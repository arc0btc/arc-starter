/**
 * Memory Query Tools
 *
 * On-demand query functions for the agent's memory system.
 * These are exposed as API endpoints and can be called from
 * pipeline phases, interactive sessions, or external tooling.
 *
 * All queries go through the memory module — never raw SQLite.
 *
 * Endpoints registered in src/server/index.ts:
 * - GET /api/memory/cycles   → queryRecentCyclesAPI()
 * - GET /api/memory/learnings → queryLearningsAPI()
 * - GET /api/memory/events   → queryEventsAPI()
 */

import { queryRecentCycles, queryEventHistory, searchLearnings, queryLearningsByImportance } from "../memory";
import type { CycleLogRow } from "../memory/cycle-log";
import type { EventHistoryRow } from "../memory/event-history";
import type { LearningRow, LearningSearchResult } from "../memory/learnings";

/**
 * Query the most recent N non-idle cycles.
 * Used for the REFLECT phase and operator dashboards.
 */
export function queryRecentCyclesAPI(count: number = 10): {
  cycles: CycleLogRow[];
  count: number;
  timestamp: string;
} {
  const cycles = queryRecentCycles(count, false);
  return {
    cycles,
    count: cycles.length,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Search learnings by text query (FTS5) or get top by importance.
 * - If search string provided: FTS5 BM25-ranked results
 * - If no search string: top N by importance
 */
export function queryLearningsAPI(
  search?: string,
  count: number = 20
): {
  learnings: LearningRow[] | LearningSearchResult[];
  count: number;
  query: string | null;
  timestamp: string;
} {
  const learnings = search
    ? searchLearnings(search, undefined, count)
    : queryLearningsByImportance(undefined, count);

  return {
    learnings,
    count: learnings.length,
    query: search ?? null,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Query recent events, optionally filtered by event type.
 * Used by sensors to check recent observations and avoid duplicates.
 */
export function queryEventsAPI(
  eventType?: string,
  count: number = 20
): {
  events: EventHistoryRow[];
  count: number;
  filter: string | null;
  timestamp: string;
} {
  const events = queryEventHistory(eventType, count);
  return {
    events,
    count: events.length,
    filter: eventType ?? null,
    timestamp: new Date().toISOString(),
  };
}
