#!/usr/bin/env bun
/**
 * CPFP bump script — spend an unconfirmed change output with enough fee
 * to pull the parent tx above minimum relay fee rate.
 *
 * Usage: bun run scripts/cpfp-bump.ts --parent-txid <txid> --vout <n> --target-rate <sat/vB>
 */

import * as btc from "@scure/btc-signer";
import { Command } from "commander";
import { NETWORK } from "../src/lib/config/networks.js";
import { MempoolApi, getMempoolTxUrl } from "../src/lib/services/mempool-api.js";
import { getWalletManager } from "../src/lib/services/wallet-manager.js";
import {
  P2WPKH_INPUT_VBYTES,
  P2WPKH_OUTPUT_VBYTES,
  TX_OVERHEAD_VBYTES,
} from "../src/lib/config/bitcoin-constants.js";
import { printJson, handleError } from "../src/lib/utils/cli.js";

const program = new Command();

program
  .name("cpfp-bump")
  .description("CPFP: spend an unconfirmed change UTXO to bump the parent tx fee rate")
  .requiredOption("--parent-txid <txid>", "Txid of the stuck parent transaction")
  .requiredOption("--vout <n>", "Output index of the change output to spend", "1")
  .option("--target-rate <sat/vB>", "Target effective fee rate for the package", "3")
  .option("--dry-run", "Calculate fees without broadcasting")
  .action(async (opts: { parentTxid: string; vout: string; targetRate: string; dryRun?: boolean }) => {
    try {
      const parentTxid = opts.parentTxid;
      const vout = parseInt(opts.vout, 10);
      const targetRate = parseFloat(opts.targetRate);

      if (!/^[0-9a-fA-F]{64}$/.test(parentTxid)) {
        throw new Error("--parent-txid must be a 64-character hex string");
      }
      if (isNaN(vout) || vout < 0) throw new Error("--vout must be a non-negative integer");
      if (isNaN(targetRate) || targetRate <= 0) throw new Error("--target-rate must be positive");

      // Wallet auto-restore
      const walletManager = getWalletManager();
      let sessionInfo = walletManager.getSessionInfo();
      if (!sessionInfo) {
        const activeId = await walletManager.getActiveWalletId();
        if (activeId) {
          await walletManager.restoreSessionFromDisk(activeId);
          sessionInfo = walletManager.getSessionInfo();
        }
      }
      if (!sessionInfo) throw new Error("Wallet not unlocked.");

      const account = walletManager.getAccount();
      if (!account?.btcPrivateKey || !account?.btcPublicKey) {
        throw new Error("BTC keys not available. Wallet may not be unlocked.");
      }

      const mempoolApi = new MempoolApi(NETWORK);

      // Fetch all UTXOs for wallet address (includes unconfirmed)
      const allUtxos = await mempoolApi.getUtxos(sessionInfo.btcAddress);
      const cpfpUtxo = allUtxos.find(
        (u) => u.txid === parentTxid && u.vout === vout
      );
      if (!cpfpUtxo) {
        throw new Error(
          `UTXO ${parentTxid}:${vout} not found in address ${sessionInfo.btcAddress}. ` +
          `Found ${allUtxos.length} UTXOs total.`
        );
      }

      // Fetch parent tx to get its vsize and fee
      const parentTxResp = await fetch(
        `https://mempool.space/api/tx/${parentTxid}`
      );
      if (!parentTxResp.ok) throw new Error(`Failed to fetch parent tx: ${parentTxResp.status}`);
      const parentTx = (await parentTxResp.json()) as {
        status: { confirmed: boolean };
        weight: number;
        fee: number;
      };

      if (parentTx.status.confirmed) {
        printJson({ status: "already_confirmed", message: "Parent tx is already confirmed. No CPFP needed." });
        return;
      }

      const parentVsize = Math.ceil(parentTx.weight / 4);
      const parentFee = parentTx.fee;

      // Child tx size: 1 P2WPKH input, 1 P2WPKH output
      const childVsize = Math.ceil(
        TX_OVERHEAD_VBYTES + P2WPKH_INPUT_VBYTES + P2WPKH_OUTPUT_VBYTES
      );

      // Calculate required child fee for target effective rate
      const packageVsize = parentVsize + childVsize;
      const totalFeeNeeded = Math.ceil(packageVsize * targetRate);
      const childFee = Math.max(totalFeeNeeded - parentFee, childVsize); // At least 1 sat/vB for child itself
      const childOutput = cpfpUtxo.value - childFee;

      if (childOutput < 546) {
        throw new Error(
          `Child output (${childOutput} sats) would be below dust threshold. ` +
          `UTXO value: ${cpfpUtxo.value}, required fee: ${childFee}`
        );
      }

      const effectiveRate = (parentFee + childFee) / packageVsize;

      const summary = {
        parent: {
          txid: parentTxid,
          vsize: parentVsize,
          fee: parentFee,
          feeRate: (parentFee / parentVsize).toFixed(2),
        },
        child: {
          inputUtxo: `${parentTxid}:${vout}`,
          inputValue: cpfpUtxo.value,
          outputValue: childOutput,
          vsize: childVsize,
          fee: childFee,
          feeRate: (childFee / childVsize).toFixed(2),
        },
        package: {
          totalVsize: packageVsize,
          totalFee: parentFee + childFee,
          effectiveRate: effectiveRate.toFixed(2),
          targetRate,
        },
      };

      if (opts.dryRun) {
        printJson({ status: "dry_run", ...summary });
        return;
      }

      // Build CPFP transaction
      const btcNetwork = NETWORK === "testnet" ? btc.TEST_NETWORK : btc.NETWORK;
      const senderP2wpkh = btc.p2wpkh(account.btcPublicKey, btcNetwork);
      const tx = new btc.Transaction();

      tx.addInput({
        txid: cpfpUtxo.txid,
        index: cpfpUtxo.vout,
        witnessUtxo: {
          script: senderP2wpkh.script,
          amount: BigInt(cpfpUtxo.value),
        },
      });

      tx.addOutputAddress(sessionInfo.btcAddress, BigInt(childOutput), btcNetwork);

      tx.sign(account.btcPrivateKey);
      tx.finalize();

      const txHex = tx.hex;
      const childTxid = tx.id;

      // Broadcast
      const broadcastTxid = await mempoolApi.broadcastTransaction(txHex);

      printJson({
        status: "broadcast",
        message: "CPFP child transaction broadcast successfully.",
        childTxid: broadcastTxid,
        childExplorerUrl: getMempoolTxUrl(broadcastTxid, NETWORK),
        parentTxid,
        parentExplorerUrl: getMempoolTxUrl(parentTxid, NETWORK),
        ...summary,
      });
    } catch (error) {
      handleError(error);
    }
  });

program.parse(process.argv);
