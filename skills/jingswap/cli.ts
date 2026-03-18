#!/usr/bin/env bun
/**
 * Jingswap skill CLI — order-book DEX for STX/sBTC on Stacks.
 *
 * Usage:
 *   arc skills run --name jingswap -- <subcommand> [flags]
 */

import { resolve, join } from "node:path";
import { getCredential } from "../../src/credentials.ts";

// ---- Constants ----

const HIRO_API = "https://api.mainnet.hiro.so";
const CONFIG_PATH = join(import.meta.dir, "config.json");
const TX_RUNNER = resolve(import.meta.dir, "../defi-zest/tx-runner.ts");
const DEFAULT_PAIR = "STX-sBTC";

// ---- Types ----

interface PairConfig {
  label: string;
  baseToken: string;
  quoteToken: string;
  baseDecimals: number;
  quoteDecimals: number;
  orderBookContract: string;
  exchangeContract: string;
  sbtcContract: string;
  functions: {
    getBids: string;
    getAsks: string;
    getOrderBook: string;
    placeBid: string;
    placeAsk: string;
    cancelOrder: string;
  };
}

interface JingConfig {
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

function getPair(config: JingConfig, pairName: string): PairConfig {
  const pair = config.pairs[pairName];
  if (!pair) {
    console.log(JSON.stringify({
      success: false,
      error: `Unknown pair: ${pairName}`,
      available: Object.keys(config.pairs),
    }));
    process.exit(1);
  }
  return pair;
}

function requireContract(pair: PairConfig, field: "orderBookContract" | "exchangeContract"): string {
  const addr = pair[field];
  if (!addr) {
    console.log(JSON.stringify({
      success: false,
      error: `${field} not configured for ${pair.label}. Populate config.json with the contract address.`,
      configPath: CONFIG_PATH,
    }));
    process.exit(1);
  }
  return addr;
}

async function callReadOnly(
  contractId: string,
  functionName: string,
  args: string[],
  sender: string,
): Promise<Record<string, unknown> | null> {
  const [address, name] = contractId.split(".");
  const url = `${HIRO_API}/v2/contracts/call-read/${address}/${name}/${functionName}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender, arguments: args }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    log(`API error: ${response.status} ${response.statusText}`);
    return null;
  }

  return (await response.json()) as Record<string, unknown>;
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

// ---- Subcommands ----

async function cmdCheckTvl(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const pairName = flags.pair ?? DEFAULT_PAIR;
  const config = await readConfig();
  const pair = getPair(config, pairName);
  const contract = requireContract(pair, "orderBookContract");

  log(`checking TVL for ${pair.label} on ${contract}`);

  const sender = config.sparkAddress;

  // Query bid side
  const bidsResult = await callReadOnly(contract, pair.functions.getBids, [], sender);
  // Query ask side
  const asksResult = await callReadOnly(contract, pair.functions.getAsks, [], sender);

  if (!bidsResult && !asksResult) {
    console.log(JSON.stringify({
      success: false,
      error: "Failed to query order book — both bid and ask calls returned null",
      contract,
      pair: pairName,
    }));
    process.exit(1);
  }

  // Parse results — exact structure depends on contract ABI
  const bidsOk = bidsResult?.okay === true;
  const asksOk = asksResult?.okay === true;

  const hasBids = bidsOk && bidsResult?.result !== "0x09"; // not (none)
  const hasAsks = asksOk && asksResult?.result !== "0x09";
  const healthy = hasBids && hasAsks;

  console.log(JSON.stringify({
    success: true,
    pair: pairName,
    contract,
    bids: {
      queryOk: bidsOk,
      hasLiquidity: hasBids,
      raw: bidsResult?.result ?? null,
    },
    asks: {
      queryOk: asksOk,
      hasLiquidity: hasAsks,
      raw: asksResult?.result ?? null,
    },
    healthy,
    gate: healthy ? "PASS — both sides have liquidity" : "FAIL — deposit blocked (one-sided or empty book)",
  }));

  if (!healthy) process.exit(1);
}

async function cmdQuote(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.side || !flags.amount) {
    console.log(JSON.stringify({
      success: false,
      error: "Required: --side <bid|ask> --amount <units>",
      usage: "arc skills run --name jingswap -- quote --side bid --amount 50000000 [--pair STX-sBTC]",
    }));
    process.exit(1);
  }

  const side = flags.side.toLowerCase();
  if (side !== "bid" && side !== "ask") {
    console.log(JSON.stringify({ success: false, error: "Side must be 'bid' or 'ask'" }));
    process.exit(1);
  }

  const pairName = flags.pair ?? DEFAULT_PAIR;
  const config = await readConfig();
  const pair = getPair(config, pairName);
  const contract = requireContract(pair, "orderBookContract");
  const amount = parseInt(flags.amount, 10);

  if (isNaN(amount) || amount <= 0) {
    console.log(JSON.stringify({ success: false, error: "Amount must be a positive integer" }));
    process.exit(1);
  }

  log(`getting quote: ${side} ${amount} on ${pair.label}`);

  const sender = config.sparkAddress;

  // Query order book for current state
  const bookResult = await callReadOnly(contract, pair.functions.getOrderBook, [], sender);

  if (!bookResult || bookResult.okay !== true) {
    console.log(JSON.stringify({
      success: false,
      error: "Failed to query order book",
      contract,
      pair: pairName,
      raw: bookResult,
    }));
    process.exit(1);
  }

  // Return raw book state — exact parsing depends on contract ABI
  const unit = side === "bid" ? pair.baseToken : pair.quoteToken;
  console.log(JSON.stringify({
    success: true,
    pair: pairName,
    side,
    amount,
    unit,
    contract,
    orderBook: bookResult.result,
    note: "Raw order book data. Parse based on contract ABI to extract best bid/ask and estimated fill.",
  }));
}

async function cmdDeposit(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.side || !flags.amount || !flags.price) {
    console.log(JSON.stringify({
      success: false,
      error: "Required: --side <bid|ask> --amount <units> --price <price>",
      usage: "arc skills run --name jingswap -- deposit --side bid --amount 50000000 --price 1500 [--pair STX-sBTC]",
    }));
    process.exit(1);
  }

  const side = flags.side.toLowerCase();
  if (side !== "bid" && side !== "ask") {
    console.log(JSON.stringify({ success: false, error: "Side must be 'bid' or 'ask'" }));
    process.exit(1);
  }

  const pairName = flags.pair ?? DEFAULT_PAIR;
  const config = await readConfig();
  const pair = getPair(config, pairName);
  requireContract(pair, "exchangeContract");

  const amount = parseInt(flags.amount, 10);
  const price = parseInt(flags.price, 10);

  if (isNaN(amount) || amount <= 0) {
    console.log(JSON.stringify({ success: false, error: "Amount must be a positive integer" }));
    process.exit(1);
  }
  if (isNaN(price) || price <= 0) {
    console.log(JSON.stringify({ success: false, error: "Price must be a positive integer" }));
    process.exit(1);
  }

  // Budget enforcement
  if (side === "bid" && amount > config.budget.maxStxPerCycle) {
    console.log(JSON.stringify({
      success: false,
      error: `Amount ${amount} uSTX exceeds budget of ${config.budget.maxStxPerCycle} uSTX (${config.budget.maxStxPerCycle / 1_000_000} STX)`,
      budget: config.budget.maxStxPerCycle,
    }));
    process.exit(1);
  }

  if (side === "ask" && amount > config.budget.maxSatsPerCycle) {
    console.log(JSON.stringify({
      success: false,
      error: `Amount ${amount} sats exceeds budget of ${config.budget.maxSatsPerCycle} sats`,
      budget: config.budget.maxSatsPerCycle,
    }));
    process.exit(1);
  }

  // TVL gate — check both sides have liquidity before depositing
  log("running TVL gate check before deposit...");
  const orderBookContract = requireContract(pair, "orderBookContract");
  const sender = config.sparkAddress;

  const bidsResult = await callReadOnly(orderBookContract, pair.functions.getBids, [], sender);
  const asksResult = await callReadOnly(orderBookContract, pair.functions.getAsks, [], sender);

  const hasBids = bidsResult?.okay === true && bidsResult?.result !== "0x09";
  const hasAsks = asksResult?.okay === true && asksResult?.result !== "0x09";

  if (!hasBids || !hasAsks) {
    console.log(JSON.stringify({
      success: false,
      error: "TVL gate failed — order book is one-sided or empty. Deposit blocked.",
      hasBids,
      hasAsks,
    }));
    process.exit(1);
  }

  log(`placing ${side} order: ${amount} at price ${price} on ${pair.label}`);

  const fnName = side === "bid" ? pair.functions.placeBid : pair.functions.placeAsk;
  const result = await runTx([
    "jingswap-order",
    "--contract", pair.exchangeContract,
    "--function", fnName,
    "--amount", String(amount),
    "--price", String(price),
  ]);

  console.log(result.stdout || JSON.stringify({ success: false, error: "No output from tx runner" }));
  if (result.exitCode !== 0) process.exit(1);
}

function printUsage(): void {
  process.stdout.write(`jingswap CLI — order-book DEX for STX/sBTC on Stacks

USAGE
  arc skills run --name jingswap -- <subcommand> [flags]

READ-ONLY COMMANDS
  check-tvl [--pair STX-sBTC]
    Check order book depth on both sides. Returns healthy=true if both
    bid and ask sides have liquidity. Gate: deposits blocked when unhealthy.

  quote --side <bid|ask> --amount <units> [--pair STX-sBTC]
    Get current order book state and estimated fill for a given size.
    Side: bid (buying base token) or ask (selling base token).

WRITE COMMANDS (wallet required)
  deposit --side <bid|ask> --amount <units> --price <price> [--pair STX-sBTC]
    Place a limit order on the Jingswap book. Budget-gated:
    max 50 STX (50,000,000 uSTX) or 10,000 sats per cycle.
    Automatically runs TVL gate check before placing order.

CONFIGURATION
  Contract addresses must be set in skills/jingswap/config.json before
  any command will work. Populate orderBookContract and exchangeContract
  with deployed Jingswap contract principals.

EXAMPLES
  arc skills run --name jingswap -- check-tvl
  arc skills run --name jingswap -- quote --side bid --amount 50000000
  arc skills run --name jingswap -- deposit --side bid --amount 50000000 --price 1500
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
    case "check-tvl":
      await cmdCheckTvl(args.slice(1));
      break;
    case "quote":
      await cmdQuote(args.slice(1));
      break;
    case "deposit":
      await cmdDeposit(args.slice(1));
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
