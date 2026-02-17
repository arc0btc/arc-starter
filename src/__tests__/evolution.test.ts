/**
 * Evolution System Tests
 *
 * Tests for:
 * 1. TaskScheduler.updateInterval — updates interval, emits events
 * 2. TaskScheduler.enable / disable — task lifecycle, event emission
 * 3. agent:evolved event emission on all evolution operations
 * 4. saveTaskInterval / loadTaskIntervals — round-trip DB persistence
 * 5. reflect() — returns typed suggestions based on cycle summary
 * 6. restoreFromDb() — applies persisted state on simulated restart
 *
 * Isolation approach:
 * - Scheduler tests use a fresh TaskScheduler instance per test (not the
 *   global singleton) to avoid cross-test contamination.
 * - All timers are stopped after each test.
 * - Memory tests use an in-memory SQLite DB reset before each test.
 * - writeEvolutionNote is not tested here (filesystem side-effect) — it
 *   has try/catch protection and is tested implicitly via updateInterval.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { TaskScheduler, ScheduledTask } from "../server/scheduler";
import { TypedEventBus, EventPayloads } from "../server/events";
import { getDb, resetDbForTesting } from "../memory/db";
import { saveTaskInterval, loadTaskIntervals } from "../memory/evolution";
import { reflect, CycleSummary } from "../evolution/reflect";

// ============================================================
// Test Helpers
// ============================================================

const TEST_DB_PATH = ":memory:";

function freshDb() {
  resetDbForTesting();
  return getDb(TEST_DB_PATH);
}

/**
 * Create a TaskScheduler with its own event bus (not the global singleton).
 * This prevents cross-test event leakage.
 */
function makeScheduler() {
  const bus = new TypedEventBus();
  const scheduler = new TaskScheduler(bus);
  return { scheduler, bus };
}

/**
 * A no-op task function for testing.
 */
function noop(): void {}

/**
 * Build a minimal ScheduledTask for tests.
 */
function makeTask(name: string, intervalMs = 60000, enabled = true): ScheduledTask {
  return { name, intervalMs, enabled, fn: noop };
}

/**
 * Collect all events of a given type emitted during a callback.
 */
function collectEvents<K extends keyof EventPayloads>(
  bus: TypedEventBus,
  eventName: K,
  callback: () => void
): EventPayloads[K][] {
  const collected: EventPayloads[K][] = [];
  bus.on(eventName, (payload) => collected.push(payload));
  callback();
  return collected;
}

// ============================================================
// Suite 1: TaskScheduler — updateInterval
// ============================================================

describe("TaskScheduler.updateInterval", () => {
  let scheduler: TaskScheduler;
  let bus: TypedEventBus;

  beforeEach(() => {
    freshDb(); // Needed because updateInterval calls saveTaskInterval
    ({ scheduler, bus } = makeScheduler());
  });

  afterEach(() => {
    scheduler.stopAll();
  });

  test("updates the task interval in the internal task map", () => {
    scheduler.register(makeTask("test-task", 60000));
    scheduler.updateInterval("test-task", 30000);

    const tasks = scheduler.list();
    const task = tasks.find((t) => t.name === "test-task");
    expect(task?.intervalMs).toBe(30000);
  });

  test("emits task:interval-changed event with correct payload", () => {
    scheduler.register(makeTask("test-task", 60000));

    const events = collectEvents(bus, "task:interval-changed", () => {
      scheduler.updateInterval("test-task", 30000);
    });

    expect(events.length).toBe(1);
    expect(events[0].taskName).toBe("test-task");
    expect(events[0].previousIntervalMs).toBe(60000);
    expect(events[0].newIntervalMs).toBe(30000);
  });

  test("emits agent:evolved event with interval change details", () => {
    scheduler.register(makeTask("test-task", 60000));

    const events = collectEvents(bus, "agent:evolved", () => {
      scheduler.updateInterval("test-task", 45000, "high observation rate");
    });

    expect(events.length).toBe(1);
    expect(events[0].component).toBe("scheduler:test-task");
    expect(events[0].change).toBe("interval updated");
    expect(events[0].reason).toBe("high observation rate");
    expect(events[0].previousValue).toBe(60000);
    expect(events[0].newValue).toBe(45000);
  });

  test("throws if task is not registered", () => {
    expect(() => {
      scheduler.updateInterval("nonexistent-task", 5000);
    }).toThrow("Task not found: nonexistent-task");
  });

  test("restarts the timer after interval update (task remains running)", () => {
    scheduler.register(makeTask("test-task", 60000));

    // Task should be running initially
    const beforeUpdate = scheduler.list();
    expect(beforeUpdate.find((t) => t.name === "test-task")?.running).toBe(true);

    scheduler.updateInterval("test-task", 30000);

    // Task should still be running after update
    const afterUpdate = scheduler.list();
    expect(afterUpdate.find((t) => t.name === "test-task")?.running).toBe(true);
  });

  test("does not restart a disabled task after interval update", () => {
    scheduler.register({ ...makeTask("test-task", 60000), enabled: false });
    scheduler.updateInterval("test-task", 30000);

    const tasks = scheduler.list();
    const task = tasks.find((t) => t.name === "test-task");
    expect(task?.running).toBe(false);
    expect(task?.intervalMs).toBe(30000); // Interval still updated
  });
});

// ============================================================
// Suite 2: TaskScheduler — enable / disable
// ============================================================

describe("TaskScheduler.enable and disable", () => {
  let scheduler: TaskScheduler;
  let bus: TypedEventBus;

  beforeEach(() => {
    freshDb();
    ({ scheduler, bus } = makeScheduler());
  });

  afterEach(() => {
    scheduler.stopAll();
  });

  test("disable stops the timer and marks task disabled", () => {
    scheduler.register(makeTask("test-task"));

    // Initially running
    expect(scheduler.list().find((t) => t.name === "test-task")?.running).toBe(true);

    scheduler.disable("test-task");

    const task = scheduler.list().find((t) => t.name === "test-task");
    expect(task?.running).toBe(false);
    expect(task?.enabled).toBe(false);
  });

  test("enable restarts a disabled task", () => {
    // Register as disabled
    scheduler.register({ ...makeTask("test-task"), enabled: false });

    // Initially not running
    expect(scheduler.list().find((t) => t.name === "test-task")?.running).toBe(false);

    scheduler.enable("test-task");

    const task = scheduler.list().find((t) => t.name === "test-task");
    expect(task?.running).toBe(true);
    expect(task?.enabled).toBe(true);
  });

  test("enable is idempotent for already-running tasks", () => {
    scheduler.register(makeTask("test-task"));
    const eventsBefore = collectEvents(bus, "agent:evolved", () => {
      scheduler.enable("test-task"); // Already running — should be no-op
    });

    // No event emitted because task was already enabled and running
    expect(eventsBefore.length).toBe(0);
  });

  test("disable is idempotent for already-disabled tasks", () => {
    scheduler.register({ ...makeTask("test-task"), enabled: false });
    const events = collectEvents(bus, "agent:evolved", () => {
      scheduler.disable("test-task"); // Already disabled — should be no-op
    });

    expect(events.length).toBe(0);
  });

  test("disable emits agent:evolved with correct payload", () => {
    scheduler.register(makeTask("test-task"));

    const events = collectEvents(bus, "agent:evolved", () => {
      scheduler.disable("test-task", "low signal rate");
    });

    expect(events.length).toBe(1);
    expect(events[0].component).toBe("scheduler:test-task");
    expect(events[0].change).toBe("task disabled");
    expect(events[0].reason).toBe("low signal rate");
    expect(events[0].previousValue).toBe(true);
    expect(events[0].newValue).toBe(false);
  });

  test("enable emits agent:evolved with correct payload", () => {
    scheduler.register({ ...makeTask("test-task"), enabled: false });

    const events = collectEvents(bus, "agent:evolved", () => {
      scheduler.enable("test-task", "inbox active");
    });

    expect(events.length).toBe(1);
    expect(events[0].component).toBe("scheduler:test-task");
    expect(events[0].change).toBe("task enabled");
    expect(events[0].reason).toBe("inbox active");
    expect(events[0].previousValue).toBe(false);
    expect(events[0].newValue).toBe(true);
  });

  test("disable keeps task registered (can be re-enabled)", () => {
    scheduler.register(makeTask("test-task"));
    scheduler.disable("test-task");

    expect(scheduler.hasTask("test-task")).toBe(true);
    expect(scheduler.list().find((t) => t.name === "test-task")).toBeDefined();
  });

  test("throws if task is not registered", () => {
    expect(() => scheduler.enable("ghost")).toThrow("Task not found: ghost");
    expect(() => scheduler.disable("ghost")).toThrow("Task not found: ghost");
  });
});

// ============================================================
// Suite 3: Evolution State Persistence
// ============================================================

describe("Evolution State Persistence", () => {
  beforeEach(() => {
    freshDb();
  });

  test("saveTaskInterval persists a row to task_intervals", () => {
    saveTaskInterval("my-task", 30000, true, "test reason");

    const rows = loadTaskIntervals();
    expect(rows.length).toBe(1);
    expect(rows[0].taskName).toBe("my-task");
    expect(rows[0].intervalMs).toBe(30000);
    expect(rows[0].enabled).toBe(true);
    expect(rows[0].reason).toBe("test reason");
    expect(typeof rows[0].updatedAt).toBe("string");
  });

  test("saveTaskInterval upserts on repeated calls (same task name)", () => {
    saveTaskInterval("my-task", 30000, true, "first save");
    saveTaskInterval("my-task", 60000, false, "second save");

    const rows = loadTaskIntervals();
    expect(rows.length).toBe(1); // Only one row per task name
    expect(rows[0].intervalMs).toBe(60000);
    expect(rows[0].enabled).toBe(false);
    expect(rows[0].reason).toBe("second save");
  });

  test("loadTaskIntervals returns all tasks ordered by name", () => {
    saveTaskInterval("z-task", 5000, true);
    saveTaskInterval("a-task", 10000, false);
    saveTaskInterval("m-task", 7500, true);

    const rows = loadTaskIntervals();
    expect(rows.length).toBe(3);
    expect(rows[0].taskName).toBe("a-task");
    expect(rows[1].taskName).toBe("m-task");
    expect(rows[2].taskName).toBe("z-task");
  });

  test("loadTaskIntervals returns empty array when no rows exist", () => {
    const rows = loadTaskIntervals();
    expect(rows).toEqual([]);
  });

  test("saveTaskInterval persists disabled state correctly", () => {
    saveTaskInterval("test-task", 20000, false, "disabled for maintenance");

    const rows = loadTaskIntervals();
    expect(rows[0].enabled).toBe(false);
  });

  test("reason is optional — null when not provided", () => {
    saveTaskInterval("test-task", 20000, true);

    const rows = loadTaskIntervals();
    expect(rows[0].reason).toBeNull();
  });
});

// ============================================================
// Suite 4: State Persistence Across Simulated Restarts
// ============================================================

describe("Evolution Persistence: Simulated Restart", () => {
  beforeEach(() => {
    freshDb();
  });

  afterEach(() => {
    // Clean up any timers from scheduler instances created in tests
  });

  test("restoreFromDb applies persisted interval after simulated restart", () => {
    // "Run 1": register task, update interval, persist to DB
    saveTaskInterval("restart-task", 45000, true, "evolved in run 1");

    // "Run 2": create a new scheduler (simulating restart), register task at original interval
    const { scheduler: newScheduler } = makeScheduler();
    newScheduler.register(makeTask("restart-task", 60000));

    // Before restore: task has original interval
    expect(newScheduler.list()[0].intervalMs).toBe(60000);

    // Apply persisted state
    newScheduler.restoreFromDb();

    // After restore: task has evolved interval
    expect(newScheduler.list()[0].intervalMs).toBe(45000);

    newScheduler.stopAll();
  });

  test("restoreFromDb applies persisted disabled state after simulated restart", () => {
    // "Run 1": disable a task and persist
    saveTaskInterval("restart-task", 60000, false, "disabled in run 1");

    // "Run 2": register task as enabled (default)
    const { scheduler: newScheduler } = makeScheduler();
    newScheduler.register(makeTask("restart-task", 60000));

    // Before restore: task is running
    expect(newScheduler.list()[0].enabled).toBe(true);

    // Apply persisted state
    newScheduler.restoreFromDb();

    // After restore: task is disabled
    expect(newScheduler.list()[0].enabled).toBe(false);
    expect(newScheduler.list()[0].running).toBe(false);

    newScheduler.stopAll();
  });

  test("restoreFromDb skips unknown task names (task was removed)", () => {
    // Persist state for a task that no longer exists
    saveTaskInterval("removed-task", 30000, true, "evolved");

    // New scheduler without that task
    const { scheduler: newScheduler } = makeScheduler();
    newScheduler.register(makeTask("other-task", 60000));

    // Should not throw — just skip the unknown task
    expect(() => newScheduler.restoreFromDb()).not.toThrow();

    // Other task is unaffected
    expect(newScheduler.list()[0].name).toBe("other-task");
    expect(newScheduler.list()[0].intervalMs).toBe(60000);

    newScheduler.stopAll();
  });

  test("updateInterval followed by restoreFromDb round-trips correctly", () => {
    // "Run 1": register, update interval (persists automatically)
    const { scheduler: run1 } = makeScheduler();
    run1.register(makeTask("evolving-task", 60000));
    run1.updateInterval("evolving-task", 20000, "run 1 evolution");
    run1.stopAll();

    // "Run 2": register at original interval, restore from DB
    const { scheduler: run2 } = makeScheduler();
    run2.register(makeTask("evolving-task", 60000));
    run2.restoreFromDb();

    // Should have run 1's evolved interval
    expect(run2.list()[0].intervalMs).toBe(20000);
    run2.stopAll();
  });
});

// ============================================================
// Suite 5: reflect() — Rule-Based Evolution Suggestions
// ============================================================

describe("reflect()", () => {
  test("returns an empty array for a normal cycle with moderate activity", () => {
    const summary: CycleSummary = {
      tasksRun: 3,
      tasksFailed: 0,
      eventsObserved: 5,
      durationMs: 200,
      errors: [],
      taskObservations: { "task-a": 3, "task-b": 2 },
    };

    const suggestions = reflect(summary);
    // Neither rule fires: not high failure, not >10 events, not 0 events
    expect(suggestions).toEqual([]);
  });

  test("high failure rate returns a diagnostic note, not an interval change", () => {
    const summary: CycleSummary = {
      tasksRun: 1,
      tasksFailed: 2,
      eventsObserved: 0,
      durationMs: 100,
      errors: ["task-b failed", "task-c failed"],
    };

    const suggestions = reflect(summary);
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].taskName).toBe("__all__");
    expect(suggestions[0].suggestedIntervalMs).toBe(-1); // sentinel for no-change
    expect(suggestions[0].confidence).toBeLessThan(0.3);
    expect(suggestions[0].reason).toMatch(/failure rate/i);
  });

  test("high event count triggers suggestion for most active task", () => {
    const summary: CycleSummary = {
      tasksRun: 3,
      tasksFailed: 0,
      eventsObserved: 15,
      durationMs: 500,
      errors: [],
      taskObservations: { "busy-task": 12, "quiet-task": 2, "idle-task": 1 },
    };

    const suggestions = reflect(summary);
    expect(suggestions.length).toBeGreaterThan(0);

    const busySuggestion = suggestions.find((s) => s.taskName === "busy-task");
    expect(busySuggestion).toBeDefined();
    expect(busySuggestion?.confidence).toBeGreaterThanOrEqual(0.5);
    expect(busySuggestion?.reason).toMatch(/busy-task/);
  });

  test("zero observations suggests backing off idle tasks", () => {
    const summary: CycleSummary = {
      tasksRun: 2,
      tasksFailed: 0,
      eventsObserved: 0,
      durationMs: 100,
      errors: [],
      taskObservations: { "idle-task-a": 0, "idle-task-b": 0 },
    };

    const suggestions = reflect(summary);
    expect(suggestions.length).toBe(2); // One per idle task

    for (const s of suggestions) {
      expect(s.suggestedIntervalMs).toBe(-1); // Caller resolves actual interval
      expect(s.confidence).toBeGreaterThanOrEqual(0.4);
      expect(s.reason).toMatch(/zero observations/i);
    }
  });

  test("returns typed EvolutionSuggestion objects", () => {
    const summary: CycleSummary = {
      tasksRun: 1,
      tasksFailed: 2,
      eventsObserved: 0,
      durationMs: 100,
      errors: ["fail"],
    };

    const suggestions = reflect(summary);
    for (const s of suggestions) {
      expect(typeof s.taskName).toBe("string");
      expect(typeof s.suggestedIntervalMs).toBe("number");
      expect(typeof s.reason).toBe("string");
      expect(typeof s.confidence).toBe("number");
      expect(s.confidence).toBeGreaterThanOrEqual(0);
      expect(s.confidence).toBeLessThanOrEqual(1);
    }
  });

  test("reflect with no taskObservations does not crash", () => {
    const summary: CycleSummary = {
      tasksRun: 2,
      tasksFailed: 0,
      eventsObserved: 3,
      durationMs: 150,
      errors: [],
      // taskObservations omitted
    };

    expect(() => reflect(summary)).not.toThrow();
  });
});
