#!/usr/bin/env bun
/**
 * Zest Yield Manager — Autonomous sBTC yield on Zest Protocol
 *
 * Commands: doctor | run | install-packs
 * Actions (run): status | supply | withdraw | claim
 *
 * Built by Secret Mars — tested on mainnet with real sBTC positions.
 * On-chain proof: SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE has active Zest history.
 */

import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  uintCV,
  principalCV,
  contractPrincipalCV,
  fetchCallReadOnlyFunction,
  cvToJSON,
} from "@stacks/transactions";
import { STACKS_MAINNET } from "@stacks/network";
import { getZestProtocolService } from "../../github/aibtcdev/skills/src/lib/services/defi.service.js";
import type { Account } from "../../github/aibtcdev/skills/src/lib/transactions/builder.js";
import { acquireNonce, releaseNonce } from "../../github/aibtcdev/skills/src/lib/services/nonce-tracker.js";
import type { Network } from "../../github/aibtcdev/skills/src/lib/config/networks.js";

// ── Wallet decrypt (ported from skills/hodlmm-move-liquidity) ──────────

const WALLETS_FILE = path.join(os.homedir(), ".aibtc", "wallets.json");
const WALLETS_DIR = path.join(os.homedir(), ".aibtc", "wallets");
const EXPLORER = "https://explorer.hiro.so/txid";

async function getWalletKeys(password: string): Promise<{ stxPrivateKey: string; stxAddress: string }> {
  if (process.env.STACKS_PRIVATE_KEY) {
    const { getAddressFromPrivateKey, TransactionVersion } =
      await import("@stacks/transactions" as string);
    const key = process.env.STACKS_PRIVATE_KEY;
    const address = getAddressFromPrivateKey(key, TransactionVersion.Mainnet);
    return { stxPrivateKey: key, stxAddress: address };
  }

  const { generateWallet, deriveAccount, getStxAddress } =
    await import("@stacks/wallet-sdk" as string);

  if (fs.existsSync(WALLETS_FILE)) {
    const walletsJson = JSON.parse(fs.readFileSync(WALLETS_FILE, "utf-8"));
    const activeWallet = (walletsJson.wallets ?? [])[0];
    if (activeWallet?.id) {
      const keystorePath = path.join(WALLETS_DIR, activeWallet.id, "keystore.json");
      if (fs.existsSync(keystorePath)) {
        const keystore = JSON.parse(fs.readFileSync(keystorePath, "utf-8"));
        const enc = keystore.encrypted;
        if (enc?.ciphertext) {
          const { scryptSync, createDecipheriv } = await import("crypto");
          const salt = Buffer.from(enc.salt, "base64");
          const iv = Buffer.from(enc.iv, "base64");
          const authTag = Buffer.from(enc.authTag, "base64");
          const ciphertext = Buffer.from(enc.ciphertext, "base64");
          const key = scryptSync(password, salt, enc.scryptParams?.keyLen ?? 32, {
            N: enc.scryptParams?.N ?? 16384,
            r: enc.scryptParams?.r ?? 8,
            p: enc.scryptParams?.p ?? 1,
          });
          const decipher = createDecipheriv("aes-256-gcm", key, iv);
          decipher.setAuthTag(authTag);
          const mnemonic = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8").trim();
          const wallet = await generateWallet({ secretKey: mnemonic, password: "" });
          const account = wallet.accounts[0] ?? deriveAccount(wallet, 0);
          return { stxPrivateKey: account.stxPrivateKey, stxAddress: getStxAddress(account) };
        }
        const legacyEnc = keystore.encryptedMnemonic ?? keystore.encrypted_mnemonic;
        if (legacyEnc) {
          const { decryptMnemonic } = await import("@stacks/encryption" as string);
          const mnemonic = await decryptMnemonic(legacyEnc, password);
          const wallet = await generateWallet({ secretKey: mnemonic, password: "" });
          const account = wallet.accounts[0] ?? deriveAccount(wallet, 0);
          return { stxPrivateKey: account.stxPrivateKey, stxAddress: getStxAddress(account) };
        }
      }
    }
  }
  throw new Error("No wallet found. Run: npx @aibtc/mcp-server@latest --install");
}

async function getSigningAccount(password: string, expectedAddress: string): Promise<Account> {
  const keys = await getWalletKeys(password);
  if (keys.stxAddress !== expectedAddress) {
    throw new Error(`Wallet address mismatch: expected ${expectedAddress}, got ${keys.stxAddress}`);
  }
  return {
    address: keys.stxAddress,
    privateKey: keys.stxPrivateKey,
    network: "mainnet",
  };
}

async function broadcastZestOp(
  account: Account,
  op: (nonce: bigint) => Promise<{ txid: string }>
): Promise<string> {
  const acquired = await acquireNonce(account.address);
  const nonce = BigInt(acquired.nonce);
  try {
    const result = await op(nonce);
    await releaseNonce(account.address, acquired.nonce, true, undefined, result.txid);
    return result.txid;
  } catch (err) {
    // Conservative: treat as broadcast so the tracker auto-resyncs from Hiro after 90s
    // rather than rolling back a nonce that may already be in the mempool.
    await releaseNonce(account.address, acquired.nonce, false, "broadcast");
    throw err;
  }
}

// ── Constants ──────────────────────────────────────────────────────────

const NETWORK = STACKS_MAINNET;
const ZEST_NETWORK: Network = "mainnet";
const HIRO_API = "https://api.hiro.so";

// Zest Protocol contracts (mainnet, current versions)
const POOL_BORROW = "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.pool-borrow-v2-3";
const BORROW_HELPER = "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.borrow-helper-v2-1-7";
const INCENTIVES = "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.incentives-v2-2";
const ZSBTC = "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zsbtc-v2-0";
const SBTC_TOKEN = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const WSTX = "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.wstx";

// Safety defaults
const DEFAULT_MAX_SUPPLY_SATS = 500_000;
const MIN_GAS_USTX = 100_000;

// ── Types ──────────────────────────────────────────────────────────────

interface SkillOutput {
  status: "success" | "error" | "blocked";
  action: string;
  data: Record<string, unknown>;
  error: { code: string; message: string; next: string } | null;
}

// ── Helpers ────────────────────────────────────────────────────────────

function output(result: SkillOutput): void {
  console.log(JSON.stringify(result, null, 2));
}

function blocked(code: string, message: string, next: string): void {
  output({ status: "blocked", action: next, data: {}, error: { code, message, next } });
}

function error(code: string, message: string, next: string): void {
  output({ status: "error", action: next, data: {}, error: { code, message, next } });
}

function splitContractId(id: string): { address: string; name: string } {
  const [address, name] = id.split(".");
  return { address, name };
}

async function getStxBalance(address: string): Promise<number> {
  const res = await fetch(`${HIRO_API}/extended/v1/address/${address}/stx`);
  if (!res.ok) throw new Error(`Failed to fetch STX balance: ${res.status}`);
  const data = await res.json();
  return parseInt(data.balance, 10) - parseInt(data.locked, 10);
}

async function getSbtcBalance(address: string): Promise<number> {
  const res = await fetch(
    `${HIRO_API}/extended/v1/address/${address}/balances`
  );
  if (!res.ok) throw new Error(`Failed to fetch balances: ${res.status}`);
  const data = await res.json();
  const ftKey = `${SBTC_TOKEN}::sbtc-token`;
  const sbtcEntry = data.fungible_tokens?.[ftKey];
  return sbtcEntry ? parseInt(sbtcEntry.balance, 10) : 0;
}

async function getZestPosition(address: string): Promise<{ supplied: number; borrowed: number }> {
  const { address: poolAddr, name: poolName } = splitContractId(POOL_BORROW);
  const { address: sbtcAddr, name: sbtcName } = splitContractId(SBTC_TOKEN);

  try {
    const result = await fetchCallReadOnlyFunction({
      network: NETWORK,
      contractAddress: poolAddr,
      contractName: poolName,
      functionName: "get-user-reserve-data",
      functionArgs: [
        principalCV(address),
        contractPrincipalCV(sbtcAddr, sbtcName),
      ],
      senderAddress: address,
    });

    const json = cvToJSON(result);
    if (json.success && json.value) {
      const val = json.value.value || json.value;
      return {
        supplied: parseInt(val["current-atoken-balance"]?.value || "0", 10),
        borrowed: parseInt(val["current-variable-debt"]?.value || "0", 10),
      };
    }
    return { supplied: 0, borrowed: 0 };
  } catch {
    // Position may not exist yet
    return { supplied: 0, borrowed: 0 };
  }
}

async function getRewardsPending(address: string): Promise<number> {
  const { address: incAddr, name: incName } = splitContractId(INCENTIVES);
  const { address: sbtcAddr, name: sbtcName } = splitContractId(SBTC_TOKEN);
  const { address: wstxAddr, name: wstxName } = splitContractId(WSTX);

  try {
    const result = await fetchCallReadOnlyFunction({
      network: NETWORK,
      contractAddress: incAddr,
      contractName: incName,
      functionName: "get-vault-rewards",
      functionArgs: [
        principalCV(address),
        contractPrincipalCV(sbtcAddr, sbtcName),
        contractPrincipalCV(wstxAddr, wstxName),
      ],
      senderAddress: address,
    });

    const json = cvToJSON(result);
    if (json.success) {
      return parseInt(json.value?.value || "0", 10);
    }
    return 0;
  } catch {
    return 0;
  }
}

function getWalletAddress(): string {
  const addr = process.env.STACKS_ADDRESS || process.env.STX_ADDRESS;
  if (!addr) {
    error("no_wallet", "No wallet address found. Set STACKS_ADDRESS env var.", "Configure wallet");
    process.exit(1);
  }
  return addr;
}

// ── Commands ───────────────────────────────────────────────────────────

async function doctor(): Promise<void> {
  const address = getWalletAddress();
  const checks: Record<string, { ok: boolean; detail: string }> = {};

  // Check STX balance (for gas)
  try {
    const stxBalance = await getStxBalance(address);
    const hasGas = stxBalance >= MIN_GAS_USTX;
    checks["stx_gas"] = {
      ok: hasGas,
      detail: `${stxBalance} uSTX (need ${MIN_GAS_USTX} min)`,
    };
  } catch (e: any) {
    checks["stx_gas"] = { ok: false, detail: e.message };
  }

  // Check sBTC balance
  try {
    const sbtcBalance = await getSbtcBalance(address);
    checks["sbtc_balance"] = {
      ok: true,
      detail: `${sbtcBalance} sats`,
    };
  } catch (e: any) {
    checks["sbtc_balance"] = { ok: false, detail: e.message };
  }

  // Check Zest contract availability
  try {
    const { address: poolAddr, name: poolName } = splitContractId(POOL_BORROW);
    const res = await fetch(
      `${HIRO_API}/v2/contracts/interface/${poolAddr}/${poolName}`
    );
    checks["zest_pool"] = {
      ok: res.ok,
      detail: res.ok ? `${POOL_BORROW} reachable` : `HTTP ${res.status}`,
    };
  } catch (e: any) {
    checks["zest_pool"] = { ok: false, detail: e.message };
  }

  // Check current position
  try {
    const pos = await getZestPosition(address);
    checks["position"] = {
      ok: true,
      detail: `supplied=${pos.supplied} sats, borrowed=${pos.borrowed} sats`,
    };
  } catch (e: any) {
    checks["position"] = { ok: false, detail: e.message };
  }

  // Check rewards
  try {
    const rewards = await getRewardsPending(address);
    checks["rewards"] = {
      ok: true,
      detail: `${rewards} uSTX pending`,
    };
  } catch (e: any) {
    checks["rewards"] = { ok: false, detail: e.message };
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  const blockers = Object.entries(checks)
    .filter(([, c]) => !c.ok)
    .map(([k, c]) => `${k}: ${c.detail}`);

  if (allOk) {
    output({
      status: "success",
      action: "Environment ready. Run with --action=status to check position.",
      data: { checks, address },
      error: null,
    });
  } else {
    output({
      status: "blocked",
      action: "Fix blockers before proceeding",
      data: { checks, address, blockers },
      error: {
        code: "doctor_failed",
        message: blockers.join("; "),
        next: "Resolve the listed issues and re-run doctor",
      },
    });
  }
}

async function runStatus(address: string): Promise<void> {
  const [stxBalance, sbtcBalance, position, rewards] = await Promise.all([
    getStxBalance(address),
    getSbtcBalance(address),
    getZestPosition(address),
    getRewardsPending(address),
  ]);

  output({
    status: "success",
    action:
      position.supplied > 0
        ? rewards > 1000
          ? "Rewards available — consider claiming with --action=claim"
          : "Position healthy. No action needed."
        : sbtcBalance > 0
        ? "Idle sBTC detected — consider supplying with --action=supply"
        : "No sBTC to manage.",
    data: {
      position: {
        supplied_sats: position.supplied,
        borrowed_sats: position.borrowed,
        rewards_pending_ustx: rewards,
        asset: "sBTC",
      },
      balances: {
        sbtc_sats: sbtcBalance,
        stx_ustx: stxBalance,
      },
    },
    error: null,
  });
}

async function runSupply(
  address: string,
  amountSats: number,
  maxSupply: number,
  confirmed: boolean,
  password?: string
): Promise<void> {
  // Safety: enforce spend limit
  if (amountSats > maxSupply) {
    blocked(
      "exceeds_limit",
      `Requested ${amountSats} sats exceeds max supply limit of ${maxSupply} sats`,
      `Reduce amount or set --max-supply-sats=${amountSats} to override`
    );
    return;
  }

  if (amountSats <= 0) {
    error("invalid_amount", "Supply amount must be positive", "Specify --amount=<sats>");
    return;
  }

  // Check balances
  const [stxBalance, sbtcBalance] = await Promise.all([
    getStxBalance(address),
    getSbtcBalance(address),
  ]);

  if (stxBalance < MIN_GAS_USTX) {
    blocked(
      "insufficient_gas",
      `STX balance ${stxBalance} uSTX < minimum ${MIN_GAS_USTX} uSTX for gas`,
      "Acquire STX for transaction fees"
    );
    return;
  }

  if (sbtcBalance < amountSats) {
    blocked(
      "insufficient_sbtc",
      `sBTC balance ${sbtcBalance} sats < requested supply of ${amountSats} sats`,
      `Reduce amount to at most ${sbtcBalance} sats`
    );
    return;
  }

  const preChecks = {
    gas_sufficient: true,
    balance_sufficient: true,
    within_spend_limit: true,
    stx_balance: stxBalance,
    sbtc_balance: sbtcBalance,
  };

  if (!confirmed) {
    output({
      status: "success",
      action: `Dry run. Add --confirm --password <pass> to execute supply of ${amountSats} sats via ${BORROW_HELPER}.`,
      data: {
        operation: "supply",
        asset: "sBTC",
        amount_sats: amountSats,
        contract: BORROW_HELPER,
        function: "supply",
        pre_checks_passed: preChecks,
      },
      error: null,
    });
    return;
  }

  if (!password) {
    blocked("password_required", "--password required with --confirm", "Provide --password <pass>");
    return;
  }

  try {
    const account = await getSigningAccount(password, address);
    const zestService = getZestProtocolService(ZEST_NETWORK);
    const txid = await broadcastZestOp(account, (nonce) =>
      zestService.supply(account, "sBTC", BigInt(amountSats), undefined, nonce)
    );

    output({
      status: "success",
      action: "Supply transaction broadcast",
      data: {
        operation: "supply",
        asset: "sBTC",
        amount_sats: amountSats,
        contract: BORROW_HELPER,
        function: "supply",
        pre_checks_passed: preChecks,
        transaction: { txid, explorer: `${EXPLORER}/${txid}?chain=mainnet` },
      },
      error: null,
    });
  } catch (e: any) {
    error("supply_failed", e.message, "Check error and retry");
  }
}

async function runWithdraw(
  address: string,
  amountSats: number,
  confirmed: boolean,
  password?: string
): Promise<void> {
  if (amountSats <= 0) {
    error("invalid_amount", "Withdraw amount must be positive", "Specify --amount=<sats>");
    return;
  }

  const zestService = getZestProtocolService(ZEST_NETWORK);
  const [stxBalance, position] = await Promise.all([
    getStxBalance(address),
    zestService.getUserPosition("sBTC", address),
  ]);
  const supplied = position ? parseInt(position.supplied, 10) : 0;

  if (stxBalance < MIN_GAS_USTX) {
    blocked(
      "insufficient_gas",
      `STX balance ${stxBalance} uSTX < minimum ${MIN_GAS_USTX} uSTX for gas`,
      "Acquire STX for transaction fees"
    );
    return;
  }

  if (supplied < amountSats) {
    blocked(
      "insufficient_position",
      `Supplied ${supplied} sats < requested withdrawal of ${amountSats} sats`,
      `Reduce amount to at most ${supplied} sats, or use --amount=${supplied} for full withdrawal`
    );
    return;
  }

  const preChecks = {
    gas_sufficient: true,
    position_sufficient: true,
    current_supplied: supplied,
  };

  if (!confirmed) {
    output({
      status: "success",
      action: `Dry run. Add --confirm --password <pass> to execute withdrawal of ${amountSats} sats via ${BORROW_HELPER}.`,
      data: {
        operation: "withdraw",
        asset: "sBTC",
        amount_sats: amountSats,
        contract: BORROW_HELPER,
        function: "withdraw",
        pre_checks_passed: preChecks,
      },
      error: null,
    });
    return;
  }

  if (!password) {
    blocked("password_required", "--password required with --confirm", "Provide --password <pass>");
    return;
  }

  try {
    const account = await getSigningAccount(password, address);
    const txid = await broadcastZestOp(account, (nonce) =>
      zestService.withdraw(account, "sBTC", BigInt(amountSats), nonce)
    );

    output({
      status: "success",
      action: "Withdraw transaction broadcast",
      data: {
        operation: "withdraw",
        asset: "sBTC",
        amount_sats: amountSats,
        contract: BORROW_HELPER,
        function: "withdraw",
        pre_checks_passed: preChecks,
        transaction: { txid, explorer: `${EXPLORER}/${txid}?chain=mainnet` },
      },
      error: null,
    });
  } catch (e: any) {
    error("withdraw_failed", e.message, "Check error and retry");
  }
}

async function runClaim(address: string, confirmed: boolean, password?: string): Promise<void> {
  const [stxBalance, rewards] = await Promise.all([
    getStxBalance(address),
    getRewardsPending(address),
  ]);

  if (stxBalance < MIN_GAS_USTX) {
    blocked(
      "insufficient_gas",
      `STX balance ${stxBalance} uSTX < minimum ${MIN_GAS_USTX}`,
      "Acquire STX for transaction fees"
    );
    return;
  }

  if (rewards === 0) {
    output({
      status: "success",
      action: "No rewards to claim. Check again after more time accrues.",
      data: { rewards_ustx: 0, note: "wSTX incentives accrue over time based on supply amount" },
      error: null,
    });
    return;
  }

  const preChecks = { gas_sufficient: true, rewards_available: rewards > 0 };

  if (!confirmed) {
    output({
      status: "success",
      action: `Dry run. Add --confirm --password <pass> to execute claim of ${rewards} uSTX via ${INCENTIVES}.`,
      data: {
        operation: "claim",
        asset: "sBTC",
        rewards_ustx: rewards,
        contract: INCENTIVES,
        function: "claim-rewards",
        pre_checks_passed: preChecks,
      },
      error: null,
    });
    return;
  }

  if (!password) {
    blocked("password_required", "--password required with --confirm", "Provide --password <pass>");
    return;
  }

  try {
    const account = await getSigningAccount(password, address);
    const zestService = getZestProtocolService(ZEST_NETWORK);
    const txid = await broadcastZestOp(account, (nonce) =>
      zestService.claimRewards(account, "sBTC", nonce)
    );

    output({
      status: "success",
      action: "Claim transaction broadcast",
      data: {
        operation: "claim",
        asset: "sBTC",
        rewards_ustx: rewards,
        contract: INCENTIVES,
        function: "claim-rewards",
        pre_checks_passed: preChecks,
        transaction: { txid, explorer: `${EXPLORER}/${txid}?chain=mainnet` },
      },
      error: null,
    });
  } catch (e: any) {
    error("claim_failed", e.message, "Check error and retry");
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name("zest-yield-manager")
  .description(
    "Autonomous sBTC yield management on Zest Protocol — supply, withdraw, claim rewards, and monitor positions"
  )
  .version("0.1.0");

program
  .command("doctor")
  .description("Check environment readiness: wallet, balances, Zest contract availability, position, and rewards")
  .action(async () => {
    await doctor();
  });

program
  .command("run")
  .description("Execute a yield management action: status, supply, withdraw, or claim")
  .option("--action <action>", "Action to perform: status | supply | withdraw | claim", "status")
  .option("--amount <sats>", "Amount in sats for supply/withdraw operations", "0")
  .option("--max-supply-sats <sats>", "Maximum sats allowed in a single supply call", String(DEFAULT_MAX_SUPPLY_SATS))
  .option("--confirm", "Execute on-chain (without this flag: preview only)")
  .option("--password <pass>", "Wallet password (required with --confirm)")
  .action(async (opts: { action: string; amount: string; maxSupplySats: string; confirm?: boolean; password?: string }) => {
    const address = getWalletAddress();
    const action = opts.action;
    const amount = parseInt(opts.amount, 10);
    const maxSupply = parseInt(opts.maxSupplySats, 10);
    const confirmed = Boolean(opts.confirm);

    switch (action) {
      case "status":
        await runStatus(address);
        break;
      case "supply":
        await runSupply(address, amount, maxSupply, confirmed, opts.password);
        break;
      case "withdraw":
        await runWithdraw(address, amount, confirmed, opts.password);
        break;
      case "claim":
        await runClaim(address, confirmed, opts.password);
        break;
      default:
        error(
          "unknown_action",
          `Unknown action: ${action}`,
          "Use --action=status|supply|withdraw|claim"
        );
    }
  });

program
  .command("install-packs")
  .description("Check and report on required dependency packages")
  .option("--pack <name>", "Specific package to check")
  .action(async () => {
    const deps = ["@stacks/transactions", "@stacks/network"];
    const missing: string[] = [];
    for (const dep of deps) {
      try {
        require.resolve(dep);
      } catch {
        missing.push(dep);
      }
    }
    if (missing.length > 0) {
      console.log(
        JSON.stringify({
          status: "success",
          action: `Install missing packages: bun add ${missing.join(" ")}`,
          data: { required: deps, missing, installed: deps.filter((d) => !missing.includes(d)) },
          error: null,
        })
      );
    } else {
      console.log(
        JSON.stringify({
          status: "success",
          action: "All dependencies installed",
          data: { required: deps, missing: [], installed: deps },
          error: null,
        })
      );
    }
  });

program.parse(process.argv);
