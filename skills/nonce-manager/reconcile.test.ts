import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";

import { reconcile } from "./reconcile.ts";
import { initNonceManagerSchema, recordBroadcast, getBroadcast, updateBroadcast } from "./schema.ts";
import { initDatabase } from "../../src/db.ts";

function testAddress(): string {
  return "SP_RECONCILE_TEST_" + Math.random().toString(36).slice(2, 14).toUpperCase();
}

beforeAll(() => {
  initDatabase();
  initNonceManagerSchema();
});

afterAll(() => {
  // Clean up test rows so the reconciler sensor doesn't chase fake txids in production cycles.
  try {
    const db = initDatabase();
    db.query("DELETE FROM nonce_broadcasts WHERE address LIKE 'SP_RECONCILE_TEST_%'").run();
  } catch {
    // best effort
  }
});

let originalFetch: typeof fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
});

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

interface FetchHandler {
  (url: string): { status: number; body: unknown };
}

function mockFetch(handler: FetchHandler): void {
  globalThis.fetch = (async (url: string | URL) => {
    const u = url.toString();
    const { status, body } = handler(u);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : status === 404 ? "Not Found" : "Error",
      async json() {
        return body;
      },
    } as Response;
  }) as typeof fetch;
}

describe("reconcile — direct broadcasts", () => {
  test("Hiro tx_status: success → confirmed with block_height", async () => {
    const addr = testAddress();
    const txid = "abc123direct";
    recordBroadcast({ address: addr, nonce: 1, source: "direct", txid });

    mockFetch((url) => {
      if (url.includes(`/tx/0x${txid}`)) {
        return { status: 200, body: { tx_status: "success", block_height: 7700000 } };
      }
      throw new Error("unexpected fetch: " + url);
    });

    try {
      const summary = await reconcile(addr);
      expect(summary.confirmed).toBe(1);
      expect(summary.transitions[0]?.block_height).toBe(7700000);
      const row = getBroadcast(addr, 1);
      expect(row?.status).toBe("confirmed");
      expect(row?.block_height).toBe(7700000);
    } finally {
      restoreFetch();
    }
  });

  test("Hiro tx_status: dropped_replace_by_fee → rejected (phantom)", async () => {
    const addr = testAddress();
    recordBroadcast({ address: addr, nonce: 5, source: "direct", txid: "dropped123" });

    mockFetch((url) => {
      if (url.includes("/tx/0x")) {
        return { status: 200, body: { tx_status: "dropped_replace_by_fee" } };
      }
      throw new Error("unexpected fetch: " + url);
    });

    try {
      const summary = await reconcile(addr);
      expect(summary.rejected).toBe(1);
      expect(summary.phantoms.length).toBe(1);
      expect(summary.phantoms[0]?.nonce).toBe(5);
      const row = getBroadcast(addr, 5);
      expect(row?.status).toBe("rejected");
    } finally {
      restoreFetch();
    }
  });

  test("Hiro abort_by_post_condition → confirmed (nonce consumed even on abort)", async () => {
    const addr = testAddress();
    recordBroadcast({ address: addr, nonce: 9, source: "direct", txid: "aborted123" });

    mockFetch(() => ({
      status: 200,
      body: { tx_status: "abort_by_post_condition", block_height: 7700100 },
    }));

    try {
      const summary = await reconcile(addr);
      expect(summary.confirmed).toBe(1);
      expect(summary.phantoms.length).toBe(0);
      const row = getBroadcast(addr, 9);
      expect(row?.status).toBe("confirmed");
      expect(row?.settlement_status).toBe("abort_by_post_condition");
    } finally {
      restoreFetch();
    }
  });

  test("Hiro 404 → still pending (does not assume drop on first miss)", async () => {
    const addr = testAddress();
    recordBroadcast({ address: addr, nonce: 11, source: "direct", txid: "missing123" });

    mockFetch(() => ({ status: 404, body: { error: "not found" } }));

    try {
      const summary = await reconcile(addr);
      expect(summary.still_pending).toBe(1);
      expect(summary.confirmed).toBe(0);
      expect(summary.rejected).toBe(0);
      const row = getBroadcast(addr, 11);
      expect(row?.status).toBe("pending");
      expect(row?.settlement_status).toBe("not_indexed");
    } finally {
      restoreFetch();
    }
  });
});

describe("reconcile — x402-relay broadcasts", () => {
  test("payment-status confirmed → confirmed", async () => {
    const addr = testAddress();
    recordBroadcast({ address: addr, nonce: 21, source: "x402-relay", payment_id: "pay-1" });

    mockFetch((url) => {
      if (url.includes("/payment-status/pay-1")) {
        return {
          status: 200,
          body: { paymentId: "pay-1", status: "confirmed", txid: "tx-1", blockHeight: 7700200 },
        };
      }
      throw new Error("unexpected fetch: " + url);
    });

    try {
      const summary = await reconcile(addr);
      expect(summary.confirmed).toBe(1);
      const row = getBroadcast(addr, 21);
      expect(row?.status).toBe("confirmed");
      expect(row?.txid).toBe("tx-1");
    } finally {
      restoreFetch();
    }
  });

  test("payment-status failed → rejected", async () => {
    const addr = testAddress();
    recordBroadcast({ address: addr, nonce: 22, source: "x402-relay", payment_id: "pay-2" });

    mockFetch(() => ({
      status: 200,
      body: { paymentId: "pay-2", status: "failed", error: "BROADCAST_FAILED" },
    }));

    try {
      const summary = await reconcile(addr);
      expect(summary.rejected).toBe(1);
      expect(summary.phantoms.length).toBe(1);
      expect(summary.phantoms[0]?.detail).toContain("BROADCAST_FAILED");
    } finally {
      restoreFetch();
    }
  });
});

describe("reconcile — defensive behavior", () => {
  test("error in one row doesn't break the rest of the cycle", async () => {
    const addr = testAddress();
    recordBroadcast({ address: addr, nonce: 31, source: "x402-relay", payment_id: "pay-good" });
    recordBroadcast({ address: addr, nonce: 32, source: "direct", txid: "tx-good" });
    recordBroadcast({ address: addr, nonce: 33, source: "direct" /* missing txid → error */ });

    mockFetch((url) => {
      if (url.includes("payment-status/pay-good")) {
        return { status: 200, body: { status: "confirmed", txid: "tx-pay-good" } };
      }
      if (url.includes("/tx/0xtx-good")) {
        return { status: 200, body: { tx_status: "success", block_height: 7700300 } };
      }
      throw new Error("unexpected fetch: " + url);
    });

    try {
      const summary = await reconcile(addr);
      expect(summary.confirmed).toBe(2);
      expect(summary.errors).toBe(1);
      // Bad row stays pending (error doesn't change status, TTL hasn't elapsed yet).
      const badRow = getBroadcast(addr, 33);
      expect(badRow?.status).toBe("pending");
      expect(badRow?.last_error).toContain("neither payment_id nor txid");
    } finally {
      restoreFetch();
    }
  });

  test("network throw is caught and row recorded as error", async () => {
    const addr = testAddress();
    recordBroadcast({ address: addr, nonce: 41, source: "direct", txid: "throw-tx" });

    globalThis.fetch = (async () => {
      throw new Error("network unreachable");
    }) as typeof fetch;

    try {
      const summary = await reconcile(addr);
      expect(summary.errors).toBe(1);
      const row = getBroadcast(addr, 41);
      expect(row?.status).toBe("pending"); // error doesn't transition status
      expect(row?.last_error).toContain("network unreachable");
    } finally {
      restoreFetch();
    }
  });
});

describe("reconcile — receipt-driven fallback", () => {
  test("x402-relay row with no payment_id falls back to Hiro tx poll", async () => {
    // Synchronous x402 settlements (HTTP 200) return a txid in the payment header
    // but no paymentId in the body. Source stays "x402-relay" but the reconciler
    // must poll Hiro by txid instead of erroring out.
    const addr = testAddress();
    recordBroadcast({ address: addr, nonce: 61, source: "x402-relay", txid: "sync-settled-tx" });

    let paymentStatusFetches = 0;
    let hiroFetches = 0;
    mockFetch((url) => {
      if (url.includes("/payment-status/")) {
        paymentStatusFetches++;
        throw new Error("must not poll payment-status without payment_id");
      }
      if (url.includes("/tx/0xsync-settled-tx")) {
        hiroFetches++;
        return { status: 200, body: { tx_status: "success", block_height: 7700400 } };
      }
      throw new Error("unexpected fetch: " + url);
    });

    try {
      const summary = await reconcile(addr);
      expect(summary.confirmed).toBe(1);
      expect(paymentStatusFetches).toBe(0);
      expect(hiroFetches).toBe(1);
      const row = getBroadcast(addr, 61);
      expect(row?.status).toBe("confirmed");
      expect(row?.block_height).toBe(7700400);
    } finally {
      restoreFetch();
    }
  });

  test("row with neither payment_id nor txid → error", async () => {
    const addr = testAddress();
    recordBroadcast({ address: addr, nonce: 62, source: "x402-relay" });

    mockFetch(() => {
      throw new Error("must not fetch when there's nothing to poll");
    });

    try {
      const summary = await reconcile(addr);
      expect(summary.errors).toBe(1);
      const row = getBroadcast(addr, 62);
      expect(row?.status).toBe("pending");
      expect(row?.last_error).toContain("neither payment_id nor txid");
    } finally {
      restoreFetch();
    }
  });

  test("errored row past TTL transitions to expired (phantom)", async () => {
    // A row stuck in error state must surface as a phantom once TTL elapses,
    // otherwise persistent error paths would poll forever with no alarm.
    const addr = testAddress();
    recordBroadcast({ address: addr, nonce: 63, source: "x402-relay" });
    // Backdate broadcast_at by 31 minutes to push past EXPIRY_MS=30min.
    const db = initDatabase();
    db.query("UPDATE nonce_broadcasts SET broadcast_at = datetime('now', '-31 minutes') WHERE address = ? AND nonce = 63").run(addr);

    mockFetch(() => {
      throw new Error("must not fetch when there's nothing to poll");
    });

    try {
      const summary = await reconcile(addr);
      expect(summary.expired).toBe(1);
      expect(summary.phantoms.length).toBe(1);
      expect(summary.phantoms[0]?.outcome).toBe("expired");
      const row = getBroadcast(addr, 63);
      expect(row?.status).toBe("expired");
    } finally {
      restoreFetch();
    }
  });
});

describe("reconcile — poll backoff", () => {
  test("skips rows polled within MIN_POLL_INTERVAL_MS", async () => {
    const addr = testAddress();
    recordBroadcast({ address: addr, nonce: 51, source: "direct", txid: "recent" });
    // Force a recent poll on this row so the next reconcile skips it.
    const row = getBroadcast(addr, 51);
    if (row) updateBroadcast(row.id, { bumpPoll: true });

    let fetched = 0;
    mockFetch(() => {
      fetched++;
      return { status: 200, body: { tx_status: "success", block_height: 1 } };
    });

    try {
      const summary = await reconcile(addr);
      expect(fetched).toBe(0);
      expect(summary.skipped).toBe(1);
      expect(summary.polled).toBe(0);
    } finally {
      restoreFetch();
    }
  });
});
