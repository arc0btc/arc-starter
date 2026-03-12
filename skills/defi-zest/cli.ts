#!/usr/bin/env bun
/**
 * Zest Protocol skill CLI — supply, withdraw, position monitoring.
 * Uses v2 contracts (deployer SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7).
 *
 * Usage:
 *   arc skills run --name defi-zest -- <subcommand> [flags]
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
const TX_RUNNER = resolve(import.meta.dir, "tx-runner.ts");
const STACKS_API = "https://api.hiro.so";
const ARC_ADDRESS = "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B";

// V2 contracts
const V2_DEPLOYER = "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7";
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

async function cmdListAssets(): Promise<void> {
  const assets = Object.values(V2_ASSETS).map(a => ({
    symbol: a.symbol,
    assetId: a.id,
    tokenContract: a.tokenContract,
    vault: a.vault,
    decimals: a.decimals,
  }));
  console.log(JSON.stringify({ assets, dataContract: V2_DATA }));
}

async function cmdPosition(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const assetSymbol = flags.asset ?? "sBTC";
  const address = flags.address ?? ARC_ADDRESS;

  const asset = resolveAsset(assetSymbol);
  if (!asset) {
    console.log(JSON.stringify({ success: false, error: `Unknown asset '${assetSymbol}'. Supported: ${Object.values(V2_ASSETS).map(a => a.symbol).join(", ")}` }));
    process.exit(1);
  }

  log(`checking Zest v2 position for ${asset.symbol} (${address}) via v0-1-data`);

  try {
    const result = await callReadOnly(V2_DATA, "get-user-position", [
      serializeCVToHex(principalCV(address)),
      serializeCVToHex(uintCV(asset.id)),
    ]);

    let supplied = "0";
    let borrowed = "0";

    if (result && result.okay && result.result) {
      const decoded = cvToJSON(hexToCV(result.result as string));
      if (decoded && typeof decoded === "object" && "value" in decoded) {
        const val = decoded.value as Record<string, { value: string }>;
        supplied = val["suppliedShares"]?.value ?? val["supplied-shares"]?.value ?? "0";
        borrowed = val["borrowed"]?.value ?? "0";
      }
    }

    const suppliedHuman = (Number(supplied) / Math.pow(10, asset.decimals)).toFixed(asset.decimals);
    const borrowedHuman = (Number(borrowed) / Math.pow(10, asset.decimals)).toFixed(asset.decimals);

    console.log(JSON.stringify({
      address,
      asset: asset.symbol,
      position: {
        suppliedShares: supplied,
        suppliedHuman,
        borrowed,
        borrowedHuman,
        assetId: asset.id,
        vault: asset.vault,
      },
      dataContract: V2_DATA,
    }));
  } catch (e) {
    console.log(JSON.stringify({ success: false, error: (e as Error).message }));
    process.exit(1);
  }
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

  const asset = resolveAsset(flags.asset);
  if (!asset) {
    console.log(JSON.stringify({ success: false, error: `Unknown asset '${flags.asset}'. Supported: ${Object.values(V2_ASSETS).map(a => a.symbol).join(", ")}` }));
    process.exit(1);
  }

  log(`supplying ${flags.amount} ${asset.symbol} to Zest v2 (supply-collateral-add)`);

  // Delegates to upstream tx-runner → defi.ts zest-supply
  // Note: upstream still uses v1 contracts — will need migration
  const result = await runTx([
    "zest-supply",
    "--asset", flags.asset,
    "--amount", flags.amount,
  ]);

  console.log(result.stdout || JSON.stringify({
    success: false,
    error: "No output from tx runner. Note: upstream may need v2 contract migration.",
  }));
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

  const asset = resolveAsset(flags.asset);
  if (!asset) {
    console.log(JSON.stringify({ success: false, error: `Unknown asset '${flags.asset}'. Supported: ${Object.values(V2_ASSETS).map(a => a.symbol).join(", ")}` }));
    process.exit(1);
  }

  log(`withdrawing ${flags.amount} ${asset.symbol} from Zest v2 (collateral-remove-redeem)`);

  const result = await runTx([
    "zest-withdraw",
    "--asset", flags.asset,
    "--amount", flags.amount,
  ]);

  console.log(result.stdout || JSON.stringify({
    success: false,
    error: "No output from tx runner. Note: upstream may need v2 contract migration.",
  }));
  if (result.exitCode !== 0) process.exit(1);
}

function printUsage(): void {
  process.stdout.write(`defi-zest CLI — Zest Protocol yield farming (v2 contracts)
Contracts: ${V2_DEPLOYER} (v0-4-market, v0-1-data)

USAGE
  arc skills run --name defi-zest -- <subcommand> [flags]

READ-ONLY COMMANDS
  list-assets
    List all supported Zest V2 assets with contract IDs and vaults.

  position [--asset <symbol>] [--address <addr>]
    Check supply position via v0-1-data get-user-position. Default: sBTC, Arc's address.

WRITE COMMANDS (wallet required, ~50k uSTX gas per op)
  supply --asset <symbol> --amount <units>
    Supply assets to Zest lending pool via supply-collateral-add.

  withdraw --asset <symbol> --amount <units>
    Withdraw assets from Zest lending pool via collateral-remove-redeem.

SUPPORTED ASSETS
  wSTX (id=0), sBTC (id=2), stSTX (id=4), USDC (id=6), USDH (id=8), stSTXbtc (id=10)

EXAMPLES
  arc skills run --name defi-zest -- list-assets
  arc skills run --name defi-zest -- position
  arc skills run --name defi-zest -- position --asset sBTC
  arc skills run --name defi-zest -- supply --asset sBTC --amount 8200
  arc skills run --name defi-zest -- withdraw --asset sBTC --amount 4000
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
      await cmdListAssets();
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
