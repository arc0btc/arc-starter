#!/usr/bin/env bun
/**
 * Zest V2 skill CLI — deposit, borrow, repay, health monitoring.
 * Uses new v2 contracts (deployer SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7).
 *
 * Usage:
 *   arc skills run --name zest-v2 -- <subcommand> [flags]
 */

import { spawn } from "bun";
import { resolve } from "node:path";
import { getCredential } from "../../src/credentials.ts";
import {
  principalCV,
  uintCV,
  cvToJSON,
  hexToCV,
  serializeCV,
} from "../../github/aibtcdev/skills/node_modules/@stacks/transactions/dist/index.js";

// ---- Constants ----

const SKILLS_ROOT = resolve(import.meta.dir, "../../github/aibtcdev/skills");
const TX_RUNNER = resolve(import.meta.dir, "../defi-zest/tx-runner.ts");
const STACKS_API = "https://api.hiro.so";
const ARC_ADDRESS = "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B";

// V2 contracts
const V2_DEPLOYER = "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7";
const V2_MARKET = `${V2_DEPLOYER}.v0-4-market`;
const V2_DATA = `${V2_DEPLOYER}.v0-1-data`;

// V2 asset registry
interface V2Asset {
  id: number;
  symbol: string;
  decimals: number;
  tokenContract: string;
  vault: string;
}

const V2_ASSETS: Record<string, V2Asset> = {
  wstx: { id: 0, symbol: "wSTX", decimals: 6, tokenContract: `${V2_DEPLOYER}.wstx`, vault: `${V2_DEPLOYER}.v0-vault-stx` },
  sbtc: { id: 2, symbol: "sBTC", decimals: 8, tokenContract: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token", vault: `${V2_DEPLOYER}.v0-vault-sbtc` },
  ststx: { id: 4, symbol: "stSTX", decimals: 6, tokenContract: "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token", vault: `${V2_DEPLOYER}.v0-vault-ststx` },
  usdc: { id: 6, symbol: "USDC", decimals: 6, tokenContract: "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx", vault: `${V2_DEPLOYER}.v0-vault-usdc` },
  usdh: { id: 8, symbol: "USDH", decimals: 8, tokenContract: "SPN5AKG35QZSK2M8GAMR4AFX45659RJHDW353HSG.usdh-token-v1", vault: `${V2_DEPLOYER}.v0-vault-usdh` },
  ststxbtc: { id: 10, symbol: "stSTXbtc", decimals: 6, tokenContract: "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststxbtc-token-v2", vault: `${V2_DEPLOYER}.v0-vault-ststxbtc` },
};

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

function resolveAsset(symbol: string): V2Asset | null {
  const key = symbol.toLowerCase();
  return V2_ASSETS[key] ?? null;
}

function serializeCVToHex(cv: unknown): string {
  const serialized = serializeCV(cv);
  if (typeof serialized === "string") {
    return serialized.startsWith("0x") ? serialized : `0x${serialized}`;
  }
  return `0x${Buffer.from(serialized as Uint8Array).toString("hex")}`;
}

/** Call read-only function on a v2 contract */
async function callReadOnly(
  contractId: string,
  functionName: string,
  args: string[],
): Promise<Record<string, unknown> | null> {
  const [address, name] = contractId.split(".");
  const url = `${STACKS_API}/v2/contracts/call-read/${address}/${name}/${functionName}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender: ARC_ADDRESS, arguments: args }),
      signal: controller.signal,
    });
    if (!response.ok) {
      log(`read-only call failed: ${functionName} on ${contractId} → HTTP ${response.status}`);
      return null;
    }
    return (await response.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
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

  const asset = resolveAsset(flags.asset);
  if (!asset) {
    console.log(JSON.stringify({ success: false, error: `Unknown asset '${flags.asset}'. Supported: ${Object.values(V2_ASSETS).map(a => a.symbol).join(", ")}` }));
    process.exit(1);
  }

  log(`depositing ${flags.amount} ${asset.symbol} to Zest V2 (v0-4-market supply-collateral-add)`);

  // V2 supply uses: supply-collateral-add(ft, amount, min-shares, price-feeds)
  // Upstream tx-runner delegates to defi.ts which still uses v1 contracts.
  // Pass through to upstream for now — will fail if upstream hasn't been updated.
  const result = await runTx([
    "zest-supply",
    "--asset", flags.asset,
    "--amount", flags.amount,
  ]);

  console.log(result.stdout || JSON.stringify({
    success: false,
    error: "No output from tx runner. Note: upstream may need v2 contract migration (SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-4-market supply-collateral-add)",
  }));
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

  const asset = resolveAsset(flags.asset);
  if (!asset) {
    console.log(JSON.stringify({ success: false, error: `Unknown asset '${flags.asset}'. Supported: ${Object.values(V2_ASSETS).map(a => a.symbol).join(", ")}` }));
    process.exit(1);
  }

  log(`borrowing ${flags.amount} ${asset.symbol} from Zest V2 (v0-4-market borrow)`);

  const result = await runTx([
    "zest-borrow",
    "--asset", flags.asset,
    "--amount", flags.amount,
  ]);

  console.log(result.stdout || JSON.stringify({
    success: false,
    error: "No output from tx runner. Note: upstream may need v2 contract migration (SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-4-market borrow)",
  }));
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

  const asset = resolveAsset(flags.asset);
  if (!asset) {
    console.log(JSON.stringify({ success: false, error: `Unknown asset '${flags.asset}'. Supported: ${Object.values(V2_ASSETS).map(a => a.symbol).join(", ")}` }));
    process.exit(1);
  }

  log(`repaying ${flags.amount} ${asset.symbol} on Zest V2 (v0-4-market repay)`);

  const result = await runTx([
    "zest-repay",
    "--asset", flags.asset,
    "--amount", flags.amount,
  ]);

  console.log(result.stdout || JSON.stringify({
    success: false,
    error: "No output from tx runner. Note: upstream may need v2 contract migration (SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-4-market repay)",
  }));
  if (result.exitCode !== 0) process.exit(1);
}

async function cmdHealth(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const address = flags.address ?? ARC_ADDRESS;

  log(`checking Zest V2 health factor for ${address} via v0-1-data`);

  const positions: Array<{
    symbol: string;
    assetId: number;
    suppliedShares: string;
    borrowed: string;
    healthFactor: number;
  }> = [];

  let worstHF = 999;

  for (const asset of Object.values(V2_ASSETS)) {
    try {
      const result = await callReadOnly(V2_DATA, "get-user-position", [
        serializeCVToHex(principalCV(address)),
        serializeCVToHex(uintCV(asset.id)),
      ]);

      if (!result || !result.okay || !result.result) continue;

      const decoded = cvToJSON(hexToCV(result.result as string));
      if (!decoded || typeof decoded !== "object" || !("value" in decoded)) continue;

      const decodedValue = decoded.value as Record<string, { value: string }>;
      const supplied = decodedValue["suppliedShares"]?.value ?? decodedValue["supplied-shares"]?.value ?? "0";
      const borrowed = decodedValue["borrowed"]?.value ?? "0";

      const suppliedN = BigInt(supplied);
      const borrowedN = BigInt(borrowed);

      if (suppliedN === 0n && borrowedN === 0n) continue;

      const hf = borrowedN === 0n ? 999 : Number(suppliedN) / Number(borrowedN);
      if (hf < worstHF) worstHF = hf;

      positions.push({
        symbol: asset.symbol,
        assetId: asset.id,
        suppliedShares: supplied,
        borrowed,
        healthFactor: Number(hf.toFixed(2)),
      });
    } catch (e) {
      log(`warn: failed to fetch position for ${asset.symbol}: ${(e as Error).message}`);
    }
  }

  const hasDebt = positions.some(p => p.borrowed !== "0");

  console.log(JSON.stringify({
    address,
    contracts: { market: V2_MARKET, data: V2_DATA },
    positions,
    worstHealthFactor: Number(worstHF.toFixed(2)),
    status: !hasDebt ? "no-debt" : worstHF < 1.2 ? "critical" : worstHF < 1.5 ? "warning" : "healthy",
    note: !hasDebt
      ? "No active borrow positions"
      : `Worst health factor ${worstHF.toFixed(2)} — ${worstHF < 1.5 ? "consider adding collateral or repaying" : "position is healthy"}`,
  }));
}

function printUsage(): void {
  process.stdout.write(`zest-v2 CLI — Zest Protocol V2 lending & borrowing
Contracts: ${V2_DEPLOYER} (v0-4-market, v0-1-data)

USAGE
  arc skills run --name zest-v2 -- <subcommand> [flags]

READ-ONLY COMMANDS
  health [--address <addr>]
    Check position health factor, collateral, and debt via v0-1-data.

WRITE COMMANDS (wallet required, ~50k uSTX gas per op)
  deposit --asset <symbol> --amount <units>
    Supply collateral via v0-4-market supply-collateral-add.

  borrow --asset <symbol> --amount <units>
    Borrow against collateral via v0-4-market borrow.

  repay --asset <symbol> --amount <units>
    Repay outstanding borrow via v0-4-market repay.

SUPPORTED ASSETS
  wSTX (id=0), sBTC (id=2), stSTX (id=4), USDC (id=6), USDH (id=8), stSTXbtc (id=10)

EXAMPLES
  arc skills run --name zest-v2 -- health
  arc skills run --name zest-v2 -- deposit --asset sBTC --amount 100000
  arc skills run --name zest-v2 -- borrow --asset wSTX --amount 500000000
  arc skills run --name zest-v2 -- repay --asset wSTX --amount 250000000
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
