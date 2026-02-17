/**
 * Reflect Helper
 *
 * Hook point for the agent's EVOLVE phase. Takes a cycle summary and
 * returns evolution suggestions — adjustments the agent could make to
 * its own behavior based on what it observed.
 *
 * This module provides the interface and a rule-based example implementation.
 * Users can replace the rule-based logic with LLM-driven reasoning, custom
 * heuristics, or any decision process that fits their use case.
 *
 * Design principle (from drx4 research):
 * Self-evolution should modify structured runtime config, not freeform
 * instructions. Suggestions from reflect() are applied via scheduler
 * methods (updateInterval, enable, disable) — never by editing source code.
 *
 * Usage:
 * ```typescript
 * import { reflect } from "../evolution/reflect";
 *
 * const suggestions = reflect(cycleSummary);
 * for (const s of suggestions) {
 *   if (s.confidence >= 0.7) {
 *     scheduler.updateInterval(s.taskName, s.suggestedIntervalMs);
 *   }
 * }
 * ```
 */

/**
 * Summary of a completed cycle.
 * Passed to reflect() so it can identify patterns and suggest adjustments.
 */
export interface CycleSummary {
  /** Number of tasks that ran successfully */
  tasksRun: number;
  /** Number of tasks that failed */
  tasksFailed: number;
  /** Number of sensor observations recorded */
  eventsObserved: number;
  /** Total cycle duration in milliseconds */
  durationMs: number;
  /** Error messages from this cycle (if any) */
  errors: string[];
  /**
   * Per-task observation counts.
   * Key: task name. Value: number of sensor:observation events emitted.
   * Used to detect tasks generating high or low signal.
   */
  taskObservations?: Record<string, number>;
}

/**
 * A single evolution suggestion produced by reflect().
 *
 * The caller decides whether to apply it based on confidence threshold
 * and any human-in-the-loop guardrails they want to enforce.
 */
export interface EvolutionSuggestion {
  /** Which task this suggestion applies to */
  taskName: string;
  /** Suggested new interval in milliseconds */
  suggestedIntervalMs: number;
  /** Human-readable explanation of why this change is suggested */
  reason: string;
  /**
   * Confidence in this suggestion (0.0–1.0).
   * Low confidence = informational only; high confidence = safe to auto-apply.
   */
  confidence: number;
}

/**
 * Reflect on a cycle summary and return evolution suggestions.
 *
 * This is a rule-based reference implementation. The rules demonstrate
 * the pattern — replace or extend them with your own logic.
 *
 * Current rules:
 * 1. High observation rate (>10 events): suggest 50% shorter interval
 *    for the most active task (more signal = poll more frequently).
 * 2. Low observation rate (0 events, no errors): suggest 2x longer interval
 *    for any task with zero observations (no signal = poll less frequently).
 * 3. High failure rate (>50% tasks failed): no interval suggestions;
 *    emit a diagnostic note with low confidence.
 *
 * @param cycleSummary - Results from the most recent cycle
 * @returns Array of evolution suggestions (may be empty)
 */
export function reflect(cycleSummary: CycleSummary): EvolutionSuggestion[] {
  const suggestions: EvolutionSuggestion[] = [];

  const { tasksRun, tasksFailed, eventsObserved, taskObservations } = cycleSummary;

  // Rule 3: High failure rate — don't suggest changes, flag for investigation
  const totalTasks = tasksRun + tasksFailed;
  if (totalTasks > 0 && tasksFailed / totalTasks > 0.5) {
    // Return a single low-confidence diagnostic note.
    // There's no safe interval change when tasks are mostly failing.
    return [
      {
        taskName: "__all__",
        suggestedIntervalMs: -1, // Sentinel: no interval change
        reason: `High failure rate (${tasksFailed}/${totalTasks} tasks failed). Investigate errors before adjusting intervals.`,
        confidence: 0.1,
      },
    ];
  }

  // Rule 1: High observation rate — suggest shorter intervals for active tasks
  if (eventsObserved > 10 && taskObservations) {
    // Find the task with the most observations
    const sorted = Object.entries(taskObservations).sort(([, a], [, b]) => b - a);
    const [topTask, topCount] = sorted[0] ?? [];

    if (topTask && topCount > 5) {
      // Suggest 50% shorter interval (more active = check more often)
      // Use a floor of 5000ms to avoid overly aggressive polling
      suggestions.push({
        taskName: topTask,
        suggestedIntervalMs: -1, // Caller must resolve current interval
        reason: `Task "${topTask}" generated ${topCount} observations. High signal rate suggests more frequent polling may be valuable.`,
        confidence: 0.6,
      });
    }
  }

  // Rule 2: Zero observations with no failures — suggest backing off
  if (eventsObserved === 0 && tasksFailed === 0 && taskObservations) {
    for (const [taskName, count] of Object.entries(taskObservations)) {
      if (count === 0) {
        // Suggest 2x longer interval (no signal = check less often)
        suggestions.push({
          taskName,
          suggestedIntervalMs: -1, // Caller must resolve current interval and double it
          reason: `Task "${taskName}" produced zero observations this cycle. Low signal rate suggests less frequent polling is sufficient.`,
          confidence: 0.5,
        });
      }
    }
  }

  return suggestions;
}
