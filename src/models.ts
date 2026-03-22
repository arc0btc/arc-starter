/**
 * Model configuration — tier names, Claude model IDs, SDK routing, and pricing.
 * Model is set explicitly per task — no implicit priority-based defaults.
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
 *   null          → { sdk: "claude", model: undefined } (no model — dispatch will reject)
 */
export interface SdkRoute {
  sdk: SdkType;
  model: string | undefined;
}

const CLAUDE_TIERS: Set<string> = new Set(["opus", "sonnet", "haiku"]);

/**
 * OpenRouter model alias map — short names → full OpenRouter model IDs.
 * Used when tasks specify `openrouter:<alias>` in the model field.
 */
export const OPENROUTER_ALIASES: Record<string, string> = {
  kimi: "moonshotai/kimi-k2.5",
  minimax: "minimax/minimax-m2-5",
  qwen: "qwen/qwen3-coder",
};

/**
 * Pricing per million tokens for OpenRouter models.
 * Used for api_cost_usd estimation. Models not listed default to sonnet-tier pricing.
 */
export const OPENROUTER_PRICING: Record<string, ModelPricing> = {
  "moonshotai/kimi-k2.5": {
    input_per_million: 2.0,
    output_per_million: 8.0,
    cache_read_per_million: 0.5,
    cache_write_per_million: 2.0,
  },
  "minimax/minimax-m2-5": {
    input_per_million: 1.0,
    output_per_million: 5.0,
    cache_read_per_million: 0.25,
    cache_write_per_million: 1.0,
  },
  "qwen/qwen3-coder": {
    input_per_million: 0.8,
    output_per_million: 3.2,
    cache_read_per_million: 0.2,
    cache_write_per_million: 0.8,
  },
};

/**
 * Parse a task's model field into SDK type + model identifier.
 * Returns sdk="claude" with model=undefined when no model is set (dispatch will reject).
 */
export function parseTaskSdk(taskModel: string | null): SdkRoute {
  if (!taskModel) return { sdk: "claude", model: undefined };

  // codex or codex:<model>
  if (taskModel === "codex") return { sdk: "codex", model: undefined };
  if (taskModel.startsWith("codex:")) {
    return { sdk: "codex", model: taskModel.slice(6) || undefined };
  }

  // openrouter:<alias-or-model-id>
  if (taskModel.startsWith("openrouter:")) {
    const raw = taskModel.slice(11);
    const resolved = OPENROUTER_ALIASES[raw] ?? raw;
    return { sdk: "openrouter", model: resolved || undefined };
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
