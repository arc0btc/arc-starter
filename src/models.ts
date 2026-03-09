/**
 * Model routing configuration — tier names, Claude model IDs, and pricing.
 *
 * Dispatch routing:
 * P1-4 (senior):   Opus  — new skills/sensors, architecture, deep reasoning, complex code.
 * P5-7 (mid):      Sonnet — composition, reviews, moderate complexity, operational tasks.
 * P8+  (junior):   Haiku  — simple execution, mark-as-read, config edits, status checks.
 */

export type ModelTier = "opus" | "sonnet" | "haiku";
export type SdkType = "claude" | "codex" | "openrouter";

/**
 * Parsed SDK routing result from a task's model field.
 *
 * Examples:
 *   "opus"        → { sdk: "claude", model: "opus" }
 *   "codex"       → { sdk: "codex", model: undefined } (use codex default)
 *   "codex:o3"    → { sdk: "codex", model: "o3" }
 *   "codex:o4-mini"→ { sdk: "codex", model: "o4-mini" }
 *   null          → { sdk: "claude", model: undefined } (priority routing)
 */
export interface SdkRoute {
  sdk: SdkType;
  model: string | undefined;
}

const CLAUDE_TIERS: Set<string> = new Set(["opus", "sonnet", "haiku"]);

/**
 * Parse a task's model field into SDK type + model identifier.
 * Returns sdk="claude" with model=undefined when no model is set (use priority routing).
 */
export function parseTaskSdk(taskModel: string | null): SdkRoute {
  if (!taskModel) return { sdk: "claude", model: undefined };

  // codex or codex:<model>
  if (taskModel === "codex") return { sdk: "codex", model: undefined };
  if (taskModel.startsWith("codex:")) {
    return { sdk: "codex", model: taskModel.slice(6) || undefined };
  }

  // Claude tiers
  if (CLAUDE_TIERS.has(taskModel)) return { sdk: "claude", model: taskModel };

  // Unknown — treat as claude with the raw value (dispatch will log a warning)
  return { sdk: "claude", model: taskModel };
}

export interface ModelPricing {
  input_per_million: number;
  output_per_million: number;
  cache_read_per_million: number;
  cache_write_per_million: number;
}

/** Actual Claude model IDs passed to the CLI --model flag. */
export const MODEL_IDS: Record<ModelTier, string> = {
  opus: "claude-opus-4-6",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
};

/** Per-million-token pricing for API cost estimation. */
export const MODEL_PRICING: Record<ModelTier, ModelPricing> = {
  opus: {
    input_per_million: 15,
    output_per_million: 75,
    cache_read_per_million: 1.875,
    cache_write_per_million: 18.75,
  },
  sonnet: {
    input_per_million: 3,
    output_per_million: 15,
    cache_read_per_million: 0.30,
    cache_write_per_million: 3.75,
  },
  haiku: {
    input_per_million: 1,
    output_per_million: 5,
    cache_read_per_million: 0.10,
    cache_write_per_million: 1.25,
  },
};
