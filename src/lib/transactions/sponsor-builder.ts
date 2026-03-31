import {
  makeSTXTokenTransfer,
  makeContractCall,
  PostConditionMode,
} from "@stacks/transactions";
import { getStacksNetwork, type Network } from "../config/networks.js";
import { getSponsorRelayUrl, getSponsorApiKey } from "../config/sponsor.js";
import { acquireNonce, releaseNonce } from "../../skills/nonce-manager/nonce-store.js";
import type { Account, ContractCallOptions, TransferResult } from "./builder.js";

export interface SponsoredTransferOptions {
  senderKey: string;
  recipient: string;
  amount: bigint;
  memo?: string;
  network: Network;
  /** Optional nonce. If omitted, auto-fetched from the network. Use for local nonce tracking. */
  nonce?: bigint;
}

export interface SponsorRelayResponse {
  success: boolean;
  requestId?: string;
  txid?: string;
  explorerUrl?: string;
  fee?: number;
  error?: string;
  code?: string;
  details?: string;
  retryable?: boolean;
  retryAfter?: number;
}

/**
 * Format a failed SponsorRelayResponse into an error message
 */
function formatRelayError(response: SponsorRelayResponse): string {
  const errorMsg = response.error || "Sponsor relay request failed";
  const details = response.details ? ` (${response.details})` : "";
  const retryInfo = response.retryable
    ? typeof response.retryAfter === "number"
      ? ` [Retryable after ${response.retryAfter}s]`
      : " [Retryable; try again later]"
    : "";
  return `${errorMsg}${details}${retryInfo}`;
}

/**
 * Resolve the sponsor API key from the account or environment.
 * Throws if no key is available.
 */
function resolveSponsorApiKey(account: Account): string {
  const apiKey = account.sponsorApiKey || getSponsorApiKey();
  if (!apiKey) {
    throw new Error(
      "Sponsored transactions require SPONSOR_API_KEY environment variable or wallet-level sponsorApiKey"
    );
  }
  return apiKey;
}

/**
 * High-level helper: build a sponsored contract call, submit to relay, and
 * return a TransferResult. Resolves the API key and handles relay errors.
 *
 * This is the primary entry point for services that need sponsored contract calls.
 */
export async function sponsoredContractCall(
  account: Account,
  options: ContractCallOptions,
  network: Network
): Promise<TransferResult> {
  const apiKey = resolveSponsorApiKey(account);
  const networkName = getStacksNetwork(network);

  // Acquire nonce from the oracle — single source of truth for all tx paths
  const acquired = await acquireNonce(account.address);
  const nonce = BigInt(acquired.nonce);

  const transaction = await makeContractCall({
    contractAddress: options.contractAddress,
    contractName: options.contractName,
    functionName: options.functionName,
    functionArgs: options.functionArgs,
    senderKey: account.privateKey,
    network: networkName,
    postConditionMode: options.postConditionMode || PostConditionMode.Deny,
    postConditions: options.postConditions || [],
    sponsored: true,
    fee: 0n,
    nonce,
  });

  const serializedTx = transaction.serialize();
  let response: SponsorRelayResponse;

  try {
    response = await submitToSponsorRelay(serializedTx, network, apiKey);
  } catch (err) {
    // Network error — assume nonce was NOT consumed (never reached relay)
    await releaseNonce(account.address, acquired.nonce, false, "rejected");
    throw err;
  }

  if (!response.success) {
    // Relay rejected: SENDER_NONCE_STALE/GAP means nonce not consumed.
    // Other codes (SENDER_NONCE_DUPLICATE) mean relay already has it — nonce consumed.
    const code = response.code ?? "";
    const rejected = code === "SENDER_NONCE_STALE" || code === "SENDER_NONCE_GAP";
    await releaseNonce(account.address, acquired.nonce, false, rejected ? "rejected" : "broadcast");
    throw new Error(formatRelayError(response));
  }

  if (!response.txid) {
    // Relay accepted but no txid — nonce was consumed by the relay
    await releaseNonce(account.address, acquired.nonce, true);
    throw new Error("Sponsor relay succeeded but returned no txid");
  }

  await releaseNonce(account.address, acquired.nonce, true);
  return { txid: response.txid, rawTx: serializedTx };
}

/**
 * Build and submit a sponsored STX transfer transaction
 */
export async function transferStxSponsored(
  options: SponsoredTransferOptions,
  apiKey: string
): Promise<SponsorRelayResponse> {
  const networkName = getStacksNetwork(options.network);

  const transaction = await makeSTXTokenTransfer({
    recipient: options.recipient,
    amount: options.amount,
    senderKey: options.senderKey,
    network: networkName,
    memo: options.memo || "",
    sponsored: true,
    fee: 0n,
    ...(options.nonce !== undefined && { nonce: options.nonce }),
  });

  const serializedTx = transaction.serialize();
  return submitToSponsorRelay(serializedTx, options.network, apiKey);
}

/**
 * Submit a serialized transaction to the sponsor relay
 */
async function submitToSponsorRelay(
  transaction: string,
  network: Network,
  apiKey: string
): Promise<SponsorRelayResponse> {
  const relayUrl = getSponsorRelayUrl(network);

  const response = await fetch(`${relayUrl}/sponsor`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      // Relay expects 0x-prefixed hex; serialize() returns raw hex in @stacks/transactions v7
      transaction: transaction.startsWith("0x") ? transaction : "0x" + transaction,
    }),
  });

  const responseText = await response.text();

  let data: SponsorRelayResponse;
  try {
    data = JSON.parse(responseText);
  } catch {
    data = {
      success: false,
      error: `Sponsor relay returned non-JSON response (status ${response.status})`,
      details: responseText || undefined,
    };
  }

  if (!response.ok || !data.success) {
    return {
      success: false,
      error: data.error || "Sponsor relay request failed",
      code: data.code,
      details: data.details,
      retryable: data.retryable,
      retryAfter: data.retryAfter,
    };
  }

  return data as SponsorRelayResponse;
}
