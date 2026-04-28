// skills/inbox-notify/x402-send.ts
// Local x402 inbox-message send. Mirrors the upstream
// aibtcdev/skills/x402/x402.ts send-inbox-message flow but with explicit nonce
// control and structured paymentId/txid extraction so the nonce-manager
// reconciler can poll the right endpoint for outcome.
//
// Why local: upstream's send-inbox-message Commander handler does not declare
// or consume a --nonce flag — so passing --nonce through bitcoin-wallet does
// nothing, and every inbox send drifts the local nonce-manager from chain
// reality. Owning the send path here lets us enforce the manager's nonce
// authoritatively + capture the relay's paymentId for receipt polling.
//
// Caller is responsible for unlocking the wallet manager singleton before
// invoking sendInboxMessage; this module does not unlock.

import {
  makeContractCall,
  uintCV,
  principalCV,
  noneCV,
} from "@stacks/transactions";

const INBOX_BASE = "https://aibtc.com/api/inbox";

export interface SendInboxMessageResult {
  /** True when the relay accepted our payment (settlement confirmed OR pending). Always implies the tx hit the network. */
  success: boolean;
  /** Tx hash from the settlement-response header, when settlement returned a txid. */
  txid?: string;
  /** Sponsor relay payment id, parsed from the inbox endpoint's response body when the relay queues the settlement. */
  paymentId?: string;
  /** "confirmed" when settlement finished synchronously, "pending" when the relay accepted but hasn't settled yet. */
  paymentStatus?: "confirmed" | "pending";
  /** HTTP status from the final POST. */
  httpStatus?: number;
  /** Relay/server-provided error code, when the response was a 4xx/5xx with structured body. */
  errorCode?: string;
  /** Human-readable error string when success=false. */
  error?: string;
  /** Hint for the nonce-manager: "rejected" means the nonce was NOT consumed on chain; "broadcast" means it was. */
  failureKind?: "rejected" | "broadcast";
}

interface WalletAccount {
  address: string;
  privateKey: string;
  network: string;
}

interface SendDeps {
  account: WalletAccount;
  /** Stacks @stacks/network instance, e.g., from getStacksNetwork("mainnet"). */
  stacksNetwork: unknown;
  /** sBTC token contract id, e.g., "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token". */
  sbtcContractId: string;
  /** Encode/decode helpers from upstream x402-protocol. Passed in to keep this module dep-light. */
  encodePaymentPayload: (payload: unknown) => string;
  decodePaymentRequired: (header: string | null | undefined) => {
    accepts: Array<{ amount: string; payTo: string; asset: string; network: string; scheme: string; maxTimeoutSeconds: number }>;
    resource: { url: string };
  } | null;
  decodePaymentResponse: (header: string | null | undefined) => { transaction?: string; success?: boolean; errorReason?: string } | null;
  /** Header constants from upstream. */
  headers: {
    PAYMENT_REQUIRED: string;
    PAYMENT_SIGNATURE: string;
    PAYMENT_RESPONSE: string;
  };
  /** Fungible post-condition builder from upstream — keeps the import local to caller. */
  createFungiblePostCondition: (
    sender: string,
    contractId: string,
    tokenName: string,
    cmp: string,
    amount: bigint,
  ) => unknown;
}

/** Classify a relay/server error string + http status into a nonce-manager failureKind. */
export function classifyRelayFailure(
  httpStatus: number | undefined,
  errorCode: string | undefined,
  errorBody: string | undefined,
): "rejected" | "broadcast" {
  // Pre-broadcast errors → nonce was never consumed on chain.
  const preBroadcast = new Set([
    "MISSING_API_KEY",
    "INVALID_API_KEY",
    "EXPIRED_API_KEY",
    "MISSING_TRANSACTION",
    "INVALID_TRANSACTION",
    "NOT_SPONSORED",
    "SPENDING_CAP_EXCEEDED",
    "BROADCAST_FAILED",
    "SENDER_NONCE_STALE",
    "SENDER_NONCE_GAP",
    "SENDER_NONCE_DUPLICATE",
  ]);
  if (errorCode && preBroadcast.has(errorCode)) return "rejected";
  // 4xx (other than 402 challenge which is normal) → typically pre-broadcast rejection.
  if (httpStatus && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 402) return "rejected";
  // No clear signal → keep the safe default. The reconciler will sort it out from the receipt.
  return "broadcast";
}

export async function sendInboxMessage(
  recipientBtcAddress: string,
  recipientStxAddress: string,
  content: string,
  nonce: bigint,
  deps: SendDeps,
): Promise<SendInboxMessageResult> {
  if (content.length > 500) {
    return {
      success: false,
      error: "Message content exceeds 500 character limit",
      failureKind: "rejected",
    };
  }

  const inboxUrl = `${INBOX_BASE}/${recipientBtcAddress}`;
  const body = {
    toBtcAddress: recipientBtcAddress,
    toStxAddress: recipientStxAddress,
    content,
  };

  // Step 1: POST without payment to get 402 challenge.
  let initialRes: Response;
  try {
    initialRes = await fetch(inboxUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      success: false,
      error: `inbox 402-challenge fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      failureKind: "rejected",
    };
  }

  if (initialRes.status !== 402) {
    const text = await initialRes.text();
    if (initialRes.ok) {
      // Free endpoint — no payment required, no nonce consumed.
      return { success: true, httpStatus: initialRes.status, failureKind: "rejected" };
    }
    return {
      success: false,
      httpStatus: initialRes.status,
      error: `Expected 402 challenge, got ${initialRes.status}: ${text.slice(0, 300)}`,
      failureKind: "rejected",
    };
  }

  const paymentHeader = initialRes.headers.get(deps.headers.PAYMENT_REQUIRED);
  const paymentRequired = deps.decodePaymentRequired(paymentHeader);
  if (!paymentRequired || !paymentRequired.accepts || paymentRequired.accepts.length === 0) {
    return {
      success: false,
      httpStatus: 402,
      error: "402 response missing payment-required header",
      failureKind: "rejected",
    };
  }
  const accept = paymentRequired.accepts[0];
  const amount = BigInt(accept.amount);

  // Step 2: build sponsored sBTC transfer with OUR nonce.
  const [contractAddress, contractName] = deps.sbtcContractId.split(".");
  if (!contractAddress || !contractName) {
    return {
      success: false,
      error: `invalid sbtc contract id: ${deps.sbtcContractId}`,
      failureKind: "rejected",
    };
  }

  let transaction;
  try {
    const postCondition = deps.createFungiblePostCondition(
      deps.account.address,
      deps.sbtcContractId,
      "sbtc-token",
      "eq",
      amount,
    );
    transaction = await makeContractCall({
      contractAddress,
      contractName,
      functionName: "transfer",
      functionArgs: [
        uintCV(amount),
        principalCV(deps.account.address),
        principalCV(accept.payTo),
        noneCV(),
      ],
      senderKey: deps.account.privateKey,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      network: deps.stacksNetwork as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      postConditions: [postCondition as any],
      sponsored: true,
      fee: 0n,
      nonce,
    });
  } catch (err) {
    return {
      success: false,
      error: `sign/build failed: ${err instanceof Error ? err.message : String(err)}`,
      failureKind: "rejected",
    };
  }

  const txHex = "0x" + transaction.serialize();

  // Step 3: encode payment payload and POST again with payment-signature header.
  const paymentSignature = deps.encodePaymentPayload({
    x402Version: 2,
    resource: paymentRequired.resource,
    accepted: accept,
    payload: { transaction: txHex },
  });

  let finalRes: Response;
  try {
    finalRes = await fetch(inboxUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [deps.headers.PAYMENT_SIGNATURE]: paymentSignature,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      success: false,
      error: `inbox payment POST failed: ${err instanceof Error ? err.message : String(err)}`,
      // Network failure mid-flight — we can't tell if the relay processed it. Safe default: assume broadcast.
      failureKind: "broadcast",
    };
  }

  const responseText = await finalRes.text();
  let responseBody: Record<string, unknown> | null = null;
  try {
    responseBody = JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    responseBody = null;
  }

  // Step 4: parse outcome.
  // Success path: 200 (synchronous settlement), 201 (queued for async settlement),
  // 202 (payment accepted, inbox delivery staged — the post-relay-v1.26.1 pending path).
  // The relay also returns paymentStatus/paymentId either at the top level or nested
  // under an "inbox" envelope (upstream skills/x402/x402.ts uses the envelope form).
  if (finalRes.status === 200 || finalRes.status === 201 || finalRes.status === 202) {
    const settlementHeader = finalRes.headers.get(deps.headers.PAYMENT_RESPONSE);
    const settlement = deps.decodePaymentResponse(settlementHeader);
    const txid = settlement?.transaction;
    const inboxEnvelope = (responseBody?.inbox && typeof responseBody.inbox === "object")
      ? (responseBody.inbox as Record<string, unknown>)
      : null;
    const paymentId = (inboxEnvelope?.paymentId as string | undefined)
      ?? (inboxEnvelope?.payment_id as string | undefined)
      ?? (responseBody?.paymentId as string | undefined)
      ?? (responseBody?.payment_id as string | undefined);
    const paymentStatus = (inboxEnvelope?.paymentStatus as "confirmed" | "pending" | undefined)
      ?? (inboxEnvelope?.payment_status as "confirmed" | "pending" | undefined)
      ?? (responseBody?.paymentStatus as "confirmed" | "pending" | undefined)
      ?? (responseBody?.payment_status as "confirmed" | "pending" | undefined)
      ?? (finalRes.status === 202 ? "pending" : (settlement?.success ? "confirmed" : "pending"));

    return {
      success: true,
      httpStatus: finalRes.status,
      txid,
      paymentId,
      paymentStatus,
      // Even if the settlement reports success=false later, the tx is in the network — nonce is consumed.
      failureKind: undefined,
    };
  }

  // Failure path: classify by relay error code.
  const errorCode = (responseBody?.code as string | undefined)
    ?? (responseBody?.error_code as string | undefined);
  const errorMsg = (responseBody?.error as string | undefined)
    ?? (responseBody?.message as string | undefined)
    ?? responseText.slice(0, 300);

  return {
    success: false,
    httpStatus: finalRes.status,
    errorCode,
    error: errorMsg,
    failureKind: classifyRelayFailure(finalRes.status, errorCode, responseText),
  };
}
