#!/usr/bin/env bun
/**
 * Styx skill CLI — BTC→sBTC conversion via Styx protocol.
 *
 * Read-only commands delegate to upstream styx/styx.ts.
 * Deposit command uses deposit-runner.ts for wallet-aware execution.
 *
 * Usage:
 *   arc skills run --name styx-btc-bridge -- <subcommand> [flags]
 */

import { spawn } from "bun";
import { resolve } from "node:path";
import { getCredential } from "../../src/credentials.ts";

// ---- Constants ----

const SKILLS_ROOT = resolve(import.meta.dir, "../../github/aibtcdev/skills");
const UPSTREAM_SCRIPT = resolve(SKILLS_ROOT, "styx/styx.ts");
const DEPOSIT_RUNNER = resolve(import.meta.dir, "deposit-runner.ts");

// ---- Helpers ----

function log(message: string): void {
  console.error(`[${new Date().toISOString()}] [styx/cli] ${message}`);
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

/** Run upstream styx.ts directly to stdout (pass-through). */
async function runUpstreamPassthrough(args: string[]): Promise<void> {
  const proc = spawn(["bun", "run", UPSTREAM_SCRIPT, ...args], {
    cwd: SKILLS_ROOT,
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

/** Run deposit via deposit-runner.ts (wallet unlock + deposit + lock). */
async function runDeposit(depositArgs: string[]): Promise<void> {
  const walletId = await getCredential("bitcoin-wallet", "id");
  const walletPassword = await getCredential("bitcoin-wallet", "password");

  if (!walletId || !walletPassword) {
    console.log(
      JSON.stringify({
        success: false,
        error:
          "Wallet credentials not found (bitcoin-wallet/id, bitcoin-wallet/password)",
      })
    );
    process.exit(1);
  }

  const proc = spawn(["bun", "run", DEPOSIT_RUNNER, ...depositArgs], {
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

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  if (stderr.trim()) {
    log(stderr.trim());
  }

  // Output the JSON result
  const output = stdout.trim();
  if (output) {
    console.log(output);
  }

  process.exit(exitCode);
}

// ---- Main ----

const args = process.argv.slice(2);
const subcommand = args[0];

if (!subcommand) {
  console.log(
    JSON.stringify({
      error:
        "Usage: arc skills run --name styx-btc-bridge -- <subcommand> [flags]\nSubcommands: pool-status, pools, fees, price, deposit, status, history",
    })
  );
  process.exit(1);
}

switch (subcommand) {
  // Read-only commands — pass through to upstream
  case "pool-status":
  case "pools":
  case "fees":
  case "price":
  case "status":
  case "history":
    await runUpstreamPassthrough(args);
    break;

  // Wallet-sensitive deposit — use deposit runner
  case "deposit":
    await runDeposit(args);
    break;

  default:
    console.log(
      JSON.stringify({
        error: `Unknown subcommand: ${subcommand}. Use: pool-status, pools, fees, price, deposit, status, history`,
      })
    );
    process.exit(1);
}
