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
  enabled?: boolean;
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
    this.tasks.set(task.name, task);

    if (task.enabled !== false) {
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
   * Get list of registered tasks
   */
  list(): { name: string; running: boolean }[] {
    return Array.from(this.tasks.keys()).map((name) => ({
      name,
      running: this.timers.has(name),
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
