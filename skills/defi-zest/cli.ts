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

// LP token contracts for each Zest asset (supply positions tracked here, not in reserve data)
// Fixed in aibtcdev/aibtc-mcp-server v1.33.3: get-user-reserve-data only returns borrow fields.
const ZEST_LP_TOKENS: Record<string, string> = {
  sbtc: "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zsbtc-v2-0",
  stststx: "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zststx-v2-0",
  aeusdc: "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zaeusdc-v2-0",
  usdh: "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zusdh-v2-0",
  wstx: "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zwstx-v2-0",
  susdt: "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zsusdt-v2-0",
  usda: "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zusda-v2-0",
  diko: "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zdiko-v2-0",
};
// Pool borrow contract (for reading borrow positions)
const POOL_BORROW = "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.pool-borrow-v2-4";

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

/** Read LP token balance for a Zest supply position via Hiro balances API. */
async function callLpBalance(lpContract: string, address: string): Promise<string> {
  // Use the /extended/v1/address/{address}/balances endpoint to find LP token balance.
  // This avoids the need to manually encode Clarity principals.
  // More reliable than callReadOnly for principal args without @stacks/transactions.
  const [lpAddr, lpName] = lpContract.split(".");
  const response = await fetch(`${HIRO_API}/extended/v1/address/${address}/balances`);
  if (!response.ok) return "0";

  const data = await response.json() as {
    fungible_tokens: Record<string, { balance: string }>;
  };

  // Look for the LP token in the fungible_tokens map
  for (const [key, val] of Object.entries(data.fungible_tokens || {})) {
    if (key.startsWith(`${lpAddr}.${lpName}`) || key === lpContract) {
      return val.balance || "0";
    }
  }
  return "0";
}

async function cmdPosition(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const asset = flags.asset ?? "sBTC";
  const address = flags.address ?? ARC_ADDRESS;

  log(`checking Zest position for ${asset} (${address})`);

  const assetKey = asset.toLowerCase();
  const lpContract = ZEST_LP_TOKENS[assetKey];

  // Read supply position from LP token balance (confirmed correct approach per mcp-server v1.33.3 fix)
  // get-user-reserve-data only tracks borrow-side data — supply lives in the LP token contract
  let supplied = "0";
  if (lpContract) {
    try {
      supplied = await callLpBalance(lpContract, address);
    } catch (e) {
      log(`LP balance lookup failed: ${(e as Error).message}`);
    }
  } else {
    log(`No LP token contract known for asset '${asset}', supply will be 0`);
  }

  // Read borrow position from get-user-reserve-data (borrow side is correct here)
  // Note: principal-borrow-balance is the correct field; current-a-token-balance does not exist
  let borrowed = "0";
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
    if (parsed.position?.borrowed) borrowed = parsed.position.borrowed;
  } catch {
    // Upstream failed — borrow defaults to 0
  }

  const decimals = assetKey === "sbtc" ? 8 : 6;
  const suppliedHuman = (Number(supplied) / Math.pow(10, decimals)).toFixed(decimals);
  const borrowedHuman = (Number(borrowed) / Math.pow(10, decimals)).toFixed(decimals);

  console.log(JSON.stringify({
    address,
    asset,
    position: {
      supplied,
      suppliedHuman,
      borrowed,
      borrowedHuman,
      lpContract: lpContract ?? null,
    },
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
