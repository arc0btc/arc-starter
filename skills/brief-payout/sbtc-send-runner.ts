#!/usr/bin/env bun
// skills/brief-payout/sbtc-send-runner.ts
// Internal runner that unlocks the wallet and sends sBTC in the same process.
// The wallet manager singleton holds unlock state in memory, so unlock + send
// must share a process.
//
// Usage (called by cli.ts, not directly):
//   WALLET_ID=... WALLET_PASSWORD=... bun skills/brief-payout/sbtc-send-runner.ts \
//     --recipient SP... --amount-sats 30000 [--memo "payout 2026-03-25"]

import { getWalletManager } from "../../github/aibtcdev/skills/src/lib/services/wallet-manager.js";
import { getSbtcService } from "../../src/lib/services/sbtc.service.ts";
import type { Account } from "../../github/aibtcdev/skills/src/lib/transactions/builder.js";

const walletId = process.env.WALLET_ID;
const walletPassword = process.env.WALLET_PASSWORD;

if (!walletId || !walletPassword) {
  console.log(JSON.stringify({ success: false, error: "WALLET_ID and WALLET_PASSWORD env vars required" }));
  process.exit(1);
}

// Parse flags
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

const flags = parseFlags(process.argv.slice(2));

if (!flags.recipient || !flags["amount-sats"]) {
  console.log(JSON.stringify({ success: false, error: "Missing required flags: --recipient and --amount-sats" }));
  process.exit(1);
}

const recipient = flags.recipient;
const amountSats = parseInt(flags["amount-sats"], 10);

if (isNaN(amountSats) || amountSats <= 0) {
  console.log(JSON.stringify({ success: false, error: `Invalid amount: ${flags["amount-sats"]}. Must be a positive integer (sats).` }));
  process.exit(1);
}

// Validate recipient address format (Stacks address for SIP-010 transfer)
if (!recipient.startsWith("SP") && !recipient.startsWith("ST")) {
  console.log(JSON.stringify({ success: false, error: "Invalid recipient address: must start with SP (mainnet) or ST (testnet)" }));
  process.exit(1);
}

const memo = flags.memo || "";

// Unlock wallet manager singleton
const wm = getWalletManager();

try {
  await wm.unlock(walletId, walletPassword);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(JSON.stringify({ success: false, error: "Unlock failed", detail: msg }));
  process.exit(1);
}

try {
  const account = wm.getAccount() as Account;
  const sbtcService = getSbtcService("mainnet");

  // sBTC uses 8 decimals = sats, so BigInt(amountSats) maps directly
  const result = await sbtcService.transfer(
    account,
    recipient,
    BigInt(amountSats),
    memo || undefined,
  );

  console.log(JSON.stringify({
    success: true,
    txid: result.txid,
    recipient,
    amount_sats: amountSats,
    explorer: `https://explorer.hiro.so/txid/${result.txid}?chain=mainnet`,
  }));
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(JSON.stringify({ success: false, error: "sBTC transfer failed", detail: msg }));
} finally {
  wm.lock();
  process.exit(0);
}
