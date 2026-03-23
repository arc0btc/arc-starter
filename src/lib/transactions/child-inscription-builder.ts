/**
 * Child Inscription transaction building
 *
 * Implements the commit/reveal pattern for Bitcoin child inscriptions using micro-ordinals.
 * A child inscription establishes on-chain provenance by referencing a parent inscription
 * per the Ordinals provenance specification (parent tag in the inscription envelope).
 *
 * The reveal transaction has 2 inputs (commit script-path + parent key-path) and
 * 2 outputs (child inscription + parent return), which is novel vs. standard inscriptions.
 *
 * Reference: https://github.com/paulmillr/micro-ordinals
 * Reference: https://docs.ordinals.com/inscriptions/provenance.html
 */

import * as btc from "@scure/btc-signer";
import { p2tr_ord_reveal } from "micro-ordinals";
import type { Tags } from "micro-ordinals";
import type { Network } from "../config/networks.js";
import {
  P2WPKH_INPUT_VBYTES,
  P2WPKH_OUTPUT_VBYTES,
  P2TR_OUTPUT_VBYTES,
  TX_OVERHEAD_VBYTES,
  DUST_THRESHOLD,
  P2TR_INPUT_BASE_VBYTES,
  WITNESS_OVERHEAD_VBYTES,
} from "../config/bitcoin-constants.js";
import type { UTXO } from "../services/mempool-api.js";
import type { InscriptionData } from "./inscription-builder.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Information about a parent inscription retrieved from the Hiro Ordinals API
 */
export interface ParentInscriptionInfo {
  /** Current owner address */
  address: string;
  /** Transaction ID of the UTXO holding the inscription */
  txid: string;
  /** Output index of the UTXO */
  vout: number;
  /** Value of the UTXO in satoshis */
  value: number;
}

/**
 * Options for deriving the child reveal script
 */
export interface DeriveChildRevealScriptOptions {
  /** Inscription content */
  inscription: InscriptionData;
  /** Parent inscription ID (format: {txid}i{index}) */
  parentInscriptionId: string;
  /** Sender's public key (compressed, 33 bytes) */
  senderPubKey: Uint8Array;
  /** Network */
  network: Network;
}

/**
 * Options for building a child commit transaction
 */
export interface BuildChildCommitTransactionOptions {
  /** UTXOs to fund the commit transaction */
  utxos: UTXO[];
  /** Inscription data to commit */
  inscription: InscriptionData;
  /** Parent inscription ID (format: {txid}i{index}) */
  parentInscriptionId: string;
  /** Fee rate in sat/vB */
  feeRate: number;
  /** Sender's public key (compressed, 33 bytes) */
  senderPubKey: Uint8Array;
  /** Sender's address for change output */
  senderAddress: string;
  /** Network */
  network: Network;
}

/**
 * Result from building a child commit transaction
 */
export interface BuildChildCommitTransactionResult {
  /** Unsigned commit transaction */
  tx: btc.Transaction;
  /** Fee paid in satoshis */
  fee: number;
  /** Taproot reveal address */
  revealAddress: string;
  /** Amount sent to reveal address (covers reveal fee + 2x dust + buffer) */
  revealAmount: number;
  /** Taproot P2TR output for reveal transaction */
  revealScript: ReturnType<typeof btc.p2tr>;
}

/**
 * Parent UTXO reference for the reveal transaction
 */
export interface ParentUtxo {
  txid: string;
  vout: number;
  value: number;
}

/**
 * Options for building a child reveal transaction
 */
export interface BuildChildRevealTransactionOptions {
  /** Commit transaction ID */
  commitTxid: string;
  /** Output index in commit transaction (usually 0) */
  commitVout: number;
  /** Amount in the commit output (satoshis) */
  commitAmount: number;
  /** Taproot P2TR output from commit transaction */
  revealScript: ReturnType<typeof btc.p2tr>;
  /** Parent inscription UTXO */
  parentUtxo: ParentUtxo;
  /**
   * Taproot internal public key for the parent owner (x-only, 32 bytes).
   * Used to construct the P2TR script for the parent key-path spend input.
   */
  parentOwnerTaprootInternalPubKey: Uint8Array;
  /** Recipient address for the child inscription */
  recipientAddress: string;
  /** Fee rate in sat/vB */
  feeRate: number;
  /** Network */
  network: Network;
  /** Inscription data (needed for accurate witness size estimation) */
  inscription: InscriptionData;
}

/**
 * Result from building a child reveal transaction
 */
export interface BuildChildRevealTransactionResult {
  /** Unsigned reveal transaction */
  tx: btc.Transaction;
  /** Fee paid in satoshis */
  fee: number;
  /** Amount sent to child inscription output (in satoshis) */
  outputAmount: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Get the @scure/btc-signer network object for a network name
 */
function getBtcNetwork(network: Network): typeof btc.NETWORK {
  return network === "testnet" ? btc.TEST_NETWORK : btc.NETWORK;
}

/**
 * Convert a compressed public key (33 bytes) to x-only (32 bytes) for Taproot
 */
function toXOnly(compressedPubKey: Uint8Array): Uint8Array {
  return compressedPubKey.slice(1);
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Look up parent inscription details from the Unisat Indexer API
 *
 * Returns the current owner address and the UTXO (txid, vout, value) holding
 * the inscription. The caller must verify that the owner address matches the
 * wallet's Taproot address before proceeding with the child inscription.
 *
 * @param inscriptionId - Inscription ID in format {txid}i{index}
 * @param network - Network to query (mainnet or testnet)
 * @returns Parent inscription info including owner address and UTXO details
 * @throws Error if the inscription is not found or the API request fails
 */
export async function lookupParentInscription(
  inscriptionId: string,
  network: Network
): Promise<ParentInscriptionInfo> {
  const apiBase =
    network === "mainnet"
      ? "https://open-api.unisat.io"
      : "https://open-api-testnet.unisat.io";

  const url = `${apiBase}/v1/indexer/inscription/info/${inscriptionId}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (process.env.UNISAT_API_KEY) {
    headers["Authorization"] = `Bearer ${process.env.UNISAT_API_KEY}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Inscription not found: ${inscriptionId}`);
    }
    throw new Error(
      `Unisat API error: ${response.status} ${response.statusText}`
    );
  }

  const json = (await response.json()) as {
    code: number;
    msg: string;
    data: {
      address: string;
      utxo: {
        txid: string;
        vout: number;
        satoshi: number;
      };
    };
  };

  if (json.code !== 0) {
    throw new Error(`Unisat API error: ${json.msg}`);
  }

  const { address, utxo } = json.data;

  if (!address || !utxo?.txid) {
    throw new Error(
      `Unexpected response from Unisat API for inscription ${inscriptionId}`
    );
  }

  if (utxo.txid.length !== 64 || utxo.vout < 0) {
    throw new Error(
      `Invalid UTXO data from Unisat API: txid=${utxo.txid}, vout=${utxo.vout}`
    );
  }

  return {
    address,
    txid: utxo.txid,
    vout: utxo.vout,
    value: utxo.satoshi,
  };
}

/**
 * Derive the Taproot reveal script for a child inscription
 *
 * This is extracted as a standalone function so both buildChildCommitTransaction
 * and the reveal step can derive the identical script deterministically.
 *
 * Bug fix applied: btc.p2tr(..., true) — 4th arg required for micro-ordinals@0.3.0
 * unknown leaf scripts.
 *
 * @param options - Script derivation options
 * @returns Taproot P2TR output for use in commit and reveal transactions
 */
export function deriveChildRevealScript(
  options: DeriveChildRevealScriptOptions
): ReturnType<typeof btc.p2tr> {
  const { inscription, parentInscriptionId, senderPubKey, network } = options;

  const btcNetwork = getBtcNetwork(network);
  const xOnlyPubkey = toXOnly(senderPubKey);

  // Build inscription tags with parent tag for child provenance
  // Tags.parent is typed as P.Coder<string, Uint8Array> due to a micro-ordinals type
  // inconsistency, but at runtime the field holds the decoded string value.
  const tags: Tags = {
    contentType: inscription.contentType,
    parent: parentInscriptionId as unknown as Tags["parent"],
  };

  const inscriptionData = {
    tags,
    body: inscription.body,
  };

  const revealScriptData = p2tr_ord_reveal(xOnlyPubkey, [inscriptionData]);

  // Bug fix: 4th arg `true` required for micro-ordinals@0.3.0 unknown leaf scripts
  return btc.p2tr(xOnlyPubkey, revealScriptData, btcNetwork, true);
}

/**
 * Build a commit transaction for a child inscription
 *
 * Similar to buildCommitTransaction but the reveal amount is calculated for a
 * 2-input (commit script-path + parent key-path) + 2-output (child + parent return)
 * reveal transaction.
 *
 * Bug fix applied: new btc.Transaction({ allowUnknownOutputs, allowUnknownInputs })
 *
 * @param options - Commit transaction building options
 * @returns Unsigned commit transaction and reveal script
 * @throws Error if insufficient funds or invalid parameters
 */
export function buildChildCommitTransaction(
  options: BuildChildCommitTransactionOptions
): BuildChildCommitTransactionResult {
  const {
    utxos,
    inscription,
    parentInscriptionId,
    feeRate,
    senderPubKey,
    senderAddress,
    network,
  } = options;

  // Validate inputs
  if (utxos.length === 0) {
    throw new Error("No UTXOs provided");
  }
  if (feeRate <= 0) {
    throw new Error("Fee rate must be positive");
  }
  if (!inscription.contentType) {
    throw new Error("Content type is required");
  }
  if (!inscription.body || inscription.body.length === 0) {
    throw new Error("Content body is required");
  }
  if (senderPubKey.length !== 33) {
    throw new Error("Sender public key must be 33 bytes (compressed)");
  }
  if (!parentInscriptionId) {
    throw new Error("Parent inscription ID is required");
  }

  const btcNetwork = getBtcNetwork(network);

  // Sort and filter confirmed UTXOs by value descending
  const sortedUtxos = [...utxos]
    .filter((utxo) => utxo.status.confirmed)
    .sort((a, b) => b.value - a.value);

  if (sortedUtxos.length === 0) {
    throw new Error("No confirmed UTXOs available");
  }

  // Derive the child reveal script
  const p2trReveal = deriveChildRevealScript({
    inscription,
    parentInscriptionId,
    senderPubKey,
    network,
  });

  if (!p2trReveal.address) {
    throw new Error("Failed to generate reveal address");
  }

  // Estimate reveal transaction size:
  // 2 P2TR inputs (commit script-path + parent key-path) + 2 P2TR outputs (child + parent return)
  const revealWitnessSize =
    Math.ceil((inscription.body.length / 4) * 1.25) + WITNESS_OVERHEAD_VBYTES;
  const revealTxSize =
    TX_OVERHEAD_VBYTES +
    P2TR_INPUT_BASE_VBYTES + // commit input (script-path)
    P2TR_INPUT_BASE_VBYTES + // parent input (key-path)
    revealWitnessSize +
    P2TR_OUTPUT_VBYTES * 2; // child output + parent return output
  const revealFee = Math.ceil(revealTxSize * feeRate);

  // Amount to lock in commit output (covers reveal fee + 2x dust + buffer)
  // The extra dust covers the child inscription output and the parent return output.
  const revealAmount = revealFee + DUST_THRESHOLD * 2 + 1000;

  // Estimate commit transaction size
  const estimatedVsize =
    TX_OVERHEAD_VBYTES +
    sortedUtxos.length * P2WPKH_INPUT_VBYTES +
    P2TR_OUTPUT_VBYTES + // reveal output
    P2WPKH_OUTPUT_VBYTES; // change output

  const estimatedFee = Math.ceil(estimatedVsize * feeRate);

  const totalAvailable = sortedUtxos.reduce((sum, utxo) => sum + utxo.value, 0);
  const requiredTotal = revealAmount + estimatedFee;

  if (totalAvailable < requiredTotal) {
    throw new Error(
      `Insufficient funds: have ${totalAvailable} sats, need ${requiredTotal} sats ` +
        `(${revealAmount} reveal amount + ${estimatedFee} commit fee)`
    );
  }

  // UTXO selection: accumulate until we have enough
  let selectedTotal = 0;
  const selectedUtxos: UTXO[] = [];

  for (const utxo of sortedUtxos) {
    selectedUtxos.push(utxo);
    selectedTotal += utxo.value;

    if (selectedTotal >= requiredTotal) {
      break;
    }
  }

  // Final fee calculation with actual UTXO count
  const finalVsize =
    TX_OVERHEAD_VBYTES +
    selectedUtxos.length * P2WPKH_INPUT_VBYTES +
    P2TR_OUTPUT_VBYTES +
    P2WPKH_OUTPUT_VBYTES;

  const finalFee = Math.ceil(finalVsize * feeRate);
  const changeAmount = selectedTotal - revealAmount - finalFee;

  if (selectedTotal < revealAmount + finalFee) {
    throw new Error(
      `Insufficient funds after UTXO selection: have ${selectedTotal} sats, ` +
        `need ${revealAmount + finalFee} sats`
    );
  }

  if (changeAmount < DUST_THRESHOLD) {
    throw new Error(
      `Change amount ${changeAmount} is below dust threshold (${DUST_THRESHOLD} sats). ` +
        "Need more UTXOs or lower fee rate."
    );
  }

  // Bug fix: allowUnknownOutputs and allowUnknownInputs required for micro-ordinals taproot scripts
  const tx = new btc.Transaction({
    allowUnknownOutputs: true,
    allowUnknownInputs: true,
  });

  // Create sender's P2WPKH script for inputs
  const senderP2wpkh = btc.p2wpkh(senderPubKey, btcNetwork);

  // Add inputs
  for (const utxo of selectedUtxos) {
    tx.addInput({
      txid: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        script: senderP2wpkh.script,
        amount: BigInt(utxo.value),
      },
    });
  }

  // Add reveal output (Taproot address from reveal script)
  tx.addOutputAddress(p2trReveal.address, BigInt(revealAmount), btcNetwork);

  // Add change output
  tx.addOutputAddress(senderAddress, BigInt(changeAmount), btcNetwork);

  return {
    tx,
    fee: finalFee,
    revealAddress: p2trReveal.address,
    revealAmount,
    revealScript: p2trReveal,
  };
}

/**
 * Build a reveal transaction for a child inscription
 *
 * This transaction has 2 inputs and 2 outputs:
 * - Input 0: commit output (script-path spend via tapLeafScript)
 * - Input 1: parent UTXO (key-path spend)
 * - Output 0: child inscription (to recipientAddress)
 * - Output 1: parent return (back to recipientAddress)
 *
 * The parent UTXO must be spent in the same transaction to establish
 * the parent-child relationship per the Ordinals provenance spec.
 *
 * Bug fixes applied:
 * 1. tapLeafScript: revealScript.tapLeafScript — named property, not spread
 * 2. new btc.Transaction({ allowUnknownOutputs, allowUnknownInputs })
 *
 * @param options - Reveal transaction building options
 * @returns Unsigned reveal transaction
 * @throws Error if invalid parameters or insufficient funds
 */
export function buildChildRevealTransaction(
  options: BuildChildRevealTransactionOptions
): BuildChildRevealTransactionResult {
  const {
    commitTxid,
    commitVout,
    commitAmount,
    revealScript,
    parentUtxo,
    parentOwnerTaprootInternalPubKey,
    recipientAddress,
    feeRate,
    network,
    inscription,
  } = options;

  // Validate inputs
  if (!commitTxid || commitTxid.length !== 64) {
    throw new Error("Invalid commit transaction ID");
  }
  if (commitVout < 0) {
    throw new Error("Invalid commit output index");
  }
  if (commitAmount <= 0) {
    throw new Error("Commit amount must be positive");
  }
  if (feeRate <= 0) {
    throw new Error("Fee rate must be positive");
  }
  if (!parentUtxo.txid || parentUtxo.txid.length !== 64) {
    throw new Error("Invalid parent UTXO transaction ID");
  }

  const btcNetwork = getBtcNetwork(network);

  // Estimate reveal tx size: 2 P2TR inputs + 2 P2TR outputs + inscription witness
  // Witness data is discounted at 1/4 weight, plus overhead for control block etc.
  const revealWitnessSize = Math.ceil(
    inscription.body.length / 4 * 1.25 + WITNESS_OVERHEAD_VBYTES
  );
  const revealTxSize =
    TX_OVERHEAD_VBYTES +
    P2TR_INPUT_BASE_VBYTES + // commit input (script-path)
    P2TR_INPUT_BASE_VBYTES + // parent input (key-path)
    revealWitnessSize +
    P2TR_OUTPUT_VBYTES * 2; // child output + parent return output
  const revealFee = Math.ceil(revealTxSize * feeRate);

  // Total available to distribute: commit amount + parent value
  const totalAvailable = commitAmount + parentUtxo.value;

  if (totalAvailable < revealFee + DUST_THRESHOLD * 2) {
    throw new Error(
      `Insufficient funds for reveal: have ${totalAvailable} sats, ` +
        `need at least ${revealFee + DUST_THRESHOLD * 2} sats (fee + 2x dust)`
    );
  }

  // Allocate outputs:
  // - Child inscription output gets DUST_THRESHOLD (minimum for inscription)
  // - Parent return output gets the remainder (parent value - fees contribution)
  // - Fees come from commit amount (which was sized to cover reveal fee + 2x dust + buffer)
  const childOutputAmount = DUST_THRESHOLD;
  const parentReturnAmount = totalAvailable - revealFee - childOutputAmount;

  if (parentReturnAmount < DUST_THRESHOLD) {
    throw new Error(
      `Parent return amount ${parentReturnAmount} is below dust threshold (${DUST_THRESHOLD} sats)`
    );
  }

  // Bug fix: allowUnknownOutputs and allowUnknownInputs required for taproot script-path spending
  const tx = new btc.Transaction({
    allowUnknownOutputs: true,
    allowUnknownInputs: true,
  });

  // Input 0: commit output — script-path spend
  // Bug fix: tapLeafScript must be a named property, not spread (spread produces numeric array keys
  // that btc-signer does not recognise, causing signing to fail silently)
  tx.addInput({
    txid: commitTxid,
    index: commitVout,
    witnessUtxo: {
      script: revealScript.script,
      amount: BigInt(commitAmount),
    },
    tapLeafScript: revealScript.tapLeafScript,
  });

  // Input 1: parent UTXO — key-path spend
  // Build the P2TR script for the parent owner using their internal public key
  const xOnlyParentPubKey = parentOwnerTaprootInternalPubKey.length === 33
    ? toXOnly(parentOwnerTaprootInternalPubKey)
    : parentOwnerTaprootInternalPubKey;

  const parentP2tr = btc.p2tr(xOnlyParentPubKey, undefined, btcNetwork);

  tx.addInput({
    txid: parentUtxo.txid,
    index: parentUtxo.vout,
    witnessUtxo: {
      script: parentP2tr.script,
      amount: BigInt(parentUtxo.value),
    },
  });

  // Output 0: child inscription (dust amount, inscription is in the witness of input 0)
  tx.addOutputAddress(recipientAddress, BigInt(childOutputAmount), btcNetwork);

  // Output 1: parent return (remaining funds back to the owner)
  tx.addOutputAddress(recipientAddress, BigInt(parentReturnAmount), btcNetwork);

  return {
    tx,
    fee: revealFee,
    outputAmount: childOutputAmount,
  };
}
