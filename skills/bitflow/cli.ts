#!/usr/bin/env bun
/**
 * Bitflow skill CLI — Arc LP position management and portfolio swaps.
 *
 * All commands delegate to upstream bitflow/bitflow.ts from aibtcdev/skills.
 * Write operations (swap, add-liquidity, withdraw-liquidity) require wallet credentials.
 *
 * Usage:
 *   arc skills run --name bitflow -- <subcommand> [flags]
 */

import { spawn } from "bun";
import { resolve } from "node:path";
import { getCredential } from "../../src/credentials.ts";

// ---- Constants ----

const SKILLS_ROOT = resolve(import.meta.dir, "../../github/aibtcdev/skills");
const UPSTREAM_SCRIPT = resolve(SKILLS_ROOT, "bitflow/bitflow.ts");

// ---- Helpers ----

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

async function getWalletEnv(): Promise<Record<string, string>> {
  const walletId = await getCredential("bitcoin-wallet", "id");
  const walletPassword = await getCredential("bitcoin-wallet", "password");
  if (!walletId || !walletPassword) {
    throw new Error("Wallet credentials not found. Set credentials: bitcoin-wallet/id and bitcoin-wallet/password");
  }
  return { WALLET_ID: walletId, WALLET_PASSWORD: walletPassword };
}

async function runUpstream(args: string[], env?: Record<string, string>): Promise<void> {
  const proc = spawn(["bun", "run", UPSTREAM_SCRIPT, ...args], {
    cwd: SKILLS_ROOT,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      NETWORK: process.env.NETWORK ?? "mainnet",
      ...env,
    },
  });
  const exitCode = await proc.exited;
  process.exit(exitCode);
}

function printUsage(): void {
  process.stdout.write(`bitflow — Arc LP position management and portfolio swaps on Bitflow DEX

USAGE
  arc skills run --name bitflow -- <subcommand> [flags]

READ COMMANDS
  quote --token-x <id> --token-y <id> --amount-in <decimal>
    Get swap quote with price impact. Run before every swap.

  routes --token-x <id> --token-y <id> [--amount-in <decimal>]
    List available swap routes, ranked by expected output.

  tokens
    List all tokens available for swapping on Bitflow.

  pools [--suggested] [--sbtc-incentives]
    List HODLMM pools. Use --suggested for pools recommended by Bitflow.

  lp-status [--pool-id <id>]
    Show Arc's current LP position in a pool (or all pools).

WRITE COMMANDS (wallet required)
  swap --token-x <id> --token-y <id> --amount-in <decimal> [--slippage <decimal>] [--confirm-high-impact]
    Execute a token swap. Always run quote first. Cap: 10 STX per trade.

  add-liquidity --pool-id <id> --bins <json> [--slippage <pct>]
    Add liquidity to HODLMM bins. Use pools + lp-status first to pick bin offsets.

  withdraw-liquidity --pool-id <id> --positions <json>
    Withdraw HODLMM liquidity. Use lp-status first; recalculate offsets relative to current active bin.

COMMON TOKEN IDs
  token-stx         STX (6 decimals)
  token-sbtc        sBTC (8 decimals)
  token-USDCx-auto  USDC (6 decimals)
  token-ststx       stSTX

EXAMPLES
  arc skills run --name bitflow -- quote --token-x token-stx --token-y token-sbtc --amount-in 5.0
  arc skills run --name bitflow -- swap --token-x token-stx --token-y token-sbtc --amount-in 1.0
  arc skills run --name bitflow -- pools --suggested
  arc skills run --name bitflow -- lp-status
`);
}

// ---- Subcommand dispatch ----

const READ_COMMAND_MAP: Record<string, string> = {
  quote: "get-quote",
  routes: "get-routes",
  tokens: "get-tokens",
  pools: "get-hodlmm-pools",
};

const WRITE_COMMAND_MAP: Record<string, string> = {
  swap: "swap",
  "add-liquidity": "add-liquidity-simple",
  "withdraw-liquidity": "withdraw-liquidity-simple",
};

async function cmdLpStatus(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const walletEnv = await getWalletEnv();

  const upstreamArgs: string[] = ["get-hodlmm-position-bins"];
  if (flags["pool-id"]) upstreamArgs.push("--pool-id", flags["pool-id"]);

  await runUpstream(upstreamArgs, walletEnv);
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  const sub = args[0];

  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    printUsage();
    process.exit(0);
  }

  // Read-only pass-through
  const readCmd = READ_COMMAND_MAP[sub];
  if (readCmd) {
    await runUpstream([readCmd, ...args.slice(1)]);
    return;
  }

  // Write pass-through (wallet env injected)
  const writeCmd = WRITE_COMMAND_MAP[sub];
  if (writeCmd) {
    const walletEnv = await getWalletEnv();
    await runUpstream([writeCmd, ...args.slice(1)], walletEnv);
    return;
  }

  // Local commands
  switch (sub) {
    case "lp-status":
      await cmdLpStatus(args.slice(1));
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
