#!/usr/bin/env bun
/**
 * Jingswap skill CLI — blind batch auction for sBTC on Stacks.
 *
 * Markets: sbtc-stx (default), sbtc-usdcx
 * Reads use Jingswap API. Writes use tx-runner.
 *
 * Usage:
 *   arc skills run --name jingswap -- <subcommand> [flags]
 */

import { resolve, join } from "node:path";
import { getCredential } from "../../src/credentials.ts";

// ---- Constants ----

const CONFIG_PATH = join(import.meta.dir, "config.json");
const TX_RUNNER = resolve(import.meta.dir, "../defi-zest/tx-runner.ts");
const DEFAULT_MARKET = "sbtc-stx";

// ---- Types ----

interface PairConfig {
  label: string;
  contractName: string;
  quoteToken: string;
  quoteDecimals: number;
  depositQuoteFn: string;
  cancelQuoteFn: string;
  priceUnit: string;
  quoteTokenContract?: string;
  quoteTokenAsset?: string;
}

interface JingConfig {
  contractAddress: string;
  sbtcContract: string;
  jingswapApi: string;
  pairs: Record<string, PairConfig>;
  budget: {
    maxStxPerCycle: number;
    maxSatsPerCycle: number;
  };
  sparkAddress: string;
}

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

async function readConfig(): Promise<JingConfig> {
  try {
    return (await Bun.file(CONFIG_PATH).json()) as JingConfig;
  } catch {
    console.log(JSON.stringify({ success: false, error: "Failed to read config.json" }));
    process.exit(1);
  }
}

function getPair(config: JingConfig, market: string): PairConfig {
  const pair = config.pairs[market];
  if (!pair) {
    console.log(JSON.stringify({
      success: false,
      error: `Unknown market: ${market}`,
      available: Object.keys(config.pairs),
    }));
    process.exit(1);
  }
  return pair;
}

/** Build API query param for non-default markets */
function apiContractParam(pair: PairConfig): string {
  return pair.contractName === "sbtc-stx-jing" ? "" : `?contract=${pair.contractName}`;
}

/** GET from Jingswap API */
async function jingGet(config: JingConfig, path: string): Promise<Record<string, unknown>> {
  const url = `${config.jingswapApi}${path}`;
  log(`GET ${url}`);

  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Jingswap API ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as Record<string, unknown>;
  if (json.success === false) {
    throw new Error((json.message as string) || "API returned failure");
  }
  return (json.data ?? json) as Record<string, unknown>;
}

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

// ---- Read Subcommands ----

async function cmdCycleState(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const market = flags.market ?? DEFAULT_MARKET;
  const config = await readConfig();
  const pair = getPair(config, market);

  const data = await jingGet(config, `/api/auction/cycle-state${apiContractParam(pair)}`);

  console.log(JSON.stringify({
    success: true,
    market,
    contract: `${config.contractAddress}.${pair.contractName}`,
    ...data,
    _hint: {
      phases: "0=deposit (min 150 blocks ~5min), 1=buffer (~1min), 2=settle",
      blockTime: "~2 seconds per Stacks block (Nakamoto)",
    },
  }));
}

async function cmdDepositors(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.cycle) {
    console.log(JSON.stringify({
      success: false,
      error: "Required: --cycle <number>",
      usage: "arc skills run --name jingswap -- depositors --cycle 5 [--market sbtc-stx]",
    }));
    process.exit(1);
  }

  const market = flags.market ?? DEFAULT_MARKET;
  const config = await readConfig();
  const pair = getPair(config, market);

  const data = await jingGet(config, `/api/auction/depositors/${flags.cycle}${apiContractParam(pair)}`);

  console.log(JSON.stringify({
    success: true,
    market,
    cycle: parseInt(flags.cycle, 10),
    ...data,
  }));
}

async function cmdSettlement(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.cycle) {
    console.log(JSON.stringify({
      success: false,
      error: "Required: --cycle <number>",
      usage: "arc skills run --name jingswap -- settlement --cycle 5 [--market sbtc-stx]",
    }));
    process.exit(1);
  }

  const market = flags.market ?? DEFAULT_MARKET;
  const config = await readConfig();
  const pair = getPair(config, market);

  const data = await jingGet(config, `/api/auction/settlement/${flags.cycle}${apiContractParam(pair)}`);

  console.log(JSON.stringify({
    success: true,
    market,
    cycle: parseInt(flags.cycle, 10),
    ...data,
  }));
}

async function cmdPrices(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const market = flags.market ?? DEFAULT_MARKET;
  const config = await readConfig();
  const pair = getPair(config, market);

  const [pyth, dex] = await Promise.all([
    jingGet(config, `/api/auction/pyth-prices${apiContractParam(pair)}`),
    jingGet(config, `/api/auction/dex-price${apiContractParam(pair)}`),
  ]);

  console.log(JSON.stringify({
    success: true,
    market,
    priceUnit: pair.priceUnit,
    pyth,
    dex,
  }));
}

async function cmdCyclesHistory(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const market = flags.market ?? DEFAULT_MARKET;
  const config = await readConfig();
  const pair = getPair(config, market);

  const data = await jingGet(config, `/api/auction/cycles-history${apiContractParam(pair)}`);

  console.log(JSON.stringify({
    success: true,
    market,
    ...data,
  }));
}

// ---- Write Subcommands ----

async function cmdDepositQuote(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.amount) {
    console.log(JSON.stringify({
      success: false,
      error: "Required: --amount <units>",
      usage: "arc skills run --name jingswap -- deposit-quote --amount 50000000 [--market sbtc-stx]",
    }));
    process.exit(1);
  }

  const market = flags.market ?? DEFAULT_MARKET;
  const config = await readConfig();
  const pair = getPair(config, market);
  const amount = parseInt(flags.amount, 10);

  if (isNaN(amount) || amount <= 0) {
    console.log(JSON.stringify({ success: false, error: "Amount must be a positive integer" }));
    process.exit(1);
  }

  // Budget enforcement
  if (amount > config.budget.maxStxPerCycle) {
    console.log(JSON.stringify({
      success: false,
      error: `Amount ${amount} exceeds budget of ${config.budget.maxStxPerCycle} (${config.budget.maxStxPerCycle / 1_000_000} ${pair.quoteToken})`,
      budget: config.budget.maxStxPerCycle,
    }));
    process.exit(1);
  }

  // Phase gate — must be in deposit phase
  log("checking auction phase before deposit...");
  const state = await jingGet(config, `/api/auction/cycle-state${apiContractParam(pair)}`);
  if (state.phase !== 0) {
    console.log(JSON.stringify({
      success: false,
      error: `Cannot deposit — auction is in phase ${state.phase} (must be 0=deposit)`,
      currentPhase: state.phase,
    }));
    process.exit(1);
  }

  log(`depositing ${amount} ${pair.quoteToken} into ${pair.label} auction`);

  const contractId = `${config.contractAddress}.${pair.contractName}`;
  const result = await runTx([
    "jingswap-deposit",
    "--contract", contractId,
    "--function", pair.depositQuoteFn,
    "--amount", String(amount),
  ]);

  console.log(result.stdout || JSON.stringify({ success: false, error: "No output from tx runner" }));
  if (result.exitCode !== 0) process.exit(1);
}

async function cmdDepositSbtc(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.amount) {
    console.log(JSON.stringify({
      success: false,
      error: "Required: --amount <sats>",
      usage: "arc skills run --name jingswap -- deposit-sbtc --amount 10000 [--market sbtc-stx]",
    }));
    process.exit(1);
  }

  const market = flags.market ?? DEFAULT_MARKET;
  const config = await readConfig();
  const pair = getPair(config, market);
  const amount = parseInt(flags.amount, 10);

  if (isNaN(amount) || amount <= 0) {
    console.log(JSON.stringify({ success: false, error: "Amount must be a positive integer (satoshis)" }));
    process.exit(1);
  }

  // Budget enforcement
  if (amount > config.budget.maxSatsPerCycle) {
    console.log(JSON.stringify({
      success: false,
      error: `Amount ${amount} sats exceeds budget of ${config.budget.maxSatsPerCycle} sats`,
      budget: config.budget.maxSatsPerCycle,
    }));
    process.exit(1);
  }

  // Phase gate
  log("checking auction phase before deposit...");
  const state = await jingGet(config, `/api/auction/cycle-state${apiContractParam(pair)}`);
  if (state.phase !== 0) {
    console.log(JSON.stringify({
      success: false,
      error: `Cannot deposit — auction is in phase ${state.phase} (must be 0=deposit)`,
      currentPhase: state.phase,
    }));
    process.exit(1);
  }

  log(`depositing ${amount} sats sBTC into ${pair.label} auction`);

  const contractId = `${config.contractAddress}.${pair.contractName}`;
  const result = await runTx([
    "jingswap-deposit",
    "--contract", contractId,
    "--function", "deposit-sbtc",
    "--amount", String(amount),
  ]);

  console.log(result.stdout || JSON.stringify({ success: false, error: "No output from tx runner" }));
  if (result.exitCode !== 0) process.exit(1);
}

// ---- Usage ----

function printUsage(): void {
  process.stdout.write(`jingswap CLI — blind batch auction for sBTC on Stacks

USAGE
  arc skills run --name jingswap -- <subcommand> [flags]

MARKETS
  --market sbtc-stx     STX/sBTC (default)
  --market sbtc-usdcx   USDCx/sBTC

READ COMMANDS
  cycle-state [--market]
    Current auction cycle: phase, blocks elapsed, totals, minimums.
    Phase 0=deposit, 1=buffer, 2=settle.

  depositors --cycle <N> [--market]
    Quote-token and sBTC depositors for a given cycle.

  settlement --cycle <N> [--market]
    Settlement details (oracle price, fill amounts) for a completed cycle.

  cycles-history [--market]
    Full history of all auction cycles.

  prices [--market]
    Pyth oracle and DEX prices for the market.

WRITE COMMANDS (wallet required)
  deposit-quote --amount <units> [--market]
    Deposit quote token (STX or USDCx) into current auction cycle.
    Budget: max 50 STX (50,000,000 uSTX) per cycle.

  deposit-sbtc --amount <sats> [--market]
    Deposit sBTC (satoshis) into current auction cycle.
    Budget: max 10,000 sats per cycle.

CONTRACTS (v0.29.0)
  sbtc-stx:   SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.sbtc-stx-jing
  sbtc-usdcx: SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.sbtc-usdcx-jing

EXAMPLES
  arc skills run --name jingswap -- cycle-state
  arc skills run --name jingswap -- prices --market sbtc-usdcx
  arc skills run --name jingswap -- deposit-quote --amount 50000000
  arc skills run --name jingswap -- deposit-sbtc --amount 5000 --market sbtc-usdcx
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
      await cmdCycleState(args.slice(1));
      break;
    case "depositors":
      await cmdDepositors(args.slice(1));
      break;
    case "settlement":
      await cmdSettlement(args.slice(1));
      break;
    case "cycles-history":
      await cmdCyclesHistory(args.slice(1));
      break;
    case "prices":
      await cmdPrices(args.slice(1));
      break;
    case "deposit-quote":
      await cmdDepositQuote(args.slice(1));
      break;
    case "deposit-sbtc":
      await cmdDepositSbtc(args.slice(1));
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
