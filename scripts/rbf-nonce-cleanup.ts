#!/usr/bin/env bun
/**
 * One-off script: RBF stuck mempool transactions (nonces 21-37) with minimal
 * STX transfers to the funding source. Each replacement tx uses fee = original + 1.
 *
 * Usage:
 *   WALLET_ID=... WALLET_PASSWORD=... bun scripts/rbf-nonce-cleanup.ts [--dry-run]
 */

import { getWalletManager } from "../github/aibtcdev/skills/src/lib/services/wallet-manager.js";
import { makeSTXTokenTransfer, broadcastTransaction } from "@stacks/transactions";
import { getStacksNetwork } from "../github/aibtcdev/skills/src/lib/config/networks.js";

const RECIPIENT = "SP6BBNM7Q8GKDG2FMKRBZJCJ3SE4BWVC1XPH7KZH"; // funding source
const AMOUNT = 1n; // 1 uSTX — minimal
const NETWORK = "mainnet";
const DRY_RUN = process.argv.includes("--dry-run");

// Stuck pending txs: nonce -> original fee (uSTX)
const STUCK_TXS: Array<{ nonce: number; originalFee: number }> = [
  { nonce: 21, originalFee: 3000 },
  { nonce: 22, originalFee: 368 },
  { nonce: 23, originalFee: 331 },
  { nonce: 24, originalFee: 331 },
  { nonce: 25, originalFee: 352 },
  { nonce: 26, originalFee: 352 },
  { nonce: 27, originalFee: 352 },
  { nonce: 28, originalFee: 352 },
  { nonce: 29, originalFee: 331 },
  { nonce: 30, originalFee: 4271 },
  { nonce: 31, originalFee: 4271 },
  { nonce: 32, originalFee: 3385 },
  { nonce: 33, originalFee: 1812 },
  { nonce: 34, originalFee: 1812 },
  { nonce: 35, originalFee: 1812 },
  { nonce: 36, originalFee: 1135 },
  { nonce: 37, originalFee: 1135 },
];

// ---- Unlock wallet ----
import { getCredential } from "../src/credentials.js";

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
console.log(`Txs to RBF: ${STUCK_TXS.length} (nonces ${STUCK_TXS[0].nonce}-${STUCK_TXS[STUCK_TXS.length - 1].nonce})`);
console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

const results: Array<{ nonce: number; fee: number; txid?: string; error?: string }> = [];

for (const { nonce, originalFee } of STUCK_TXS) {
  const newFee = BigInt(originalFee + 1);

  if (DRY_RUN) {
    console.log(`[DRY RUN] nonce=${nonce} fee=${newFee} (was ${originalFee})`);
    results.push({ nonce, fee: Number(newFee) });
    continue;
  }

  try {
    const transaction = await makeSTXTokenTransfer({
      recipient: RECIPIENT,
      amount: AMOUNT,
      senderKey: account.privateKey,
      network: networkName,
      memo: `rbf-cleanup-n${nonce}`,
      fee: newFee,
      nonce: BigInt(nonce),
    });

    const broadcastResult = await broadcastTransaction({ transaction, network: networkName });

    if ("error" in broadcastResult) {
      const errMsg = typeof broadcastResult.error === "string"
        ? broadcastResult.error
        : JSON.stringify(broadcastResult);
      console.log(`  nonce=${nonce} fee=${newFee} ERROR: ${errMsg}`);
      results.push({ nonce, fee: Number(newFee), error: errMsg });
    } else {
      const txid = typeof broadcastResult === "string" ? broadcastResult : broadcastResult.txid;
      console.log(`  nonce=${nonce} fee=${newFee} txid=${txid}`);
      results.push({ nonce, fee: Number(newFee), txid });
    }

    // Small delay between broadcasts to avoid hammering the node
    await new Promise((r) => setTimeout(r, 500));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  nonce=${nonce} fee=${newFee} FAILED: ${msg}`);
    results.push({ nonce, fee: Number(newFee), error: msg });
  }
}

wm.lock();

// Summary
const succeeded = results.filter((r) => r.txid);
const failed = results.filter((r) => r.error);

console.log(`\n--- Summary ---`);
console.log(`Broadcast: ${succeeded.length}/${STUCK_TXS.length}`);
if (failed.length > 0) {
  console.log(`Failed: ${failed.length}`);
  for (const f of failed) {
    console.log(`  nonce=${f.nonce}: ${f.error}`);
  }
}
if (succeeded.length > 0) {
  console.log(`\nNext available nonce: ${STUCK_TXS[STUCK_TXS.length - 1].nonce + 1}`);
}

process.exit(failed.length > 0 ? 1 : 0);
