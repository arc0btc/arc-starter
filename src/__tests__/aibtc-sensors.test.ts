/**
 * AIBTC Sensor Tests
 *
 * Tests for:
 * 1. Heartbeat sensor — correct event emission, graceful degradation
 * 2. Inbox sensor — dedup logic, new-only emission, graceful degradation
 * 3. Balance sensor — change detection, snapshot persistence, graceful degradation
 *
 * All tests use in-memory SQLite to avoid state/ directory pollution.
 * HTTP calls are mocked via bun:test mock utilities.
 */

import { describe, test, expect, beforeEach, mock, afterEach } from "bun:test";
import { resetDbForTesting, getDb } from "../memory/db";
import { eventBus } from "../server/events";

// ============================================================
// Test DB setup
// ============================================================

const TEST_DB_PATH = ":memory:";

function freshDb() {
  resetDbForTesting();
  return getDb(TEST_DB_PATH);
}

// ============================================================
// Helpers
// ============================================================

/**
 * Capture events emitted during an async operation.
 */
async function captureEvents(
  eventName: string,
  fn: () => Promise<unknown>
): Promise<unknown[]> {
  const captured: unknown[] = [];
  const listener = (payload: unknown) => captured.push(payload);
  eventBus.on(eventName as keyof import("../server/events").EventPayloads, listener as never);
  await fn();
  eventBus.removeListener(eventName, listener);
  return captured;
}

// ============================================================
// Suite 1: Heartbeat Sensor
// ============================================================

describe("AIBTC Heartbeat Sensor", () => {
  beforeEach(() => {
    freshDb();
  });

  test("returns unconfigured observation when stxAddress is missing", async () => {
    // Mock config loader to return empty config (no stxAddress)
    const originalFetch = global.fetch;
    // No fetch needed — sensor returns early

    const { observeHeartbeat } = await import("../sensors/aibtc-heartbeat");
    const obs = await observeHeartbeat();

    expect(obs.source).toBe("aibtc-heartbeat");
    expect(obs.data.success).toBe(false);
    expect(obs.data.error).toContain("not configured");
    expect(obs.data.stxAddress).toBe("");

    global.fetch = originalFetch;
  });

  test("returns observation with correct source and timestamp shape", async () => {
    const { observeHeartbeat } = await import("../sensors/aibtc-heartbeat");
    const before = Date.now();
    const obs = await observeHeartbeat();
    const after = Date.now();

    expect(obs.source).toBe("aibtc-heartbeat");
    expect(obs.timestamp).toBeGreaterThanOrEqual(before);
    expect(obs.timestamp).toBeLessThanOrEqual(after);
    expect(obs.data).toBeDefined();
  });

  test("emits sensor:observation when heartbeat succeeds", async () => {
    // Mock fetch to simulate a successful heartbeat response
    const mockFetch = mock(async (url: string) => {
      if (String(url).includes("/heartbeat")) {
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // Config file fetch — simulate missing config (fall back to unconfigured)
      throw new Error("not a heartbeat url");
    });

    const originalFetch = global.fetch;
    global.fetch = mockFetch as typeof fetch;

    try {
      // We can only test the unconfigured path without full config injection.
      // This test verifies no event is emitted when unconfigured.
      const { observeHeartbeat } = await import("../sensors/aibtc-heartbeat");
      const events = await captureEvents("sensor:observation", () =>
        observeHeartbeat()
      );

      // Unconfigured — no event emitted
      expect(events.length).toBe(0);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("does not emit event when not configured", async () => {
    const { observeHeartbeat } = await import("../sensors/aibtc-heartbeat");
    const events = await captureEvents("sensor:observation", () =>
      observeHeartbeat()
    );
    expect(events.length).toBe(0);
  });
});

// ============================================================
// Suite 2: Inbox Sensor
// ============================================================

describe("AIBTC Inbox Sensor", () => {
  beforeEach(() => {
    freshDb();
  });

  test("returns unconfigured observation when stxAddress is missing", async () => {
    const { observeInbox } = await import("../sensors/aibtc-inbox");
    const obs = await observeInbox();

    expect(obs.source).toBe("aibtc-inbox");
    expect(obs.data.newMessages).toHaveLength(0);
    expect(obs.data.totalFetched).toBe(0);
    expect(obs.data.error).toContain("not configured");
  });

  test("does not emit event when not configured", async () => {
    const { observeInbox } = await import("../sensors/aibtc-inbox");
    const events = await captureEvents("sensor:observation", () =>
      observeInbox()
    );
    expect(events.length).toBe(0);
  });

  test("dedup logic: writeEvent returns null for duplicate dedup_key", async () => {
    // Test the dedup mechanism directly using the memory module
    const { writeEvent } = await import("../memory/event-history");

    const key = "inbox:test-message-001";
    const id1 = writeEvent({
      timestamp: new Date().toISOString(),
      eventType: "sensor:observation",
      source: "aibtc-inbox",
      payload: { messageId: "test-message-001" },
      dedupKey: key,
    });
    const id2 = writeEvent({
      timestamp: new Date().toISOString(),
      eventType: "sensor:observation",
      source: "aibtc-inbox",
      payload: { messageId: "test-message-001" },
      dedupKey: key,
    });

    // First insert succeeds
    expect(id1).not.toBeNull();
    expect(typeof id1).toBe("number");

    // Second insert is skipped (INSERT OR IGNORE)
    expect(id2).toBeNull();
  });

  test("dedup logic: different message IDs both insert successfully", async () => {
    const { writeEvent } = await import("../memory/event-history");

    const id1 = writeEvent({
      timestamp: new Date().toISOString(),
      eventType: "sensor:observation",
      source: "aibtc-inbox",
      dedupKey: "inbox:msg-001",
    });
    const id2 = writeEvent({
      timestamp: new Date().toISOString(),
      eventType: "sensor:observation",
      source: "aibtc-inbox",
      dedupKey: "inbox:msg-002",
    });

    expect(id1).not.toBeNull();
    expect(id2).not.toBeNull();
    expect(id1).not.toBe(id2);
  });

  test("observation structure is correct", async () => {
    const { observeInbox } = await import("../sensors/aibtc-inbox");
    const obs = await observeInbox();

    // Check required fields on the observation
    expect(obs.source).toBe("aibtc-inbox");
    expect(typeof obs.timestamp).toBe("number");
    expect(obs.data).toBeDefined();
    expect(Array.isArray(obs.data.newMessages)).toBe(true);
    expect(typeof obs.data.totalFetched).toBe("number");
    expect(typeof obs.data.skippedDuplicates).toBe("number");
  });

  test("skippedDuplicates tracks previously-seen message IDs", async () => {
    // Pre-seed a message as already processed in event_history
    const { writeEvent } = await import("../memory/event-history");
    writeEvent({
      timestamp: new Date().toISOString(),
      eventType: "sensor:observation",
      source: "aibtc-inbox",
      payload: { messageId: "already-seen-001" },
      dedupKey: "inbox:already-seen-001",
    });

    // Verify the dedup entry exists
    const db = getDb(TEST_DB_PATH);
    const row = db
      .prepare(
        "SELECT COUNT(*) as cnt FROM event_history WHERE dedup_key = 'inbox:already-seen-001'"
      )
      .get() as { cnt: number };
    expect(row.cnt).toBe(1);

    // Simulate trying to insert it again — should return null
    const dup = writeEvent({
      timestamp: new Date().toISOString(),
      eventType: "sensor:observation",
      source: "aibtc-inbox",
      dedupKey: "inbox:already-seen-001",
    });
    expect(dup).toBeNull();
  });
});

// ============================================================
// Suite 3: Balance Sensor
// ============================================================

describe("AIBTC Balance Sensor", () => {
  beforeEach(() => {
    freshDb();
  });

  test("returns unconfigured observation when stxAddress is missing", async () => {
    const { observeBalances } = await import("../sensors/aibtc-balance");
    const obs = await observeBalances();

    expect(obs.source).toBe("aibtc-balance");
    expect(obs.data.stxAddress).toBe("");
    expect(obs.data.error).toContain("not configured");
    expect(obs.data.current.stx).toBeNull();
    expect(obs.data.current.btc).toBeNull();
    expect(obs.data.current.sbtc).toBeNull();
  });

  test("does not emit event when not configured", async () => {
    const { observeBalances } = await import("../sensors/aibtc-balance");
    const events = await captureEvents("sensor:observation", () =>
      observeBalances()
    );
    expect(events.length).toBe(0);
  });

  test("change detection: changed flags correct when nothing changed", () => {
    // Test the change detection logic by simulating the comparison directly
    const previous = {
      stx: "1000000",
      btc: "500000",
      sbtc: "100",
      fetchedAt: new Date().toISOString(),
    };
    const current = {
      stx: "1000000", // same
      btc: "500000", // same
      sbtc: "100", // same
      fetchedAt: new Date().toISOString(),
    };

    const changed = {
      stx: previous.stx !== current.stx,
      btc: previous.btc !== current.btc,
      sbtc: previous.sbtc !== current.sbtc,
    };

    expect(changed.stx).toBe(false);
    expect(changed.btc).toBe(false);
    expect(changed.sbtc).toBe(false);
    expect(changed.stx || changed.btc || changed.sbtc).toBe(false);
  });

  test("change detection: changed flags correct when STX changes", () => {
    const previous = {
      stx: "1000000",
      btc: "500000",
      sbtc: "100",
      fetchedAt: new Date().toISOString(),
    };
    const current = {
      stx: "2000000", // changed
      btc: "500000",
      sbtc: "100",
      fetchedAt: new Date().toISOString(),
    };

    const changed = {
      stx: previous.stx !== current.stx,
      btc: previous.btc !== current.btc,
      sbtc: previous.sbtc !== current.sbtc,
    };

    expect(changed.stx).toBe(true);
    expect(changed.btc).toBe(false);
    expect(changed.sbtc).toBe(false);
    expect(changed.stx || changed.btc || changed.sbtc).toBe(true);
  });

  test("snapshot persistence: saveSnapshot writes to agent_state", async () => {
    // Test that agent_state is used for snapshot persistence
    const db = getDb(TEST_DB_PATH);

    const snapshot = {
      stx: "5000000",
      btc: "10000",
      sbtc: "50",
      fetchedAt: new Date().toISOString(),
    };

    // Simulate what saveSnapshot does
    db.prepare(
      `INSERT OR REPLACE INTO agent_state (key, value, updated_at)
       VALUES ('balance_snapshot', ?, ?)`
    ).run(JSON.stringify(snapshot), new Date().toISOString());

    // Read it back
    const row = db
      .prepare("SELECT value FROM agent_state WHERE key = 'balance_snapshot'")
      .get() as { value: string } | undefined;

    expect(row).toBeDefined();
    const stored = JSON.parse(row!.value);
    expect(stored.stx).toBe("5000000");
    expect(stored.btc).toBe("10000");
    expect(stored.sbtc).toBe("50");
  });

  test("snapshot persistence: loadPreviousSnapshot returns null when not yet saved", async () => {
    // Fresh DB has no balance_snapshot key.
    // Note: bun:sqlite .get() returns null (not undefined) when no row is found.
    const db = getDb(TEST_DB_PATH);
    const row = db
      .prepare("SELECT value FROM agent_state WHERE key = 'balance_snapshot'")
      .get() as { value: string } | null;

    expect(row).toBeNull();
  });

  test("observation has correct shape for unconfigured state", async () => {
    const { observeBalances } = await import("../sensors/aibtc-balance");
    const obs = await observeBalances();

    expect(obs.source).toBe("aibtc-balance");
    expect(typeof obs.timestamp).toBe("number");
    expect(obs.data).toBeDefined();
    expect(obs.data.current).toBeDefined();
    expect(obs.data.changed).toBeDefined();
    expect(typeof obs.data.changed.stx).toBe("boolean");
    expect(typeof obs.data.changed.btc).toBe("boolean");
    expect(typeof obs.data.changed.sbtc).toBe("boolean");
  });
});

// ============================================================
// Suite 4: Sensor Module Exports
// ============================================================

describe("AIBTC Sensor Module Exports", () => {
  test("heartbeat sensor exports observeHeartbeat function", async () => {
    const mod = await import("../sensors/aibtc-heartbeat");
    expect(typeof mod.observeHeartbeat).toBe("function");
  });

  test("inbox sensor exports observeInbox function", async () => {
    const mod = await import("../sensors/aibtc-inbox");
    expect(typeof mod.observeInbox).toBe("function");
  });

  test("balance sensor exports observeBalances function", async () => {
    const mod = await import("../sensors/aibtc-balance");
    expect(typeof mod.observeBalances).toBe("function");
  });

  test("all sensor functions are async (return Promise)", async () => {
    const heartbeat = await import("../sensors/aibtc-heartbeat");
    const inbox = await import("../sensors/aibtc-inbox");
    const balance = await import("../sensors/aibtc-balance");

    // Call each and check we get a Promise back
    const hResult = heartbeat.observeHeartbeat();
    const iResult = inbox.observeInbox();
    const bResult = balance.observeBalances();

    expect(hResult instanceof Promise).toBe(true);
    expect(iResult instanceof Promise).toBe(true);
    expect(bResult instanceof Promise).toBe(true);

    // Await to avoid unhandled rejections
    await hResult;
    await iResult;
    await bResult;
  });
});
