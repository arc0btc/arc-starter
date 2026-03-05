#!/usr/bin/env bun
// skills/bitcoin-wallet/bns-runner.ts
// Internal runner that unlocks the wallet and runs a BNS command in the
// same process. The wallet manager singleton holds unlock state in memory,
// so unlock + BNS write ops must share a process.
//
// Usage (called by cli.ts, not directly):
//   WALLET_ID=... WALLET_PASSWORD=... bun skills/bitcoin-wallet/bns-runner.ts <bns-args...>
//
// Example:
//   WALLET_ID=abc WALLET_PASSWORD=pw bun skills/bitcoin-wallet/bns-runner.ts claim-fast --name alice --send-to SP...

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

// Override process.argv so Commander in bns.ts sees our args.
// Commander expects: [execPath, scriptPath, ...commands]
const bnsArgs = process.argv.slice(2); // everything after bns-runner.ts
process.argv = ["bun", "bns.ts", ...bnsArgs];

// Monkey-patch Commander's parse() to use parseAsync() so we can await the
// async action. bns.ts calls program.parse() at module level which starts
// the async action but never awaits it. Without this patch, the process exits
// before network requests complete.
const { Command } = await import("../../github/aibtcdev/skills/node_modules/commander/index.js");
let parseResult: Promise<unknown> | null = null;
const origParse = Command.prototype.parse;
Command.prototype.parse = function (this: InstanceType<typeof Command>, ...args: unknown[]) {
  parseResult = this.parseAsync(...(args as [string[]?, object?]));
  return this;
};

// Dynamically import the BNS script. It calls program.parse(process.argv)
// at module level, which now uses our patched parseAsync.
try {
  await import("../../github/aibtcdev/skills/bns/bns.ts");
  // Wait for the async Commander action to complete (network calls, etc.)
  if (parseResult) {
    await parseResult;
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(JSON.stringify({ success: false, error: "BNS command failed", detail: msg }));
  wm.lock();
  process.exit(1);
} finally {
  // Restore original parse
  Command.prototype.parse = origParse;
}

wm.lock();
process.exit(0);
