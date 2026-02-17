/**
 * AIBTC Heartbeat Sensor
 *
 * Sends a signed heartbeat to the AIBTC platform every 5 minutes,
 * proving the agent is alive and authenticated.
 *
 * Pattern:
 * - Sign a timestamped message using BIP-137 (Stacks wallet signing)
 * - POST the signed heartbeat to the AIBTC API
 * - Emit a sensor:observation with the result
 *
 * Signing requirement:
 * This sensor uses a placeholder signing function. To use it in production,
 * replace `signMessage` below with a real implementation.
 *
 * Options for real signing:
 * 1. @aibtc/mcp-server — MCP tool `stacks_sign_message` handles signing
 *    via the AIBTC wallet integration. See: https://github.com/aibtcdev/aibtc-mcp-server
 * 2. @stacks/transactions — Use `signWithKey` from the Stacks JS library
 * 3. External signer — Call an HSM or vault that holds the private key
 *
 * Registration (add to src/index.ts):
 * ```typescript
 * import { observeHeartbeat } from "./sensors/aibtc-heartbeat";
 * import { scheduler, minutes } from "./server/scheduler";
 *
 * scheduler.register({
 *   name: "aibtc-heartbeat",
 *   intervalMs: minutes(5),
 *   fn: observeHeartbeat,
 * });
 * ```
 */

import { eventBus } from "../server/events";
import { writeEvent } from "../memory/event-history";

/**
 * AIBTC config shape (subset of config/example-config.json)
 */
interface AibtcConfig {
  stxAddress?: string;
  aibtcApiBase?: string;
}

/**
 * Heartbeat payload sent to the AIBTC API
 */
interface HeartbeatPayload {
  stxAddress: string;
  timestamp: string;
  signature: string;
}

/**
 * Result returned from the AIBTC heartbeat endpoint
 */
interface HeartbeatResult {
  success: boolean;
  status?: string;
  error?: string;
  respondedAt?: string;
}

/**
 * Observation returned by this sensor
 */
export interface HeartbeatObservation {
  source: "aibtc-heartbeat";
  timestamp: number;
  data: HeartbeatResult & { stxAddress: string };
}

/**
 * Placeholder: sign a message with the agent's Stacks private key.
 *
 * Replace this with a real implementation using @aibtc/mcp-server or
 * @stacks/transactions. The message format follows BIP-137 conventions
 * used by the Stacks ecosystem.
 *
 * @param message - The message to sign (typically a timestamped string)
 * @returns Base64-encoded signature string
 */
async function signMessage(message: string): Promise<string> {
  // PLACEHOLDER: Return a mock signature.
  // In production, call your signing service here.
  //
  // Example with @aibtc/mcp-server (via MCP tool call):
  //   const result = await mcpClient.callTool("stacks_sign_message", { message });
  //   return result.signature;
  //
  // Example with @stacks/transactions:
  //   import { signWithKey } from "@stacks/transactions";
  //   return signWithKey(privateKey, message);
  void message; // suppress unused warning in placeholder
  return "placeholder-signature-replace-with-real-signing";
}

/**
 * Load AIBTC config from the project config file.
 * Falls back gracefully if the file doesn't exist or is missing keys.
 */
async function loadConfig(): Promise<AibtcConfig> {
  try {
    const configPath = new URL("../../config/config.json", import.meta.url);
    const file = Bun.file(configPath);
    if (!(await file.exists())) {
      // Fall back to example-config
      const examplePath = new URL(
        "../../config/example-config.json",
        import.meta.url
      );
      const example = await Bun.file(examplePath).json();
      return (example.aibtc as AibtcConfig) ?? {};
    }
    const config = await file.json();
    return (config.aibtc as AibtcConfig) ?? {};
  } catch {
    return {};
  }
}

/**
 * Observe: send a signed heartbeat to the AIBTC platform.
 *
 * Returns an observation with the API response.
 * Emits `sensor:observation` so other components can react.
 * Skips gracefully if stxAddress is not configured.
 */
export async function observeHeartbeat(): Promise<HeartbeatObservation> {
  const config = await loadConfig();
  const now = Date.now();
  const timestamp = new Date(now).toISOString();

  // Fail gracefully if not configured
  if (!config.stxAddress) {
    const observation: HeartbeatObservation = {
      source: "aibtc-heartbeat",
      timestamp: now,
      data: {
        stxAddress: "",
        success: false,
        error: "not configured: missing aibtc.stxAddress in config",
      },
    };
    return observation;
  }

  const apiBase = config.aibtcApiBase ?? "https://aibtc.com/api";
  const stxAddress = config.stxAddress;

  let result: HeartbeatResult;

  try {
    // Build the message to sign: "heartbeat:{address}:{timestamp}"
    const message = `heartbeat:${stxAddress}:${timestamp}`;
    const signature = await signMessage(message);

    const payload: HeartbeatPayload = { stxAddress, timestamp, signature };

    const response = await fetch(`${apiBase}/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000), // 10s timeout
    });

    if (response.ok) {
      const body = (await response.json()) as Record<string, unknown>;
      result = {
        success: true,
        status: (body.status as string) ?? "ok",
        respondedAt: new Date().toISOString(),
      };
    } else {
      result = {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }
  } catch (err) {
    result = {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const observation: HeartbeatObservation = {
    source: "aibtc-heartbeat",
    timestamp: now,
    data: { stxAddress, ...result },
  };

  // Emit event for other components to react
  eventBus.emit("sensor:observation", {
    source: observation.source,
    data: observation.data,
  });

  // Persist to event history (dedup by minute to avoid noise on retries)
  const dedupKey = `heartbeat:${stxAddress}:${timestamp.slice(0, 16)}`; // minute precision
  writeEvent({
    timestamp,
    eventType: "sensor:observation",
    source: "aibtc-heartbeat",
    payload: observation.data,
    dedupKey,
  });

  return observation;
}
