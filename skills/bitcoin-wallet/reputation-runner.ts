#!/usr/bin/env bun
// skills/bitcoin-wallet/reputation-runner.ts
// Internal runner that unlocks the wallet and runs a reputation command in the
// same process.

import { getWalletManager } from "../../github/aibtcdev/skills/src/lib/services/wallet-manager.js";

const walletId = process.env.WALLET_ID;
const walletPassword = process.env.WALLET_PASSWORD;

if (!walletId || !walletPassword) {
  console.log(JSON.stringify({ success: false, error: "WALLET_ID and WALLET_PASSWORD env vars required" }));
  process.exit(1);
}

// Unlock wallet manager singleton
const wm = getWalletManager();

try {
  await wm.unlock(walletId, walletPassword);
  console.error("[DEBUG] Wallet unlocked successfully");
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(JSON.stringify({ success: false, error: "Unlock failed", detail: msg }));
  process.exit(1);
}

// Override process.argv
const reputationArgs = process.argv.slice(2);
process.argv = ["bun", "reputation.ts", ...reputationArgs];

console.error(`[DEBUG] Executing reputation with args: ${reputationArgs.join(" ")}`);

// Change to skills directory
process.chdir(process.env.HOME + "/github/aibtcdev/skills");

// Create a completion signal
let actionCompleted = false;
const originalLog = console.log;
const originalError = console.error;

// Intercept console.log to detect when action output is produced
console.log = function(...args: any[]) {
  actionCompleted = true;
  originalLog.apply(console, args);
};

console.error = function(...args: any[]) {
  originalError.apply(console, args);
};

try {
  // Import the reputation module - this will trigger Commander.parse()
  const repModule = await import("../../github/aibtcdev/skills/reputation/reputation.ts");
  console.error("[DEBUG] Reputation module imported");

  // Wait for async action to potentially complete
  // Give it up to 5 seconds to produce output
  for (let i = 0; i < 50; i++) {
    if (actionCompleted) {
      console.error("[DEBUG] Action output detected");
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  if (!actionCompleted) {
    console.error("[DEBUG] No action output after 5 seconds");
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[DEBUG] Error: ${msg}`);
  originalLog(JSON.stringify({ success: false, error: "Reputation operation failed", detail: msg }));
}

// Lock and exit
wm.lock();
process.exit(0);
