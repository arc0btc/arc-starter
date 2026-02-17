/**
 * Event Bus
 *
 * Simple EventEmitter-based event bus for inter-component communication.
 * Allows sensors, schedulers, and channels to communicate without tight coupling.
 *
 * Pattern:
 * - Emit events when state changes or actions complete
 * - Subscribe to events to react to system state
 * - Use wildcard '*' to listen to all events
 */

import { EventEmitter } from "events";

/**
 * Event payload types
 * Add your own event types here as you extend the system
 */
export interface EventPayloads {
  "server:started": { port: number; uptime: number };
  "server:stopped": { uptime: number };
  "task:started": { taskName: string; timestamp: number };
  "task:completed": { taskName: string; duration: number };
  "task:failed": { taskName: string; error: string };
  "task:interval-changed": {
    taskName: string;
    previousIntervalMs: number;
    newIntervalMs: number;
  };
  "sensor:observation": { source: string; data: unknown };
  "channel:message": { channel: string; message: string };
  /**
   * Emitted when the agent adjusts its own behavior at runtime.
   * Provides a structured, auditable record of self-modification.
   */
  "agent:evolved": {
    /** Which component changed (e.g. "scheduler", "sensor:github") */
    component: string;
    /** Human-readable description of the change */
    change: string;
    /** Why the change was made */
    reason: string;
    /** Value before the change */
    previousValue: unknown;
    /** Value after the change */
    newValue: unknown;
  };
}

/**
 * Typed event emitter
 * Provides type safety for event names and payloads
 */
export class TypedEventBus extends EventEmitter {
  /**
   * Emit a typed event
   * Also emits to wildcard listeners registered via onAny()
   */
  emit<K extends keyof EventPayloads>(
    event: K,
    payload: EventPayloads[K]
  ): boolean {
    // Emit to specific event listeners
    const result = super.emit(event, payload);
    // Also emit to wildcard listeners
    super.emit("*", event, payload);
    return result;
  }

  /**
   * Subscribe to a typed event
   */
  on<K extends keyof EventPayloads>(
    event: K,
    listener: (payload: EventPayloads[K]) => void
  ): this {
    return super.on(event, listener);
  }

  /**
   * Subscribe to all events (wildcard listener)
   * Useful for logging or monitoring
   */
  onAny(listener: (event: string, payload: unknown) => void): this {
    return super.on("*", listener);
  }
}

/**
 * Global event bus instance
 * Import this in other modules to emit or listen to events
 */
export const eventBus = new TypedEventBus();

// Example: Log all events in development
if (process.env.NODE_ENV === "development") {
  eventBus.onAny((event, payload) => {
    console.log(`[Event] ${event}:`, payload);
  });
}
