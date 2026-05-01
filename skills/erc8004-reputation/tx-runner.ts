#!/usr/bin/env bun
// skills/erc8004-reputation/tx-runner.ts
// Internal runner that unlocks the wallet and runs a reputation command in the
// same process. The wallet manager singleton holds unlock state in memory,
// so unlock + tx must share a process.
//
// Usage (called by cli.ts, not directly):
//   WALLET_ID=... WALLET_PASSWORD=... bun skills/erc8004-reputation/tx-runner.ts give-feedback --agent-id 5 --value 1

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

// Override process.argv so Commander in reputation.ts sees our args
const txArgs = process.argv.slice(2);
process.argv = ["bun", "reputation.ts", ...txArgs];

// Monkey-patch Commander's parse() to use parseAsync()
// @ts-ignore — no type declarations for bundled commander
const { Command } = await import("../../github/aibtcdev/skills/node_modules/commander/index.js");
let parseResult: Promise<unknown> | null = null;
const origParse = Command.prototype.parse;
Command.prototype.parse = function (this: InstanceType<typeof Command>, ...args: unknown[]) {
  parseResult = this.parseAsync(...(args as [string[]?, object?]));
  return this;
};

try {
  await import("../../github/aibtcdev/skills/reputation/reputation.ts");
  if (parseResult) {
    await parseResult;
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(JSON.stringify({ success: false, error: "Reputation command failed", detail: msg }));
  wm.lock();
  process.exit(1);
} finally {
  Command.prototype.parse = origParse;
}

wm.lock();
process.exit(0);
