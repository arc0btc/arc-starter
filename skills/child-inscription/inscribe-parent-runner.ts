#!/usr/bin/env bun
// skills/child-inscription/inscribe-parent-runner.ts
// Creates a standalone inscription (parent) using the wallet.
// Unlocks wallet in-process, builds and broadcasts commit tx, saves state.
//
// Usage:
//   WALLET_ID=... WALLET_PASSWORD=... bun skills/child-inscription/inscribe-parent-runner.ts \
//     commit --content-type "image/png" --content-file ./aibtcnews.png [--fee-rate slow]
//   WALLET_ID=... WALLET_PASSWORD=... bun skills/child-inscription/inscribe-parent-runner.ts \
//     reveal --commit-txid <txid> --reveal-amount <sats>

import { getWalletManager } from "../../github/aibtcdev/skills/src/lib/services/wallet-manager.js";
import { MempoolApi, getMempoolTxUrl } from "../../github/aibtcdev/skills/src/lib/services/mempool-api.js";
import {
  buildCommitTransaction,
  buildRevealTransaction,
  type InscriptionData,
} from "../../src/lib/transactions/inscription-builder.js";
import { signBtcTransaction } from "../../github/aibtcdev/skills/src/lib/transactions/bitcoin-builder.js";
import { NETWORK } from "../../github/aibtcdev/skills/src/lib/config/networks.js";

const walletId = process.env.WALLET_ID;
const walletPassword = process.env.WALLET_PASSWORD;

if (!walletId || !walletPassword) {
  console.log(JSON.stringify({ error: "WALLET_ID and WALLET_PASSWORD env vars required" }));
  process.exit(1);
}

const wm = getWalletManager();
try {
  await wm.unlock(walletId, walletPassword);
} catch (err) {
  console.log(JSON.stringify({ error: "Unlock failed", detail: String(err) }));
  process.exit(1);
}

async function resolveFeeRate(rate: string | undefined, api: MempoolApi): Promise<number> {
  const fees = await api.getFeeEstimates();
  if (!rate || rate === "medium") return fees.halfHourFee;
  if (rate === "fast") return fees.fastestFee;
  if (rate === "slow") return fees.hourFee;
  const n = parseFloat(rate);
  if (isNaN(n) || n <= 0) throw new Error("Invalid fee rate");
  return n;
}

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length) {
      result[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return result;
}

const subcommand = process.argv[2];
const opts = parseArgs(process.argv.slice(3));

try {
  if (subcommand === "commit") {
    const contentType = opts["content-type"];
    const contentFile = opts["content-file"];
    if (!contentType || !contentFile) {
      throw new Error("--content-type and --content-file required");
    }

    const body = await Bun.file(contentFile).arrayBuffer();
    const inscription: InscriptionData = {
      contentType,
      body: new Uint8Array(body),
    };

    const sessionInfo = wm.getSessionInfo();
    if (!sessionInfo?.btcAddress || !sessionInfo?.taprootAddress) {
      throw new Error("Wallet not ready");
    }
    const account = wm.getAccount();
    if (!account?.btcPublicKey || !account?.btcPrivateKey) {
      throw new Error("Keys not available");
    }

    const api = new MempoolApi(NETWORK);
    const feeRate = await resolveFeeRate(opts["fee-rate"], api);

    const utxos = await api.getUtxos(sessionInfo.btcAddress);
    if (utxos.length === 0) throw new Error("No UTXOs available");

    const commitResult = buildCommitTransaction({
      utxos,
      inscription,
      feeRate,
      senderPubKey: account.btcPublicKey,
      senderAddress: sessionInfo.btcAddress,
      network: NETWORK,
    });

    const signed = signBtcTransaction(commitResult.tx, account.btcPrivateKey);
    const txid = await api.broadcastTransaction(signed.txHex);

    // Save state for reveal step
    const state = {
      contentType,
      contentFile,
      commitTxid: txid,
      revealAmount: commitResult.revealAmount,
      feeRate,
      timestamp: new Date().toISOString(),
    };
    await Bun.write(".parent-inscription-state.json", JSON.stringify(state, null, 2));

    console.log(JSON.stringify({
      status: "commit_broadcast",
      commitTxid: txid,
      commitExplorerUrl: getMempoolTxUrl(txid, NETWORK),
      revealAmount: commitResult.revealAmount,
      commitFee: commitResult.fee,
      feeRate,
      contentType,
      contentSize: inscription.body.length,
      nextStep: "Wait for commit to confirm, then run reveal subcommand",
    }, null, 2));
  } else if (subcommand === "reveal") {
    const stateFile = Bun.file(".parent-inscription-state.json");
    if (!await stateFile.exists()) throw new Error("No .parent-inscription-state.json found");
    const state = await stateFile.json();

    const commitTxid = opts["commit-txid"] || state.commitTxid;
    const revealAmount = parseInt(opts["reveal-amount"] || String(state.revealAmount), 10);
    const contentType = state.contentType;
    const contentFile = state.contentFile;

    const body = await Bun.file(contentFile).arrayBuffer();
    const inscription: InscriptionData = { contentType, body: new Uint8Array(body) };

    const sessionInfo = wm.getSessionInfo();
    if (!sessionInfo?.btcAddress || !sessionInfo?.taprootAddress) throw new Error("Wallet not ready");
    const account = wm.getAccount();
    if (!account?.btcPublicKey || !account?.btcPrivateKey) throw new Error("Keys not available");

    const api = new MempoolApi(NETWORK);
    const feeRate = await resolveFeeRate(opts["fee-rate"] || String(state.feeRate), api);

    // Rebuild commit to get the reveal script (deterministic)
    const dummyUtxos = [{
      txid: commitTxid,
      vout: 0,
      value: revealAmount,
      status: { confirmed: true, block_height: 0, block_hash: "", block_time: 0 },
    }];

    const commitResult = buildCommitTransaction({
      utxos: dummyUtxos,
      inscription,
      feeRate,
      senderPubKey: account.btcPublicKey,
      senderAddress: sessionInfo.btcAddress,
      network: NETWORK,
    });

    const revealResult = buildRevealTransaction({
      commitTxid,
      commitVout: 0,
      commitAmount: revealAmount,
      revealScript: commitResult.revealScript,
      recipientAddress: sessionInfo.taprootAddress,
      feeRate,
      network: NETWORK,
    });

    const signed = signBtcTransaction(revealResult.tx, account.btcPrivateKey);
    const revealTxid = await api.broadcastTransaction(signed.txHex);
    const inscriptionId = `${revealTxid}i0`;

    console.log(JSON.stringify({
      status: "success",
      inscriptionId,
      contentType,
      commit: { txid: commitTxid, explorerUrl: getMempoolTxUrl(commitTxid, NETWORK) },
      reveal: { txid: revealTxid, fee: revealResult.fee, explorerUrl: getMempoolTxUrl(revealTxid, NETWORK) },
      recipientAddress: sessionInfo.taprootAddress,
    }, null, 2));
  } else {
    throw new Error(`Unknown subcommand: ${subcommand}. Use 'commit' or 'reveal'.`);
  }
} catch (err) {
  console.log(JSON.stringify({ error: String(err) }));
  process.exit(1);
} finally {
  wm.lock();
}
