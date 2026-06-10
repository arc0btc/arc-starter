/**
 * Escalation ladder — ARC-0011.
 *
 * Replaces the flat `max_retries=3` retry model with a four-rung progression:
 *
 *   REFINE      same approach, adjusted prompt/params/timing
 *   PIVOT       fundamentally different approach; consult dead-ends first
 *   WEB-SEARCH   fetch external context, verify mechanically, then re-enter PIVOT
 *   HANDOFF     block + escalate to the operator with a pruned decision tree
 *
 * The rung is persisted on the task (escalation_rung / pivot_count / dead_ends) and
 * advanced by dispatch after each failed attempt. One success at any rung resets the
 * task to REFINE (see resetEscalation in db.ts).
 *
 * See agent-runtime/proposals/0011-escalation-ladder.md for the full spec.
 */

export type EscalationRung = "REFINE" | "PIVOT" | "WEB-SEARCH" | "HANDOFF";

/**
 * Failure-detector classes from recursive-improve-failure-detectors.md. Only the
 * structural classes (`errors`, `loops`) change rung selection — they skip REFINE
 * because the same approach has already failed repeatedly.
 */
export type DetectorClass = "errors" | "loops" | "give-ups" | "recovery" | "verification_failed";

export interface DeadEnd {
  approach: string; // what was tried (rung + brief note)
  reason: string;   // why it failed
  attempt: number;  // attempt_count at the time of abandonment
}

/** Ordered rungs, lowest to highest escalation. */
export const RUNGS: readonly EscalationRung[] = ["REFINE", "PIVOT", "WEB-SEARCH", "HANDOFF"] as const;

/** Recommended HANDOFF threshold for new tasks: 2 REFINE + 2 PIVOT + 1 WEB-SEARCH + 2 post-web REFINE. */
export const DEFAULT_MAX_RETRIES = 7;

const VALID_RUNGS = new Set<string>(RUNGS);

/** Coerce a raw column value into a valid rung, defaulting to REFINE. */
export function normalizeRung(value: string | null | undefined): EscalationRung {
  return value && VALID_RUNGS.has(value) ? (value as EscalationRung) : "REFINE";
}

/** Parse the dead_ends JSON column into a typed array (empty on null/garbage). */
export function parseDeadEnds(json: string | null | undefined): DeadEnd[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as DeadEnd[]) : [];
  } catch {
    return [];
  }
}

/**
 * Compute the next rung after a failed attempt.
 *
 * Differs from the ARC-0011 pseudocode in one deliberate way: the HANDOFF threshold
 * is checked FIRST so the ladder always terminates. The proposal lists that check
 * last, which makes it unreachable for the `errors`/`loops` classes (they early-return
 * to PIVOT) — those tasks would loop in PIVOT forever. Hoisting the threshold preserves
 * the intent ("max_retries is the HANDOFF threshold") while guaranteeing termination.
 *
 * @param current      the task's current rung
 * @param attemptCount the task's attempt_count AFTER incrementing for this attempt
 * @param pivotCount   the number of PIVOT attempts made so far (including the one just failed)
 * @param maxRetries   the HANDOFF threshold
 * @param failureClass optional detector class; `errors`/`loops` skip REFINE
 * @param webSearchUsed whether the (non-repeating) WEB-SEARCH rung has already run
 */
export function nextRung(
  current: EscalationRung,
  attemptCount: number,
  pivotCount: number,
  maxRetries: number,
  failureClass?: DetectorClass,
  webSearchUsed: boolean = false,
): EscalationRung {
  // Terminal guarantee: the HANDOFF threshold always wins.
  if (attemptCount >= maxRetries) return "HANDOFF";

  const structural = failureClass === "errors" || failureClass === "loops";

  if (current === "REFINE") {
    // Structural failures skip REFINE entirely; otherwise promote after 2 REFINE attempts.
    return structural || attemptCount >= 2 ? "PIVOT" : "REFINE";
  }
  if (current === "PIVOT") {
    // After two PIVOT attempts, reach for external context — but only once per task.
    return pivotCount >= 2 && !webSearchUsed ? "WEB-SEARCH" : "PIVOT";
  }
  if (current === "WEB-SEARCH") {
    // One external pass only, then fold the new context back into a PIVOT.
    return "PIVOT";
  }
  return current;
}

/**
 * Format a pruned decision tree for a HANDOFF escalation: what was tried, what
 * blocked each attempt, what a human should try next. Arrives with the tree already
 * pruned so the operator doesn't have to reconstruct the strategic history.
 */
export function formatDecisionTree(
  args: { id: number; subject: string; attemptCount: number; maxRetries: number },
  deadEnds: DeadEnd[],
  lastError: string,
): string {
  const lines: string[] = [
    `[ESCALATED] Task #${args.id} reached HANDOFF after ${args.attemptCount}/${args.maxRetries} attempts.`,
    `Subject: ${args.subject}`,
    "",
    "Approaches tried (pruned decision tree):",
  ];
  if (deadEnds.length === 0) {
    lines.push("  - (no PIVOT history recorded — failures stayed on REFINE)");
  } else {
    for (const dead of deadEnds) {
      lines.push(`  - attempt ${dead.attempt} [${dead.approach}]: ${dead.reason}`);
    }
  }
  lines.push(
    "",
    `Last error: ${lastError.slice(0, 400)}`,
    "",
    "What a human should try next: review the abandoned approaches above; the structural",
    "block is unlikely to clear via retry. Provide a new strategy, credentials, or a policy",
    "decision, then re-open the original task.",
  );
  return lines.join("\n");
}
