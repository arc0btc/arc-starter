/**
 * OpenRouter dispatch adapter — calls OpenRouter's API instead of Claude Code CLI.
 *
 * Used when OPENROUTER_API_KEY is set (via credentials or env var).
 * Supports tool calling for bash/arc commands so the agent can operate autonomously.
 *
 * OpenRouter uses the OpenAI-compatible chat completions API at:
 *   https://openrouter.ai/api/v1/chat/completions
 *
 * Model mapping: tier → OpenRouter model ID (Claude models via OpenRouter).
 */

import { type ModelTier, MODEL_PRICING, OPENROUTER_PRICING } from "./models.ts";
import { getCredential } from "./credentials.ts";

// ---- Constants ----

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

/** OpenRouter model IDs for Claude models. */
const OPENROUTER_MODEL_IDS: Record<ModelTier, string> = {
  opus: "anthropic/claude-opus-4-6",
  sonnet: "anthropic/claude-sonnet-4-6",
  haiku: "anthropic/claude-haiku-4-5-20251001",
};

/** Max iterations for tool-call loop to prevent runaway. */
const MAX_TOOL_ITERATIONS = 50;

/** Tool call timeout for bash commands (ms). */
const BASH_TIMEOUT_MS = 120_000;

// ---- Types ----

interface OpenRouterMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenRouterToolCall[];
  tool_call_id?: string;
}

interface OpenRouterToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenRouterChoice {
  message: {
    role: string;
    content: string | null;
    tool_calls?: OpenRouterToolCall[];
  };
  finish_reason: string;
}

interface OpenRouterResponse {
  id: string;
  choices: OpenRouterChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenRouterDispatchResult {
  result: string;
  cost_usd: number;
  api_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
}

// ---- Tool definitions ----

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "bash",
      description: "Execute a bash command. Use this to run arc CLI commands, read files, edit files, and perform any system operations. The working directory is the arc-starter repo root.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The bash command to execute",
          },
        },
        required: ["command"],
      },
    },
  },
];

// ---- Helpers ----

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] openrouter: ${msg}`);
}

/**
 * Get the OpenRouter API key from credentials store or env var.
 * Returns null if not configured.
 */
export async function getOpenRouterApiKey(): Promise<string | null> {
  // Check env var first (allows override)
  if (process.env.OPENROUTER_API_KEY) {
    return process.env.OPENROUTER_API_KEY;
  }
  // Check credentials store
  try {
    const key = await getCredential("openrouter", "api-key");
    return key || null;
  } catch {
    return null;
  }
}

/**
 * Execute a bash command and return stdout/stderr.
 */
async function executeBash(command: string, cwd: string): Promise<string> {
  log(`bash: ${command.slice(0, 120)}${command.length > 120 ? "..." : ""}`);

  const proc = Bun.spawn(["bash", "-c", command], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });

  // Timeout watchdog
  const timeout = setTimeout(() => {
    try { proc.kill("SIGTERM"); } catch { /* already dead */ }
  }, BASH_TIMEOUT_MS);

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  clearTimeout(timeout);

  const output = stdout + (stderr ? `\nSTDERR: ${stderr}` : "");
  const result = `Exit code: ${exitCode}\n${output}`.trim();

  // Cap output to prevent context blowup
  if (result.length > 10_000) {
    return result.slice(0, 9_500) + "\n\n[output truncated — 10k char limit]";
  }
  return result;
}

/**
 * Calculate API cost from token counts using model pricing.
 * Accepts a Claude tier name OR an OpenRouter model ID string.
 * Falls back to sonnet-tier pricing for unknown models.
 */
function calculateApiCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = MODEL_PRICING[model as ModelTier] ?? OPENROUTER_PRICING[model] ?? MODEL_PRICING.sonnet;
  return (
    (inputTokens / 1_000_000) * p.input_per_million +
    (outputTokens / 1_000_000) * p.output_per_million
  );
}

// ---- Main dispatch function ----

/**
 * Dispatch a prompt to OpenRouter's API with tool calling support.
 *
 * The prompt is sent as a user message. The model can call the `bash` tool
 * to execute arc CLI commands, read/write files, etc. The loop continues
 * until the model produces a final text response (no more tool calls).
 *
 * @param explicitModelId — Full OpenRouter model ID (e.g. "moonshotai/kimi-k2.5").
 *   When set, overrides the Claude tier→model mapping. Used for `openrouter:` prefix routing.
 */
export async function dispatchOpenRouter(
  prompt: string,
  model: ModelTier = "sonnet",
  cwd?: string,
  apiKey?: string,
  explicitModelId?: string,
): Promise<OpenRouterDispatchResult> {
  const key = apiKey ?? await getOpenRouterApiKey();
  if (!key) {
    throw new Error("OpenRouter API key not configured. Set via: arc creds set --service openrouter --key api-key --value <key>");
  }

  const workDir = cwd ?? new URL("..", import.meta.url).pathname;
  const modelId = explicitModelId ?? OPENROUTER_MODEL_IDS[model];
  const costModel = explicitModelId ?? model;

  log(`dispatching to ${modelId}`);

  // Build initial messages
  const messages: OpenRouterMessage[] = [
    {
      role: "user",
      content: prompt,
    },
  ];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalResult = "";
  let iterations = 0;

  // Tool-call loop
  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    const body = {
      model: modelId,
      messages,
      tools: TOOLS,
      max_tokens: 16384,
    };

    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://arc0.me",
        "X-Title": "Arc Agent",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${errText.slice(0, 500)}`);
    }

    const data = await response.json() as OpenRouterResponse;

    // Accumulate token usage
    if (data.usage) {
      totalInputTokens += data.usage.prompt_tokens;
      totalOutputTokens += data.usage.completion_tokens;
    }

    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error("OpenRouter returned no choices");
    }

    const assistantMsg = choice.message;

    // Add assistant message to conversation
    messages.push({
      role: "assistant",
      content: assistantMsg.content,
      tool_calls: assistantMsg.tool_calls,
    });

    // If no tool calls, we're done
    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
      finalResult = assistantMsg.content ?? "";
      break;
    }

    // Execute tool calls and add results
    for (const toolCall of assistantMsg.tool_calls) {
      if (toolCall.function.name === "bash") {
        let args: { command: string };
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: "Error: invalid JSON in tool arguments",
          });
          continue;
        }

        const output = await executeBash(args.command, workDir);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: output,
        });
      } else {
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: `Error: unknown tool "${toolCall.function.name}"`,
        });
      }
    }

    // If last iteration ended with tool_calls and content, capture content
    if (iterations >= MAX_TOOL_ITERATIONS && assistantMsg.content) {
      finalResult = assistantMsg.content;
    }
  }

  if (iterations >= MAX_TOOL_ITERATIONS && !finalResult) {
    log(`hit max tool iterations (${MAX_TOOL_ITERATIONS})`);
    finalResult = "[max tool iterations reached]";
  }

  const apiCost = calculateApiCostUsd(costModel, totalInputTokens, totalOutputTokens);

  log(`complete — ${iterations} iterations, ${totalInputTokens}in/${totalOutputTokens}out, cost=$${apiCost.toFixed(4)}`);

  return {
    result: finalResult,
    cost_usd: apiCost,  // OpenRouter doesn't report cost_usd separately
    api_cost_usd: apiCost,
    input_tokens: totalInputTokens,
    output_tokens: totalOutputTokens,
  };
}
