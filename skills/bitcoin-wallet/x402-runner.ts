#!/usr/bin/env bun
// skills/bitcoin-wallet/x402-runner.ts
// Internal runner that unlocks the wallet and runs an x402 command in the
// same process. The wallet manager singleton holds unlock state in memory,
// so unlock + x402 must share a process.
//
// Nonce oracle integration: for send-inbox-message, acquires a nonce from the
// oracle and injects --nonce unless the caller already passed one. This prevents
// dual-nonce-source drift between the oracle and direct Hiro fetches.
//
// Usage (called by cli.ts, not directly):
//   WALLET_ID=... WALLET_PASSWORD=... bun skills/bitcoin-wallet/x402-runner.ts <x402-args...>

import { getWalletManager } from "../../github/aibtcdev/skills/src/lib/services/wallet-manager.js";
import { acquireNonce, releaseNonce } from "../nonce-manager/nonce-store.js";

const SENDER_STX = "SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM";

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

// Override process.argv so Commander in x402.ts sees our args.
// Commander expects: [execPath, scriptPath, ...commands]
const x402Args = process.argv.slice(2); // everything after x402-runner.ts
const command = x402Args[0];
const hasNonceFlag = x402Args.includes("--nonce");

// Acquire nonce from oracle for send-inbox-message when caller didn't pass --nonce
let acquiredNonce: { nonce: number; address: string } | null = null;
if (command === "send-inbox-message" && !hasNonceFlag) {
  acquiredNonce = await acquireNonce(SENDER_STX);
  x402Args.push("--nonce", acquiredNonce.nonce.toString());
}

process.argv = ["bun", "x402.ts", ...x402Args];

// Monkey-patch Commander's parse() to use parseAsync() so we can await the
// async action. x402.ts calls program.parse() at module level which starts
// the async action but never awaits it. Without this patch, the process exits
// before the network request completes.
const { Command } = await import("../../github/aibtcdev/skills/node_modules/commander/index.js");
let parseResult: Promise<unknown> | null = null;
const origParse = Command.prototype.parse;
Command.prototype.parse = function (this: InstanceType<typeof Command>, ...args: unknown[]) {
  parseResult = this.parseAsync(...(args as [string[]?, object?]));
  return this;
};

// Dynamically import the x402 script. It calls program.parse(process.argv)
// at module level, which now uses our patched parseAsync.
let exitCode = 0;
try {
  await import("../../github/aibtcdev/skills/x402/x402.ts");
  // Wait for the async Commander action to complete (network calls, etc.)
  if (parseResult) {
    await parseResult;
  }
} catch (err) {
  exitCode = 1;
  const msg = err instanceof Error ? err.message : String(err);
  console.log(JSON.stringify({ success: false, error: "x402 command failed", detail: msg }));
} finally {
  // Restore original parse
  Command.prototype.parse = origParse;

  // Release nonce if we acquired one
  if (acquiredNonce) {
    const success = exitCode === 0;
    await releaseNonce(SENDER_STX, acquiredNonce.nonce, success, success ? undefined : "broadcast");
  }
}

wm.lock();
process.exit(exitCode);
