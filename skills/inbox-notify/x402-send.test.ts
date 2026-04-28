import { describe, expect, test } from "bun:test";
import { classifyRelayFailure } from "./x402-send.ts";

describe("classifyRelayFailure", () => {
  // These error codes are documented in aibtcdev/x402-sponsor-relay README:
  // each represents a state where the relay never broadcast the tx, so the nonce
  // is reusable and we should release as "rejected".
  test.each([
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
  ])("'%s' → rejected", (errorCode) => {
    expect(classifyRelayFailure(undefined, errorCode, undefined)).toBe("rejected");
  });

  // Note: HTTP 202 is the relay's success-pending path (payment accepted, inbox
  // delivery staged). It's handled in the success branch of sendInboxMessage and
  // never reaches classifyRelayFailure.

  test("HTTP 401/403 → rejected (auth failure, never broadcast)", () => {
    expect(classifyRelayFailure(401, undefined, undefined)).toBe("rejected");
    expect(classifyRelayFailure(403, undefined, undefined)).toBe("rejected");
  });

  test("HTTP 400 → rejected (bad request, never broadcast)", () => {
    expect(classifyRelayFailure(400, undefined, undefined)).toBe("rejected");
  });

  test("HTTP 402 (payment challenge) is NOT a failure — still classified as broadcast (handled separately)", () => {
    // 402 isn't really an error in the x402 flow — it's the challenge step. classifyRelayFailure
    // shouldn't be called on the initial 402, but if it is (defensive), we don't want to
    // over-classify it as rejected since the actual outcome is unknown at that point.
    expect(classifyRelayFailure(402, undefined, undefined)).toBe("broadcast");
  });

  test("HTTP 5xx with no error code → broadcast (conservative; reconciler will sort it out)", () => {
    expect(classifyRelayFailure(500, undefined, undefined)).toBe("broadcast");
    expect(classifyRelayFailure(502, undefined, undefined)).toBe("broadcast");
    expect(classifyRelayFailure(503, undefined, undefined)).toBe("broadcast");
  });

  test("undefined http + unknown code → broadcast (safe default)", () => {
    expect(classifyRelayFailure(undefined, undefined, undefined)).toBe("broadcast");
    expect(classifyRelayFailure(undefined, "UNKNOWN_CODE", undefined)).toBe("broadcast");
  });

  test("BROADCAST_FAILED with HTTP 502 → rejected (error code wins over status range)", () => {
    expect(classifyRelayFailure(502, "BROADCAST_FAILED", undefined)).toBe("rejected");
  });
});
