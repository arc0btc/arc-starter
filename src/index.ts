/**
 * Arc Starter - Entry Point
 *
 * This is where your agent comes to life.
 * Start the server, register your tasks, and let it run.
 */

import { startServer } from "./server";
import { scheduler, minutes } from "./server/scheduler";
import { eventBus } from "./server/events";

/**
 * Example task: Say hello every minute
 * Replace this with your actual agent logic
 */
scheduler.register({
  name: "hello-task",
  intervalMs: minutes(1),
  fn: async () => {
    console.log("👋 Hello from Arc! Time:", new Date().toISOString());

    // Emit an event that other components can listen to
    eventBus.emit("sensor:observation", {
      source: "hello-task",
      data: { message: "Hello from Arc!", timestamp: Date.now() },
    });
  },
});

/**
 * Example: Listen to task events
 * This shows how to monitor task execution
 */
eventBus.on("task:completed", (payload) => {
  console.log(`✅ Task completed: ${payload.taskName} (${payload.duration}ms)`);
});

eventBus.on("task:failed", (payload) => {
  console.error(`❌ Task failed: ${payload.taskName} - ${payload.error}`);
});

/**
 * Start the server
 * Default port: 3000 (override with PORT env var)
 */
const port = parseInt(process.env.PORT || "3000", 10);
await startServer(port);
