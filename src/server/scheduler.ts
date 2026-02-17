/**
 * Task Scheduler
 *
 * Interval-based task scheduler for running periodic jobs.
 * Simpler than cron - just uses setInterval under the hood.
 *
 * Pattern:
 * - Register tasks with a name and interval
 * - Tasks run automatically at specified intervals
 * - Emit events when tasks start/complete/fail
 * - Tasks can be stopped and restarted
 */

import { eventBus } from "./events";
import {
  saveTaskInterval,
  loadTaskIntervals,
  writeEvolutionNote,
} from "../memory/evolution";

/**
 * Task definition
 */
export interface ScheduledTask {
  /** Unique task name */
  name: string;
  /** Task function to execute */
  fn: () => Promise<void> | void;
  /** Interval in milliseconds */
  intervalMs: number;
  /** Whether task is enabled (default: true) */
  enabled: boolean;
}

/**
 * Task scheduler
 * Manages periodic task execution
 */
export class TaskScheduler {
  private tasks = new Map<string, ScheduledTask>();
  private timers = new Map<string, Timer>();

  /**
   * Register a new task
   * Starts immediately if enabled
   */
  register(task: ScheduledTask): void {
    // Normalize enabled to a definite boolean (default: true)
    const normalizedTask: ScheduledTask = {
      ...task,
      enabled: task.enabled !== false,
    };
    this.tasks.set(task.name, normalizedTask);

    if (normalizedTask.enabled) {
      this.start(task.name);
    }

    console.log(
      `[Scheduler] Registered task: ${task.name} (${task.intervalMs}ms interval)`
    );
  }

  /**
   * Start a task
   */
  start(taskName: string): void {
    const task = this.tasks.get(taskName);
    if (!task) {
      throw new Error(`Task not found: ${taskName}`);
    }

    // Stop existing timer if running
    this.stop(taskName);

    // Create new interval timer
    const timer = setInterval(async () => {
      await this.executeTask(task);
    }, task.intervalMs);

    this.timers.set(taskName, timer);

    console.log(`[Scheduler] Started task: ${taskName}`);

    // Run immediately on start (don't wait for first interval)
    this.executeTask(task);
  }

  /**
   * Stop a task
   */
  stop(taskName: string): void {
    const timer = this.timers.get(taskName);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(taskName);
      console.log(`[Scheduler] Stopped task: ${taskName}`);
    }
  }

  /**
   * Check if a task is registered.
   * Useful before calling updateInterval/enable/disable from external code.
   */
  hasTask(taskName: string): boolean {
    return this.tasks.has(taskName);
  }

  /**
   * Update a task's interval at runtime (self-evolution hook).
   *
   * Stops the current timer, updates the interval in the task definition,
   * then restarts with the new interval. Emits task:interval-changed and
   * agent:evolved events so the change is observable and auditable.
   *
   * Persists the new interval to SQLite (task_intervals) and appends a
   * note to memory/working.md so evolution is visible to operators.
   *
   * @param taskName - The registered task name
   * @param newIntervalMs - New interval in milliseconds
   * @param reason - Optional reason for the change (stored in DB)
   */
  updateInterval(taskName: string, newIntervalMs: number, reason?: string): void {
    const task = this.tasks.get(taskName);
    if (!task) {
      throw new Error(`Task not found: ${taskName}`);
    }

    const previousIntervalMs = task.intervalMs;

    // Stop the running timer (if any)
    this.stop(taskName);

    // Update the task definition in-place
    task.intervalMs = newIntervalMs;

    // Restart if the task is enabled
    if (task.enabled) {
      this.start(taskName);
    }

    // Emit change events
    eventBus.emit("task:interval-changed", {
      taskName,
      previousIntervalMs,
      newIntervalMs,
    });

    const evolveReason = reason ?? "runtime evolution";
    eventBus.emit("agent:evolved", {
      component: `scheduler:${taskName}`,
      change: "interval updated",
      reason: evolveReason,
      previousValue: previousIntervalMs,
      newValue: newIntervalMs,
    });

    // Persist to SQLite so evolution survives restarts
    try {
      saveTaskInterval(taskName, newIntervalMs, task.enabled, evolveReason);
      writeEvolutionNote(
        `Interval for \`${taskName}\` changed from ${previousIntervalMs}ms to ${newIntervalMs}ms — ${evolveReason}`
      );
    } catch (err) {
      // Never crash the scheduler because of a persistence failure
      console.error(`[Scheduler] Failed to persist interval change for ${taskName}:`, err);
    }

    console.log(
      `[Scheduler] Updated interval for ${taskName}: ${previousIntervalMs}ms -> ${newIntervalMs}ms`
    );
  }

  /**
   * Enable a task at runtime.
   *
   * If the task is already enabled and running, this is a no-op.
   * Otherwise marks it enabled and starts the timer.
   * Persists enabled state to SQLite.
   *
   * @param taskName - The registered task name
   * @param reason - Optional reason for enabling
   */
  enable(taskName: string, reason?: string): void {
    const task = this.tasks.get(taskName);
    if (!task) {
      throw new Error(`Task not found: ${taskName}`);
    }

    if (task.enabled && this.timers.has(taskName)) {
      // Already running — nothing to do
      return;
    }

    task.enabled = true;
    this.start(taskName);

    const evolveReason = reason ?? "runtime evolution";
    eventBus.emit("agent:evolved", {
      component: `scheduler:${taskName}`,
      change: "task enabled",
      reason: evolveReason,
      previousValue: false,
      newValue: true,
    });

    try {
      saveTaskInterval(taskName, task.intervalMs, true, evolveReason);
    } catch (err) {
      console.error(`[Scheduler] Failed to persist enable for ${taskName}:`, err);
    }

    console.log(`[Scheduler] Enabled task: ${taskName}`);
  }

  /**
   * Disable a task at runtime.
   *
   * Stops the timer but keeps the task registered.
   * The task can be re-enabled later with enable().
   * Persists disabled state to SQLite.
   *
   * @param taskName - The registered task name
   * @param reason - Optional reason for disabling
   */
  disable(taskName: string, reason?: string): void {
    const task = this.tasks.get(taskName);
    if (!task) {
      throw new Error(`Task not found: ${taskName}`);
    }

    if (!task.enabled && !this.timers.has(taskName)) {
      // Already disabled — nothing to do
      return;
    }

    task.enabled = false;
    this.stop(taskName);

    const evolveReason = reason ?? "runtime evolution";
    eventBus.emit("agent:evolved", {
      component: `scheduler:${taskName}`,
      change: "task disabled",
      reason: evolveReason,
      previousValue: true,
      newValue: false,
    });

    try {
      saveTaskInterval(taskName, task.intervalMs, false, evolveReason);
    } catch (err) {
      console.error(`[Scheduler] Failed to persist disable for ${taskName}:`, err);
    }

    console.log(`[Scheduler] Disabled task: ${taskName}`);
  }

  /**
   * Restore evolved task state from SQLite on startup.
   *
   * Loads persisted intervals and enabled states from task_intervals table.
   * Only applies to tasks that are already registered — unknown task names
   * are skipped (tasks may have been removed since last run).
   *
   * Call this after all tasks are registered in src/index.ts:
   * ```typescript
   * scheduler.register({ name: "my-task", ... });
   * scheduler.restoreFromDb();  // apply any evolved state
   * ```
   */
  restoreFromDb(): void {
    try {
      const rows = loadTaskIntervals();
      let restored = 0;

      for (const row of rows) {
        if (!this.tasks.has(row.taskName)) {
          // Task was removed — skip silently
          continue;
        }

        const task = this.tasks.get(row.taskName)!;

        // Apply persisted interval if different from current
        if (task.intervalMs !== row.intervalMs) {
          // Use internal stop/start to avoid re-persisting (already in DB)
          this.stop(row.taskName);
          task.intervalMs = row.intervalMs;
          if (row.enabled) {
            this.start(row.taskName);
          }
          console.log(
            `[Scheduler] Restored interval for ${row.taskName}: ${row.intervalMs}ms`
          );
        }

        // Apply persisted enabled state
        if (task.enabled && !row.enabled) {
          // Should be disabled — stop without re-persisting
          task.enabled = false;
          this.stop(row.taskName);
          console.log(`[Scheduler] Restored disabled state for: ${row.taskName}`);
        } else if (!task.enabled && row.enabled) {
          // Should be enabled — start without re-persisting
          task.enabled = true;
          this.start(row.taskName);
          console.log(`[Scheduler] Restored enabled state for: ${row.taskName}`);
        }

        restored++;
      }

      if (restored > 0) {
        console.log(`[Scheduler] Restored evolution state for ${restored} task(s)`);
      }
    } catch (err) {
      // Never crash on startup because DB restore failed
      console.error(`[Scheduler] Failed to restore evolution state from DB:`, err);
    }
  }

  /**
   * Stop all tasks
   */
  stopAll(): void {
    for (const taskName of this.timers.keys()) {
      this.stop(taskName);
    }
  }

  /**
   * Execute a single task
   * Emits events for task lifecycle
   */
  private async executeTask(task: ScheduledTask): Promise<void> {
    const startTime = Date.now();

    eventBus.emit("task:started", {
      taskName: task.name,
      timestamp: startTime,
    });

    try {
      await task.fn();

      const duration = Date.now() - startTime;
      eventBus.emit("task:completed", {
        taskName: task.name,
        duration,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      eventBus.emit("task:failed", {
        taskName: task.name,
        error: errorMessage,
      });

      console.error(`[Scheduler] Task failed: ${task.name}`, error);
    }
  }

  /**
   * Get list of registered tasks with runtime state.
   */
  list(): { name: string; running: boolean; enabled: boolean; intervalMs: number }[] {
    return Array.from(this.tasks.entries()).map(([name, task]) => ({
      name,
      running: this.timers.has(name),
      enabled: task.enabled,
      intervalMs: task.intervalMs,
    }));
  }
}

/**
 * Global scheduler instance
 * Import this in other modules to register tasks
 */
export const scheduler = new TaskScheduler();

/**
 * Helper: Convert minutes to milliseconds
 */
export function minutes(n: number): number {
  return n * 60 * 1000;
}

/**
 * Helper: Convert hours to milliseconds
 */
export function hours(n: number): number {
  return n * 60 * 60 * 1000;
}
