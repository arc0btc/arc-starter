#!/usr/bin/env bun
// skills/defi-stacks-market/trade-runner.ts
// Internal runner that unlocks the wallet and runs a stacks-market trading
// command in the same process. The wallet manager singleton holds unlock state
// in memory, so unlock + trade must share a process.
//
// Usage (called by cli.ts, not directly):
//   WALLET_ID=... WALLET_PASSWORD=... bun skills/defi-stacks-market/trade-runner.ts buy-yes --market-id 123 --amount 5 --max-cost 6000000
//
// Follows the same pattern as skills/bitcoin-wallet/x402-runner.ts.

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

// Override process.argv so Commander in stacks-market.ts sees our args.
const tradeArgs = process.argv.slice(2);
process.argv = ["bun", "stacks-market.ts", ...tradeArgs];

// Monkey-patch Commander's parse() to use parseAsync() so we can await the
// async action. stacks-market.ts calls program.parse(process.argv) at module
// level which starts the async action but never awaits it.
// @ts-ignore — no type declarations for bundled commander
const { Command } = await import("../../github/aibtcdev/skills/node_modules/commander/index.js");
let parseResult: Promise<unknown> | null = null;
const origParse = Command.prototype.parse;
Command.prototype.parse = function (this: InstanceType<typeof Command>, ...args: unknown[]) {
  parseResult = this.parseAsync(...(args as [string[]?, object?]));
  return this;
};

try {
  // @ts-ignore — stacks-market module in external repo
  await import("../../github/aibtcdev/skills/defi-stacks-market/stacks-market.ts");
  if (parseResult) {
    await parseResult;
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(JSON.stringify({ success: false, error: "Trade command failed", detail: msg }));
  wm.lock();
  process.exit(1);
} finally {
  Command.prototype.parse = origParse;
}

wm.lock();
process.exit(0);
