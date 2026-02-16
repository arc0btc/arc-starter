/**
 * Example Tests
 *
 * Demonstrates testing patterns for arc-starter sensors and query tools.
 * Uses bun:test framework (built-in to Bun).
 *
 * Run tests: bun test
 */

import { describe, test, expect } from "bun:test";
import {
  observeTime,
  observeMockAPI,
  type Observation,
} from "../sensors/example-sensor";
import {
  queryStatus,
  queryData,
  queryAggregate,
} from "../query-tools/example-query";

/**
 * Test Suite: Example Sensor
 *
 * Sensors should:
 * - Return Observation objects
 * - Have correct structure (source, timestamp, data)
 * - Emit events (tested via event bus integration tests)
 */
describe("Example Sensor", () => {
  describe("observeTime", () => {
    test("returns observation with correct structure", async () => {
      const obs: Observation = await observeTime();

      // Check required fields
      expect(obs.source).toBe("time-sensor");
      expect(obs.timestamp).toBeGreaterThan(0);
      expect(obs.data).toBeDefined();
    });

    test("data contains time information", async () => {
      const obs = await observeTime();
      const data = obs.data as {
        iso: string;
        unix: number;
        dayOfWeek: string;
      };

      // Check data shape
      expect(data.iso).toBeDefined();
      expect(data.unix).toBeGreaterThan(0);
      expect(data.dayOfWeek).toBeDefined();

      // Check types
      expect(typeof data.iso).toBe("string");
      expect(typeof data.unix).toBe("number");
      expect(typeof data.dayOfWeek).toBe("string");
    });

    test("timestamp matches data.unix", async () => {
      const obs = await observeTime();
      const data = obs.data as { unix: number };

      // Timestamp should be close to data.unix (within 10ms)
      expect(Math.abs(obs.timestamp - data.unix)).toBeLessThan(10);
    });
  });

  describe("observeMockAPI", () => {
    test("returns observation with correct structure", async () => {
      const obs: Observation = await observeMockAPI();

      // Check required fields
      expect(obs.source).toBe("mock-api");
      expect(obs.timestamp).toBeGreaterThan(0);
      expect(obs.data).toBeDefined();
    });

    test("data contains mock API response", async () => {
      const obs = await observeMockAPI();
      const data = obs.data as {
        status: string;
        value: number;
        message: string;
      };

      // Check data shape
      expect(data.status).toBe("healthy");
      expect(data.value).toBeGreaterThanOrEqual(0);
      expect(data.value).toBeLessThanOrEqual(100);
      expect(data.message).toBeDefined();
    });

    test("simulates async delay", async () => {
      const start = Date.now();
      await observeMockAPI();
      const duration = Date.now() - start;

      // Should take at least 100ms (simulated delay)
      expect(duration).toBeGreaterThanOrEqual(100);
    });
  });
});

/**
 * Test Suite: Example Query Tools
 *
 * Query tools should:
 * - Take input, return output (request-response)
 * - Handle both success and error cases
 * - Return consistent types
 */
describe("Example Query Tools", () => {
  describe("queryStatus", () => {
    test("returns status object", () => {
      const status = queryStatus();

      expect(status.status).toBe("running");
      expect(status.uptime).toBeGreaterThanOrEqual(0);
      expect(status.timestamp).toBeDefined();
    });

    test("timestamp is valid ISO 8601 string", () => {
      const status = queryStatus();

      // Should be parseable as date
      const date = new Date(status.timestamp);
      expect(date.toString()).not.toBe("Invalid Date");
    });

    test("uptime matches process.uptime()", () => {
      const status = queryStatus();
      const processUptime = process.uptime();

      // Should be close (within 1 second)
      expect(Math.abs(status.uptime - processUptime)).toBeLessThan(1);
    });
  });

  describe("queryData", () => {
    test("returns found data for valid ID", async () => {
      const result = await queryData("1");

      expect(result.id).toBe("1");
      expect(result.found).toBe(true);
      expect(result.data).toBeDefined();
    });

    test("returns not found for invalid ID", async () => {
      const result = await queryData("999");

      expect(result.id).toBe("999");
      expect(result.found).toBe(false);
      expect(result.data).toBeNull();
    });

    test("handles multiple valid IDs", async () => {
      const results = await Promise.all([
        queryData("1"),
        queryData("2"),
        queryData("3"),
      ]);

      expect(results.every((r) => r.found)).toBe(true);
      expect(results.every((r) => r.data !== null)).toBe(true);
    });

    test("data has correct shape for valid ID", async () => {
      const result = await queryData("1");
      const data = result.data as { name: string; value: number };

      expect(data.name).toBe("Item One");
      expect(data.value).toBe(100);
    });
  });

  describe("queryAggregate", () => {
    test("returns aggregate object", async () => {
      const result = await queryAggregate();

      expect(result.sources).toBeDefined();
      expect(result.total).toBeDefined();
      expect(result.timestamp).toBeDefined();
    });

    test("sources is an array", async () => {
      const result = await queryAggregate();

      expect(Array.isArray(result.sources)).toBe(true);
      expect(result.sources.length).toBeGreaterThan(0);
    });

    test("total is sum of values", async () => {
      const result = await queryAggregate();

      // Mock implementation sums [10, 20, 30] = 60
      expect(result.total).toBe(60);
    });

    test("timestamp is valid ISO 8601 string", async () => {
      const result = await queryAggregate();

      const date = new Date(result.timestamp);
      expect(date.toString()).not.toBe("Invalid Date");
    });
  });
});

/**
 * Integration Test: Verify exports are accessible
 *
 * These tests ensure the module structure is correct
 * and all expected exports are available.
 */
describe("Module Exports", () => {
  test("sensor exports are functions", () => {
    expect(typeof observeTime).toBe("function");
    expect(typeof observeMockAPI).toBe("function");
  });

  test("query tool exports are functions", () => {
    expect(typeof queryStatus).toBe("function");
    expect(typeof queryData).toBe("function");
    expect(typeof queryAggregate).toBe("function");
  });
});
