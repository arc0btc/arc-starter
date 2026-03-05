#!/usr/bin/env bun
// skills/bitcoin-taproot-multisig/taproot-runner.ts
// Internal runner that unlocks the wallet and retrieves the Taproot pubkey
// in the same process. The wallet manager singleton holds unlock state in
// memory, so unlock + key derivation must share a process.
//
// Usage (called by cli.ts, not directly):
//   WALLET_ID=... WALLET_PASSWORD=... bun skills/bitcoin-taproot-multisig/taproot-runner.ts get-pubkey

import { getWalletManager } from "../../github/aibtcdev/skills/src/lib/services/wallet-manager.js";
import { NETWORK } from "../../github/aibtcdev/skills/src/lib/config/networks.js";
import { hex } from "../../github/aibtcdev/skills/node_modules/@scure/base/index.js";

const walletId = process.env.WALLET_ID;
const walletPassword = process.env.WALLET_PASSWORD;

if (!walletId || !walletPassword) {
  console.log(JSON.stringify({ success: false, error: "WALLET_ID and WALLET_PASSWORD env vars required" }));
  process.exit(1);
}

const command = process.argv[2];

if (command !== "get-pubkey") {
  console.log(JSON.stringify({ success: false, error: `Unknown command: ${command}. Only get-pubkey is supported.` }));
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

try {
  const account = wm.getAccount();

  if (!account) {
    throw new Error("Wallet unlocked but no active account found.");
  }
  if (!account.taprootPublicKey || !account.taprootAddress) {
    throw new Error("Taproot keys not available. Ensure the wallet has Taproot key derivation.");
  }

  const internalPubKey = hex.encode(account.taprootPublicKey);
  const derivationPath = NETWORK === "mainnet" ? "m/86'/0'/0'/0/0" : "m/86'/1'/0'/0/0";

  console.log(JSON.stringify({
    success: true,
    internalPubKey,
    taprootAddress: account.taprootAddress,
    network: NETWORK,
    keyFormat: "x-only (32 bytes)",
    derivationPath,
    usage: "Register 'internalPubKey' when joining a multisig. Sign proposals with: arc skills run --name wallet -- schnorr-sign-digest --digest <sighash> --confirm-blind-sign",
    warning: "Always register internalPubKey, NOT the tweaked key. The tweaked key is embedded in the bc1p address and requires different signing logic.",
  }));
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(JSON.stringify({ success: false, error: "get-pubkey failed", detail: msg }));
  wm.lock();
  process.exit(1);
}

wm.lock();
process.exit(0);
