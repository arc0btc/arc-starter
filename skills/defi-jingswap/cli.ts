#!/usr/bin/env bun
/**
 * Jingswap skill CLI — STX/sBTC blind auction queries and deposit/cancel.
 *
 * Read-only commands hit the Jingswap API directly.
 * Write commands validate phase + budget, then call the MCP server tools
 * via the aibtc-mcp-server subprocess.
 *
 * Usage:
 *   arc skills run --name defi-jingswap -- <subcommand> [flags]
 */

import { resolve } from "node:path";
import { spawn } from "bun";
import { getCredential } from "../../src/credentials.ts";

// ---- Constants ----

const JINGSWAP_API = "https://faktory-dao-backend.vercel.app";
const JINGSWAP_API_KEY =
  process.env.JINGSWAP_API_KEY || "jc_b058d7f2e0976bd4ee34be3e5c7ba7ebe45289c55d3f5e45f666ebc14b7ebfd0";
const ARC_ADDRESS = "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B";
const MAX_STX = Number(process.env.JINGSWAP_MAX_STX ?? 50);
const MAX_SATS = Number(process.env.JINGSWAP_MAX_SATS ?? 10_000);

const MCP_SCRIPT = resolve(import.meta.dir, "../../../github/aibtcdev/aibtc-mcp-server/dist/index.js");

// ---- Helpers ----

function log(message: string): void {
  console.error(`[${new Date().toISOString()}] [jingswap/cli] ${message}`);
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

interface ApiResponse {
  success: boolean;
  data: unknown;
  message?: string;
}

async function jingswapGet(path: string): Promise<unknown> {
  const response = await fetch(`${JINGSWAP_API}${path}`, {
    headers: { "x-api-key": JINGSWAP_API_KEY },
  });
  if (!response.ok) throw new Error(`Jingswap API ${response.status}: ${await response.text()}`);
  const json = (await response.json()) as ApiResponse;
  if (!json.success) throw new Error(json.message || "API returned failure");
  return json.data;
}

interface CycleState {
  currentCycle: number;
  phase: number;
  blocksElapsed: number;
  cycleStartBlock: number;
  cycleTotals: { totalStx: number; totalSbtc: number };
  minDeposits: { minStx: number; minSbtc: number };
}

async function assertDepositPhase(): Promise<CycleState> {
  const state = (await jingswapGet("/api/auction/cycle-state")) as CycleState;
  if (state.phase !== 0) {
    const phaseNames = ["deposit", "buffer", "settle"];
    throw new Error(
      `Cannot deposit/cancel — auction is in ${phaseNames[state.phase] || "unknown"} phase (must be deposit)`
    );
  }
  return state;
}

/** Run an MCP tool via the aibtc-mcp-server subprocess. */
async function runMcpTool(
  toolName: string,
  args: Record<string, unknown> = {}
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const walletId = await getCredential("bitcoin-wallet", "id");
  const walletPassword = await getCredential("bitcoin-wallet", "password");

  if (!walletId || !walletPassword) {
    return { success: false, error: "Wallet credentials not found (bitcoin-wallet/id, bitcoin-wallet/password)" };
  }

  // Build MCP-style JSON-RPC request
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  };

  const proc = spawn(["node", MCP_SCRIPT], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NETWORK: "mainnet",
      WALLET_ID: walletId,
      WALLET_PASSWORD: walletPassword,
    },
  });

  // Write JSON-RPC request to stdin
  const writer = proc.stdin.getWriter();
  await writer.write(new TextEncoder().encode(JSON.stringify(request) + "\n"));
  await writer.close();

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    return { success: false, error: `MCP tool failed (exit ${exitCode}): ${stderr || stdout}` };
  }

  try {
    const response = JSON.parse(stdout.trim());
    return { success: true, result: response };
  } catch {
    return { success: true, result: stdout.trim() };
  }
}

// ---- Subcommands ----

async function cmdCycleState(): Promise<void> {
  const data = (await jingswapGet("/api/auction/cycle-state")) as CycleState;
  const phaseNames = ["deposit", "buffer", "settle"];
  const { cycleTotals, minDeposits } = data;
  console.log(JSON.stringify({
    cycle: data.currentCycle,
    phase: phaseNames[data.phase] || `unknown(${data.phase})`,
    phaseId: data.phase,
    blocksElapsed: data.blocksElapsed,
    cycleStartBlock: data.cycleStartBlock,
    totalStx: cycleTotals.totalStx,
    totalStxDisplay: `${(cycleTotals.totalStx / 1_000_000).toFixed(6)} STX`,
    totalSbtc: cycleTotals.totalSbtc,
    totalSbtcDisplay: `${cycleTotals.totalSbtc} sats`,
    minStx: minDeposits.minStx,
    minSbtc: minDeposits.minSbtc,
  }, null, 2));
}

async function cmdPrices(): Promise<void> {
  const [pyth, dex] = await Promise.all([
    jingswapGet("/api/auction/pyth-prices"),
    jingswapGet("/api/auction/dex-price"),
  ]) as [Record<string, unknown>, Record<string, unknown> & { xykBalances?: { xBalance: number; yBalance: number }; dlmmPrice?: number }];

  const xykStxPerBtc =
    dex.xykBalances && dex.xykBalances.xBalance > 0
      ? (dex.xykBalances.yBalance / dex.xykBalances.xBalance / 1e6) * 1e8
      : null;
  const dlmmStxPerBtc =
    dex.dlmmPrice && dex.dlmmPrice > 0
      ? Math.round((1 / (dex.dlmmPrice * 1e-10)) * 100) / 100
      : null;

  console.log(JSON.stringify({
    pyth,
    dex: {
      ...dex,
      xykStxPerBtc: xykStxPerBtc ? Math.round(xykStxPerBtc * 100) / 100 : null,
      dlmmStxPerBtc,
    },
  }, null, 2));
}

async function cmdDepositors(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  let cycle: number;

  if (flags.cycle) {
    cycle = parseInt(flags.cycle, 10);
    if (isNaN(cycle)) {
      console.log(JSON.stringify({ success: false, error: "--cycle must be a number" }));
      process.exit(1);
    }
  } else {
    const state = (await jingswapGet("/api/auction/cycle-state")) as CycleState;
    cycle = state.currentCycle;
  }

  const data = await jingswapGet(`/api/auction/depositors/${cycle}`);
  console.log(JSON.stringify({ cycle, ...(data as Record<string, unknown>) }, null, 2));
}

async function cmdMyDeposit(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  let cycle: number;

  if (flags.cycle) {
    cycle = parseInt(flags.cycle, 10);
    if (isNaN(cycle)) {
      console.log(JSON.stringify({ success: false, error: "--cycle must be a number" }));
      process.exit(1);
    }
  } else {
    const state = (await jingswapGet("/api/auction/cycle-state")) as CycleState;
    cycle = state.currentCycle;
  }

  const data = await jingswapGet(`/api/auction/deposit/${cycle}/${ARC_ADDRESS}`);
  console.log(JSON.stringify({ cycle, address: ARC_ADDRESS, ...(data as Record<string, unknown>) }, null, 2));
}

async function cmdHistory(): Promise<void> {
  const data = await jingswapGet("/api/auction/cycles-history");
  console.log(JSON.stringify(data, null, 2));
}

async function cmdDepositStx(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const amount = parseFloat(flags.amount);

  if (!flags.amount || isNaN(amount) || amount <= 0) {
    console.log(JSON.stringify({ success: false, error: "Required: --amount <STX>" }));
    process.exit(1);
  }

  if (amount > MAX_STX) {
    console.log(JSON.stringify({
      success: false,
      error: `Amount ${amount} STX exceeds budget cap (${MAX_STX} STX per cycle)`,
      maxStx: MAX_STX,
    }));
    process.exit(1);
  }

  const state = await assertDepositPhase();
  log(`depositing ${amount} STX into cycle ${state.currentCycle}`);

  const result = await runMcpTool("jingswap_deposit_stx", { amount });
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exit(1);
}

async function cmdDepositSbtc(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const amount = parseInt(flags.amount, 10);

  if (!flags.amount || isNaN(amount) || amount <= 0) {
    console.log(JSON.stringify({ success: false, error: "Required: --amount <sats>" }));
    process.exit(1);
  }

  if (amount > MAX_SATS) {
    console.log(JSON.stringify({
      success: false,
      error: `Amount ${amount} sats exceeds budget cap (${MAX_SATS} sats per cycle)`,
      maxSats: MAX_SATS,
    }));
    process.exit(1);
  }

  const state = await assertDepositPhase();
  log(`depositing ${amount} sats into cycle ${state.currentCycle}`);

  const result = await runMcpTool("jingswap_deposit_sbtc", { amount });
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exit(1);
}

async function cmdCancelStx(): Promise<void> {
  await assertDepositPhase();
  log("cancelling STX deposit");

  const result = await runMcpTool("jingswap_cancel_stx");
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exit(1);
}

async function cmdCancelSbtc(): Promise<void> {
  await assertDepositPhase();
  log("cancelling sBTC deposit");

  const result = await runMcpTool("jingswap_cancel_sbtc");
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exit(1);
}

// ---- Usage ----

function printUsage(): void {
  process.stdout.write(`defi-jingswap CLI — STX/sBTC blind auction

USAGE
  arc skills run --name defi-jingswap -- <subcommand> [flags]

READ-ONLY COMMANDS
  cycle-state                    Current cycle phase, blocks elapsed, totals
  prices                         Oracle (Pyth) and DEX price feeds
  depositors [--cycle N]         STX and sBTC depositors (default: current cycle)
  my-deposit [--cycle N]         Arc's deposit for a cycle (default: current)
  history                        All past auction cycles with settlement data

WRITE COMMANDS (wallet required, deposit phase only)
  deposit-stx --amount <STX>     Deposit STX (max ${MAX_STX} per cycle)
  deposit-sbtc --amount <sats>   Deposit sBTC in sats (max ${MAX_SATS} per cycle)
  cancel-stx                     Cancel STX deposit (full refund)
  cancel-sbtc                    Cancel sBTC deposit (full refund)

EXAMPLES
  arc skills run --name defi-jingswap -- cycle-state
  arc skills run --name defi-jingswap -- prices
  arc skills run --name defi-jingswap -- deposit-stx --amount 10
  arc skills run --name defi-jingswap -- my-deposit
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
    case "cycle-state":
      await cmdCycleState();
      break;
    case "prices":
      await cmdPrices();
      break;
    case "depositors":
      await cmdDepositors(args.slice(1));
      break;
    case "my-deposit":
      await cmdMyDeposit(args.slice(1));
      break;
    case "history":
      await cmdHistory();
      break;
    case "deposit-stx":
      await cmdDepositStx(args.slice(1));
      break;
    case "deposit-sbtc":
      await cmdDepositSbtc(args.slice(1));
      break;
    case "cancel-stx":
      await cmdCancelStx();
      break;
    case "cancel-sbtc":
      await cmdCancelSbtc();
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
