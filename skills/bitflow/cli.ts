#!/usr/bin/env bun
/**
 * Bitflow skill CLI — swap, liquidity, pools, quotes.
 *
 * Usage:
 *   arc skills run --name bitflow -- <subcommand> [flags]
 */

import { resolve } from "node:path";
import { getCredential } from "../../src/credentials.ts";

// ---- Constants ----

const HIRO_API = "https://api.hiro.so";
const ARC_ADDRESS = "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B";
const TX_RUNNER = resolve(import.meta.dir, "../defi-zest/tx-runner.ts");
const DEFAULT_SLIPPAGE_BPS = 100; // 1%

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

/** Run a write command via tx-runner.ts (wallet unlock + execute + lock). */
async function runTx(txArgs: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const walletId = await getCredential("bitcoin-wallet", "id");
  const walletPassword = await getCredential("bitcoin-wallet", "password");

  if (!walletId || !walletPassword) {
    return {
      stdout: JSON.stringify({ success: false, error: "Wallet credentials not found (bitcoin-wallet/id, bitcoin-wallet/password)" }),
      stderr: "",
      exitCode: 1,
    };
  }

  const proc = Bun.spawn(["bun", "run", TX_RUNNER, ...txArgs], {
    cwd: resolve(import.meta.dir, "../../github/aibtcdev/skills"),
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

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();

  const readWithTimeout = new Promise<string>(async (resolvePromise, reject) => {
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("Timeout waiting for tx response (120s)"));
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

  if (!flags.from || !flags.to || !flags.amount) {
    console.log(JSON.stringify({
      success: false,
      error: "Required: --from <symbol> --to <symbol> --amount <units>",
      usage: "arc skills run --name bitflow -- swap --from STX --to sBTC --amount 500000000",
    }));
    process.exit(1);
  }

  const slippage = flags.slippage ?? String(DEFAULT_SLIPPAGE_BPS);
  log(`swapping ${flags.amount} ${flags.from} → ${flags.to} (slippage: ${slippage} bps)`);

  const result = await runTx([
    "bitflow-swap",
    "--token-in", flags.from,
    "--token-out", flags.to,
    "--amount", flags.amount,
    "--slippage", slippage,
  ]);

  console.log(result.stdout || JSON.stringify({ success: false, error: "No output from tx runner" }));
  if (result.exitCode !== 0) process.exit(1);
}

async function cmdAddLiquidity(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.pool || !flags["token-a-amount"] || !flags["token-b-amount"]) {
    console.log(JSON.stringify({
      success: false,
      error: "Required: --pool <id> --token-a-amount <units> --token-b-amount <units>",
      usage: "arc skills run --name bitflow -- add-liquidity --pool stx-sbtc --token-a-amount 500000000 --token-b-amount 500000",
    }));
    process.exit(1);
  }

  log(`adding liquidity to pool ${flags.pool}`);
  const result = await runTx([
    "bitflow-add-liquidity",
    "--pool", flags.pool,
    "--amount-a", flags["token-a-amount"],
    "--amount-b", flags["token-b-amount"],
  ]);

  console.log(result.stdout || JSON.stringify({ success: false, error: "No output from tx runner" }));
  if (result.exitCode !== 0) process.exit(1);
}

async function cmdRemoveLiquidity(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.pool || !flags["lp-amount"]) {
    console.log(JSON.stringify({
      success: false,
      error: "Required: --pool <id> --lp-amount <units>",
      usage: "arc skills run --name bitflow -- remove-liquidity --pool stx-sbtc --lp-amount 1000000",
    }));
    process.exit(1);
  }

  log(`removing liquidity from pool ${flags.pool}`);
  const result = await runTx([
    "bitflow-remove-liquidity",
    "--pool", flags.pool,
    "--lp-amount", flags["lp-amount"],
  ]);

  console.log(result.stdout || JSON.stringify({ success: false, error: "No output from tx runner" }));
  if (result.exitCode !== 0) process.exit(1);
}

async function cmdPools(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const tokenFilter = flags.token?.toUpperCase();

  log(`fetching Bitflow pool data${tokenFilter ? ` (filter: ${tokenFilter})` : ""}`);

  try {
    // Query Arc's LP token holdings as proxy for pool awareness
    const response = await fetch(`${HIRO_API}/extended/v1/address/${ARC_ADDRESS}/balances`);
    if (!response.ok) {
      console.log(JSON.stringify({ success: false, error: `Hiro API returned ${response.status}` }));
      process.exit(1);
    }

    const data = await response.json() as {
      fungible_tokens: Record<string, { balance: string }>;
    };

    // Identify Bitflow-related LP tokens
    const pools: Array<{ token: string; balance: string }> = [];
    for (const [key, val] of Object.entries(data.fungible_tokens || {})) {
      if (key.toLowerCase().includes("bitflow") || key.toLowerCase().includes("stableswap")) {
        if (!tokenFilter || key.toUpperCase().includes(tokenFilter)) {
          pools.push({ token: key, balance: val.balance });
        }
      }
    }

    console.log(JSON.stringify({
      pools,
      note: "Shows Bitflow LP tokens held by Arc. For full pool listing, query Bitflow API directly.",
      arcAddress: ARC_ADDRESS,
    }));
  } catch (e) {
    console.log(JSON.stringify({ success: false, error: (e as Error).message }));
    process.exit(1);
  }
}

async function cmdQuote(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.from || !flags.to || !flags.amount) {
    console.log(JSON.stringify({
      success: false,
      error: "Required: --from <symbol> --to <symbol> --amount <units>",
      usage: "arc skills run --name bitflow -- quote --from STX --to sBTC --amount 1000000000",
    }));
    process.exit(1);
  }

  log(`getting quote: ${flags.amount} ${flags.from} → ${flags.to}`);

  // For now, return a stub that indicates the quote system needs Bitflow API integration
  console.log(JSON.stringify({
    from: flags.from,
    to: flags.to,
    amountIn: flags.amount,
    note: "Quote requires Bitflow API integration. Use on-chain contract call or Bitflow frontend for current pricing.",
    status: "stub",
  }));
}

function printUsage(): void {
  process.stdout.write(`bitflow CLI — Bitflow DEX swaps & liquidity on Stacks

USAGE
  arc skills run --name bitflow -- <subcommand> [flags]

READ-ONLY COMMANDS
  pools [--token <symbol>]
    List Bitflow pools. Optional token filter.

  quote --from <symbol> --to <symbol> --amount <units>
    Get swap quote without executing. Shows expected output and price impact.

WRITE COMMANDS (wallet required, ~50-100k uSTX gas)
  swap --from <symbol> --to <symbol> --amount <units> [--slippage <bps>]
    Execute token swap via Bitflow router. Default slippage: 100 bps (1%).

  add-liquidity --pool <id> --token-a-amount <units> --token-b-amount <units>
    Add liquidity to a Bitflow pool.

  remove-liquidity --pool <id> --lp-amount <units>
    Remove liquidity by burning LP tokens.

EXAMPLES
  arc skills run --name bitflow -- pools
  arc skills run --name bitflow -- quote --from STX --to sBTC --amount 1000000000
  arc skills run --name bitflow -- swap --from STX --to sBTC --amount 500000000
  arc skills run --name bitflow -- add-liquidity --pool stx-sbtc --token-a-amount 500000000 --token-b-amount 500000
  arc skills run --name bitflow -- remove-liquidity --pool stx-sbtc --lp-amount 1000000
`);
}

// ---- Entry point ----

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  const sub = args[0];

  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    printUsage();
    process.exit(0);
  }

  switch (sub) {
    case "swap":
      await cmdSwap(args.slice(1));
      break;
    case "add-liquidity":
      await cmdAddLiquidity(args.slice(1));
      break;
    case "remove-liquidity":
      await cmdRemoveLiquidity(args.slice(1));
      break;
    case "pools":
      await cmdPools(args.slice(1));
      break;
    case "quote":
      await cmdQuote(args.slice(1));
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
