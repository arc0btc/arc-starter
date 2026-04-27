import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate the nonce-state JSON per test run via the env-overridable path.
const tmpDir = mkdtempSync(join(tmpdir(), "nonce-store-test-"));
const tmpStatePath = join(tmpDir, "nonce-state.json");
process.env.NONCE_STATE_PATH = tmpStatePath;

// Import AFTER setting env so the module captures the right path.
const { acquireNonce, releaseNonce, syncNonce, getStatus } = await import("./nonce-store.ts");
const { initNonceManagerSchema, getBroadcast, getPendingBroadcasts } = await import("./schema.ts");
const { initDatabase } = await import("../../src/db.ts");

// Each test uses a unique synthetic address so test rows don't collide with each other or production.
function testAddress(): string {
  return "SP_TEST_" + Math.random().toString(36).slice(2, 14).toUpperCase();
}

beforeAll(() => {
  initDatabase();
  initNonceManagerSchema();
});

afterAll(() => {
  // Tear down the temp state dir (lock dir lives there too).
  if (existsSync(tmpStatePath)) unlinkSync(tmpStatePath);
  rmSync(tmpDir, { recursive: true, force: true });
  // Clean up test rows from the shared SQLite DB so the reconciler doesn't
  // chase fake txids against Hiro on the next sensor cycle.
  try {
    const db = initDatabase();
    db.query("DELETE FROM nonce_broadcasts WHERE address LIKE 'SP_TEST_%'").run();
  } catch {
    // best effort — production data on real addresses is never matched by this prefix.
  }
});

beforeEach(() => {
  // Each test starts with a fresh state file by deleting any stale state for the previous test.
  if (existsSync(tmpStatePath)) unlinkSync(tmpStatePath);
});

// Mock Hiro nonce fetch for deterministic tests.
function mockHiroNonce(possibleNext: number, lastExecuted: number | null = null): void {
  globalThis.fetch = (async (url: string | URL) => {
    const u = url.toString();
    if (u.includes("/nonces")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return {
            possible_next_nonce: possibleNext,
            last_executed_tx_nonce: lastExecuted,
            detected_mempool_nonces: [],
            detected_missing_nonces: [],
          };
        },
      } as Response;
    }
    throw new Error(`unexpected fetch in test: ${u}`);
  }) as typeof fetch;
}

describe("acquireNonce", () => {
  test("hands out sequential nonces and tracks each in inFlight (L4b regression)", async () => {
    const addr = testAddress();
    mockHiroNonce(100);

    const a = await acquireNonce(addr);
    const b = await acquireNonce(addr);
    const c = await acquireNonce(addr);

    expect(a.nonce).toBe(100);
    expect(b.nonce).toBe(101);
    expect(c.nonce).toBe(102);

    const status = getStatus(addr) as { nextNonce: number; inFlight: number[] };
    expect(status.nextNonce).toBe(103);
    expect(status.inFlight.sort()).toEqual([100, 101, 102]);
  });

  test("never advances nextNonce without pushing to inFlight (atomic)", async () => {
    const addr = testAddress();
    mockHiroNonce(200);

    // Concurrent acquires under the same withLock — every returned nonce must be tracked.
    const results = await Promise.all([
      acquireNonce(addr),
      acquireNonce(addr),
      acquireNonce(addr),
      acquireNonce(addr),
      acquireNonce(addr),
    ]);

    const returnedNonces = results.map((r) => r.nonce).sort((a, b) => a - b);
    const status = getStatus(addr) as { nextNonce: number; inFlight: number[] };

    expect(status.nextNonce).toBe(returnedNonces[returnedNonces.length - 1] + 1);
    expect(status.inFlight.sort((a, b) => a - b)).toEqual(returnedNonces);
  });
});

describe("releaseNonce", () => {
  test("success removes from inFlight, no rollback", async () => {
    const addr = testAddress();
    mockHiroNonce(300);
    const { nonce } = await acquireNonce(addr);
    const result = await releaseNonce(addr, nonce, true);

    expect(result.action).toBe("confirmed");
    const status = getStatus(addr) as { nextNonce: number; inFlight: number[] };
    expect(status.nextNonce).toBe(301);
    expect(status.inFlight).toEqual([]);
  });

  test("rejected with rollback restores nextNonce when this was the latest acquire", async () => {
    const addr = testAddress();
    mockHiroNonce(400);
    const { nonce } = await acquireNonce(addr);
    const result = await releaseNonce(addr, nonce, false, "rejected");

    expect(result.action).toBe("rolled_back");
    const status = getStatus(addr) as { nextNonce: number; inFlight: number[] };
    expect(status.nextNonce).toBe(400);
    expect(status.inFlight).toEqual([]);
  });

  test("rejected without rollback when a later acquire happened in between", async () => {
    const addr = testAddress();
    mockHiroNonce(500);
    const a = await acquireNonce(addr); // 500
    const b = await acquireNonce(addr); // 501
    // Release the EARLIER nonce as rejected — can't rollback nextNonce because a later
    // one was handed out. Just removes from inFlight.
    const result = await releaseNonce(addr, a.nonce, false, "rejected");

    expect(result.action).toBe("noted");
    const status = getStatus(addr) as { nextNonce: number; inFlight: number[] };
    expect(status.nextNonce).toBe(502);
    expect(status.inFlight).toEqual([b.nonce]);
  });

  test("broadcast with broadcastInfo persists a row in nonce_broadcasts (L4 wiring)", async () => {
    const addr = testAddress();
    mockHiroNonce(600);
    const { nonce } = await acquireNonce(addr);
    await releaseNonce(addr, nonce, true, undefined, {
      source: "x402-relay",
      paymentId: "test-payment-1",
      txid: "deadbeef",
      context: JSON.stringify({ test: "release-broadcast" }),
    });

    const row = getBroadcast(addr, nonce);
    expect(row).not.toBeNull();
    expect(row?.source).toBe("x402-relay");
    expect(row?.payment_id).toBe("test-payment-1");
    expect(row?.txid).toBe("deadbeef");
    expect(row?.status).toBe("pending");
  });

  test("rejected with broadcastInfo does NOT persist a row (no chain-bound tx)", async () => {
    const addr = testAddress();
    mockHiroNonce(700);
    const { nonce } = await acquireNonce(addr);
    await releaseNonce(addr, nonce, false, "rejected", {
      source: "x402-relay",
      paymentId: "should-not-persist",
    });

    const row = getBroadcast(addr, nonce);
    expect(row).toBeNull();
  });

  test("broadcast without broadcastInfo still releases cleanly (legacy callers)", async () => {
    const addr = testAddress();
    mockHiroNonce(800);
    const { nonce } = await acquireNonce(addr);
    const result = await releaseNonce(addr, nonce, true);

    expect(result.action).toBe("confirmed");
    // No row written because no broadcastInfo.
    expect(getBroadcast(addr, nonce)).toBeNull();
  });
});

describe("syncNonce", () => {
  test("preserves inFlight across sync — never rolls back nextNonce below max(inFlight)+1", async () => {
    const addr = testAddress();
    mockHiroNonce(900);
    await acquireNonce(addr); // 900
    await acquireNonce(addr); // 901

    // Hiro now reports a stale-low possible_next_nonce (e.g., index lag pretending we're at 850).
    mockHiroNonce(850, 849);
    const result = await syncNonce(addr);

    // sync should never lose track of acquired-but-pending nonces.
    expect(result.nonce).toBe(850); // Hiro's view is what we return as "nonce" (possible_next_nonce)
    const status = getStatus(addr) as { nextNonce: number; inFlight: number[] };
    expect(status.nextNonce).toBeGreaterThanOrEqual(902); // protected against rollback
    expect(status.inFlight).toEqual([900, 901]);
  });
});

describe("getPendingBroadcasts", () => {
  test("returns only pending entries for the given address", async () => {
    const addr1 = testAddress();
    const addr2 = testAddress();
    mockHiroNonce(1000);
    const { nonce: n1 } = await acquireNonce(addr1);
    await releaseNonce(addr1, n1, true, undefined, {
      source: "direct",
      txid: "addr1-tx",
    });
    mockHiroNonce(2000);
    const { nonce: n2 } = await acquireNonce(addr2);
    await releaseNonce(addr2, n2, true, undefined, {
      source: "direct",
      txid: "addr2-tx",
    });

    const a1pending = getPendingBroadcasts(addr1);
    const a2pending = getPendingBroadcasts(addr2);
    expect(a1pending.length).toBe(1);
    expect(a1pending[0]?.txid).toBe("addr1-tx");
    expect(a2pending.length).toBe(1);
    expect(a2pending[0]?.txid).toBe("addr2-tx");
  });
});
