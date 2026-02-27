#!/usr/bin/env bun
// skills/wallet/sign-runner.ts
// Internal runner that unlocks the wallet and runs a signing command in the
// same process. The wallet manager singleton holds unlock state in memory,
// so unlock + sign must share a process.
//
// Usage (called by cli.ts, not directly):
//   WALLET_ID=... WALLET_PASSWORD=... bun skills/wallet/sign-runner.ts <signing-args...>
//
// Example:
//   WALLET_ID=abc WALLET_PASSWORD=pw bun skills/wallet/sign-runner.ts btc-sign --message "Hello"

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
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(JSON.stringify({ success: false, error: "Unlock failed", detail: msg }));
  process.exit(1);
}

// Override process.argv so Commander in the signing script sees our args.
// Commander expects: [execPath, scriptPath, ...commands]
const signingArgs = process.argv.slice(2); // everything after sign-runner.ts
process.argv = ["bun", "signing.ts", ...signingArgs];

// Dynamically import the signing script. It calls program.parse(process.argv)
// at module level, which will now see our overridden argv.
try {
  await import("../../github/aibtcdev/skills/signing/signing.ts");
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(JSON.stringify({ success: false, error: "Signing failed", detail: msg }));
  wm.lock();
  process.exit(1);
}

// Lock after signing completes. Small delay to let Commander's async action finish.
// Commander actions are async and may not have completed by the time the import resolves.
setTimeout(() => {
  wm.lock();
  process.exit(0);
}, 100);
