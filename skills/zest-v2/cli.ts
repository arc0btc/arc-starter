#!/usr/bin/env bun
/**
 * Zest V2 skill CLI — deposit, borrow, repay, rewards, health monitoring.
 *
 * Usage:
 *   arc skills run --name zest-v2 -- <subcommand> [flags]
 */

import { spawn } from "bun";
import { resolve } from "node:path";
import { getCredential } from "../../src/credentials.ts";

// ---- Constants ----

const SKILLS_ROOT = resolve(import.meta.dir, "../../github/aibtcdev/skills");
const TX_RUNNER = resolve(import.meta.dir, "../defi-zest/tx-runner.ts");
const HIRO_API = "https://api.hiro.so";
const ARC_ADDRESS = "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B";

// ---- Helpers ----

function log(message: string): void {
  console.error(`[${new Date().toISOString()}] [zest-v2/cli] ${message}`);
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

  const proc = spawn(["bun", "run", TX_RUNNER, ...txArgs], {
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

async function cmdDeposit(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.asset || !flags.amount) {
    console.log(JSON.stringify({
      success: false,
      error: "Required: --asset <symbol> --amount <units>",
      usage: "arc skills run --name zest-v2 -- deposit --asset sBTC --amount 100000",
    }));
    process.exit(1);
  }

  log(`depositing ${flags.amount} ${flags.asset} to Zest V2`);
  const result = await runTx([
    "zest-supply",
    "--asset", flags.asset,
    "--amount", flags.amount,
  ]);

  console.log(result.stdout || JSON.stringify({ success: false, error: "No output from tx runner" }));
  if (result.exitCode !== 0) process.exit(1);
}

async function cmdBorrow(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.asset || !flags.amount) {
    console.log(JSON.stringify({
      success: false,
      error: "Required: --asset <symbol> --amount <units>",
      usage: "arc skills run --name zest-v2 -- borrow --asset sBTC --amount 50000",
    }));
    process.exit(1);
  }

  log(`borrowing ${flags.amount} ${flags.asset} from Zest V2`);
  const result = await runTx([
    "zest-borrow",
    "--asset", flags.asset,
    "--amount", flags.amount,
  ]);

  console.log(result.stdout || JSON.stringify({ success: false, error: "No output from tx runner" }));
  if (result.exitCode !== 0) process.exit(1);
}

async function cmdRepay(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.asset || !flags.amount) {
    console.log(JSON.stringify({
      success: false,
      error: "Required: --asset <symbol> --amount <units>",
      usage: "arc skills run --name zest-v2 -- repay --asset sBTC --amount 50000",
    }));
    process.exit(1);
  }

  log(`repaying ${flags.amount} ${flags.asset} on Zest V2`);
  const result = await runTx([
    "zest-repay",
    "--asset", flags.asset,
    "--amount", flags.amount,
  ]);

  console.log(result.stdout || JSON.stringify({ success: false, error: "No output from tx runner" }));
  if (result.exitCode !== 0) process.exit(1);
}

async function cmdRewardsStatus(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const address = flags.address ?? ARC_ADDRESS;

  log(`checking Zest V2 rewards for ${address}`);

  try {
    // Check token balances for ZEST reward tokens
    const response = await fetch(`${HIRO_API}/extended/v1/address/${address}/balances`);
    if (!response.ok) {
      console.log(JSON.stringify({ success: false, error: `Hiro API returned ${response.status}` }));
      process.exit(1);
    }

    const data = await response.json() as {
      fungible_tokens: Record<string, { balance: string }>;
    };

    // Find Zest-related reward tokens
    const rewards: Record<string, string> = {};
    for (const [key, val] of Object.entries(data.fungible_tokens || {})) {
      if (key.toLowerCase().includes("zest") || key.toLowerCase().includes("wstx")) {
        rewards[key] = val.balance;
      }
    }

    console.log(JSON.stringify({
      address,
      rewards,
      note: "Shows current reward token balances. Use claim-rewards via defi-zest for wSTX rewards.",
    }));
  } catch (e) {
    console.log(JSON.stringify({ success: false, error: (e as Error).message }));
    process.exit(1);
  }
}

async function cmdHealth(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const address = flags.address ?? ARC_ADDRESS;

  log(`checking Zest V2 health factor for ${address}`);

  try {
    const response = await fetch(`${HIRO_API}/extended/v1/address/${address}/balances`);
    if (!response.ok) {
      console.log(JSON.stringify({ success: false, error: `Hiro API returned ${response.status}` }));
      process.exit(1);
    }

    const data = await response.json() as {
      fungible_tokens: Record<string, { balance: string }>;
    };

    let collateral = 0n;
    let debt = 0n;

    for (const [key, val] of Object.entries(data.fungible_tokens || {})) {
      // Collateral (z-prefixed LP tokens)
      if (key.includes("zsbtc") || key.includes("zstx") || key.includes("zusda")) {
        collateral += BigInt(val.balance);
      }
      // Debt (d-prefixed debt tokens)
      if (key.includes("dsbtc") || key.includes("dstx") || key.includes("dusda")) {
        debt += BigInt(val.balance);
      }
    }

    const healthFactor = debt === 0n ? 999 : Number(collateral) / Number(debt);

    console.log(JSON.stringify({
      address,
      collateral: collateral.toString(),
      debt: debt.toString(),
      healthFactor: Number(healthFactor.toFixed(2)),
      status: debt === 0n ? "no-debt" : healthFactor < 1.2 ? "critical" : healthFactor < 1.5 ? "warning" : "healthy",
      note: debt === 0n
        ? "No active borrow positions"
        : `Health factor ${healthFactor.toFixed(2)} — ${healthFactor < 1.5 ? "consider adding collateral or repaying" : "position is healthy"}`,
    }));
  } catch (e) {
    console.log(JSON.stringify({ success: false, error: (e as Error).message }));
    process.exit(1);
  }
}

function printUsage(): void {
  process.stdout.write(`zest-v2 CLI — Zest Protocol V2 lending & borrowing

USAGE
  arc skills run --name zest-v2 -- <subcommand> [flags]

READ-ONLY COMMANDS
  rewards-status [--address <addr>]
    Check accumulated Zest reward token balances.

  health [--address <addr>]
    Check position health factor, collateral, and debt.

WRITE COMMANDS (wallet required, ~50k uSTX gas per op)
  deposit --asset <symbol> --amount <units>
    Deposit collateral to Zest V2 lending pool.

  borrow --asset <symbol> --amount <units>
    Borrow against deposited collateral.

  repay --asset <symbol> --amount <units>
    Repay outstanding borrow (partial or full).

EXAMPLES
  arc skills run --name zest-v2 -- health
  arc skills run --name zest-v2 -- rewards-status
  arc skills run --name zest-v2 -- deposit --asset sBTC --amount 100000
  arc skills run --name zest-v2 -- borrow --asset STX --amount 500000000
  arc skills run --name zest-v2 -- repay --asset STX --amount 250000000
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
    case "deposit":
      await cmdDeposit(args.slice(1));
      break;
    case "borrow":
      await cmdBorrow(args.slice(1));
      break;
    case "repay":
      await cmdRepay(args.slice(1));
      break;
    case "rewards-status":
      await cmdRewardsStatus(args.slice(1));
      break;
    case "health":
      await cmdHealth(args.slice(1));
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
