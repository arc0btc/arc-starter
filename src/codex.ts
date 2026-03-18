/**
 * Codex CLI dispatch adapter — spawns OpenAI Codex CLI as a subprocess.
 *
 * Codex CLI (https://github.com/openai/codex) is an agentic coding tool
 * similar to Claude Code but powered by OpenAI models (o3, o4-mini, gpt-4.1, gpt-5.4).
 *
 * Differences from Claude Code:
 * - Input via --prompt flag (not stdin)
 * - Output is plain text to stdout (not stream-json)
 * - Uses --full-auto for autonomous mode (vs --dangerously-skip-permissions)
 * - No native cost reporting — we estimate from known pricing
 */

// ---- Types ----

export interface CodexDispatchResult {
  result: string;
  cost_usd: number;
  api_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
}

/** Known Codex model IDs and their per-million-token pricing. */
const CODEX_PRICING: Record<string, { input: number; output: number }> = {
  "o3":       { input: 2, output: 8 },
  "o4-mini":  { input: 1.10, output: 4.40 },
  "gpt-4.1":  { input: 2, output: 8 },
  "gpt-5.4":  { input: 2.50, output: 15 },
};

const DEFAULT_CODEX_MODEL = "o4-mini";

/** Maximum time (ms) for Codex subprocess. */
const CODEX_TIMEOUT_MS = 15 * 60 * 1000;

import { join } from "path";
import { Glob } from "bun";

// ---- Helpers ----

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] codex: ${msg}`);
}

/**
 * Resolve the codex binary path.
 * Tries $PATH first, then falls back to common nvm install locations.
 * Systemd services run with a minimal PATH that excludes nvm directories.
 */
async function resolveCodexBin(): Promise<{ bin: string; extraPath: string }> {
  const inPath = Bun.which("codex");
  if (inPath) return { bin: inPath, extraPath: "" };

  const home = process.env.HOME ?? "/home/dev";
  const nvmBase = join(home, ".nvm", "versions", "node");

  // Find all codex binaries under nvm, pick the first one found
  const glob = new Glob("*/bin/codex");
  for await (const match of glob.scan({ cwd: nvmBase, absolute: false })) {
    const fullPath = join(nvmBase, match);
    const binDir = join(nvmBase, match.replace(/\/codex$/, ""));
    return { bin: fullPath, extraPath: binDir };
  }

  throw new Error(`Executable not found in $PATH: "codex". Install via: npm install -g @openai/codex`);
}

/**
 * Rough token estimate from character count.
 * OpenAI models average ~4 chars per token for English text.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---- Main dispatch function ----

/**
 * Dispatch a prompt to the Codex CLI.
 *
 * The Codex CLI runs in --full-auto mode (autonomous execution)
 * and writes its output to stdout. We capture the full output as the result.
 */
export async function dispatchCodex(
  prompt: string,
  model?: string,
  cwd?: string,
): Promise<CodexDispatchResult> {
  const codexModel = model || DEFAULT_CODEX_MODEL;
  const workDir = cwd ?? new URL("..", import.meta.url).pathname;

  log(`dispatching to codex model=${codexModel}`);

  const { bin: codexBin, extraPath } = await resolveCodexBin();
  log(`resolved codex binary: ${codexBin}`);

  const args = [
    codexBin,
    "--model", codexModel,
    "--full-auto",
    "--quiet",
    "--prompt", prompt,
  ];

  const env = { ...process.env };
  if (extraPath) {
    env.PATH = `${extraPath}:${env.PATH ?? ""}`;
  }

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    env,
    cwd: workDir,
  });

  // Timeout watchdog
  let timedOut = false;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    log(`subprocess timeout after ${CODEX_TIMEOUT_MS / 60_000}min — killing pid ${proc.pid}`);
    proc.kill("SIGTERM");
    setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* already dead */ }
    }, 10_000);
  }, CODEX_TIMEOUT_MS);

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  clearTimeout(timeoutTimer);

  if (timedOut) {
    throw new Error(`codex subprocess timed out after ${CODEX_TIMEOUT_MS / 60_000} minutes`);
  }

  if (exitCode !== 0) {
    throw new Error(`codex exited ${exitCode}: ${stderr.trim().slice(0, 500)}`);
  }

  const result = stdout.trim();

  // Estimate tokens and cost (Codex CLI doesn't report these)
  const inputTokens = estimateTokens(prompt);
  const outputTokens = estimateTokens(result);
  const pricing = CODEX_PRICING[codexModel] ?? CODEX_PRICING[DEFAULT_CODEX_MODEL];
  const apiCost =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output;

  log(`complete — model=${codexModel}, ~${inputTokens}in/${outputTokens}out, est_cost=$${apiCost.toFixed(4)}`);

  return {
    result,
    cost_usd: apiCost,
    api_cost_usd: apiCost,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
  };
}
