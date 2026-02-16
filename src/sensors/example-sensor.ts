/**
 * Example Sensor
 *
 * Sensors observe the external world and return observations.
 * They're the "eyes" of your agent - watching for changes, events, signals.
 *
 * Pattern:
 * - Sensors are stateless (they don't remember previous observations)
 * - They return structured data that other components can act on
 * - They should be fast - don't block the main loop
 * - They emit events so other parts of the system can react
 *
 * Common sensor types:
 * - API polling (check GitHub, Twitter, blockchain, etc.)
 * - Webhook receivers (incoming events)
 * - File system watchers
 * - Database change streams
 */

import { eventBus } from "../server/events";

/**
 * Observation type
 * Define what your sensor observes
 */
export interface Observation {
  /** Where the observation came from */
  source: string;
  /** When it was observed */
  timestamp: number;
  /** The actual data */
  data: unknown;
}

/**
 * Example: Simple time-based sensor
 * Observes the current time and emits an event
 */
export async function observeTime(): Promise<Observation> {
  const now = Date.now();

  const observation: Observation = {
    source: "time-sensor",
    timestamp: now,
    data: {
      iso: new Date(now).toISOString(),
      unix: now,
      dayOfWeek: new Date(now).toLocaleDateString("en-US", { weekday: "long" }),
    },
  };

  // Emit event so other components can react
  eventBus.emit("sensor:observation", observation);

  return observation;
}

/**
 * Example: Mock API sensor
 * In a real agent, this would call an actual API
 */
export async function observeMockAPI(): Promise<Observation> {
  // Simulate API call delay
  await new Promise((resolve) => setTimeout(resolve, 100));

  const observation: Observation = {
    source: "mock-api",
    timestamp: Date.now(),
    data: {
      status: "healthy",
      value: Math.random() * 100,
      message: "This would be real data in production",
    },
  };

  eventBus.emit("sensor:observation", observation);

  return observation;
}

/**
 * How to use this sensor:
 *
 * 1. Register as a scheduled task:
 *    ```typescript
 *    import { scheduler, minutes } from "./server/scheduler";
 *    import { observeTime } from "./sensors/example-sensor";
 *
 *    scheduler.register({
 *      name: "time-observer",
 *      intervalMs: minutes(5),
 *      fn: observeTime,
 *    });
 *    ```
 *
 * 2. Call on-demand from a query tool or API endpoint:
 *    ```typescript
 *    const obs = await observeTime();
 *    console.log("Current time:", obs.data);
 *    ```
 *
 * 3. React to observations via events:
 *    ```typescript
 *    eventBus.on("sensor:observation", (observation) => {
 *      if (observation.source === "time-sensor") {
 *        console.log("Time updated:", observation.data);
 *      }
 *    });
 *    ```
 */
