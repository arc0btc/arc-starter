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
   * Update a task's interval at runtime (self-evolution hook).
   *
   * Stops the current timer, updates the interval in the task definition,
   * then restarts with the new interval. Emits task:interval-changed and
   * agent:evolved events so the change is observable and auditable.
   *
   * Callers that want to persist this change should call
   * saveTaskInterval() from src/memory/evolution.ts separately.
   */
  updateInterval(taskName: string, newIntervalMs: number): void {
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

    eventBus.emit("agent:evolved", {
      component: `scheduler:${taskName}`,
      change: "interval updated",
      reason: "runtime evolution",
      previousValue: previousIntervalMs,
      newValue: newIntervalMs,
    });

    console.log(
      `[Scheduler] Updated interval for ${taskName}: ${previousIntervalMs}ms → ${newIntervalMs}ms`
    );
  }

  /**
   * Enable a task at runtime.
   *
   * If the task is already enabled and running, this is a no-op.
   * Otherwise marks it enabled and starts the timer.
   */
  enable(taskName: string): void {
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

    eventBus.emit("agent:evolved", {
      component: `scheduler:${taskName}`,
      change: "task enabled",
      reason: "runtime evolution",
      previousValue: false,
      newValue: true,
    });

    console.log(`[Scheduler] Enabled task: ${taskName}`);
  }

  /**
   * Disable a task at runtime.
   *
   * Stops the timer but keeps the task registered.
   * The task can be re-enabled later with enable().
   */
  disable(taskName: string): void {
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

    eventBus.emit("agent:evolved", {
      component: `scheduler:${taskName}`,
      change: "task disabled",
      reason: "runtime evolution",
      previousValue: true,
      newValue: false,
    });

    console.log(`[Scheduler] Disabled task: ${taskName}`);
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
