#!/usr/bin/env bun
// skills/child-inscription/ordinals-runner.ts
// Internal runner that unlocks the wallet and runs the ordinals CLI in the
// same process. The wallet manager singleton holds unlock state in memory,
// so unlock + inscribe must share a process.
//
// Usage:
//   WALLET_ID=... WALLET_PASSWORD=... bun skills/child-inscription/ordinals-runner.ts inscribe --content-type ... --content-base64 ...

import { getWalletManager } from "../../github/aibtcdev/skills/src/lib/services/wallet-manager.js";

const walletId = process.env.WALLET_ID;
const walletPassword = process.env.WALLET_PASSWORD;

if (!walletId || !walletPassword) {
  console.log(JSON.stringify({ success: false, error: "WALLET_ID and WALLET_PASSWORD env vars required" }));
  process.exit(1);
}

const wm = getWalletManager();

try {
  await wm.unlock(walletId, walletPassword);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(JSON.stringify({ success: false, error: "Unlock failed", detail: msg }));
  process.exit(1);
}

// Override process.argv so Commander in the ordinals script sees our args.
const ordinalsArgs = process.argv.slice(2);
process.argv = ["bun", "ordinals.ts", ...ordinalsArgs];

try {
  await import("../../github/aibtcdev/skills/ordinals/ordinals.ts");
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(JSON.stringify({ success: false, error: "Ordinals command failed", detail: msg }));
  wm.lock();
  process.exit(1);
}

setTimeout(() => {
  wm.lock();
  process.exit(0);
}, 100);
