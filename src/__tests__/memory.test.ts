/**
 * Memory System Tests
 *
 * Tests for:
 * 1. DB schema initialization (tables exist, state is seeded)
 * 2. Cycle log write and read operations
 * 3. Event history write, deduplication, and query
 * 4. Learnings insert, FTS5 search, and importance query
 * 5. Memory query API functions
 *
 * Each test group uses an in-memory SQLite database to avoid
 * polluting the state/ directory and ensure test isolation.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";

// Override the default DB path for testing by using a helper
// that creates an in-memory DB and wires it into the module.
// Since getDb() is a singleton, we reset it before each test group.
import { getDb, resetDbForTesting } from "../memory/db";

// Force an in-memory database for all tests
// We monkey-patch the module by providing a test DB path
const TEST_DB_PATH = ":memory:";

/**
 * Initialize a fresh in-memory DB for each test group.
 * Since db.ts uses a module-level singleton, we reset it.
 */
function freshDb(): Database {
  resetDbForTesting();
  return getDb(TEST_DB_PATH);
}

import { writeCycleLog, queryRecentCycles, getCycleByNum } from "../memory/cycle-log";
import { writeEvent, queryEventHistory, queryEventsAfter } from "../memory/event-history";
import { insertLearning, searchLearnings, queryLearningsByImportance } from "../memory/learnings";
import {
  queryRecentCyclesAPI,
  queryLearningsAPI,
  queryEventsAPI,
} from "../query-tools/memory-query";

// ============================================================
// Suite 1: Database Schema Initialization
// ============================================================

describe("DB Schema Initialization", () => {
  beforeEach(() => {
    freshDb();
  });

  test("creates cycle_log table", () => {
    const db = getDb(TEST_DB_PATH);
    const result = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='cycle_log'"
      )
      .get() as { name: string } | undefined;
    expect(result?.name).toBe("cycle_log");
  });

  test("creates learnings table", () => {
    const db = getDb(TEST_DB_PATH);
    const result = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='learnings'"
      )
      .get() as { name: string } | undefined;
    expect(result?.name).toBe("learnings");
  });

  test("creates event_history table", () => {
    const db = getDb(TEST_DB_PATH);
    const result = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='event_history'"
      )
      .get() as { name: string } | undefined;
    expect(result?.name).toBe("event_history");
  });

  test("creates agent_state table", () => {
    const db = getDb(TEST_DB_PATH);
    const result = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_state'"
      )
      .get() as { name: string } | undefined;
    expect(result?.name).toBe("agent_state");
  });

  test("creates learnings_fts virtual table", () => {
    const db = getDb(TEST_DB_PATH);
    const result = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='learnings_fts'"
      )
      .get() as { name: string } | undefined;
    expect(result?.name).toBe("learnings_fts");
  });

  test("seeds agent_state with required keys", () => {
    const db = getDb(TEST_DB_PATH);
    const rows = db
      .prepare("SELECT key FROM agent_state ORDER BY key")
      .all() as { key: string }[];
    const keys = rows.map((r) => r.key);
    expect(keys).toContain("cycle_count");
    expect(keys).toContain("last_cycle_at");
    expect(keys).toContain("next_cycle_at");
  });

  test("cycle_count seeded to 0", () => {
    const db = getDb(TEST_DB_PATH);
    const row = db
      .prepare("SELECT value FROM agent_state WHERE key='cycle_count'")
      .get() as { value: string } | undefined;
    expect(row?.value).toBe("0");
  });
});

// ============================================================
// Suite 2: Cycle Log
// ============================================================

describe("Cycle Log", () => {
  beforeEach(() => {
    freshDb();
  });

  test("writes a cycle record and returns an ID", () => {
    const id = writeCycleLog({
      cycleNum: 1,
      startedAt: new Date().toISOString(),
      status: "ok",
    });
    expect(id).toBeGreaterThan(0);
  });

  test("reads back the cycle by number", () => {
    writeCycleLog({
      cycleNum: 5,
      startedAt: "2026-02-17T10:00:00.000Z",
      endedAt: "2026-02-17T10:00:05.000Z",
      status: "ok",
      summary: "test cycle",
    });

    const row = getCycleByNum(5);
    expect(row).not.toBeNull();
    expect(row!.cycleNum).toBe(5);
    expect(row!.status).toBe("ok");
    expect(row!.summary).toBe("test cycle");
    expect(row!.startedAt).toBe("2026-02-17T10:00:00.000Z");
  });

  test("stores phase results as parsed JSON", () => {
    writeCycleLog({
      cycleNum: 2,
      startedAt: new Date().toISOString(),
      status: "degraded",
      phases: { gather: "ok", think: "fail", execute: "skip" },
    });

    const row = getCycleByNum(2);
    expect(row!.phases).toEqual({ gather: "ok", think: "fail", execute: "skip" });
  });

  test("stores phase timing as parsed JSON", () => {
    writeCycleLog({
      cycleNum: 3,
      startedAt: new Date().toISOString(),
      status: "ok",
      phaseMs: { gather: 120, execute: 850 },
    });

    const row = getCycleByNum(3);
    expect(row!.phaseMs).toEqual({ gather: 120, execute: 850 });
  });

  test("queryRecentCycles excludes idle cycles by default", () => {
    writeCycleLog({ cycleNum: 10, startedAt: new Date().toISOString(), status: "idle", isIdle: true });
    writeCycleLog({ cycleNum: 11, startedAt: new Date().toISOString(), status: "ok" });
    writeCycleLog({ cycleNum: 12, startedAt: new Date().toISOString(), status: "ok" });

    const cycles = queryRecentCycles(10);
    expect(cycles.every((c) => !c.isIdle)).toBe(true);
    expect(cycles.length).toBe(2);
  });

  test("queryRecentCycles includes idle when asked", () => {
    writeCycleLog({ cycleNum: 20, startedAt: new Date().toISOString(), status: "idle", isIdle: true });
    writeCycleLog({ cycleNum: 21, startedAt: new Date().toISOString(), status: "ok" });

    const cycles = queryRecentCycles(10, true);
    expect(cycles.length).toBe(2);
  });

  test("returns null for missing cycle number", () => {
    const row = getCycleByNum(9999);
    expect(row).toBeNull();
  });
});

// ============================================================
// Suite 3: Event History
// ============================================================

describe("Event History", () => {
  beforeEach(() => {
    freshDb();
  });

  test("writes an event and returns an ID", () => {
    const id = writeEvent({
      timestamp: new Date().toISOString(),
      eventType: "task:completed",
      source: "hello-task",
      payload: { taskName: "hello-task", duration: 50 },
    });
    expect(id).toBeGreaterThan(0);
  });

  test("reads back events by type", () => {
    writeEvent({
      timestamp: new Date().toISOString(),
      eventType: "task:completed",
      source: "task-a",
    });
    writeEvent({
      timestamp: new Date().toISOString(),
      eventType: "sensor:observation",
      source: "sensor-x",
    });

    const events = queryEventHistory("task:completed", 10);
    expect(events.length).toBe(1);
    expect(events[0].eventType).toBe("task:completed");
    expect(events[0].source).toBe("task-a");
  });

  test("deduplication: second insert with same dedup_key is skipped", () => {
    const key = "unique-obs-123";
    const id1 = writeEvent({
      timestamp: new Date().toISOString(),
      eventType: "sensor:observation",
      source: "price-sensor",
      dedupKey: key,
    });
    const id2 = writeEvent({
      timestamp: new Date().toISOString(),
      eventType: "sensor:observation",
      source: "price-sensor",
      dedupKey: key,
    });

    expect(id1).not.toBeNull();
    expect(id2).toBeNull(); // skipped

    const events = queryEventHistory("sensor:observation", 10);
    expect(events.length).toBe(1);
  });

  test("payload is parsed from JSON on read", () => {
    const payload = { message: "hello", value: 42 };
    writeEvent({
      timestamp: new Date().toISOString(),
      eventType: "task:started",
      source: "test-task",
      payload,
    });

    const events = queryEventHistory("task:started", 1);
    expect(events[0].payload).toEqual(payload);
  });

  test("queryEventsAfter filters by timestamp", () => {
    const past = new Date(Date.now() - 10000).toISOString();
    const future = new Date(Date.now() + 10000).toISOString();

    writeEvent({
      timestamp: new Date().toISOString(),
      eventType: "task:completed",
      source: "task-b",
    });

    const recentEvents = queryEventsAfter(past);
    expect(recentEvents.length).toBe(1);

    const futureEvents = queryEventsAfter(future);
    expect(futureEvents.length).toBe(0);
  });
});

// ============================================================
// Suite 4: Learnings
// ============================================================

describe("Learnings", () => {
  beforeEach(() => {
    freshDb();
  });

  test("inserts a learning and returns a UUID", () => {
    const id = insertLearning({
      content: "Bun has built-in SQLite via bun:sqlite",
      area: "main",
      tags: ["bun", "sqlite"],
      importance: 0.8,
    });
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  test("queryLearningsByImportance returns highest importance first", () => {
    insertLearning({ content: "Low importance fact", area: "fragments", importance: 0.2 });
    insertLearning({ content: "High importance solution", area: "solutions", importance: 0.9 });
    insertLearning({ content: "Medium importance", area: "main", importance: 0.5 });

    const results = queryLearningsByImportance(undefined, 10);
    expect(results.length).toBe(3);
    expect(results[0].importance).toBeGreaterThanOrEqual(results[1].importance);
    expect(results[1].importance).toBeGreaterThanOrEqual(results[2].importance);
  });

  test("queryLearningsByImportance filters by area", () => {
    insertLearning({ content: "Main area learning", area: "main", importance: 0.6 });
    insertLearning({ content: "Solution learning", area: "solutions", importance: 0.9 });

    const mainOnly = queryLearningsByImportance("main", 10);
    expect(mainOnly.every((l) => l.area === "main")).toBe(true);
    expect(mainOnly.length).toBe(1);
  });

  test("searchLearnings finds relevant content via FTS5", () => {
    insertLearning({ content: "SQLite FTS5 full-text search with BM25 ranking", area: "main" });
    insertLearning({ content: "Hono is a fast web framework for edge runtimes", area: "main" });
    insertLearning({ content: "TypeScript type inference reduces runtime errors", area: "main" });

    const results = searchLearnings("SQLite full-text", undefined, 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain("SQLite");
  });

  test("searchLearnings returns bm25Score", () => {
    insertLearning({ content: "BM25 ranking is used for relevance scoring", area: "main" });
    const results = searchLearnings("BM25 ranking", undefined, 5);
    expect(results.length).toBeGreaterThan(0);
    expect(typeof results[0].bm25Score).toBe("number");
  });

  test("tags are stored and retrieved as arrays", () => {
    insertLearning({
      content: "Tag storage test",
      area: "main",
      tags: ["typescript", "testing", "bun"],
    });

    const results = queryLearningsByImportance(undefined, 1);
    expect(Array.isArray(results[0].tags)).toBe(true);
    expect(results[0].tags).toContain("typescript");
    expect(results[0].tags).toContain("testing");
  });
});

// ============================================================
// Suite 5: Memory Query API
// ============================================================

describe("Memory Query API", () => {
  beforeEach(() => {
    freshDb();
  });

  test("queryRecentCyclesAPI returns structured response", () => {
    writeCycleLog({ cycleNum: 1, startedAt: new Date().toISOString(), status: "ok" });

    const result = queryRecentCyclesAPI(10);
    expect(result.cycles).toBeDefined();
    expect(result.count).toBe(1);
    expect(typeof result.timestamp).toBe("string");
  });

  test("queryLearningsAPI with search returns query field", () => {
    insertLearning({ content: "Memory query API test content", area: "main" });

    const result = queryLearningsAPI("memory query", 10);
    expect(result.learnings).toBeDefined();
    expect(result.query).toBe("memory query");
    expect(typeof result.timestamp).toBe("string");
  });

  test("queryLearningsAPI without search returns null query", () => {
    insertLearning({ content: "Some learning", area: "main" });

    const result = queryLearningsAPI(undefined, 10);
    expect(result.query).toBeNull();
    expect(result.count).toBe(1);
  });

  test("queryEventsAPI returns structured response", () => {
    writeEvent({
      timestamp: new Date().toISOString(),
      eventType: "task:completed",
      source: "test-task",
    });

    const result = queryEventsAPI("task:completed", 10);
    expect(result.events).toBeDefined();
    expect(result.count).toBe(1);
    expect(result.filter).toBe("task:completed");
    expect(typeof result.timestamp).toBe("string");
  });

  test("queryEventsAPI without filter returns null filter", () => {
    writeEvent({
      timestamp: new Date().toISOString(),
      eventType: "sensor:observation",
      source: "test-sensor",
    });

    const result = queryEventsAPI(undefined, 10);
    expect(result.filter).toBeNull();
    expect(result.count).toBe(1);
  });
});
