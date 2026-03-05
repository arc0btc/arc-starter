#!/usr/bin/env bun
/**
 * Stacks Market skill CLI — prediction market trading with budget enforcement.
 *
 * Read-only commands delegate directly to upstream stacks-market.ts.
 * Trading commands enforce a 50 STX budget, quote before executing, record
 * positions in SQLite, and use trade-runner.ts for wallet-aware execution.
 *
 * Usage:
 *   arc skills run --name stacks-market -- <subcommand> [flags]
 */

import { spawn } from "bun";
import { resolve } from "node:path";
import { getCredential } from "../../src/credentials.ts";
import {
  initDatabase,
  insertMarketPosition,
  getMarketPositions,
  getOpenPositions,
  getTotalBuysCostUstx,
  getTotalProceedsUstx,
} from "../../src/db.ts";

// ---- Constants ----

const SKILLS_ROOT = resolve(import.meta.dir, "../../github/aibtcdev/skills");
const UPSTREAM_SCRIPT = resolve(SKILLS_ROOT, "stacks-market/stacks-market.ts");
const TRADE_RUNNER = resolve(import.meta.dir, "trade-runner.ts");
const BUDGET_USTX = Number(process.env.STACKS_MARKET_BUDGET_USTX ?? 50_000_000); // 50 STX default
const MAX_POSITION_USTX = Number(process.env.STACKS_MARKET_MAX_POSITION_USTX ?? 10_000_000); // 10 STX max per trade
const SLIPPAGE_PCT = 5; // 5% slippage tolerance on quotes

// ---- Helpers ----

function log(msg: string): void {
  console.error(`[${new Date().toISOString()}] [stacks-market/cli] ${msg}`);
}

function ustxToStx(ustx: number | bigint): string {
  const micro = BigInt(ustx);
  const whole = micro / 1_000_000n;
  const frac = micro % 1_000_000n;
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return fracStr.length > 0 ? `${whole}.${fracStr}` : whole.toString();
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

/** Run upstream stacks-market.ts read-only command. Captures JSON output. */
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

/** Run upstream stacks-market.ts directly to stdout (pass-through). */
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

/** Run a trade command via trade-runner.ts (wallet unlock + trade + lock). */
async function runTrade(tradeArgs: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const walletId = await getCredential("bitcoin-wallet", "id");
  const walletPassword = await getCredential("bitcoin-wallet", "password");

  if (!walletId || !walletPassword) {
    return {
      stdout: JSON.stringify({ success: false, error: "Wallet credentials not found (wallet/id, wallet/password)" }),
      stderr: "",
      exitCode: 1,
    };
  }

  const proc = spawn(["bun", "run", TRADE_RUNNER, ...tradeArgs], {
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

  // Read stdout incrementally, capture JSON output. Allow 120s for on-chain tx.
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();

  const readWithTimeout = new Promise<string>(async (resolvePromise, reject) => {
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("Timeout waiting for trade response (120s)"));
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
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });

  const result = await readWithTimeout;
  await stderrPromise.catch(() => {});
  return { stdout: result, stderr: stderr.trim(), exitCode: 0 };
}

function getBudgetStatus(): { budgetUstx: number; spentUstx: number; proceedsUstx: number; exposureUstx: number; remainingUstx: number } {
  const spentUstx = getTotalBuysCostUstx();
  const proceedsUstx = getTotalProceedsUstx();
  const exposureUstx = spentUstx - proceedsUstx;
  const remainingUstx = BUDGET_USTX - Math.max(0, exposureUstx);
  return { budgetUstx: BUDGET_USTX, spentUstx, proceedsUstx, exposureUstx, remainingUstx };
}

// ---- Subcommands ----

async function cmdBuy(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags["market-id"] || !flags.side || !flags.amount) {
    console.log(JSON.stringify({
      success: false,
      error: "Required: --market-id <id> --side yes|no --amount <shares>",
      usage: "arc skills run --name stacks-market -- buy --market-id <epochMs> --side yes|no --amount <shares> [--market-title <title>] [--mongo-id <id>]",
    }));
    process.exit(1);
  }

  const marketId = flags["market-id"];
  const side = flags.side.toLowerCase();
  const shares = parseInt(flags.amount, 10);
  const marketTitle = flags["market-title"] ?? `Market ${marketId}`;
  const mongoId = flags["mongo-id"] ?? null;

  if (side !== "yes" && side !== "no") {
    console.log(JSON.stringify({ success: false, error: "--side must be 'yes' or 'no'" }));
    process.exit(1);
  }
  if (isNaN(shares) || shares <= 0) {
    console.log(JSON.stringify({ success: false, error: "--amount must be a positive integer" }));
    process.exit(1);
  }

  initDatabase();

  // 1. Get quote
  log(`quoting buy-${side} ${shares} shares on market ${marketId}`);
  const quoteResult = await runUpstream(["quote-buy", "--market-id", marketId, "--side", side, "--amount", String(shares)]);

  if (quoteResult.exitCode !== 0) {
    console.log(JSON.stringify({ success: false, error: "Quote failed", detail: quoteResult.stderr || quoteResult.stdout }));
    process.exit(1);
  }

  let quoteData: { quote?: { totalCostUstx?: number } };
  try {
    quoteData = JSON.parse(quoteResult.stdout);
  } catch {
    console.log(JSON.stringify({ success: false, error: "Failed to parse quote response", raw: quoteResult.stdout }));
    process.exit(1);
  }

  const quotedCostUstx = quoteData.quote?.totalCostUstx ?? 0;
  if (quotedCostUstx <= 0) {
    console.log(JSON.stringify({ success: false, error: "Quote returned zero or invalid cost", quote: quoteData }));
    process.exit(1);
  }

  // 2. Budget check
  const budget = getBudgetStatus();
  if (quotedCostUstx > budget.remainingUstx) {
    console.log(JSON.stringify({
      success: false,
      error: "Trade exceeds budget",
      quotedCostStx: ustxToStx(quotedCostUstx),
      remainingBudgetStx: ustxToStx(budget.remainingUstx),
      totalBudgetStx: ustxToStx(budget.budgetUstx),
    }));
    process.exit(1);
  }

  // 3. Per-trade size check
  if (quotedCostUstx > MAX_POSITION_USTX) {
    console.log(JSON.stringify({
      success: false,
      error: "Trade exceeds max position size",
      quotedCostStx: ustxToStx(quotedCostUstx),
      maxPositionStx: ustxToStx(MAX_POSITION_USTX),
    }));
    process.exit(1);
  }

  // 4. Calculate max-cost with slippage
  const maxCostUstx = Math.ceil(quotedCostUstx * (1 + SLIPPAGE_PCT / 100));
  const tradeCmd = side === "yes" ? "buy-yes" : "buy-no";

  log(`executing ${tradeCmd}: ${shares} shares, quoted ${ustxToStx(quotedCostUstx)} STX, max ${ustxToStx(maxCostUstx)} STX`);

  // 5. Execute trade
  const tradeResult = await runTrade([
    tradeCmd,
    "--market-id", marketId,
    "--amount", String(shares),
    "--max-cost", String(maxCostUstx),
  ]);

  let tradeData: { success?: boolean; txid?: string; error?: string };
  try {
    tradeData = JSON.parse(tradeResult.stdout);
  } catch {
    console.log(JSON.stringify({ success: false, error: "Failed to parse trade response", raw: tradeResult.stdout }));
    process.exit(1);
  }

  if (!tradeData.success || !tradeData.txid) {
    console.log(JSON.stringify({
      success: false,
      error: "Trade execution failed",
      detail: tradeData.error ?? tradeResult.stderr ?? tradeResult.stdout,
    }));
    process.exit(1);
  }

  // 6. Record position
  const positionId = insertMarketPosition({
    market_id: marketId,
    mongo_id: mongoId,
    market_title: marketTitle,
    side,
    action: "buy",
    shares,
    cost_ustx: quotedCostUstx,
    txid: tradeData.txid,
    status: "confirmed",
  });

  const updatedBudget = getBudgetStatus();

  console.log(JSON.stringify({
    success: true,
    positionId,
    txid: tradeData.txid,
    trade: {
      marketId,
      marketTitle,
      side,
      shares,
      costStx: ustxToStx(quotedCostUstx),
      maxCostStx: ustxToStx(maxCostUstx),
    },
    budget: {
      totalStx: ustxToStx(updatedBudget.budgetUstx),
      remainingStx: ustxToStx(updatedBudget.remainingUstx),
      exposureStx: ustxToStx(updatedBudget.exposureUstx),
    },
  }));
}

async function cmdSell(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags["market-id"] || !flags.side || !flags.amount) {
    console.log(JSON.stringify({
      success: false,
      error: "Required: --market-id <id> --side yes|no --amount <shares>",
    }));
    process.exit(1);
  }

  const marketId = flags["market-id"];
  const side = flags.side.toLowerCase();
  const shares = parseInt(flags.amount, 10);
  const marketTitle = flags["market-title"] ?? `Market ${marketId}`;
  const mongoId = flags["mongo-id"] ?? null;

  if (side !== "yes" && side !== "no") {
    console.log(JSON.stringify({ success: false, error: "--side must be 'yes' or 'no'" }));
    process.exit(1);
  }
  if (isNaN(shares) || shares <= 0) {
    console.log(JSON.stringify({ success: false, error: "--amount must be a positive integer" }));
    process.exit(1);
  }

  initDatabase();

  // 1. Get sell quote
  log(`quoting sell-${side} ${shares} shares on market ${marketId}`);
  const quoteResult = await runUpstream(["quote-sell", "--market-id", marketId, "--side", side, "--amount", String(shares)]);

  if (quoteResult.exitCode !== 0) {
    console.log(JSON.stringify({ success: false, error: "Quote failed", detail: quoteResult.stderr || quoteResult.stdout }));
    process.exit(1);
  }

  let quoteData: { quote?: { totalProceedsUstx?: number } };
  try {
    quoteData = JSON.parse(quoteResult.stdout);
  } catch {
    console.log(JSON.stringify({ success: false, error: "Failed to parse quote response", raw: quoteResult.stdout }));
    process.exit(1);
  }

  const quotedProceedsUstx = quoteData.quote?.totalProceedsUstx ?? 0;
  const minProceedsUstx = Math.floor(quotedProceedsUstx * (1 - SLIPPAGE_PCT / 100));
  const tradeCmd = side === "yes" ? "sell-yes" : "sell-no";

  log(`executing ${tradeCmd}: ${shares} shares, quoted proceeds ${ustxToStx(quotedProceedsUstx)} STX`);

  // 2. Execute trade
  const tradeResult = await runTrade([
    tradeCmd,
    "--market-id", marketId,
    "--amount", String(shares),
    "--min-proceeds", String(minProceedsUstx),
  ]);

  let tradeData: { success?: boolean; txid?: string; error?: string };
  try {
    tradeData = JSON.parse(tradeResult.stdout);
  } catch {
    console.log(JSON.stringify({ success: false, error: "Failed to parse trade response", raw: tradeResult.stdout }));
    process.exit(1);
  }

  if (!tradeData.success || !tradeData.txid) {
    console.log(JSON.stringify({
      success: false,
      error: "Sell execution failed",
      detail: tradeData.error ?? tradeResult.stderr ?? tradeResult.stdout,
    }));
    process.exit(1);
  }

  // 3. Record position
  const positionId = insertMarketPosition({
    market_id: marketId,
    mongo_id: mongoId,
    market_title: marketTitle,
    side,
    action: "sell",
    shares,
    cost_ustx: quotedProceedsUstx,
    txid: tradeData.txid,
    status: "confirmed",
  });

  const updatedBudget = getBudgetStatus();

  console.log(JSON.stringify({
    success: true,
    positionId,
    txid: tradeData.txid,
    trade: {
      marketId,
      marketTitle,
      side,
      shares,
      proceedsStx: ustxToStx(quotedProceedsUstx),
      minProceedsStx: ustxToStx(minProceedsUstx),
    },
    budget: {
      totalStx: ustxToStx(updatedBudget.budgetUstx),
      remainingStx: ustxToStx(updatedBudget.remainingUstx),
      exposureStx: ustxToStx(updatedBudget.exposureUstx),
    },
  }));
}

async function cmdRedeem(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags["market-id"]) {
    console.log(JSON.stringify({ success: false, error: "Required: --market-id <id>" }));
    process.exit(1);
  }

  const marketId = flags["market-id"];
  const marketTitle = flags["market-title"] ?? `Market ${marketId}`;
  const mongoId = flags["mongo-id"] ?? null;

  initDatabase();

  log(`redeeming shares on market ${marketId}`);

  const tradeResult = await runTrade(["redeem", "--market-id", marketId]);

  let tradeData: { success?: boolean; txid?: string; error?: string };
  try {
    tradeData = JSON.parse(tradeResult.stdout);
  } catch {
    console.log(JSON.stringify({ success: false, error: "Failed to parse redeem response", raw: tradeResult.stdout }));
    process.exit(1);
  }

  if (!tradeData.success || !tradeData.txid) {
    console.log(JSON.stringify({
      success: false,
      error: "Redeem failed",
      detail: tradeData.error ?? tradeResult.stderr ?? tradeResult.stdout,
    }));
    process.exit(1);
  }

  // Record redeem — shares * 1 STX = proceeds for winning shares
  // We don't know the exact proceeds here (depends on resolution), record as 0 and update later
  const positions = getMarketPositions(marketId);
  const totalShares = positions
    .filter((p) => p.action === "buy" && p.status !== "failed")
    .reduce((sum, p) => sum + p.shares, 0);

  // Winning shares pay 1 STX each
  const estimatedProceedsUstx = totalShares * 1_000_000;

  const positionId = insertMarketPosition({
    market_id: marketId,
    mongo_id: mongoId,
    market_title: marketTitle,
    side: "redeem",
    action: "redeem",
    shares: totalShares,
    cost_ustx: estimatedProceedsUstx,
    txid: tradeData.txid,
    status: "confirmed",
  });

  console.log(JSON.stringify({
    success: true,
    positionId,
    txid: tradeData.txid,
    marketId,
    totalShares,
    estimatedProceedsStx: ustxToStx(estimatedProceedsUstx),
  }));
}

function cmdPositions(): void {
  initDatabase();
  const positions = getMarketPositions();

  if (positions.length === 0) {
    console.log(JSON.stringify({ positions: [], message: "No positions recorded" }));
    return;
  }

  const formatted = positions.map((p) => ({
    id: p.id,
    marketId: p.market_id,
    title: p.market_title,
    side: p.side,
    action: p.action,
    shares: p.shares,
    costStx: ustxToStx(p.cost_ustx),
    txid: p.txid,
    status: p.status,
    createdAt: p.created_at,
  }));

  console.log(JSON.stringify({ positions: formatted }));
}

function cmdPortfolio(): void {
  initDatabase();
  const budget = getBudgetStatus();
  const positions = getMarketPositions();

  // Group by market
  const marketMap = new Map<string, { title: string; buys: number; sells: number; buyShares: number; sellShares: number; redeemed: boolean }>();

  for (const p of positions) {
    if (p.status === "failed") continue;
    const entry = marketMap.get(p.market_id) ?? { title: p.market_title, buys: 0, sells: 0, buyShares: 0, sellShares: 0, redeemed: false };
    if (p.action === "buy") {
      entry.buys += p.cost_ustx;
      entry.buyShares += p.shares;
    } else if (p.action === "sell") {
      entry.sells += p.cost_ustx;
      entry.sellShares += p.shares;
    } else if (p.action === "redeem") {
      entry.redeemed = true;
      entry.sells += p.cost_ustx;
    }
    entry.title = p.market_title;
    marketMap.set(p.market_id, entry);
  }

  const markets = Array.from(marketMap.entries()).map(([id, m]) => ({
    marketId: id,
    title: m.title,
    invested: ustxToStx(m.buys),
    returned: ustxToStx(m.sells),
    netShares: m.buyShares - m.sellShares,
    redeemed: m.redeemed,
    pnlStx: ustxToStx(m.sells - m.buys),
  }));

  console.log(JSON.stringify({
    budget: {
      totalStx: ustxToStx(budget.budgetUstx),
      spentStx: ustxToStx(budget.spentUstx),
      proceedsStx: ustxToStx(budget.proceedsUstx),
      exposureStx: ustxToStx(budget.exposureUstx),
      remainingStx: ustxToStx(budget.remainingUstx),
    },
    markets,
    totalPositions: positions.length,
  }));
}

function cmdBudget(): void {
  initDatabase();
  const budget = getBudgetStatus();

  console.log(JSON.stringify({
    budget: {
      totalStx: ustxToStx(budget.budgetUstx),
      spentStx: ustxToStx(budget.spentUstx),
      proceedsStx: ustxToStx(budget.proceedsUstx),
      exposureStx: ustxToStx(budget.exposureUstx),
      remainingStx: ustxToStx(budget.remainingUstx),
      maxPositionStx: ustxToStx(MAX_POSITION_USTX),
    },
  }));
}

function printUsage(): void {
  process.stdout.write(`stacks-market CLI — prediction market trading with budget enforcement

USAGE
  arc skills run --name stacks-market -- <subcommand> [flags]

TRADING COMMANDS (budget-enforced, wallet required)
  buy --market-id <epochMs> --side yes|no --amount <shares> [--market-title <title>] [--mongo-id <id>]
    Quote, check budget, buy shares, and record position.

  sell --market-id <epochMs> --side yes|no --amount <shares> [--market-title <title>] [--mongo-id <id>]
    Quote, sell shares, and record proceeds.

  redeem --market-id <epochMs> [--market-title <title>] [--mongo-id <id>]
    Redeem winning shares after market resolution.

PORTFOLIO COMMANDS
  positions       List all recorded trades
  portfolio       Summary by market with P&L
  budget          Show remaining budget and limits

READ-ONLY COMMANDS (pass-through to upstream)
  list-markets [--limit N] [--status STATUS] [--category CAT]
  search-markets --query KEYWORD [--limit N]
  get-market --market-id <mongoId>
  quote-buy --market-id <epochMs> --side yes|no --amount <shares>
  quote-sell --market-id <epochMs> --side yes|no --amount <shares>
  get-position --market-id <epochMs> [--address STACKS_ADDRESS]

BUDGET
  Total: ${ustxToStx(BUDGET_USTX)} STX | Max per trade: ${ustxToStx(MAX_POSITION_USTX)} STX | Slippage: ${SLIPPAGE_PCT}%

EXAMPLES
  arc skills run --name stacks-market -- budget
  arc skills run --name stacks-market -- list-markets --limit 10
  arc skills run --name stacks-market -- buy --market-id 1771853629839 --side yes --amount 5 --market-title "BTC above 100k"
  arc skills run --name stacks-market -- portfolio
`);
}

// ---- Entry point ----

const READ_ONLY_COMMANDS = new Set([
  "list-markets", "search-markets", "get-market",
  "quote-buy", "quote-sell", "get-position",
]);

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  const sub = args[0];

  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    printUsage();
    process.exit(0);
  }

  // Read-only commands pass through to upstream
  if (READ_ONLY_COMMANDS.has(sub)) {
    await runUpstreamPassthrough(args);
    return;
  }

  // Trading + portfolio commands
  switch (sub) {
    case "buy":
      await cmdBuy(args.slice(1));
      break;
    case "sell":
      await cmdSell(args.slice(1));
      break;
    case "redeem":
      await cmdRedeem(args.slice(1));
      break;
    case "positions":
      cmdPositions();
      break;
    case "portfolio":
      cmdPortfolio();
      break;
    case "budget":
      cmdBudget();
      break;
    default:
      process.stderr.write(`Error: unknown subcommand '${sub}'\n\n`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
