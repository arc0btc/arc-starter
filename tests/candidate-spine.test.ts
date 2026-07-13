import { describe, expect, test } from "bun:test";
import { normalizeIncidentKey } from "../src/candidate-spine.ts";

describe("normalizeIncidentKey", () => {
  test("collapses near-identical viral-story titles to the same key", () => {
    // The actual BridgeMind/Stripe incident (candidate-maturation-incident-vs-
    // tweet-dedup-churn, 2026-07-13) — five sibling tweets carried slightly
    // different punctuation/casing of the same discovery_context.
    const a = normalizeIncidentKey("BridgeMind: GPT-5.6 Sol cancels ALL Stripe subscriptions!");
    const b = normalizeIncidentKey("bridgemind gpt-5.6 sol cancels all stripe subscriptions");
    const c = normalizeIncidentKey("BridgeMind — GPT-5.6 Sol cancels all Stripe subscriptions.");
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  test("distinct stories produce distinct keys", () => {
    const a = normalizeIncidentKey("BridgeMind GPT-5.6 Sol cancels all Stripe subscriptions");
    const b = normalizeIncidentKey("Robinhood opens agentic crypto accounts via MCP");
    expect(a).not.toBe(b);
  });

  test("null/empty/whitespace-only context returns null, never matches another null", () => {
    expect(normalizeIncidentKey(null)).toBeNull();
    expect(normalizeIncidentKey(undefined)).toBeNull();
    expect(normalizeIncidentKey("")).toBeNull();
    expect(normalizeIncidentKey("   ")).toBeNull();
  });

  test("collapses internal whitespace differences", () => {
    const a = normalizeIncidentKey("Robinhood   opens agentic  crypto accounts");
    const b = normalizeIncidentKey("Robinhood opens agentic crypto accounts");
    expect(a).toBe(b);
  });
});
