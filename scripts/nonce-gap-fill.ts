#!/usr/bin/env bun
/**
 * Fill missing nonce gaps with minimal STX transfers to unblock the mempool queue.
 * Unlike RBF, these nonces have no existing tx — we submit fresh ones.
 *
 * Usage:
 *   bun scripts/nonce-gap-fill.ts [--dry-run]
 */

import { getWalletManager } from "../github/aibtcdev/skills/src/lib/services/wallet-manager.js";
import { makeSTXTokenTransfer, broadcastTransaction } from "@stacks/transactions";
import { getStacksNetwork } from "../github/aibtcdev/skills/src/lib/config/networks.js";
import { getCredential } from "../src/credentials.js";

const RECIPIENT = "SP6BBNM7Q8GKDG2FMKRBZJCJ3SE4BWVC1XPH7KZH"; // funding source
const AMOUNT = 1n; // 1 uSTX — minimal
const NETWORK = "mainnet";
const FEE = 5000n; // 5000 uSTX — reasonable fee to confirm quickly
const DRY_RUN = process.argv.includes("--dry-run");

// SP1K (our wallet / x402 sender) has nonce 38 missing, blocking 39-42.
// Task #366 referenced SP2G but that's not our wallet — x402 uses SP1K.
const MISSING_NONCES = [38];

// ---- Unlock wallet ----
const walletId = process.env.WALLET_ID || await getCredential("bitcoin-wallet", "id");
const walletPassword = process.env.WALLET_PASSWORD || await getCredential("bitcoin-wallet", "password");

if (!walletId || !walletPassword) {
  console.error("Wallet credentials not found. Set WALLET_ID/WALLET_PASSWORD env vars or store in arc creds (bitcoin-wallet/id, bitcoin-wallet/password)");
  process.exit(1);
}

const wm = getWalletManager();
try {
  await wm.unlock(walletId, walletPassword);
  console.log("Wallet unlocked");
} catch (err) {
  console.error("Unlock failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}

const account = wm.getAccount() as { address: string; privateKey: string; network: string };
const networkName = getStacksNetwork(NETWORK);

console.log(`\nSender: ${account.address}`);
console.log(`Recipient: ${RECIPIENT}`);
console.log(`Amount per tx: ${AMOUNT} uSTX`);
console.log(`Fee per tx: ${FEE} uSTX`);
console.log(`Gap nonces to fill: ${MISSING_NONCES.join(", ")}`);
console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

const results: Array<{ nonce: number; txid?: string; error?: string }> = [];

for (const nonce of MISSING_NONCES) {
  if (DRY_RUN) {
    console.log(`[DRY RUN] nonce=${nonce} fee=${FEE}`);
    results.push({ nonce });
    continue;
  }

  try {
    const transaction = await makeSTXTokenTransfer({
      recipient: RECIPIENT,
      amount: AMOUNT,
      senderKey: account.privateKey,
      network: networkName,
      memo: `nonce-gap-fill-n${nonce}`,
      fee: FEE,
      nonce: BigInt(nonce),
    });

    const broadcastResult = await broadcastTransaction({ transaction, network: networkName });

    if ("error" in broadcastResult) {
      const errMsg = typeof broadcastResult.error === "string"
        ? broadcastResult.error
        : JSON.stringify(broadcastResult);
      console.log(`  nonce=${nonce} ERROR: ${errMsg}`);
      results.push({ nonce, error: errMsg });
    } else {
      const txid = typeof broadcastResult === "string" ? broadcastResult : broadcastResult.txid;
      console.log(`  nonce=${nonce} txid=${txid}`);
      results.push({ nonce, txid });
    }

    // Small delay between broadcasts
    await new Promise((r) => setTimeout(r, 500));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  nonce=${nonce} FAILED: ${msg}`);
    results.push({ nonce, error: msg });
  }
}

wm.lock();

// Summary
const succeeded = results.filter((r) => r.txid);
const failed = results.filter((r) => r.error);

console.log(`\n--- Summary ---`);
console.log(`Broadcast: ${succeeded.length}/${MISSING_NONCES.length}`);
if (failed.length > 0) {
  console.log(`Failed: ${failed.length}`);
  for (const f of failed) {
    console.log(`  nonce=${f.nonce}: ${f.error}`);
  }
}
if (succeeded.length > 0) {
  console.log(`\nGap-fill txids:`);
  for (const s of succeeded) {
    console.log(`  nonce=${s.nonce}: ${s.txid}`);
  }
}

process.exit(failed.length > 0 ? 1 : 0);
