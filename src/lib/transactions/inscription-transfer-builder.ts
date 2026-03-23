/**
 * Inscription Transfer Builder
 *
 * Builds a transaction to transfer an inscription from one address to another.
 * Uses a mixed-input pattern:
 * - P2TR input: the inscription UTXO (signed with taproot key)
 * - P2WPKH inputs: cardinal UTXOs for fees (signed with segwit key)
 * - P2TR output: recipient receives the inscription
 * - P2WPKH output: change back to sender
 *
 * Uses the signIdx() pattern proven in psbt/psbt.ts for mixed signing.
 */

import * as btc from "@scure/btc-signer";
import type { Network } from "../config/networks.js";
import {
  P2WPKH_INPUT_VBYTES,
  P2WPKH_OUTPUT_VBYTES,
  P2TR_OUTPUT_VBYTES,
  P2TR_INPUT_BASE_VBYTES,
  TX_OVERHEAD_VBYTES,
  DUST_THRESHOLD,
} from "../config/bitcoin-constants.js";
import type { UTXO } from "../services/mempool-api.js";

export interface InscriptionTransferOptions {
  /** The inscription UTXO to transfer */
  inscriptionUtxo: UTXO;
  /** Cardinal UTXOs to pay fees from */
  feeUtxos: UTXO[];
  /** Recipient address (bc1p... or tb1p... for Taproot) */
  recipientAddress: string;
  /** Fee rate in sat/vB */
  feeRate: number;
  /** Sender's P2WPKH public key (compressed, 33 bytes) */
  senderPubKey: Uint8Array;
  /** Sender's Taproot internal public key (x-only, 32 bytes) */
  senderTaprootPubKey: Uint8Array;
  /** Sender's P2WPKH address for change */
  senderAddress: string;
  /** Network */
  network: Network;
}

export interface InscriptionTransferResult {
  /** Unsigned transaction (needs mixed signing) */
  tx: btc.Transaction;
  /** Fee paid in satoshis */
  fee: number;
  /** Change amount in satoshis */
  change: number;
  /** Estimated vsize */
  vsize: number;
  /** Index of the inscription input (always 0) */
  inscriptionInputIndex: number;
  /** Indices of fee inputs */
  feeInputIndices: number[];
}

function getBtcNetwork(network: Network): typeof btc.NETWORK {
  return network === "testnet" ? btc.TEST_NETWORK : btc.NETWORK;
}

/**
 * Build an inscription transfer transaction.
 *
 * The inscription UTXO is always input 0. Fee UTXOs follow.
 * The recipient output carries the inscription's full value.
 * Change goes back to the sender's P2WPKH address.
 */
export function buildInscriptionTransfer(
  options: InscriptionTransferOptions
): InscriptionTransferResult {
  const {
    inscriptionUtxo,
    feeUtxos,
    recipientAddress,
    feeRate,
    senderPubKey,
    senderTaprootPubKey,
    senderAddress,
    network,
  } = options;

  if (feeUtxos.length === 0) {
    throw new Error("No fee UTXOs provided");
  }
  if (feeRate <= 0) {
    throw new Error("Fee rate must be positive");
  }

  const btcNetwork = getBtcNetwork(network);
  const tx = new btc.Transaction();

  // Input 0: inscription UTXO (P2TR key-path spend)
  const taprootPayment = btc.p2tr(senderTaprootPubKey, undefined, btcNetwork);
  tx.addInput({
    txid: inscriptionUtxo.txid,
    index: inscriptionUtxo.vout,
    witnessUtxo: {
      script: taprootPayment.script,
      amount: BigInt(inscriptionUtxo.value),
    },
  });

  // Fee inputs: P2WPKH cardinal UTXOs
  const senderP2wpkh = btc.p2wpkh(senderPubKey, btcNetwork);
  const sortedFeeUtxos = [...feeUtxos]
    .filter((u) => u.status.confirmed)
    .sort((a, b) => b.value - a.value);

  if (sortedFeeUtxos.length === 0) {
    throw new Error("No confirmed fee UTXOs available");
  }

  // Estimate fee: 1 P2TR input + N P2WPKH inputs, 1 P2TR output + 1 P2WPKH change output
  // Start with minimum inputs and add more if needed
  let selectedFeeUtxos: UTXO[] = [];
  let feeTotal = 0;

  for (const utxo of sortedFeeUtxos) {
    selectedFeeUtxos.push(utxo);
    feeTotal += utxo.value;

    const estimatedVsize =
      TX_OVERHEAD_VBYTES +
      P2TR_INPUT_BASE_VBYTES + // inscription input
      selectedFeeUtxos.length * P2WPKH_INPUT_VBYTES + // fee inputs
      P2TR_OUTPUT_VBYTES + // recipient output
      P2WPKH_OUTPUT_VBYTES; // change output

    const estimatedFee = Math.ceil(estimatedVsize * feeRate);

    if (feeTotal >= estimatedFee) {
      break;
    }
  }

  // Final fee calculation
  const finalVsize =
    TX_OVERHEAD_VBYTES +
    P2TR_INPUT_BASE_VBYTES +
    selectedFeeUtxos.length * P2WPKH_INPUT_VBYTES +
    P2TR_OUTPUT_VBYTES +
    P2WPKH_OUTPUT_VBYTES;
  const finalFee = Math.ceil(finalVsize * feeRate);

  if (feeTotal < finalFee) {
    throw new Error(
      `Insufficient fee UTXOs: have ${feeTotal} sats, need ${finalFee} sats for fee`
    );
  }

  const changeAmount = feeTotal - finalFee;

  // Add fee inputs
  const feeInputIndices: number[] = [];
  for (let i = 0; i < selectedFeeUtxos.length; i++) {
    const utxo = selectedFeeUtxos[i];
    tx.addInput({
      txid: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        script: senderP2wpkh.script,
        amount: BigInt(utxo.value),
      },
    });
    feeInputIndices.push(i + 1); // offset by 1 for inscription input
  }

  // Output 0: recipient gets the inscription (full inscription UTXO value)
  tx.addOutputAddress(recipientAddress, BigInt(inscriptionUtxo.value), btcNetwork);

  // Output 1: change back to sender (if above dust)
  if (changeAmount >= DUST_THRESHOLD) {
    tx.addOutputAddress(senderAddress, BigInt(changeAmount), btcNetwork);
  }

  return {
    tx,
    fee: finalFee,
    change: changeAmount >= DUST_THRESHOLD ? changeAmount : 0,
    vsize: Math.ceil(finalVsize),
    inscriptionInputIndex: 0,
    feeInputIndices,
  };
}

/**
 * Sign an inscription transfer transaction with mixed key types.
 *
 * Uses signIdx() to sign each input with the appropriate key:
 * - Inscription input (index 0): taproot private key
 * - Fee inputs: P2WPKH private key
 */
export function signInscriptionTransfer(
  tx: btc.Transaction,
  taprootPrivateKey: Uint8Array,
  btcPrivateKey: Uint8Array,
  inscriptionInputIndex: number,
  feeInputIndices: number[]
): { txHex: string; txid: string; vsize: number } {
  // Sign inscription input with taproot key
  tx.signIdx(taprootPrivateKey, inscriptionInputIndex);

  // Sign fee inputs with P2WPKH key
  for (const idx of feeInputIndices) {
    tx.signIdx(btcPrivateKey, idx);
  }

  tx.finalize();

  return {
    txHex: tx.hex,
    txid: tx.id,
    vsize: tx.vsize,
  };
}
