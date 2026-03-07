#!/usr/bin/env bun
// skills/erc8004-trust/cli.ts
// Aggregates ERC-8004 reputation + validation summaries into a single trust score.
// Usage: arc skills run --name erc8004-trust -- compute-trust-score --agent-id <id>

import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../github/aibtcdev/skills");
const REPUTATION_SCRIPT = resolve(ROOT, "reputation/reputation.ts");
const VALIDATION_SCRIPT = resolve(ROOT, "validation/validation.ts");

// ---- Types ----

interface ReputationSummary {
  success: boolean;
  agentId: number;
  totalFeedback: number;
  summaryValue: number;
  summaryValueDecimals: number;
  network: string;
  error?: string;
}

interface ValidationSummary {
  success: boolean;
  agentId: number;
  count: number;
  avgResponse: number;
  network: string;
  error?: string;
}

// ---- Helpers ----

function log(message: string): void {
  console.error(`[${new Date().toISOString()}] [erc8004-trust/cli] ${message}`);
}

async function runScript(
  scriptPath: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", scriptPath, ...args], {
    cwd: ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NETWORK: process.env.NETWORK || "mainnet" },
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  return { stdout, stderr, exitCode: await proc.exited };
}

/**
 * Normalize a WAD-scaled reputation value to a 0-100 score.
 *
 * summaryValue uses WAD decimals (summaryValueDecimals). We divide first,
 * clamp to [-100, 100], then map linearly to [0, 100].
 *
 * A neutral (zero) reputation maps to 50.
 */
function normalizeReputation(summaryValue: number, summaryValueDecimals: number): number {
  const scale = Math.pow(10, summaryValueDecimals);
  const real = summaryValue / scale;
  const clamped = Math.max(-100, Math.min(100, real));
  return (clamped + 100) / 2;
}

/**
 * Derive a confidence label from total data points available.
 * "low"    — 0-4 combined data points
 * "medium" — 5-19 combined data points
 * "high"   — 20+ combined data points
 */
function confidenceLabel(totalPoints: number): "low" | "medium" | "high" {
  if (totalPoints >= 20) return "high";
  if (totalPoints >= 5) return "medium";
  return "low";
}

// ---- compute-trust-score ----

async function computeTrustScore(agentId: number): Promise<void> {
  // Fetch reputation and validation summaries in parallel
  const [repResult, valResult] = await Promise.all([
    runScript(REPUTATION_SCRIPT, ["get-summary", "--agent-id", String(agentId)]),
    runScript(VALIDATION_SCRIPT, ["get-summary", "--agent-id", String(agentId)]),
  ]);

  let rep: ReputationSummary | null = null;
  let val: ValidationSummary | null = null;
  const warnings: string[] = [];

  try {
    rep = JSON.parse(repResult.stdout) as ReputationSummary;
    if (!rep.success) {
      warnings.push(`reputation: ${rep.error ?? "query failed"}`);
      rep = null;
    }
  } catch {
    warnings.push("reputation: failed to parse response");
    if (repResult.stderr) log(`reputation stderr: ${repResult.stderr.trim()}`);
  }

  try {
    val = JSON.parse(valResult.stdout) as ValidationSummary;
    if (!val.success) {
      warnings.push(`validation: ${val.error ?? "query failed"}`);
      val = null;
    }
  } catch {
    warnings.push("validation: failed to parse response");
    if (valResult.stderr) log(`validation stderr: ${valResult.stderr.trim()}`);
  }

  if (!rep && !val) {
    console.log(
      JSON.stringify(
        {
          success: false,
          agentId,
          error: "No reputation or validation data available",
          warnings,
          network: process.env.NETWORK || "mainnet",
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  // Compute component scores
  const repScore = rep ? normalizeReputation(rep.summaryValue, rep.summaryValueDecimals) : null;
  const valScore = val ? val.avgResponse : null;

  // Weighted composite: 40% reputation, 60% validation
  // If only one source is available, use it at full weight.
  let trustScore: number;
  let formula: string;

  if (repScore !== null && valScore !== null) {
    trustScore = repScore * 0.4 + valScore * 0.6;
    formula = "trustScore = reputation(40%) + validation(60%)";
  } else if (repScore !== null) {
    trustScore = repScore;
    formula = "trustScore = reputation(100%) — no validation data";
  } else {
    trustScore = valScore!;
    formula = "trustScore = validation(100%) — no reputation data";
  }

  const totalDataPoints = (rep?.totalFeedback ?? 0) + (val?.count ?? 0);
  const confidence = confidenceLabel(totalDataPoints);

  const output: Record<string, unknown> = {
    success: true,
    agentId,
    trustScore: Math.round(trustScore * 100) / 100,
    confidence,
    formula,
    reputation: rep
      ? {
          totalFeedback: rep.totalFeedback,
          summaryValue: rep.summaryValue,
          summaryValueDecimals: rep.summaryValueDecimals,
          normalizedScore: Math.round((repScore ?? 0) * 100) / 100,
        }
      : null,
    validation: val
      ? {
          count: val.count,
          avgResponse: val.avgResponse,
          normalizedScore: val.avgResponse,
        }
      : null,
    network: rep?.network ?? val?.network ?? (process.env.NETWORK || "mainnet"),
  };

  if (warnings.length > 0) {
    output.warnings = warnings;
  }

  console.log(JSON.stringify(output, null, 2));
}

// ---- Main ----

function parseArgs(args: string[]): { agentId?: number; help: boolean } {
  let agentId: number | undefined;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {
      help = true;
    } else if (args[i] === "--agent-id" && i + 1 < args.length) {
      agentId = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return { agentId, help };
}

async function main(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(`ERC-8004 Trust Score

Usage: arc skills run --name erc8004-trust -- <subcommand> [options]

Subcommands:
  compute-trust-score      Aggregate reputation + validation into a 0-100 trust score

Options for compute-trust-score:
  --agent-id <id>          Agent ID to score (required, non-negative integer)
  --help                   Show this help message

Score formula:
  trustScore = reputation(40%) + validation(60%)
  reputation normalized from WAD-averaged feedback value to [0, 100]
  validation is avgResponse (already 0-100)
  If only one source has data, it contributes 100% of the score.

Confidence levels:
  low    — fewer than 5 total data points
  medium — 5 to 19 total data points
  high   — 20 or more total data points
`);
    process.exit(0);
  }

  if (subcommand !== "compute-trust-score") {
    console.error(`Unknown subcommand: ${subcommand}`);
    console.error(`Run 'arc skills run --name erc8004-trust -- --help' for usage.`);
    process.exit(1);
  }

  const { agentId, help } = parseArgs(args.slice(1));

  if (help) {
    console.log(`compute-trust-score — Aggregate reputation + validation into a trust score

Usage: arc skills run --name erc8004-trust -- compute-trust-score --agent-id <id>

Options:
  --agent-id <id>    Agent ID to score (required, non-negative integer)

Output fields:
  trustScore         Composite 0-100 score
  confidence         Data confidence: low | medium | high
  formula            Score weighting used
  reputation         Reputation component (totalFeedback, summaryValue, normalizedScore)
  validation         Validation component (count, avgResponse, normalizedScore)
  warnings           Any non-fatal issues during data fetch
`);
    process.exit(0);
  }

  if (agentId === undefined || isNaN(agentId) || agentId < 0) {
    console.error("Error: --agent-id is required and must be a non-negative integer");
    process.exit(1);
  }

  try {
    await computeTrustScore(agentId);
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

await main(Bun.argv.slice(2));
