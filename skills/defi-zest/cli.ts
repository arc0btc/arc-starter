#!/usr/bin/env bun
/**
 * Zest Protocol skill CLI — supply, withdraw, claim rewards, position monitoring.
 *
 * Read-only commands delegate to upstream defi/defi.ts.
 * Write commands use tx-runner.ts for wallet-aware execution.
 *
 * Usage:
 *   arc skills run --name defi-zest -- <subcommand> [flags]
 */

import { spawn } from "bun";
import { resolve } from "node:path";
import { getCredential } from "../../src/credentials.ts";

// ---- Constants ----

const SKILLS_ROOT = resolve(import.meta.dir, "../../github/aibtcdev/skills");
const UPSTREAM_SCRIPT = resolve(SKILLS_ROOT, "defi/defi.ts");
const TX_RUNNER = resolve(import.meta.dir, "tx-runner.ts");
const HIRO_API = "https://api.hiro.so";
const ARC_ADDRESS = "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B";
const ZSBTC_CONTRACT = "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N";
const ZSBTC_NAME = "zsbtc-v2-0";

// ---- Helpers ----

function log(message: string): void {
  console.error(`[${new Date().toISOString()}] [defi-zest/cli] ${message}`);
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

/** Run upstream defi.ts directly to stdout (pass-through). */
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

  // Read stdout with timeout (120s for on-chain tx)
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

async function cmdPosition(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const asset = flags.asset ?? "sBTC";
  const address = flags.address ?? ARC_ADDRESS;

  log(`checking Zest position for ${asset} (${address})`);

  // Method 1: LP token balance via Hiro balances API (workaround)
  let lpBalance: string | null = null;
  try {
    const response = await fetch(`${HIRO_API}/extended/v1/address/${address}/balances`);
    if (response.ok) {
      const data = await response.json() as {
        fungible_tokens: Record<string, { balance: string }>;
      };

      // Find LP token balance
      for (const [key, val] of Object.entries(data.fungible_tokens || {})) {
        if (key.includes(ZSBTC_NAME) && asset.toLowerCase() === "sbtc") {
          lpBalance = val.balance;
          break;
        }
        // Generic match for other assets
        const assetLower = asset.toLowerCase();
        if (key.toLowerCase().includes(`z${assetLower}`)) {
          lpBalance = val.balance;
          break;
        }
      }
    }
  } catch (e) {
    log(`LP balance lookup failed: ${(e as Error).message}`);
  }

  // Method 2: upstream get-user-reserve-data (may return 0 — known bug)
  let upstreamPosition: { supplied?: string; borrowed?: string } | null = null;
  try {
    const proc = spawn(["bun", "run", UPSTREAM_SCRIPT, "zest-get-position", "--asset", asset, "--address", address], {
      cwd: SKILLS_ROOT,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NETWORK: "mainnet" },
    });

    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const parsed = JSON.parse(stdout.trim());
    if (parsed.position) {
      upstreamPosition = parsed.position;
    }
  } catch {
    // Upstream failed, we have the LP balance fallback
  }

  // Combine results
  const supplied = lpBalance && lpBalance !== "0" ? lpBalance : upstreamPosition?.supplied ?? "0";
  const decimals = asset.toLowerCase() === "sbtc" ? 8 : 6;
  const suppliedHuman = (Number(supplied) / Math.pow(10, decimals)).toFixed(decimals);

  console.log(JSON.stringify({
    address,
    asset,
    position: {
      supplied,
      suppliedHuman,
      borrowed: upstreamPosition?.borrowed ?? "0",
      lpTokenBalance: lpBalance ?? "unknown",
      source: lpBalance && lpBalance !== "0" ? "lp-token-balance" : "upstream",
    },
    note: lpBalance && lpBalance !== "0"
      ? "Position from LP token balance (workaround for aibtcdev/aibtc-mcp-server#278)"
      : "Position from upstream get-user-reserve-data",
  }));
}

async function cmdSupply(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.asset || !flags.amount) {
    console.log(JSON.stringify({
      success: false,
      error: "Required: --asset <symbol> --amount <units>",
      usage: "arc skills run --name defi-zest -- supply --asset sBTC --amount 100000",
    }));
    process.exit(1);
  }

  log(`supplying ${flags.amount} ${flags.asset} to Zest`);
  const result = await runTx([
    "zest-supply",
    "--asset", flags.asset,
    "--amount", flags.amount,
    ...(flags["on-behalf-of"] ? ["--on-behalf-of", flags["on-behalf-of"]] : []),
  ]);

  console.log(result.stdout || JSON.stringify({ success: false, error: "No output from tx runner" }));
  if (result.exitCode !== 0) process.exit(1);
}

async function cmdWithdraw(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.asset || !flags.amount) {
    console.log(JSON.stringify({
      success: false,
      error: "Required: --asset <symbol> --amount <units>",
      usage: "arc skills run --name defi-zest -- withdraw --asset sBTC --amount 100000",
    }));
    process.exit(1);
  }

  log(`withdrawing ${flags.amount} ${flags.asset} from Zest`);
  const result = await runTx([
    "zest-withdraw",
    "--asset", flags.asset,
    "--amount", flags.amount,
  ]);

  console.log(result.stdout || JSON.stringify({ success: false, error: "No output from tx runner" }));
  if (result.exitCode !== 0) process.exit(1);
}

async function cmdClaimRewards(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const asset = flags.asset ?? "sBTC";

  log(`claiming Zest rewards for ${asset}`);
  const result = await runTx([
    "zest-claim-rewards",
    "--asset", asset,
  ]);

  console.log(result.stdout || JSON.stringify({ success: false, error: "No output from tx runner" }));
  if (result.exitCode !== 0) process.exit(1);
}

function printUsage(): void {
  process.stdout.write(`defi-zest CLI — Zest Protocol yield farming

USAGE
  arc skills run --name defi-zest -- <subcommand> [flags]

READ-ONLY COMMANDS
  list-assets
    List all supported Zest Protocol assets.

  position [--asset <symbol>] [--address <addr>]
    Check yield farming position. Default: sBTC, Arc's address.
    Uses LP token balance workaround for accurate position data.

WRITE COMMANDS (wallet required, ~50k uSTX gas per op)
  supply --asset <symbol> --amount <units>
    Supply assets to Zest lending pool.

  withdraw --asset <symbol> --amount <units>
    Withdraw assets from Zest lending pool.

  claim-rewards [--asset <symbol>]
    Claim accumulated wSTX rewards. Default asset: sBTC.

EXAMPLES
  arc skills run --name defi-zest -- position
  arc skills run --name defi-zest -- position --asset sBTC
  arc skills run --name defi-zest -- supply --asset sBTC --amount 8200
  arc skills run --name defi-zest -- claim-rewards
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
    case "list-assets":
      await runUpstreamPassthrough(["zest-list-assets"]);
      break;
    case "position":
      await cmdPosition(args.slice(1));
      break;
    case "supply":
      await cmdSupply(args.slice(1));
      break;
    case "withdraw":
      await cmdWithdraw(args.slice(1));
      break;
    case "claim-rewards":
      await cmdClaimRewards(args.slice(1));
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
