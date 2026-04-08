#!/usr/bin/env bun
// skills/defi-zest/tx-runner.ts
// Internal runner that unlocks the wallet and runs a Zest command in the
// same process. The wallet manager singleton holds unlock state in memory,
// so unlock + tx must share a process.
//
// Nonce serialization: acquires a nonce from the shared nonce-tracker before
// running the defi command, then injects it via --nonce so all Zest write ops
// coordinate with STX sends (stx-send-runner) through the same file-locked
// nonce state at ~/.aibtc/nonce-state.json.
//
// Usage (called by cli.ts, not directly):
//   WALLET_ID=... WALLET_PASSWORD=... bun skills/defi-zest/tx-runner.ts zest-supply --asset sBTC --amount 8200

import { getWalletManager } from "../../github/aibtcdev/skills/src/lib/services/wallet-manager.js";
import { acquireNonce, syncNonce } from "../../github/aibtcdev/skills/src/lib/services/nonce-tracker.js";
import type { Account } from "../../github/aibtcdev/skills/src/lib/transactions/builder.js";

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

// Determine if this is a write command that broadcasts an STX transaction.
// Read-only commands (zest-get-position, zest-list-assets, etc.) skip nonce acquisition.
const WRITE_COMMANDS = new Set([
  "zest-supply", "zest-withdraw", "zest-borrow", "zest-repay", "zest-claim-rewards",
  "alex-run-swap",
]);
const command = process.argv[2];
const isWriteCommand = command !== undefined && WRITE_COMMANDS.has(command);

// Acquire nonce before running the defi command so all STX-sending paths
// coordinate through the shared nonce-tracker file lock.
let acquiredNonce: number | undefined;
if (isWriteCommand) {
  try {
    const account = wm.getAccount() as Account;
    const acquired = await acquireNonce(account.address);
    acquiredNonce = acquired.nonce;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ success: false, error: "Nonce acquisition failed", detail: msg }));
    wm.lock();
    process.exit(1);
  }
}

// Override process.argv so Commander in defi.ts sees our args.
// Append --nonce so the Zest command passes it through to callContract.
const txArgs = process.argv.slice(2);
if (acquiredNonce !== undefined) {
  txArgs.push("--nonce", acquiredNonce.toString());
}
process.argv = ["bun", "defi.ts", ...txArgs];

// Monkey-patch Commander's parse() to use parseAsync()
const { Command } = await import("../../github/aibtcdev/skills/node_modules/commander/index.js");
let parseResult: Promise<unknown> | null = null;
const origParse = Command.prototype.parse;
Command.prototype.parse = function (this: InstanceType<typeof Command>, ...args: unknown[]) {
  parseResult = this.parseAsync(...(args as [string[]?, object?]));
  return this;
};

try {
  await import("../../github/aibtcdev/skills/defi/defi.ts");
  if (parseResult) {
    await parseResult;
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(JSON.stringify({ success: false, error: "Zest command failed", detail: msg }));
  // Sync nonce-tracker from Hiro on failure: we don't know if the tx was
  // broadcast before the error, so a fresh sync is safer than guessing.
  if (acquiredNonce !== undefined) {
    try {
      const account = wm.getAccount() as Account;
      await syncNonce(account.address);
    } catch {
      // Best effort — nonce-tracker auto-recovers after STALE_NONCE_MS (90s)
    }
  }
  wm.lock();
  process.exit(1);
} finally {
  Command.prototype.parse = origParse;
}

wm.lock();
process.exit(0);
