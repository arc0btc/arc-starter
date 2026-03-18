#!/usr/bin/env bun
/**
 * Bitflow skill CLI — DEX quotes, swaps, spread analysis, and DCA automation.
 *
 * Read-only commands delegate to upstream bitflow/bitflow.ts.
 * Swap commands enforce a per-trade cap and use swap-runner.ts for wallet-aware execution.
 *
 * Usage:
 *   arc skills run --name defi-bitflow -- <subcommand> [flags]
 */

import { spawn } from "bun";
import { resolve } from "node:path";
import { getCredential } from "../../src/credentials.ts";

// ---- Constants ----

const SKILLS_ROOT = resolve(import.meta.dir, "../../github/aibtcdev/skills");
const UPSTREAM_SCRIPT = resolve(SKILLS_ROOT, "bitflow/bitflow.ts");
const SWAP_RUNNER = resolve(import.meta.dir, "swap-runner.ts");
const BITFLOW_API = "https://bitflow-sdk-api-gateway-7owjsmt8.uc.gateway.dev";
const MAX_TRADE_STX = Number(process.env.BITFLOW_MAX_TRADE_STX ?? 10); // 10 STX default cap
const DEFAULT_SPREAD_THRESHOLD = 5; // 5%

// ---- Helpers ----

function log(message: string): void {
  console.error(`[${new Date().toISOString()}] [bitflow/cli] ${message}`);
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        flags[key] = "true";
      } else {
        flags[key] = args[i + 1];
        i++;
      }
    }
  }
  return flags;
}

/** Run upstream bitflow.ts directly to stdout (pass-through). */
async function runUpstreamPassthrough(args: string[]): Promise<void> {
  const proc = spawn(["bun", "run", UPSTREAM_SCRIPT, ...args], {
    cwd: resolve(import.meta.dir, "../.."),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      NETWORK: process.env.NETWORK ?? "mainnet",
    },
  });
  const exitCode = await proc.exited;
  process.exit(exitCode);
}

/** Run upstream bitflow.ts, capture JSON output. */
async function runUpstream(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = spawn(["bun", "run", UPSTREAM_SCRIPT, ...args], {
    cwd: resolve(import.meta.dir, "../.."),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NETWORK: process.env.NETWORK ?? "mainnet",
    },
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

/** Run a swap command via swap-runner.ts (wallet unlock + swap + lock). */
async function runSwap(swapArgs: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const walletId = await getCredential("bitcoin-wallet", "id");
  const walletPassword = await getCredential("bitcoin-wallet", "password");

  if (!walletId || !walletPassword) {
    return {
      stdout: JSON.stringify({ success: false, error: "Wallet credentials not found (wallet/id, wallet/password)" }),
      stderr: "",
      exitCode: 1,
    };
  }

  const proc = spawn(["bun", "run", SWAP_RUNNER, ...swapArgs], {
    cwd: SKILLS_ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NETWORK: process.env.NETWORK ?? "mainnet",
      WALLET_ID: walletId,
      WALLET_PASSWORD: walletPassword,
    },
  });

  let stdout = "";
  let stderr = "";

  const stderrPromise = new Response(proc.stderr).text().then((t) => { stderr = t; });

  // Read stdout with timeout (120s for on-chain tx)
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();

  const readWithTimeout = new Promise<string>(async (resolvePromise, reject) => {
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("Timeout waiting for swap response (120s)"));
    }, 120_000);

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        stdout += decoder.decode(value, { stream: true });

        const trimmed = stdout.trim();
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
          try {
            JSON.parse(trimmed);
            clearTimeout(timer);
            proc.kill();
            resolvePromise(trimmed);
            return;
          } catch {
            // Incomplete JSON, keep reading
          }
        }
      }
      clearTimeout(timer);
      resolvePromise(stdout.trim());
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });

  const result = await readWithTimeout;
  await stderrPromise.catch(() => {});
  return { stdout: result, stderr: stderr.trim(), exitCode: 0 };
}

// ---- Subcommands ----

async function cmdSwap(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags["token-x"] || !flags["token-y"] || !flags["amount-in"]) {
    console.log(JSON.stringify({
      success: false,
      error: "Required: --token-x <id> --token-y <id> --amount-in <decimal>",
      usage: "arc skills run --name bitflow -- swap --token-x token-stx --token-y token-sbtc --amount-in 1.0 [--slippage 0.01] [--confirm-high-impact]",
    }));
    process.exit(1);
  }

  const amountIn = parseFloat(flags["amount-in"]);
  if (isNaN(amountIn) || amountIn <= 0) {
    console.log(JSON.stringify({ success: false, error: "--amount-in must be a positive number" }));
    process.exit(1);
  }

  // Per-trade cap check
  if (amountIn > MAX_TRADE_STX) {
    console.log(JSON.stringify({
      success: false,
      error: `Trade exceeds max per-trade cap (${MAX_TRADE_STX} STX)`,
      amountIn,
      maxTradeStx: MAX_TRADE_STX,
    }));
    process.exit(1);
  }

  // 1. Get quote first
  log(`quoting ${flags["token-x"]} -> ${flags["token-y"]}, amount: ${amountIn}`);
  const quoteResult = await runUpstream([
    "get-quote",
    "--token-x", flags["token-x"],
    "--token-y", flags["token-y"],
    "--amount-in", flags["amount-in"],
  ]);

  if (quoteResult.exitCode !== 0) {
    console.log(JSON.stringify({ success: false, error: "Quote failed", detail: quoteResult.stderr || quoteResult.stdout }));
    process.exit(1);
  }

  let quoteData: { quote?: { expectedAmountOut?: string }; priceImpact?: { combinedImpactPct?: string; severity?: string } };
  try {
    quoteData = JSON.parse(quoteResult.stdout);
  } catch {
    console.log(JSON.stringify({ success: false, error: "Failed to parse quote", raw: quoteResult.stdout }));
    process.exit(1);
  }

  const impact = quoteData.priceImpact;
  log(`quote: expected out=${quoteData.quote?.expectedAmountOut}, impact=${impact?.combinedImpactPct} (${impact?.severity})`);

  // 2. Execute swap via runner
  const swapArgs = [
    "swap",
    "--token-x", flags["token-x"],
    "--token-y", flags["token-y"],
    "--amount-in", flags["amount-in"],
  ];
  if (flags.slippage) swapArgs.push("--slippage-tolerance", flags.slippage);
  if (flags["confirm-high-impact"]) swapArgs.push("--confirm-high-impact");

  log("executing swap...");
  const swapResult = await runSwap(swapArgs);

  // Pass through the result
  console.log(swapResult.stdout || JSON.stringify({ success: false, error: "No output from swap runner" }));
  if (swapResult.exitCode !== 0) process.exit(1);
}

async function cmdSpreads(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const threshold = parseFloat(flags.threshold ?? String(DEFAULT_SPREAD_THRESHOLD));

  log(`fetching tickers to compute spreads (threshold: ${threshold}%)`);

  try {
    const response = await fetch(`${BITFLOW_API}/ticker`);
    if (!response.ok) {
      console.log(JSON.stringify({ success: false, error: `Bitflow API returned ${response.status}` }));
      process.exit(1);
    }

    const tickers = (await response.json()) as Array<{
      ticker_id: string;
      base_currency: string;
      target_currency: string;
      high: number;
      low: number;
      last_price: number;
      liquidity_in_usd: number;
      base_volume: number;
    }>;

    const spreads: Array<{
      pair: string;
      tickerId: string;
      high: string;
      low: string;
      lastPrice: string;
      rangePct: string;
      liquidityUsd: string;
    }> = [];

    for (const t of tickers) {
      const high = Number(t.high);
      const low = Number(t.low);
      const lastPrice = Number(t.last_price);
      if (high <= 0 || low <= 0 || lastPrice <= 0) continue;

      const rangePct = ((high - low) / lastPrice) * 100;

      if (rangePct >= threshold) {
        spreads.push({
          pair: `${t.base_currency}/${t.target_currency}`,
          tickerId: t.ticker_id,
          high: String(high),
          low: String(low),
          lastPrice: String(lastPrice),
          rangePct: rangePct.toFixed(2),
          liquidityUsd: String(t.liquidity_in_usd),
        });
      }
    }

    // Sort by spread descending
    spreads.sort((a, b) => parseFloat(b.rangePct) - parseFloat(a.rangePct));

    console.log(JSON.stringify({
      threshold: `${threshold}%`,
      totalPairs: tickers.length,
      highSpreadCount: spreads.length,
      spreads,
    }));
  } catch (e) {
    const error = e as Error;
    console.log(JSON.stringify({ success: false, error: error.message }));
    process.exit(1);
  }
}

function printUsage(): void {
  process.stdout.write(`defi-bitflow CLI — market intelligence, spread analysis, DCA automation

USAGE
  arc skills run --name defi-bitflow -- <subcommand> [flags]

SWAP COMMANDS (wallet required)
  swap --token-x <id> --token-y <id> --amount-in <decimal> [--slippage <decimal>] [--confirm-high-impact]
    Quote, validate, and execute a token swap. Max ${MAX_TRADE_STX} STX per trade.

ANALYSIS COMMANDS
  spreads [--threshold <pct>]
    Show trading pairs with bid-ask spread above threshold (default ${DEFAULT_SPREAD_THRESHOLD}%).

READ-ONLY COMMANDS (pass-through to upstream)
  quote --token-x <id> --token-y <id> --amount-in <decimal>
  ticker [--base-currency <id>] [--target-currency <id>]
  tokens
  routes --token-x <id> --token-y <id>

KEEPER COMMANDS (pass-through to upstream, wallet required)
  get-keeper-contract [--address <addr>]
  create-order --contract-identifier <id> --action-type <type> --funding-tokens <json> --action-amount <units>
  get-order --order-id <id>
  cancel-order --order-id <id>
  get-keeper-user [--address <addr>]

EXAMPLES
  arc skills run --name defi-bitflow -- spreads --threshold 3
  arc skills run --name defi-bitflow -- quote --token-x token-stx --token-y token-sbtc --amount-in 5.0
  arc skills run --name defi-bitflow -- swap --token-x token-stx --token-y token-sbtc --amount-in 1.0
`);
}

// ---- Entry point ----

// Map CLI subcommand names to upstream command names
const UPSTREAM_COMMAND_MAP: Record<string, string> = {
  quote: "get-quote",
  ticker: "get-ticker",
  tokens: "get-tokens",
  routes: "get-routes",
  "get-keeper-contract": "get-keeper-contract",
  "create-order": "create-order",
  "get-order": "get-order",
  "cancel-order": "cancel-order",
  "get-keeper-user": "get-keeper-user",
};

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  const sub = args[0];

  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    printUsage();
    process.exit(0);
  }

  // Pass-through commands to upstream
  const upstreamCmd = UPSTREAM_COMMAND_MAP[sub];
  if (upstreamCmd) {
    // Replace the subcommand with the upstream name, keep remaining args
    await runUpstreamPassthrough([upstreamCmd, ...args.slice(1)]);
    return;
  }

  // Local commands
  switch (sub) {
    case "swap":
      await cmdSwap(args.slice(1));
      break;
    case "spreads":
      await cmdSpreads(args.slice(1));
      break;
    default:
      process.stderr.write(`Error: unknown subcommand '${sub}'\n\n`);
      printUsage();
      process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
