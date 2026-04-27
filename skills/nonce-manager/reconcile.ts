// skills/nonce-manager/reconcile.ts
// Receipt-driven reconciliation of pending broadcasts. Polls either the x402
// sponsor relay's payment-status endpoint or Hiro's tx endpoint based on the
// broadcast's source, then transitions nonce_broadcasts rows pending → confirmed
// or pending → rejected. Phantoms (rejected entries) are surfaced via the return
// value so callers (sensor, soak-report, alert) can act.

import {
  getPendingBroadcasts,
  updateBroadcast,
  type NonceBroadcast,
} from "./schema.js";

const HIRO_API = "https://api.hiro.so";
const PAYMENT_STATUS_BASE = "https://aibtc.com/api/payment-status";

/** How long after broadcast we keep polling before marking a still-pending row as expired. */
const EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

/** Poll backoff: only re-poll if we haven't polled in this long. */
const MIN_POLL_INTERVAL_MS = 30 * 1000; // 30s — relay receipts typically settle in 5-15s

export interface ReconcileTransition {
  id: number;
  address: string;
  nonce: number;
  source: string;
  /** Outcome on this reconciliation pass. "skipped" = poll-interval not yet elapsed. */
  outcome: "confirmed" | "rejected" | "expired" | "still_pending" | "skipped" | "error";
  txid: string | null;
  block_height: number | null;
  detail: string | null;
}

export interface ReconcileSummary {
  polled: number;
  confirmed: number;
  rejected: number;
  expired: number;
  still_pending: number;
  skipped: number;
  errors: number;
  /** Nonces that completed (confirmed or rejected) on this pass. */
  transitions: ReconcileTransition[];
  /** Phantoms = rejected + expired entries — these are gaps on chain that may need gap-fill. */
  phantoms: ReconcileTransition[];
}

interface HiroTxResponse {
  tx_id?: string;
  tx_status?: string;
  block_height?: number | null;
}

interface PaymentStatusResponse {
  paymentId?: string;
  status?: string;
  txid?: string;
  blockHeight?: number;
  confirmedAt?: string;
  error?: string;
}

async function pollDirect(broadcast: NonceBroadcast): Promise<{
  outcome: ReconcileTransition["outcome"];
  txid: string | null;
  block_height: number | null;
  settlement_status: string | null;
  detail: string | null;
}> {
  if (!broadcast.txid) {
    return {
      outcome: "error",
      txid: null,
      block_height: null,
      settlement_status: null,
      detail: "direct-broadcast row has no txid to poll",
    };
  }
  const id = broadcast.txid.startsWith("0x") ? broadcast.txid : `0x${broadcast.txid}`;
  try {
    const res = await fetch(`${HIRO_API}/extended/v1/tx/${id}`);
    if (res.status === 404) {
      return {
        outcome: "still_pending",
        txid: broadcast.txid,
        block_height: null,
        settlement_status: "not_indexed",
        detail: "Hiro returned 404 — could be index lag, holding pending",
      };
    }
    if (!res.ok) {
      return {
        outcome: "error",
        txid: broadcast.txid,
        block_height: null,
        settlement_status: null,
        detail: `Hiro ${res.status} ${res.statusText}`,
      };
    }
    const data = (await res.json()) as HiroTxResponse;
    if (data.tx_status === "success") {
      return {
        outcome: "confirmed",
        txid: broadcast.txid,
        block_height: data.block_height ?? null,
        settlement_status: "success",
        detail: null,
      };
    }
    if (data.tx_status?.startsWith("abort_")) {
      // Abort = tx was processed on chain and aborted by contract logic. Nonce IS consumed.
      // Not a phantom for nonce-tracking purposes — still confirmed in nonce-space.
      return {
        outcome: "confirmed",
        txid: broadcast.txid,
        block_height: data.block_height ?? null,
        settlement_status: data.tx_status,
        detail: `Contract abort — nonce consumed but tx had no effect`,
      };
    }
    if (data.tx_status === "pending") {
      return {
        outcome: "still_pending",
        txid: broadcast.txid,
        block_height: null,
        settlement_status: "pending",
        detail: null,
      };
    }
    if (data.tx_status === "dropped_replace_by_fee" || data.tx_status === "dropped_replace_across_fork" || data.tx_status === "dropped_too_expensive" || data.tx_status === "dropped_stale_garbage_collect") {
      return {
        outcome: "rejected",
        txid: broadcast.txid,
        block_height: null,
        settlement_status: data.tx_status,
        detail: "Mempool drop — nonce was never consumed on chain (phantom)",
      };
    }
    return {
      outcome: "still_pending",
      txid: broadcast.txid,
      block_height: null,
      settlement_status: data.tx_status ?? "unknown",
      detail: `Unhandled tx_status: ${data.tx_status}`,
    };
  } catch (err) {
    return {
      outcome: "error",
      txid: broadcast.txid,
      block_height: null,
      settlement_status: null,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function pollX402(broadcast: NonceBroadcast): Promise<{
  outcome: ReconcileTransition["outcome"];
  txid: string | null;
  block_height: number | null;
  settlement_status: string | null;
  detail: string | null;
}> {
  if (!broadcast.payment_id) {
    return {
      outcome: "error",
      txid: broadcast.txid,
      block_height: null,
      settlement_status: null,
      detail: "x402-relay row has no payment_id to poll",
    };
  }
  try {
    const res = await fetch(`${PAYMENT_STATUS_BASE}/${broadcast.payment_id}`);
    if (!res.ok && res.status !== 404) {
      return {
        outcome: "error",
        txid: broadcast.txid,
        block_height: null,
        settlement_status: null,
        detail: `payment-status ${res.status} ${res.statusText}`,
      };
    }
    const data = (await res.json()) as PaymentStatusResponse;
    const status = (data.status ?? "").toLowerCase();
    if (status === "confirmed") {
      return {
        outcome: "confirmed",
        txid: data.txid ?? broadcast.txid,
        block_height: data.blockHeight ?? null,
        settlement_status: "confirmed",
        detail: null,
      };
    }
    if (status === "failed" || status === "rejected") {
      return {
        outcome: "rejected",
        txid: data.txid ?? broadcast.txid,
        block_height: null,
        settlement_status: status,
        detail: data.error ?? "relay reported failure",
      };
    }
    if (status === "not_found") {
      // Relay forgot it. If the row has a txid, fall back to direct Hiro poll on next pass.
      // For now, hold pending and let TTL expire it.
      return {
        outcome: "still_pending",
        txid: broadcast.txid,
        block_height: null,
        settlement_status: "not_found",
        detail: "Relay reports payment not found — will fall back to TTL expiry",
      };
    }
    // queued, broadcasting, mempool, etc.
    return {
      outcome: "still_pending",
      txid: data.txid ?? broadcast.txid,
      block_height: null,
      settlement_status: status || "unknown",
      detail: null,
    };
  } catch (err) {
    return {
      outcome: "error",
      txid: broadcast.txid,
      block_height: null,
      settlement_status: null,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function shouldPoll(broadcast: NonceBroadcast, now: number): boolean {
  if (!broadcast.last_polled_at) return true;
  const last = new Date(broadcast.last_polled_at + "Z").getTime();
  if (Number.isNaN(last)) return true;
  return now - last >= MIN_POLL_INTERVAL_MS;
}

function isExpired(broadcast: NonceBroadcast, now: number): boolean {
  const broadcastAt = new Date(broadcast.broadcast_at + "Z").getTime();
  if (Number.isNaN(broadcastAt)) return false;
  return now - broadcastAt >= EXPIRY_MS;
}

/**
 * Poll all pending broadcasts and update their status. Pure read+write to nonce_broadcasts;
 * does NOT touch nonce-state.json. The reconciler is conservative — phantoms are surfaced
 * but not auto-gap-filled (that's a separate operator decision).
 *
 * Wraps every per-broadcast poll in try/catch so a single bad row can't break the cycle.
 */
export async function reconcile(address?: string): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    polled: 0,
    confirmed: 0,
    rejected: 0,
    expired: 0,
    still_pending: 0,
    skipped: 0,
    errors: 0,
    transitions: [],
    phantoms: [],
  };

  const pending = getPendingBroadcasts(address);
  const now = Date.now();

  for (const broadcast of pending) {
    if (!shouldPoll(broadcast, now)) {
      summary.skipped++;
      continue;
    }

    let result;
    try {
      if (broadcast.source === "x402-relay") {
        result = await pollX402(broadcast);
      } else if (broadcast.source === "direct") {
        result = await pollDirect(broadcast);
      } else {
        result = {
          outcome: "error" as const,
          txid: broadcast.txid,
          block_height: null,
          settlement_status: null,
          detail: `unknown source: ${broadcast.source}`,
        };
      }
    } catch (err) {
      // Defensive: an unexpected throw inside a poll path must not break the loop.
      result = {
        outcome: "error" as const,
        txid: broadcast.txid,
        block_height: null,
        settlement_status: null,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
    summary.polled++;

    let finalOutcome: ReconcileTransition["outcome"] = result.outcome;

    // TTL: still-pending past EXPIRY_MS becomes expired (a soft phantom).
    if (finalOutcome === "still_pending" && isExpired(broadcast, now)) {
      finalOutcome = "expired";
    }

    try {
      if (finalOutcome === "confirmed") {
        updateBroadcast(broadcast.id, {
          status: "confirmed",
          txid: result.txid,
          settlement_status: result.settlement_status,
          block_height: result.block_height,
          last_error: null,
          bumpPoll: true,
        });
        summary.confirmed++;
      } else if (finalOutcome === "rejected") {
        updateBroadcast(broadcast.id, {
          status: "rejected",
          settlement_status: result.settlement_status,
          last_error: result.detail,
          bumpPoll: true,
        });
        summary.rejected++;
      } else if (finalOutcome === "expired") {
        updateBroadcast(broadcast.id, {
          status: "expired",
          settlement_status: result.settlement_status ?? "ttl_exceeded",
          last_error: result.detail ?? `No terminal status after ${EXPIRY_MS / 60000}m`,
          bumpPoll: true,
        });
        summary.expired++;
      } else if (finalOutcome === "still_pending") {
        updateBroadcast(broadcast.id, {
          settlement_status: result.settlement_status,
          last_error: result.detail,
          bumpPoll: true,
        });
        summary.still_pending++;
      } else {
        // error
        updateBroadcast(broadcast.id, {
          last_error: result.detail,
          bumpPoll: true,
        });
        summary.errors++;
      }
    } catch {
      // DB write failure shouldn't break the rest of the cycle.
      summary.errors++;
    }

    if (finalOutcome === "confirmed" || finalOutcome === "rejected" || finalOutcome === "expired") {
      const transition: ReconcileTransition = {
        id: broadcast.id,
        address: broadcast.address,
        nonce: broadcast.nonce,
        source: broadcast.source,
        outcome: finalOutcome,
        txid: result.txid,
        block_height: result.block_height,
        detail: result.detail,
      };
      summary.transitions.push(transition);
      if (finalOutcome === "rejected" || finalOutcome === "expired") {
        summary.phantoms.push(transition);
      }
    }
  }

  return summary;
}
