/**
 * Event Logger
 *
 * Subscribes to the event bus and writes structured records to SQLite.
 * This is the bridge between the in-process event system and the
 * machine-queryable event_history table.
 *
 * Events logged:
 * - task:started     → event_history (source = task name)
 * - task:completed   → event_history (source = task name)
 * - task:failed      → event_history (source = task name)
 * - sensor:observation → event_history (source = observation source)
 *
 * Registration:
 * Call registerEventLogger() once during server startup, before tasks start.
 * It attaches listeners to the global eventBus and logs all relevant events.
 *
 * Pattern: write to SQLite first (authoritative), then optionally digest
 * to memory/working.md (human-readable summary). This module handles
 * the SQLite side; working.md updates happen in the REFLECT/EVOLVE phases.
 */

import { eventBus } from "../server/events";
import { writeEvent } from "../memory";

/**
 * Register event bus listeners that write to the event_history table.
 * Call once during server startup.
 */
export function registerEventLogger(): void {
  // task:started — a scheduled task has begun execution
  eventBus.on("task:started", (payload) => {
    writeEvent({
      timestamp: new Date().toISOString(),
      eventType: "task:started",
      source: payload.taskName,
      payload,
    });
  });

  // task:completed — a task finished successfully
  eventBus.on("task:completed", (payload) => {
    writeEvent({
      timestamp: new Date().toISOString(),
      eventType: "task:completed",
      source: payload.taskName,
      payload,
    });
  });

  // task:failed — a task threw an error
  eventBus.on("task:failed", (payload) => {
    writeEvent({
      timestamp: new Date().toISOString(),
      eventType: "task:failed",
      source: payload.taskName,
      payload,
    });
  });

  // sensor:observation — a sensor has observed external state
  eventBus.on("sensor:observation", (payload) => {
    writeEvent({
      timestamp: new Date().toISOString(),
      eventType: "sensor:observation",
      source: payload.source,
      payload,
    });
  });

  console.log("[Logger] Event logger registered — writing events to SQLite");
}
