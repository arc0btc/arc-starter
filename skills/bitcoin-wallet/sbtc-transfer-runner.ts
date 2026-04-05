#!/usr/bin/env bun
// skills/bitcoin-wallet/sbtc-transfer-runner.ts
// Internal runner that unlocks the wallet and transfers sBTC in the same process.
// The wallet manager singleton holds unlock state in memory, so unlock + transfer
// must share a process.
//
// Usage (called by cli.ts, not directly):
//   WALLET_ID=... WALLET_PASSWORD=... bun skills/bitcoin-wallet/sbtc-transfer-runner.ts --recipient SP... --amount 100000 [--memo "text"] [--sponsored]

import { getWalletManager } from "../../github/aibtcdev/skills/src/lib/services/wallet-manager.js";
import { getSbtcService } from "../../github/aibtcdev/skills/src/lib/services/sbtc.service.js";
import type { Account } from "../../github/aibtcdev/skills/src/lib/transactions/builder.js";

const walletId = process.env.WALLET_ID;
const walletPassword = process.env.WALLET_PASSWORD;
const network = (process.env.NETWORK || "mainnet") as "mainnet" | "testnet";

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

if (!flags.recipient || !flags.amount) {
  console.log(JSON.stringify({ success: false, error: "Missing required flags: --recipient and --amount" }));
  process.exit(1);
}

const recipient = flags.recipient;
const amountSats = BigInt(flags.amount);

if (amountSats <= 0n) {
  console.log(JSON.stringify({ success: false, error: `Invalid amount: ${flags.amount}. Must be a positive integer (satoshis).` }));
  process.exit(1);
}

// Validate recipient address format (basic check for Stacks addresses)
if (!recipient.startsWith("SP") && !recipient.startsWith("ST")) {
  console.log(JSON.stringify({ success: false, error: `Invalid recipient address: must start with SP (mainnet) or ST (testnet)` }));
  process.exit(1);
}

const memo = flags.memo || undefined;
const sponsored = flags.sponsored === "true";

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
  const sbtcService = getSbtcService(network);

  const result = await sbtcService.transfer(
    account,
    recipient,
    amountSats,
    memo,
    undefined, // fee — let the service auto-estimate
    sponsored
  );

  const btcAmount = Number(amountSats) / 100_000_000;

  console.log(JSON.stringify({
    success: true,
    txid: result.txid,
    from: account.address,
    recipient,
    amount_sbtc: btcAmount.toFixed(8) + " sBTC",
    amount_sats: amountSats.toString(),
    memo: memo || undefined,
    sponsored,
    explorer: `https://explorer.hiro.so/txid/${result.txid}?chain=${network}`,
  }));
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(JSON.stringify({ success: false, error: "sBTC transfer failed", detail: msg }));
} finally {
  wm.lock();
  process.exit(0);
}
