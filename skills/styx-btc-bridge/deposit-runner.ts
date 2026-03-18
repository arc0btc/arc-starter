#!/usr/bin/env bun
// skills/styx/deposit-runner.ts
// Internal runner that unlocks the wallet and runs the styx deposit command
// in the same process. The wallet manager singleton holds unlock state in memory,
// so unlock + deposit must share a process.
//
// Usage (called by cli.ts, not directly):
//   WALLET_ID=... WALLET_PASSWORD=... bun skills/styx/deposit-runner.ts deposit --amount 50000 --fee medium

import { getWalletManager } from "../../github/aibtcdev/skills/src/lib/services/wallet-manager.js";

const walletId = process.env.WALLET_ID;
const walletPassword = process.env.WALLET_PASSWORD;

if (!walletId || !walletPassword) {
  console.log(
    JSON.stringify({
      success: false,
      error: "WALLET_ID and WALLET_PASSWORD env vars required",
    })
  );
  process.exit(1);
}

// Unlock wallet manager singleton
const wm = getWalletManager();

try {
  await wm.unlock(walletId, walletPassword);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(
    JSON.stringify({ success: false, error: "Unlock failed", detail: msg })
  );
  process.exit(1);
}

// Override process.argv so Commander in styx.ts sees our args
const depositArgs = process.argv.slice(2);
process.argv = ["bun", "styx.ts", ...depositArgs];

// Monkey-patch Commander's parse() to use parseAsync()
const { Command } = await import(
  "../../github/aibtcdev/skills/node_modules/commander/index.js"
);
let parseResult: Promise<unknown> | null = null;
const origParse = Command.prototype.parse;
Command.prototype.parse = function (
  this: InstanceType<typeof Command>,
  ...args: unknown[]
) {
  parseResult = this.parseAsync(...(args as [string[]?, object?]));
  return this;
};

try {
  await import("../../github/aibtcdev/skills/styx/styx.ts");
  if (parseResult) {
    await parseResult;
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(
    JSON.stringify({
      success: false,
      error: "Styx deposit command failed",
      detail: msg,
    })
  );
  wm.lock();
  process.exit(1);
} finally {
  Command.prototype.parse = origParse;
}

wm.lock();
process.exit(0);
